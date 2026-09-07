import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyseSession } from '../src/session'
import { renderReport } from '../src/report'
import { applyOperation } from '../src/replay'
import { findUndone } from '../src/reverts'
import type { Operation } from '../src/types'

interface Case {
  name: string
  records: unknown[]
  /** Records for a second, subagent transcript, read after the main one. */
  subagentRecords?: unknown[]
  expect: (report: Awaited<ReturnType<typeof analyseSession>>) => boolean
}

const prompt = (uuid: string, id: string, mode: string, parent: string | null) => ({
  type: 'user', uuid, parentUuid: parent, promptId: id, permissionMode: mode,
  timestamp: '2026-09-07T19:00:00Z', sessionId: 's', cwd: '/repo', gitBranch: 'main',
  message: { content: `prompt ${id}` },
})

const edit = (uuid: string, parent: string, file: string, from: string, to: string, sidechain = false) => ({
  type: 'assistant', uuid, parentUuid: parent, timestamp: '2026-09-07T19:10:00Z', isSidechain: sidechain,
  message: { content: [{ type: 'tool_use', id: `t-${uuid}`, name: 'Edit', input: { file_path: file, old_string: from, new_string: to } }] },
})

const write = (uuid: string, parent: string, file: string, content: string) => ({
  type: 'assistant', uuid, parentUuid: parent, timestamp: '2026-09-07T19:20:00Z', isSidechain: false,
  message: { content: [{ type: 'tool_use', id: `t-${uuid}`, name: 'Write', input: { file_path: file, content } }] },
})

/** A record shaped exactly like a genuine prompt, except for the field that tells them apart. */
const systemPrompt = (uuid: string, parent: string) => ({
  type: 'user', uuid, parentUuid: parent, promptId: `sys-${uuid}`, permissionMode: 'default',
  timestamp: '2026-09-07T19:01:00Z', sessionId: 's', cwd: '/repo', gitBranch: 'main',
  promptSource: 'system',
  message: { content: 'injected task notification' },
})

/** An edit at an arbitrary timestamp, for cases that plant a specific chronology. */
const editAt = (uuid: string, parent: string, file: string, from: string, to: string, at: string, sidechain = false) => ({
  type: 'assistant', uuid, parentUuid: parent, timestamp: at, isSidechain: sidechain,
  message: { content: [{ type: 'tool_use', id: `t-${uuid}`, name: 'Edit', input: { file_path: file, old_string: from, new_string: to } }] },
})

const CASES: Case[] = [
  {
    name: 'a change under default mode is decided',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y')],
    expect: (r) => r.totals.decided.files === 1 && r.totals.auto.files === 0 && r.totals.subagent.files === 0,
  },
  {
    name: 'a change under acceptEdits is auto',
    records: [prompt('u1', 'p1', 'acceptEdits', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y')],
    expect: (r) => r.totals.auto.files === 1 && r.totals.decided.files === 0,
  },
  {
    name: 'a change inside a subagent beats the mode',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y', true)],
    expect: (r) => r.totals.subagent.files === 1 && r.totals.decided.files === 0,
  },
  {
    name: 'an unrecognised mode is auto and is named',
    records: [prompt('u1', 'p1', 'somethingNew', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y')],
    expect: (r) => r.totals.auto.files === 1 && r.unrecognisedModes.includes('somethingNew'),
  },
  {
    name: 'an inverse pair is one reverted change',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y'), edit('a2', 'a1', '/repo/a.ts', 'y', 'x')],
    expect: (r) => r.undone.length === 1 && r.undone[0]?.kind === 'reverted',
  },
  {
    name: 'a replacement by something else is overwritten',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y'), edit('a2', 'a1', '/repo/a.ts', 'y', 'z')],
    expect: (r) => r.undone.length === 1 && r.undone[0]?.kind === 'overwritten',
  },
  {
    name: 'a whole-file write discards what came before it',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y'), write('a2', 'a1', '/repo/a.ts', 'unrelated')],
    expect: (r) => r.undone.length === 1 && r.undone[0]?.kind === 'discarded',
  },
  {
    name: 'a change that survives is not reported as undone',
    records: [prompt('u1', 'p1', 'default', null), edit('a1', 'u1', '/repo/a.ts', 'x', 'y')],
    expect: (r) => r.undone.length === 0,
  },
  {
    name: 'a malformed line is counted and does not lose the records around it',
    records: [prompt('u1', 'p1', 'default', null), '{ not json', edit('a1', 'u1', '/repo/a.ts', 'x', 'y')],
    expect: (r) => r.skippedLines === 1 && r.totals.decided.files === 1,
  },
  {
    name: 'attribution reaches the prompt several hops up',
    records: [
      prompt('u1', 'p1', 'default', null),
      { type: 'assistant', uuid: 'a0', parentUuid: 'u1' },
      { type: 'user', uuid: 'r0', parentUuid: 'a0', isMeta: true, message: { content: [{ type: 'tool_result' }] } },
      edit('a1', 'r0', '/repo/a.ts', 'x', 'y'),
    ],
    expect: (r) => r.byPrompt[0]?.files === 1,
  },

  // --- Six defects that escaped every case above and were only caught against a
  // real transcript or by adversarial review. Each one printed a confident, wrong
  // report. See task-14-report.md for the two demonstrated by reverting their fix.

  {
    name: 'a system-injected record is not counted as a prompt',
    records: [
      prompt('u1', 'p1', 'default', null),
      systemPrompt('s1', 'u1'),
      systemPrompt('s2', 's1'),
    ],
    // p1 carries no promptSource at all, the shape of every transcript older than
    // this field, and must still count. s1 and s2 carry promptSource: 'system' and
    // must not, even though they otherwise look exactly like a typed prompt.
    expect: (r) => r.prompts.length === 1 && r.prompts[0]?.id === 'p1',
  },
  {
    name: 'operations are ordered by timestamp, not by which transcript was read first',
    records: [editAt('a1', 'u0', '/repo/order.ts', 'q', 'p', '2026-09-07T19:10:00Z')],
    // The main transcript is read first (and so observed first) even though this
    // operation happened second: the subagent op below carries an earlier
    // timestamp. A ledger that trusts observation order over the timestamp
    // reports the pair backwards.
    subagentRecords: [editAt('b1', 'u0', '/repo/order.ts', 'p', 'q', '2026-09-07T19:00:00Z')],
    expect: (r) => {
      const u = r.undone[0]
      return r.undone.length === 1 && u !== undefined && u.introduced.at < u.undoneBy.at
    },
  },
  {
    name: 'a phantom trailing line is not counted',
    records: [prompt('u1', 'p1', 'default', null), write('a1', 'u1', '/repo/w.ts', 'line1\nline2\nline3\n')],
    // split('\n') on content ending in a newline yields a trailing empty element.
    // The real file holds three lines, not four.
    expect: (r) => r.totals.decided.added === 3,
  },
  {
    name: 'escape sequences and a bidi override do not survive into the rendered report',
    records: [
      {
        type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1',
        permissionMode: 'default\x1b[2Jmode‮',
        timestamp: '2026-09-07T19:00:00Z', sessionId: 's',
        cwd: '/repo\x1b[2J‮/etc/passwd',
        gitBranch: 'main‮\x1b]0;evil\x07',
        message: { content: 'prompt p1' },
      },
      edit('a1', 'u1', '/repo/a.ts', 'x', 'y'),
    ],
    expect: (r) => {
      const rendered = renderReport(r)
      return !rendered.includes('\x1b') && !rendered.includes('‮')
    },
  },
]

/** One line of harness output, plus whatever bookkeeping keeps the exit code honest. */
async function runCase(dir: string, test: Case): Promise<boolean> {
  const slug = test.name.replace(/\W+/g, '-')
  const path = join(dir, `${slug}.jsonl`)
  const body = test.records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')
  await writeFile(path, body)

  const subagents: string[] = []
  if (test.subagentRecords !== undefined) {
    const subPath = join(dir, `${slug}-subagent.jsonl`)
    const subBody = test.subagentRecords.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')
    await writeFile(subPath, subBody)
    subagents.push(subPath)
  }

  const report = await analyseSession({ transcript: path, subagents })
  const ok = test.expect(report)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${test.name}`)
  if (!ok) {
    console.log(JSON.stringify({ totals: report.totals, undone: report.undone.map((u) => u.kind), modes: report.unrecognisedModes, skipped: report.skippedLines }, null, 2))
  }
  return ok
}

/** A planted case that checks a function's return value directly, without a transcript. */
interface DirectCase {
  name: string
  run: () => boolean
  detail: () => unknown
}

const op = (overrides: Partial<Operation>): Operation => ({
  file: '/repo/x.ts', kind: 'edit', at: '2026-09-07T19:00:00Z', uuid: 'a1', promptId: null,
  attestation: 'decided', oldString: null, newString: null, replaceAll: false, content: null,
  ...overrides,
})

const DIRECT_CASES: DirectCase[] = [
  {
    // A new_string built from a Makefile-shaped snippet: $$ and $& are routine
    // there and must land in the replayed content exactly as written, not
    // interpreted as String.replace's special replacement patterns.
    name: 'a new_string carrying $$ and $& is inserted literally',
    run: () => {
      const result = applyOperation(
        'before X after',
        op({ oldString: 'X', newString: 'has $$ and $& literally' }),
      )
      return result === 'before has $$ and $& literally after'
    },
    detail: () => applyOperation('before X after', op({ oldString: 'X', newString: 'has $$ and $& literally' })),
  },
  {
    // The real reproduction: a later, unrelated edit's old_string happens to contain
    // the earlier change as an incidental substring ("true" inside "isReady === true").
    // analyseSession passes a null base in v1 (see task-14-brief.md's self-review),
    // so this calls findUndone directly with a real base to exercise the
    // confirm-against-final-content check that a null base can never reach.
    name: 'a change that survives in the final content is not reported as undone, even with an incidental substring match',
    run: () => {
      const base = 'const enabled = false\nif (isReady === true) { go() }\n'
      const introduce = op({ uuid: 'a1', at: '2026-09-07T19:00:00Z', oldString: 'false', newString: 'true' })
      const unrelated = op({
        uuid: 'a2', at: '2026-09-07T19:05:00Z',
        oldString: 'if (isReady === true) { go() }', newString: 'if (isReady) { go() }',
      })
      const found = findUndone('/repo/x.ts', [introduce, unrelated], base)
      return found.length === 0
    },
    detail: () => {
      const base = 'const enabled = false\nif (isReady === true) { go() }\n'
      const introduce = op({ uuid: 'a1', at: '2026-09-07T19:00:00Z', oldString: 'false', newString: 'true' })
      const unrelated = op({
        uuid: 'a2', at: '2026-09-07T19:05:00Z',
        oldString: 'if (isReady === true) { go() }', newString: 'if (isReady) { go() }',
      })
      return findUndone('/repo/x.ts', [introduce, unrelated], base).map((u) => u.kind)
    },
  },
]

const dir = await mkdtemp(join(tmpdir(), 'minos-fp-'))
let failed = 0
let total = 0

for (const test of CASES) {
  total += 1
  const ok = await runCase(dir, test)
  if (!ok) failed += 1
}

for (const test of DIRECT_CASES) {
  total += 1
  const ok = test.run()
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${test.name}`)
  if (!ok) {
    failed += 1
    console.log(JSON.stringify(test.detail(), null, 2))
  }
}

console.log(`\n${total - failed} of ${total} planted cases recovered`)
process.exitCode = failed === 0 ? 0 : 1

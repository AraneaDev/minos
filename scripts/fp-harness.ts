import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyseSession } from '../src/session'
import { renderReport } from '../src/report'
import { applyOperation } from '../src/replay'
import { findUndone } from '../src/reverts'
import type { Operation } from '../src/types'

type Report = Awaited<ReturnType<typeof analyseSession>>

interface Case {
  name: string
  records: unknown[]
  /** Records for a second, subagent transcript, read after the main one. */
  subagentRecords?: unknown[]
  /**
   * The tool call the subagent's sidecar names as having spawned it. Set it to
   * plant the link back to the parent session, or leave it undefined to plant
   * a subagent with no sidecar at all, which is what a case checking that an
   * unlinkable subagent stays unattributed needs.
   */
  subagentSpawnedBy?: string
  expect: (report: Report) => boolean
  /**
   * What to print when `expect` returns false. Defaults to a fixed summary of
   * totals, undone kinds, modes and skipped lines, which is enough for most
   * cases but says nothing about a case that asserts on a field the default
   * never shows (a timestamp ordering, a rendered string). Such a case
   * supplies its own.
   */
  detail?: (report: Report) => unknown
}

// The same control and bidi ranges src/report.ts's sanitise strips, matched here instead of
// stripped, so a failing case can print what it found without ever putting the very
// characters under test onto this terminal.
const DEBUG_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Escapes control and bidi characters to a visible `\uXXXX` form for safe printing. */
const escapeForDisplay = (text: string): string =>
  text.replace(DEBUG_UNSAFE, (ch) => `\\u${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`)

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

  // --- Defects that escaped every case above and were only caught against a real
  // transcript or by adversarial review. Each one printed a confident, wrong report.
  // See task-14-report.md for the ones demonstrated by reverting their fix.

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
    detail: (r) => ({ prompts: r.prompts.map((p) => p.id) }),
  },
  {
    name: 'a subagent change is attributed to the prompt behind the call that spawned it',
    records: [
      prompt('u1', 'p1', 'default', null),
      {
        type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-07T19:01:00Z', isSidechain: false,
        message: { content: [{ type: 'tool_use', id: 'toolu_SPAWN', name: 'Agent', input: {} }] },
      },
    ],
    // parentUuid null, the shape a real subagent transcript's single root record has.
    subagentRecords: [{ ...edit('sa1', 'ignored', '/repo/a.ts', 'x', 'y', true), parentUuid: null }],
    subagentSpawnedBy: 'toolu_SPAWN',
    // The subagent's own chain ends inside its own file, so this only resolves
    // if the sidecar's tool call is matched back to a1 and the root grafted on.
    // The label must stay subagent regardless: attribution says which prompt
    // caused the change, never that its diff reached the terminal.
    expect: (r) =>
      r.unattributedCount === 0 &&
      r.operations.length === 1 &&
      r.operations[0]?.promptId === 'p1' &&
      r.operations[0]?.attestation === 'subagent' &&
      r.totals.subagent.files === 1 &&
      r.totals.decided.files === 0,
    detail: (r) => ({
      unattributed: r.unattributedCount,
      ops: r.operations.map((o) => ({ prompt: o.promptId, label: o.attestation })),
    }),
  },
  {
    name: 'a subagent with no sidecar to link it stays unattributed, and still counts as subagent',
    records: [prompt('u1', 'p1', 'default', null)],
    // parentUuid null, the shape a real subagent transcript's single root record has.
    subagentRecords: [{ ...edit('sa1', 'ignored', '/repo/a.ts', 'x', 'y', true), parentUuid: null }],
    // No subagentSpawnedBy, so no sidecar is written: the shape of a workflow
    // nested subagent, whose sidecar records no spawning call at all.
    expect: (r) =>
      r.unattributedCount === 1 &&
      r.operations[0]?.promptId === null &&
      r.operations[0]?.attestation === 'subagent',
    detail: (r) => ({
      unattributed: r.unattributedCount,
      ops: r.operations.map((o) => ({ prompt: o.promptId, label: o.attestation })),
    }),
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
    detail: (r) => r.undone.map((u) => ({ kind: u.kind, introducedAt: u.introduced.at, undoneByAt: u.undoneBy.at })),
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
    detail: (r) => escapeForDisplay(renderReport(r)),
  },
  {
    // Ruling UD4: routed through analyseSession with a Write, so this exercises the
    // path the shipped tool actually takes rather than a hypothetical one. The base
    // content and the pre-existing "if (isReady === T$$R$&E)" line both come from the
    // Write, mirroring the real reproduction below but with the introduced text built
    // from dollar sequences ($$, $&) that a Makefile or shell snippet would carry
    // routinely. If applyOperation's replacement is not inserted literally, the actual
    // content diverges from what was declared, the confirm-guard in src/reverts.ts can
    // no longer find the introduced text in the reconstructed final content, and this
    // change is wrongly reported as overwritten even though nothing removed it.
    name: 'a new_string carrying $$ and $& lands literally, so a surviving change is not falsely reported as undone',
    records: [
      prompt('u1', 'p1', 'default', null),
      // write()'s own timestamp is fixed at 19:20:00Z, so both edits must be timed
      // after it, or a sort-by-timestamp ledger reorders the write to the end and it
      // discards them instead of the intended overwrite candidate below.
      write('w1', 'u1', '/repo/dollar.ts', 'const enabled = false\nif (isReady === T$$R$&E) { go() }\n'),
      editAt('a1', 'w1', '/repo/dollar.ts', 'false', 'T$$R$&E', '2026-09-07T19:21:00Z'),
      editAt('a2', 'a1', '/repo/dollar.ts', 'if (isReady === T$$R$&E) { go() }', 'if (isReady) { go() }', '2026-09-07T19:22:00Z'),
    ],
    expect: (r) => r.undone.length === 0,
    detail: (r) => r.undone.map((u) => ({ kind: u.kind, introduced: u.introduced.uuid, undoneBy: u.undoneBy.uuid })),
  },
  {
    // Ruling UD3, demonstrated on the real product path: no explicit base anywhere
    // (analyseSession always passes null, and src/session.ts is untouched by this
    // round), but the Write below lets replay recover the final content anyway, which
    // is exactly what the fixed guard in src/reverts.ts now keys on instead of the
    // base argument. Before the fix this was reported as an overwrite; see the
    // report's end-to-end reproduction for both the broken and fixed runs.
    name: 'the confirm-guard fires without an explicit base, via a Write, on the real analyseSession path',
    records: [
      prompt('u1', 'p1', 'default', null),
      // Same timing note as the case above: both edits must postdate write()'s fixed
      // 19:20:00Z timestamp.
      write('w1', 'u1', '/repo/flag.ts', 'const enabled = false\nif (isReady === true) { go() }\n'),
      editAt('a1', 'w1', '/repo/flag.ts', 'false', 'true', '2026-09-07T19:21:00Z'),
      editAt('a2', 'a1', '/repo/flag.ts', 'if (isReady === true) { go() }', 'if (isReady) { go() }', '2026-09-07T19:22:00Z'),
    ],
    expect: (r) => r.undone.length === 0,
    detail: (r) => r.undone.map((u) => ({ kind: u.kind, introduced: u.introduced.uuid, undoneBy: u.undoneBy.uuid })),
  },
]

const defaultDetail = (report: Report): unknown => ({
  totals: report.totals,
  undone: report.undone.map((u) => u.kind),
  modes: report.unrecognisedModes,
  skipped: report.skippedLines,
})

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
    if (test.subagentSpawnedBy !== undefined) {
      await writeFile(
        subPath.replace(/\.jsonl$/, '.meta.json'),
        JSON.stringify({ agentType: 'general-purpose', toolUseId: test.subagentSpawnedBy }),
      )
    }
    subagents.push(subPath)
  }

  const report = await analyseSession({ transcript: path, subagents })
  const ok = test.expect(report)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${test.name}`)
  if (!ok) {
    const detail = test.detail !== undefined ? test.detail(report) : defaultDetail(report)
    console.log(JSON.stringify(detail, null, 2))
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
    // findUndone's confirm-guard, exercised directly with an explicit base. v1's only
    // caller, analyseSession, always passes null (src/session.ts), so this base-supplied
    // shape is not reachable through the CLI today; it is the shape `~/.claude/file-history`
    // would supply once that v1.1 work lands (see docs/spec.md, "Not in v1"). It is a
    // genuine unit-level check of the guard's logic, not a claim about what the shipped
    // tool does with this exact input today: see the two CASES entries above for that,
    // which route the equivalent scenario through analyseSession with a Write standing
    // in for the base.
    name: "findUndone's confirm-guard recognises a surviving change given an explicit base",
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
  {
    // applyOperation, exercised directly: a Makefile-shaped new_string carrying $$ and $&
    // must land in the replayed content exactly as written, not interpreted as
    // String.replace's special replacement patterns.
    name: 'applyOperation inserts a new_string carrying $$ and $& literally',
    run: () => {
      const result = applyOperation(
        'before X after',
        op({ oldString: 'X', newString: 'has $$ and $& literally' }),
      )
      return result === 'before has $$ and $& literally after'
    },
    detail: () => applyOperation('before X after', op({ oldString: 'X', newString: 'has $$ and $& literally' })),
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

import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyseSession } from '../src/session'
import type { FileTotals, PromptTotals } from '../src/session'
import { FIXTURE_DIR } from '../scripts/make-fixtures'

test('a session is split by attestation and the undone change is found', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })

  expect(report.sessionId).toBe('s1')
  expect(report.cwd).toBe('/repo')
  expect(report.branch).toBe('main')

  expect(report.totals.decided.files).toBe(1)
  expect(report.totals.auto.files).toBe(1)
  expect(report.totals.subagent.files).toBe(1)

  expect(report.undone.map((u) => [u.kind, u.file])).toEqual([['reverted', '/repo/src/auth.ts']])

  const byPrompt: PromptTotals[] = report.byPrompt
  expect(byPrompt.map((p) => [p.prompt.index, p.undone])).toEqual([
    [1, 1],
    [2, 0],
  ])

  const largestAuto: FileTotals[] = report.largestAuto
  expect(largestAuto).toEqual([
    { file: '/repo/src/auth.ts', added: 1, removed: 1, promptIndex: 2 },
    { file: '/repo/src/mail.ts', added: 1, removed: 0, promptIndex: 2 },
  ])

  // auth.ts is touched under both 'decided' and 'auto', so the per-label file
  // counts (1 + 1 + 1 = 3) overcount the two distinct files actually touched.
  expect(report.filesTouched).toBe(2)

  // Every operation here descends from a resolvable prompt (p1 or p2).
  expect(report.unattributedCount).toBe(0)

  // Finding 6: minos file needs one file's own operations, in order, which
  // SessionReport did not carry at all before this. The fixture's auth.ts has
  // two Edit operations, at 19:02 (decided) and 20:11 (auto), in that order.
  const authOps = report.operations.filter((op) => op.file === '/repo/src/auth.ts')
  expect(authOps.map((op) => [op.at, op.kind, op.attestation])).toEqual([
    ['2026-09-07T19:02:00Z', 'edit', 'decided'],
    ['2026-09-07T20:11:00Z', 'edit', 'auto'],
  ])
})

test('the count of unparseable lines survives into the report', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'malformed.jsonl'), subagents: [] })
  expect(report.skippedLines).toBe(1)
})

test('a subagent transcript is forced sidechain regardless of its own flag, and its skipped lines count', async () => {
  const report = await analyseSession({
    transcript: join(FIXTURE_DIR, 'session.jsonl'),
    subagents: [join(FIXTURE_DIR, 'subagent.jsonl')],
  })

  // subagent.jsonl records isSidechain: false on its one change, so this only
  // reads 'subagent' if analyseSession forces the flag as it observes the file.
  expect(report.totals.subagent.files).toBe(2)

  // session.jsonl parses cleanly; the one skipped line lives in subagent.jsonl.
  expect(report.skippedLines).toBe(1)

  // subagent.jsonl's one change (sa1) has parentUuid: null and precedes no
  // prompt of its own, so it resolves to no prompt at all: promptId is null.
  expect(report.unattributedCount).toBe(1)
})

// analyseSession reads the main transcript first and every subagent transcript
// after, so a subagent operation that actually happened earlier than a main
// operation on the same file would land after it in the ledger unless the
// ledger sorts by timestamp. findUndone walks the ledger in array order, so
// an unsorted ledger reports the undoing operation as the earlier one: the
// UNDONE row would read backwards in time.
test('an earlier subagent operation undone by a later main operation reads in the right direction', async () => {
  const mainPath = join(FIXTURE_DIR, 'order-main.jsonl')
  const subPath = join(FIXTURE_DIR, 'order-subagent.jsonl')

  const mainOp = {
    type: 'assistant',
    uuid: 'main-a1',
    parentUuid: null,
    timestamp: '2026-09-07T19:42:00Z',
    isSidechain: false,
    message: {
      content: [
        { type: 'tool_use', id: 'main-t1', name: 'Edit', input: { file_path: '/repo/src/shared.ts', old_string: 'temp', new_string: 'original' } },
      ],
    },
  }
  await writeFile(mainPath, JSON.stringify(mainOp))

  const subOp = {
    type: 'assistant',
    uuid: 'sub-a1',
    parentUuid: null,
    timestamp: '2026-09-07T19:14:00Z',
    isSidechain: false,
    message: {
      content: [
        { type: 'tool_use', id: 'sub-t1', name: 'Edit', input: { file_path: '/repo/src/shared.ts', old_string: 'original', new_string: 'temp' } },
      ],
    },
  }
  await writeFile(subPath, JSON.stringify(subOp))

  const report = await analyseSession({ transcript: mainPath, subagents: [subPath] })

  expect(report.undone).toHaveLength(1)
  const finding = report.undone[0]
  // The earlier change (the subagent's, 19:14) is the one that was undone;
  // the later change (main, 19:42) is the one that undid it. Read the other
  // way round, this finding would claim the future undid the past.
  expect(finding?.introduced.at).toBe('2026-09-07T19:14:00Z')
  expect(finding?.undoneBy.at).toBe('2026-09-07T19:42:00Z')
})

test('a trailing newline terminates the last line rather than starting an empty one', async () => {
  const path = join(FIXTURE_DIR, 'lines-boundary.jsonl')
  const records = [
    {
      type: 'assistant',
      uuid: 'ba1',
      parentUuid: null,
      timestamp: '2026-09-07T22:00:00Z',
      isSidechain: false,
      message: { content: [{ type: 'tool_use', id: 'bt1', name: 'Write', input: { file_path: '/repo/src/with-newline.txt', content: 'a\nb\n' } }] },
    },
    {
      type: 'assistant',
      uuid: 'ba2',
      parentUuid: null,
      timestamp: '2026-09-07T22:01:00Z',
      isSidechain: false,
      message: { content: [{ type: 'tool_use', id: 'bt2', name: 'Write', input: { file_path: '/repo/src/no-newline.txt', content: 'a\nb' } }] },
    },
  ]
  await writeFile(path, records.map((r) => JSON.stringify(r)).join('\n'))

  const report = await analyseSession({ transcript: path, subagents: [] })
  const byFile = new Map(report.largestAuto.map((f) => [f.file, f]))

  // Both are two-line files. 'a\nb\n' ends with a trailing newline that
  // terminates the second line rather than starting a third, empty one, so
  // it must count the same as 'a\nb', not one more.
  expect(byFile.get('/repo/src/with-newline.txt')).toMatchObject({ added: 2, removed: 0 })
  expect(byFile.get('/repo/src/no-newline.txt')).toMatchObject({ added: 2, removed: 0 })
})

test('a session reports the span of every timestamp in it, compared as instants', async () => {
  const main = join(FIXTURE_DIR, 'session.jsonl')
  const alone = await analyseSession({ transcript: main, subagents: [] })
  expect(alone.startedAt).toBe('2026-09-07T19:01:00Z')
  expect(alone.endedAt).toBe('2026-09-07T20:12:00Z')

  const withSub = await analyseSession({ transcript: main, subagents: [join(FIXTURE_DIR, 'subagent.jsonl')] })
  expect(withSub.endedAt).toBe('2026-09-07T21:00:00Z')
})

/** Writes records as one transcript in a fresh temp directory, runs `body` on its path, and cleans up. */
async function withTranscripts(files: Record<string, object[]>, body: (path: (name: string) => string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'minos-session-'))
  try {
    for (const [name, records] of Object.entries(files)) await writeFile(join(dir, name), records.map((r) => JSON.stringify(r)).join('\n'))
    await body((name) => join(dir, name))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const userPrompt = (mode: string, timestamp: string) => ({ type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: mode, timestamp, sessionId: 's', cwd: '/repo', message: { content: 'go' } })
const call = (uuid: string, timestamp: string, name: string, input: object, parentUuid: string | null = 'u1') => ({
  type: 'assistant',
  uuid,
  parentUuid,
  timestamp,
  isSidechain: false,
  message: { content: [{ type: 'tool_use', id: `t-${uuid}`, name, input }] },
})

test('the span compares instants when string order and instant order disagree across offsets', async () => {
  // 10:30+02:00 is 08:30Z, earlier than 09:00Z, though it sorts later as a string.
  await withTranscripts(
    { 'main.jsonl': [userPrompt('default', '2026-09-07T09:00:00Z'), call('a1', '2026-09-07T10:30:00+02:00', 'Read', {}), call('a2', '2026-09-07T08:45:00Z', 'Read', {})] },
    async (path) => {
      const report = await analyseSession({ transcript: path('main.jsonl'), subagents: [] })
      expect(report.startedAt).toBe('2026-09-07T10:30:00+02:00')
      expect(report.endedAt).toBe('2026-09-07T09:00:00Z')
    },
  )
})

test('an unparseable timestamp is ignored for the span', async () => {
  await withTranscripts(
    { 'main.jsonl': [userPrompt('default', '2026-09-07T09:00:00Z'), call('a1', 'not a time', 'Read', {}), call('a2', '2026-09-07T09:05:00Z', 'Read', {})] },
    async (path) => {
      const report = await analyseSession({ transcript: path('main.jsonl'), subagents: [] })
      expect(report.startedAt).toBe('2026-09-07T09:00:00Z')
      expect(report.endedAt).toBe('2026-09-07T09:05:00Z')
    },
  )
})

test('a grafted subagent operation carries the permission mode of the prompt behind it, and an orphan none', async () => {
  const spawn = { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-07T09:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'task-1', name: 'Task', input: {} }] } }
  await withTranscripts(
    {
      'main.jsonl': [userPrompt('acceptEdits', '2026-09-07T09:00:00Z'), spawn],
      'agent-1.jsonl': [call('s1', '2026-09-07T09:02:00Z', 'Write', { file_path: '/repo/a.ts', content: 'x' }, null)],
      'agent-2.jsonl': [call('s2', '2026-09-07T09:03:00Z', 'Write', { file_path: '/repo/b.ts', content: 'y' }, null)],
    },
    async (path) => {
      await writeFile(path('agent-1.meta.json'), JSON.stringify({ toolUseId: 'task-1' }))
      const report = await analyseSession({ transcript: path('main.jsonl'), subagents: [path('agent-1.jsonl'), path('agent-2.jsonl')] })
      const byFile = new Map(report.operations.map((o) => [o.file, o]))
      expect(byFile.get('/repo/a.ts')).toMatchObject({ attestation: 'subagent', permissionMode: 'acceptEdits', promptId: 'p1' })
      expect(byFile.get('/repo/b.ts')).toMatchObject({ attestation: 'subagent', permissionMode: null, promptId: null })
    },
  )
})

test('shell writes carry decided and subagent labels, and a window keeps only those inside it and counts the undated', async () => {
  const bash = (uuid: string, timestamp: string) => call(uuid, timestamp, 'Bash', { command: 'rm src/old.ts' })
  await withTranscripts(
    {
      'main.jsonl': [userPrompt('default', '2026-09-07T09:00:00Z'), bash('b1', '2026-09-07T09:01:00Z'), bash('b2', '2026-09-09T09:01:00Z'), bash('b3', 'garbage')],
      'agent-1.jsonl': [bash('b4', '2026-09-07T09:02:00Z')],
    },
    async (path) => {
      const paths = { transcript: path('main.jsonl'), subagents: [path('agent-1.jsonl')] }
      const open = await analyseSession(paths)
      expect(open.shellWrites.map((w) => [w.toolUseId, w.attestation])).toEqual([
        ['t-b1', 'decided'],
        ['t-b4', 'subagent'],
        ['t-b2', 'decided'],
        ['t-b3', 'decided'],
      ])
      expect(open.undatedShellWrites).toBe(0)
      const windowed = await analyseSession(paths, { window: { since: null, until: '2026-09-08' } })
      expect(windowed.shellWrites.map((w) => w.toolUseId)).toEqual(['t-b1', 't-b4'])
      expect(windowed.undatedShellWrites).toBe(1)
    },
  )
})

test('a failed Edit is out of the totals, the operations and undone, and its failedChanges entry follows the window', async () => {
  const failure = { type: 'user', uuid: 'r2', parentUuid: 'a2', timestamp: '2026-09-07T09:02:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 't-a2', is_error: true, content: '<tool_use_error>String to replace not found in file.</tool_use_error>' }] } }
  await withTranscripts(
    {
      'main.jsonl': [
        userPrompt('default', '2026-09-07T09:00:00Z'),
        call('a1', '2026-09-07T09:01:00Z', 'Write', { file_path: '/repo/a.ts', content: 'one\n' }),
        call('a2', '2026-09-07T09:02:00Z', 'Edit', { file_path: '/repo/a.ts', old_string: 'one', new_string: 'two' }),
        failure,
        call('a3', '2026-09-09T09:00:00Z', 'Edit', { file_path: '/repo/a.ts', old_string: 'two', new_string: 'one' }),
      ],
    },
    async (path) => {
      const paths = { transcript: path('main.jsonl'), subagents: [] }
      const open = await analyseSession(paths)
      expect(open.operations.map((o) => o.toolUseId)).toEqual(['t-a1', 't-a3'])
      expect(open.totals.decided).toEqual({ files: 1, added: 2, removed: 1 })
      expect(open.undone).toEqual([])
      expect(open.failedChanges).toEqual([{ toolUseId: 't-a2', at: '2026-09-07T09:02:00Z' }])
      const before = await analyseSession(paths, { window: { since: null, until: '2026-09-08' } })
      expect(before.failedChanges.map((f) => f.toolUseId)).toEqual(['t-a2'])
      expect(before.operations.map((o) => o.toolUseId)).toEqual(['t-a1'])
      const after = await analyseSession(paths, { window: { since: '2026-09-08', until: null } })
      expect(after.failedChanges).toEqual([])
      expect(after.operations.map((o) => o.toolUseId)).toEqual(['t-a3'])
    },
  )
})

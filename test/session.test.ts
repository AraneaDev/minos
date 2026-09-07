import { expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
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

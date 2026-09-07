import { expect, test } from 'bun:test'
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
    { file: '/repo/src/mail.ts', added: 2, removed: 0, promptIndex: 2 },
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
})

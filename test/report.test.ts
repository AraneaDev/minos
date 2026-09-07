import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { analyseSession } from '../src/session'
import { renderReport, sanitise } from '../src/report'
import { FIXTURE_DIR } from '../scripts/make-fixtures'

test('control and bidi characters never reach the terminal', () => {
  expect(sanitise('fix the‮ redirect')).toBe('fix the redirect')
})

test('the three classes are named, and never rolled into one total', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  expect(text).toContain('decided')
  expect(text).toContain('auto')
  expect(text).toContain('subagent')
  expect(text).toContain('UNDONE')
})

test('an unrecognised permission mode is named rather than hidden', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport({ ...report, unrecognisedModes: ['somethingNew'] })
  expect(text).toContain('somethingNew')
})

test('skipped lines are reported', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport({ ...report, skippedLines: 2 })
  expect(text).toContain('2 transcript lines did not parse')
})

// Ruling R1: the "applied without asking" section renders largestAuto, capped,
// and never prints the literal string "null" for an unresolved prompt index.
test('the largest auto/subagent changes are rendered, and an unknown prompt reads as a dash, not null', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const withUnknownPrompt = {
    ...report,
    largestAuto: [{ file: '/repo/src/services/billing.ts', added: 212, removed: 44, promptIndex: null }],
  }
  const text = renderReport(withUnknownPrompt)
  expect(text).toContain('APPLIED WITHOUT ASKING')
  expect(text).toContain('src/services/billing.ts')
  expect(text).not.toMatch(/\bnull\b/)
})

test('the applied-without-asking section is capped at the five largest files', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const largestAuto = Array.from({ length: 8 }, (_, i) => ({
    file: `/repo/src/file${i}.ts`,
    added: 100 - i,
    removed: 0,
    promptIndex: 1,
  }))
  const text = renderReport({ ...report, largestAuto })
  expect(text).toContain('file0.ts')
  expect(text).toContain('file4.ts')
  expect(text).not.toContain('file5.ts')
})

// Ruling R2: the auto legend names the modes a real session actually records.
test('the auto legend names acceptEdits and auto, not a mode that never occurs', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  expect(text).toContain('acceptEdits')
  expect(text).not.toContain('bypassPermissions')
})

// Ruling F1: CHANGED counts distinct files touched, not the sum of the three
// per-label counts, which double-counts a file changed under two labels.
test('CHANGED reports distinct files touched, not the overcounted sum of the three labels', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  // The fixture touches 2 distinct files (auth.ts, mail.ts), but the sum of
  // totals.decided.files + totals.auto.files + totals.subagent.files is 3.
  expect(report.filesTouched).toBe(2)
  const text = renderReport(report)
  expect(text).toContain('CHANGED  2 files')
  expect(text).not.toContain('CHANGED  3 files')
})

// Ruling F2: a change that could not be attributed to a prompt is named in a
// caveat, since it is in the totals but appears in no BY PROMPT row.
test('an unattributed change is named as a caveat rather than silently missing from the table', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport({ ...report, unattributedCount: 3 })
  expect(text).toContain('3')
  expect(text.toLowerCase()).toContain('could not be attributed to a prompt')
})

test('no unattributed-change caveat is printed when the count is zero', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport({ ...report, unattributedCount: 0 })
  expect(text.toLowerCase()).not.toContain('could not be attributed to a prompt')
})

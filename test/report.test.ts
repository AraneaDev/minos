import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { analyseSession } from '../src/session'
import { renderReport, sanitise } from '../src/report'
import { FIXTURE_DIR } from '../scripts/make-fixtures'
import type { Operation } from '../src/types'

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

// Important 1: cwd, branch and each unrecognised mode are transcript-derived
// text exactly like a prompt or a file path, and must survive the same
// sanitising before they reach a terminal. Built with escapes, not pasted
// control characters, so the test file itself stays easy to handle.
test('cwd, branch, and unrecognised modes cannot inject terminal escapes or bidi overrides', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const erase = '\x1b[2J'
  const rtl = '‮'
  const injected = {
    ...report,
    cwd: `/repo/evil${erase}dir`,
    branch: `main${rtl}evil`,
    unrecognisedModes: [`weird${erase}mode`],
  }
  const text = renderReport(injected)
  expect(text).not.toContain(erase)
  expect(text).not.toContain(rtl)
})

// Important 2 / Ruling S3: BY PROMPT gets a header row naming its columns,
// including 'when', and the trailing 'undone' column must land at the same
// offset in every row no matter how long the quoted prompt is.
test('BY PROMPT has a header row with a when column, and rows of different prompt lengths still align', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  const lines = text.split('\n')
  const headerLineIndex = lines.findIndex((l) => l.includes('when') && l.includes('asked for') && l.includes('undone'))
  expect(headerLineIndex).toBeGreaterThan(-1)

  const rows = lines.slice(headerLineIndex + 1, headerLineIndex + 1 + report.byPrompt.length)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toContain('19:01')
  expect(rows[1]).toContain('20:09')
  // "fix the login redirect" and "make the mailer use the queue" are very
  // different lengths; the trailing column must still line up.
  expect(new Set(rows.map((l) => l.length)).size).toBe(1)
})

// Polish: singular counts get their singular word, in both the standalone
// headlines and the per-label table, where the word must stay a fixed width
// so the columns after it do not drift between rows.
test('pluralisation agrees with the count instead of always reading as plural', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  // totals.decided.files, totals.auto.files and totals.subagent.files are each 1 here.
  expect(text).toMatch(/\b1 file\b/)
  expect(text).not.toMatch(/\b1 files\b/)
  // report.undone.length is 1 in this fixture.
  expect(text).toContain('1 change did not survive the session')
  expect(text).not.toContain('1 changes did not survive the session')
})

// Polish: the per-label rows show a sign on the added count, matching the
// APPLIED WITHOUT ASKING rows below them.
test('the per-label rows sign the added count, matching the applied-without-asking rows', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  expect(text).toMatch(/decided\s+1 file\s+\+\s*1\s+-\s*1/)
})

// Polish: CHANGED's file count and the three label rows below it are not
// mutually exclusive by design, and the report says so in one line.
test('CHANGED explains that the rows below it can overlap', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report)
  expect(text.toLowerCase()).toContain('overlap')
})

// Defect 3: a real repository path can run well past the column's padding
// width. Without a guaranteed separator, the next column's text runs
// straight into the path with no space at all, e.g.
// "...task-12-report.md+ 537  -   0   (unattributed)".
test('a file path long enough to overflow its column still separates from the next column', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const longPath = '/root/minos/.superpowers/sdd/plan/task-12-report.md'
  const withLongPath = {
    ...report,
    largestAuto: [{ file: longPath, added: 537, removed: 0, promptIndex: null }],
  }
  const text = renderReport(withLongPath)
  const line = text.split('\n').find((l) => l.includes('task-12-report.md'))
  expect(line).toBeDefined()
  // Whatever comes after the path column (the '+' of the added count) must be
  // separated from the path by whitespace, not glued straight onto it.
  expect(line ?? '').not.toMatch(/task-12-report\.md\+/)
  expect(line ?? '').toMatch(/task-12-report\.md\s+\+/)
})

test('a long path in the UNDONE section still separates from the kind column', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const longPath = '/root/minos/.superpowers/sdd/plan/task-10-report.md'
  const undoneOp = (over: Partial<Operation>): Operation => ({
    file: longPath,
    kind: 'edit',
    at: '2026-09-07T20:08:00Z',
    uuid: 'u',
    promptId: null,
    attestation: 'auto',
    oldString: null,
    newString: null,
    replaceAll: false,
    content: null,
    ...over,
  })
  const withLongPath = {
    ...report,
    undone: [
      {
        file: longPath,
        kind: 'discarded' as const,
        line: null,
        introduced: undoneOp({ at: '2026-09-07T20:08:00Z' }),
        undoneBy: undoneOp({ at: '2026-09-07T20:44:00Z' }),
      },
    ],
  }
  const text = renderReport(withLongPath)
  const line = text.split('\n').find((l) => l.includes('task-10-report.md'))
  expect(line).toBeDefined()
  expect(line ?? '').not.toMatch(/task-10-report\.mddiscarded/)
  expect(line ?? '').toMatch(/task-10-report\.md\s+discarded/)
})

// Finding 4: the spec and README both say a finding names both prompts, but
// the shipped row only ever printed path, kind and two timestamps. The data
// already exists on Operation.promptId and SessionReport.prompts; this test
// plants one resolvable and one unresolvable promptId on the two sides of a
// single finding, so a fix that names only one side, or neither, still fails.
test('an UNDONE row names the prompt behind each side, and (unattributed) when there is none', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const undoneOp = (over: Partial<Operation>): Operation => ({
    file: '/repo/src/named.ts',
    kind: 'edit',
    at: '2026-09-07T20:08:00Z',
    uuid: 'u',
    promptId: null,
    attestation: 'auto',
    oldString: null,
    newString: null,
    replaceAll: false,
    content: null,
    ...over,
  })
  const withNamedPrompts = {
    ...report,
    undone: [
      {
        file: '/repo/src/named.ts',
        kind: 'overwritten' as const,
        line: null,
        // report's fixture prompt p1 is index 1 ("fix the login redirect").
        introduced: undoneOp({ at: '2026-09-07T19:02:00Z', promptId: 'p1' }),
        undoneBy: undoneOp({ at: '2026-09-07T20:11:00Z', promptId: null }),
      },
    ],
  }
  const text = renderReport(withNamedPrompts)
  const line = text.split('\n').find((l) => l.includes('named.ts'))
  expect(line).toBeDefined()
  expect(line ?? '').toContain('prompt 1')
  expect(line ?? '').toContain('(unattributed)')
})

// Defect 4: the caveat prints after the BY PROMPT table it refers to, so it
// must say "above", not "below".
test('the unattributed caveat says the table is above it, since that is where it prints', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport({ ...report, unattributedCount: 3 })
  expect(text).toContain('do not appear in the BY PROMPT table above')
  expect(text).not.toContain('do not appear in the BY PROMPT table below')
})

// Finding 5: `decided` prints the flat assertion "you were asked before it was
// applied", but a standing allow rule such as Edit(src/**) can mean nothing
// was ever put on screen under `default` mode. The spec requires one caveat
// naming the allow rules currently in force, so a reader can see what would
// move a decided row into auto, printed only when decided covers more than
// zero files (the fixture's own session has exactly one).
test('a caveat names the allow rules in force when decided covers at least one file', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  expect(report.totals.decided.files).toBeGreaterThan(0)
  const text = renderReport(report, { allowRules: ['Edit(src/**)', 'Write(src/**)'] })
  expect(text).toContain('Edit(src/**)')
  expect(text).toContain('Write(src/**)')
  expect(text.toLowerCase()).toContain('decided')
  expect(text.toLowerCase()).toContain('right now')
})

test('the caveat still prints, without a rule list, when settings could not be read', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const text = renderReport(report, { allowRules: null })
  expect(text.toLowerCase()).toContain('allow rule')
  expect(text.toLowerCase()).toContain('could not')
})

test('no allow-rule caveat is printed when decided covers zero files', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const zeroDecided = { ...report, totals: { ...report.totals, decided: { files: 0, added: 0, removed: 0 } } }
  const text = renderReport(zeroDecided, { allowRules: ['Edit(src/**)'] })
  expect(text.toLowerCase()).not.toContain('allow rule')
})

test('an allow rule carrying an escape sequence is sanitised before it reaches the caveat', async () => {
  const report = await analyseSession({ transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] })
  const erase = '\x1b[2J'
  const text = renderReport(report, { allowRules: [`Edit(src${erase}/**)`] })
  expect(text).not.toContain(erase)
})

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { resolveSession, runReport } from '../src/commands/report'
import { runUndone } from '../src/commands/undone'
import { runFile } from '../src/commands/file'
import { runSessions } from '../src/commands/sessions'
import { localStamp } from '../src/clock'
import type { Window } from '../src/window'
import { runExport, runExportAll } from '../src/commands/export'
import { collectAll, renderAll } from '../src/commands/all'
import { main } from '../src/cli'
import { encodeProjectSlug } from '../src/paths'
import { FIXTURE_DIR } from '../scripts/make-fixtures'

const OPEN: Window = { since: null, until: null }
const paths = { transcript: join(FIXTURE_DIR, 'session.jsonl'), subagents: [] }

test('report prints the sectioned report', async () => {
  const text = await runReport(paths)
  expect(text.startsWith('MINOS')).toBe(true)
})

test('undone prints only the changes that did not survive', async () => {
  const text = await runUndone(paths)
  expect(text).toContain('reverted')
  expect(text).not.toContain('BY PROMPT')
})

test('export emits parseable json carrying the totals', async () => {
  const parsed = JSON.parse(await runExport(paths))
  expect(parsed.totals.subagent.files).toBe(1)
})

// runFile: a regression that swapped the suffix match for an exact-path match,
// or that dropped the filter entirely, would change these counts.
test('file reports only the undone changes for that file, matched by suffix', async () => {
  const text = await runFile(paths, '/repo/src/auth.ts')
  expect(text.startsWith('/repo/src/auth.ts: 1 of its changes did not survive')).toBe(true)
  expect(text).toContain('reverted')
})

test('file matches by trailing path segment, and says so when nothing matches', async () => {
  // 'auth.ts' is a suffix of the fixture's real path, not the whole path: this
  // guards `endsWith` specifically, not just "some" filtering.
  const bySuffix = await runFile(paths, 'auth.ts')
  expect(bySuffix.startsWith('auth.ts: 1 of its changes did not survive')).toBe(true)

  const noMatch = await runFile(paths, 'nonexistent.ts')
  expect(noMatch).toBe('nonexistent.ts: no operations in this session')
})

// Finding 6: the spec calls minos file "one file's operation history in the
// session", but the implementation filtered undone findings only. The
// fixture's auth.ts has two Edit operations: 19:02 under default mode
// (decided, prompt 1) and 20:11 under acceptEdits (auto, prompt 2). A fix
// that still shows only the undone summary leaves both of these unnamed.
test('file prints the file\'s full operation history, with time, kind, attestation and prompt', async () => {
  const text = await runFile(paths, '/repo/src/auth.ts')
  expect(text).toContain('19:02')
  expect(text).toContain('20:11')
  expect(text).toContain('edit')
  expect(text).toContain('decided')
  expect(text).toContain('auto')
  expect(text).toContain('prompt 1')
  expect(text).toContain('prompt 2')
  // The undone summary named by the earlier test must still be present.
  expect(text).toContain('1 of its changes did not survive')
})

// Ruling A2: `endsWith` alone matches on raw characters, not path segments,
// so a target of 'auth.ts' also matches a file named 'oauth.ts' with nothing
// in the output to show it happened. A fresh two-file transcript is built
// here (rather than reusing the shared fixture) so both an 'auth.ts' and an
// 'oauth.ts' change exist side by side, each undone once.
test('file matches on a path-segment boundary: auth.ts matches src/auth.ts but never src/oauth.ts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minos-file-boundary-'))
  const transcript = join(dir, 'session.jsonl')
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T10:00:00Z', sessionId: 's', cwd: '/repo', gitBranch: 'main', message: { content: 'edit both' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-07T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' } }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u1', timestamp: '2026-09-07T10:02:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'b', new_string: 'a' } }] } },
    { type: 'assistant', uuid: 'a3', parentUuid: 'u1', timestamp: '2026-09-07T10:03:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: '/repo/src/oauth.ts', old_string: 'x', new_string: 'y' } }] } },
    { type: 'assistant', uuid: 'a4', parentUuid: 'u1', timestamp: '2026-09-07T10:04:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: '/repo/src/oauth.ts', old_string: 'y', new_string: 'x' } }] } },
  ]
  await writeFile(transcript, records.map((r) => JSON.stringify(r)).join('\n'))

  try {
    const text = await runFile({ transcript, subagents: [] }, 'auth.ts')
    expect(text.startsWith('auth.ts: 1 of its changes did not survive')).toBe(true)
    expect(text).not.toContain('oauth')

    // The exact full path must still match, since it satisfies equality directly.
    const byFullPath = await runFile({ transcript, subagents: [] }, '/repo/src/oauth.ts')
    expect(byFullPath.startsWith('/repo/src/oauth.ts: 1 of its changes did not survive')).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Finding 2: runUndone and runFile printed `u.introduced.at` and `u.undoneBy.at`
// raw and unsliced, so a crafted timestamp field carrying an escape sequence or
// a bidi override reached the terminal unsanitised, unlike renderReport which
// slices and sanitises the same fields. Escapes are written here (\x1b[2J, the
// U+202E override) rather than pasted as literal control bytes.
test('runUndone sanitises escape sequences and bidi overrides carried in a timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minos-undone-escape-'))
  const transcript = join(dir, 'session.jsonl')
  const erase = '\x1b[2J'
  const rtl = '‮'
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T10:00:00Z', sessionId: 's', cwd: '/repo', gitBranch: 'main', message: { content: 'edit' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: `2026-09-07T10:01:00Z${erase}`, isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u1', timestamp: `2026-09-07T10:02:00Z${rtl}`, isSidechain: false, message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'y', new_string: 'x' } }] } },
  ]
  await writeFile(transcript, records.map((r) => JSON.stringify(r)).join('\n'))
  try {
    const text = await runUndone({ transcript, subagents: [] })
    expect(text).toContain('reverted')
    expect(text).not.toContain(erase)
    expect(text).not.toContain(rtl)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runFile sanitises escape sequences and bidi overrides carried in a timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minos-file-escape-'))
  const transcript = join(dir, 'session.jsonl')
  const erase = '\x1b[2J'
  const rtl = '‮'
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T10:00:00Z', sessionId: 's', cwd: '/repo', gitBranch: 'main', message: { content: 'edit' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: `2026-09-07T10:01:00Z${erase}`, isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u1', timestamp: `2026-09-07T10:02:00Z${rtl}`, isSidechain: false, message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'y', new_string: 'x' } }] } },
  ]
  await writeFile(transcript, records.map((r) => JSON.stringify(r)).join('\n'))
  try {
    const text = await runFile({ transcript, subagents: [] }, 'a.ts')
    expect(text).toContain('reverted')
    expect(text).not.toContain(erase)
    expect(text).not.toContain(rtl)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// resolveSession and runSessions resolve against a real, on-disk project
// store, so every test below points CLAUDE_CONFIG_DIR at a throwaway
// directory rather than the real ~/.claude. Otherwise they would read this
// repository's own real session transcripts and print a real report into the
// test output.
describe('commands that resolve a session against the transcript store', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'minos-commands-'))
    process.env.CLAUDE_CONFIG_DIR = root
  })

  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    await rm(root, { recursive: true, force: true })
  })

  const record = (over: Record<string, unknown>): string =>
    JSON.stringify({
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      promptId: 'p1',
      permissionMode: 'default',
      timestamp: '2026-09-07T19:01:00Z',
      cwd: over.cwd,
      gitBranch: 'main',
      message: { content: 'do a thing' },
      ...over,
    })

  // Ruling S2: subagentFiles is session-scoped, keyed by the transcript's own
  // filename (the session id), not by the project directory alone. A
  // resolveSession that forgot to derive that id, or passed the wrong one,
  // would find no subagent files here.
  test('resolveSession derives the session id from the transcript filename and finds that session\'s subagent files', async () => {
    const cwd = '/root/fake-project-s2'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'sess-real.jsonl'), `${record({ cwd, sessionId: 'sess-real' })}\n`)

    const subagentsDir = join(projectDir, 'sess-real', 'subagents')
    await mkdir(subagentsDir, { recursive: true })
    await writeFile(join(subagentsDir, 'agent-1.jsonl'), '')
    // A sidecar and a differently-named session directory that must not leak in.
    await writeFile(join(subagentsDir, 'agent-1.meta.json'), '')

    const found = await resolveSession({ cwd, session: null })

    expect(found.kind).toBe('found')
    expect(found.kind === 'found' && found.paths.transcript).toBe(join(projectDir, 'sess-real.jsonl'))
    expect(found.kind === 'found' ? found.paths.subagents : []).toEqual([join(subagentsDir, 'agent-1.jsonl')])
  })

  test('resolveSession reports no project when no project directory matches the cwd', async () => {
    const found = await resolveSession({ cwd: '/root/nothing-here', session: null })
    expect(found.kind).toBe('no-project')
  })

  // Finding 4: a project that has transcripts and an id that matches none of
  // them is a different failure from a project with no transcripts, and the
  // two must not collapse into one answer.
  test('resolveSession tells an unmatched session id apart from a project with no transcripts', async () => {
    const cwd = '/root/fake-project-unmatched'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'sess-real.jsonl'), `${record({ cwd })}\n`)

    expect((await resolveSession({ cwd, session: 'nosuchid' })).kind).toBe('no-session')
    expect((await resolveSession({ cwd, session: null })).kind).toBe('found')
  })

  // Ruling S2's `files.at(-1)` default (most recent) is covered by the test
  // above. The `--session` flag takes a different path through the same
  // ternary, matching a named session rather than the most recent one; two
  // sessions are written here so that picking the wrong one, or falling back
  // to "most recent" regardless of the flag, is caught.
  test('resolveSession finds a specific named session when one is requested, not just the most recent', async () => {
    const cwd = '/root/fake-project-named-session'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'session-older-abc123.jsonl'), `${record({ cwd })}\n`)
    await writeFile(join(projectDir, 'session-newer-def456.jsonl'), `${record({ cwd })}\n`)

    const found = await resolveSession({ cwd, session: 'abc123' })

    expect(found.kind === 'found' && found.paths.transcript).toBe(join(projectDir, 'session-older-abc123.jsonl'))
  })

  // runSessions: the "no store" branch. A regression that threw instead of
  // reporting, or that reported success, would break this.
  test('sessions returns nothing at all when there is no transcript store for the directory', async () => {
    expect(await runSessions('/root/nothing-here', 10, OPEN)).toBeNull()
  })

  // Finding 1: runSessions passed `subagents: []` to every row's analyseSession
  // call, so a session with real subagent work always reported "subagent 0" and
  // an undercounted "undone", indistinguishable from a session with no subagent
  // work at all. This plants a session whose only change sits inside a subagent
  // transcript, so a fix that forgets to resolve subagentFiles for each row
  // (not just for resolveSession's single session) still reports "subagent 0".
  test('sessions reports a non-zero subagent count when the session has a subagent transcript', async () => {
    const cwd = '/root/fake-project-sessions-subagent'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })

    const session = [
      { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T10:00:00Z', sessionId: 'sess-sub', cwd, gitBranch: 'main', message: { content: 'do a thing' } },
    ]
    await writeFile(join(projectDir, 'sess-sub.jsonl'), session.map((r) => JSON.stringify(r)).join('\n'))

    const subagentsDir = join(projectDir, 'sess-sub', 'subagents')
    await mkdir(subagentsDir, { recursive: true })
    const subagentChange = {
      type: 'assistant', uuid: 'sa1', parentUuid: null, timestamp: '2026-09-07T10:01:00Z', isSidechain: false,
      message: { content: [{ type: 'tool_use', id: 'st1', name: 'Write', input: { file_path: '/repo/sub.ts', content: 'hi\n' } }] },
    }
    await writeFile(join(subagentsDir, 'agent-1.jsonl'), JSON.stringify(subagentChange))

    const text = await runSessions(cwd, 10, OPEN)
    const stamp = localStamp('2026-09-07T10:00:00Z')
    expect((text ?? '').split('\n')[2]).toBe(`sess-sub  ${stamp}  ${localStamp('2026-09-07T10:01:00Z')}        0     0         1       0`)
  })

  // runSessions: the listing branch, plus the limit. Two sessions are
  // written with distinct, explicit content so both the per-label counts and
  // the oldest-first ordering are pinned to real ledger output rather than
  // guessed at; a third, unrelated session proves the limit actually caps the
  // rows returned rather than merely being accepted as a parameter.
  test('sessions lists newest-last with real per-label counts, and the limit caps how many are shown', async () => {
    const cwd = '/root/fake-project-sessions'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })

    // Session names are exactly 8 characters (before the .jsonl extension),
    // since runSessions displays `basename(transcript, '.jsonl').slice(0, 8)`
    // and two names that only differ after the eighth character would render
    // identically, defeating the point of distinguishing the rows.

    // Session A: one decided edit, nothing undone.
    const sessionA = [
      { type: 'user', uuid: 'a-u1', parentUuid: null, promptId: 'a-p1', permissionMode: 'default', timestamp: '2026-09-01T10:00:00Z', sessionId: 'sess-001', cwd, gitBranch: 'main', message: { content: 'first session' } },
      { type: 'assistant', uuid: 'a-a1', parentUuid: 'a-u1', timestamp: '2026-09-01T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'a-t1', name: 'Write', input: { file_path: '/repo/a.ts', content: 'one\n' } }] } },
    ]
    await writeFile(join(projectDir, 'sess-001.jsonl'), sessionA.map((r) => JSON.stringify(r)).join('\n'))

    // Session B: one auto edit that is then reverted, so undone.length === 1.
    const sessionB = [
      { type: 'user', uuid: 'b-u1', parentUuid: null, promptId: 'b-p1', permissionMode: 'acceptEdits', timestamp: '2026-09-02T10:00:00Z', sessionId: 'sess-002', cwd, gitBranch: 'main', message: { content: 'second session' } },
      { type: 'assistant', uuid: 'b-a1', parentUuid: 'b-u1', timestamp: '2026-09-02T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'b-t1', name: 'Edit', input: { file_path: '/repo/b.ts', old_string: 'x', new_string: 'y' } }] } },
      { type: 'assistant', uuid: 'b-a2', parentUuid: 'b-u1', timestamp: '2026-09-02T10:02:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'b-t2', name: 'Edit', input: { file_path: '/repo/b.ts', old_string: 'y', new_string: 'x' } }] } },
    ]
    await writeFile(join(projectDir, 'sess-002.jsonl'), sessionB.map((r) => JSON.stringify(r)).join('\n'))

    const full = await runSessions(cwd, 10, OPEN)
    expect(full).not.toBeNull()
    const lines = (full ?? '').split('\n').slice(2)
    expect(lines.length).toBe(2)
    expect(lines[0]).toEndWith('        1     0         0       0')
    expect(lines[1]).toEndWith('        0     1         0       1')
    expect(lines[0]!.startsWith('sess-001')).toBe(true)
    expect(lines[1]!.startsWith('sess-002')).toBe(true)

    const limited = await runSessions(cwd, 1, OPEN)
    expect((limited ?? '').split('\n').slice(2)).toEqual([lines[1]!])
  })

  /** Two sessions, one on 09-01 and one on 09-02, plus a third on 09-03. */
  async function threeSessions(cwd: string): Promise<void> {
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    for (const [id, day] of [['sess-001', '01'], ['sess-002', '02'], ['sess-003', '03']] as const) {
      const lines = [
        { type: 'user', uuid: `${id}-u`, parentUuid: null, promptId: `${id}-p`, permissionMode: 'default', timestamp: `2026-09-${day}T10:00:00Z`, sessionId: id, cwd, message: { content: 'hi' } },
        { type: 'assistant', uuid: `${id}-a`, parentUuid: `${id}-u`, timestamp: `2026-09-${day}T10:02:00Z`, isSidechain: false, message: { content: [{ type: 'tool_use', id: `${id}-t`, name: 'Write', input: { file_path: '/repo/a.ts', content: 'x\n' } }] } },
      ]
      await writeFile(join(projectDir, `${id}.jsonl`), lines.map((r) => JSON.stringify(r)).join('\n'))
    }
  }
  const ids = (text: string | null) => (text ?? '').split('\n').filter((l) => l.startsWith('sess-')).map((l) => l.slice(0, 8))

  test("sessions prints each session's first and last time and states its units", async () => {
    const cwd = '/root/fake-project-sessions-units'
    await threeSessions(cwd)
    const lines = ((await runSessions(cwd, 10, OPEN)) ?? '').split('\n')
    expect(lines[0]).toBe('session   first             last              decided  auto  subagent  undone')
    expect(lines[1]).toBe('          (decided, auto and subagent count files; undone counts changes)')
    expect(lines[3]).toContain(`${localStamp('2026-09-02T10:00:00Z')}  ${localStamp('2026-09-02T10:02:00Z')}`)
  })

  test('sessions with --since leaves out sessions that ended before it and prints the window', async () => {
    const cwd = '/root/fake-project-sessions-since'
    await threeSessions(cwd)
    const since = ((await runSessions(cwd, 10, { since: '2026-09-02', until: null })) ?? '')
    expect(ids(since)).toEqual(['sess-002', 'sess-003'])
    expect(since.split('\n').at(-1)).toBe('window: 2026-09-02 to today')
    const until = (await runSessions(cwd, 10, { since: null, until: '2026-09-01' })) ?? ''
    expect(ids(until)).toEqual(['sess-001'])
    expect(until.split('\n').at(-1)).toBe('window: start of history to 2026-09-01')
  })

  test('sessions applies the window before the limit, so older in-window sessions are still listed', async () => {
    const cwd = '/root/fake-project-sessions-window-limit'
    await threeSessions(cwd)
    expect(ids(await runSessions(cwd, 1, { since: null, until: '2026-09-01' }))).toEqual(['sess-001'])
    expect(ids(await runSessions(cwd, 2, { since: '2026-09-02', until: null }))).toEqual(['sess-002', 'sess-003'])
  })

  test('sessions lists every session of a project recorded under two paths, and says so once', async () => {
    const cwd = '/home/tim/site'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    const record = (id: string, recorded: string) =>
      JSON.stringify({ type: 'user', uuid: `${id}-u`, parentUuid: null, promptId: `${id}-p`, permissionMode: 'default', timestamp: '2026-09-01T10:00:00Z', sessionId: id, cwd: recorded, message: { content: 'hi' } })
    await writeFile(join(projectDir, 'sess-001.jsonl'), record('sess-001', '/root/site'))
    await writeFile(join(projectDir, 'sess-002.jsonl'), record('sess-002', cwd))

    const lines = ((await runSessions(cwd, 10, OPEN)) ?? '').split('\n')
    const notice = 'recorded under 2 paths: /home/tim/site, /root/site'
    expect(lines[0]).toBe(notice)
    expect(lines.filter((l) => l === notice).length).toBe(1)
    expect(lines.filter((l) => /^sess-00\d /.test(l)).length).toBe(2)
  })

  // Ruling A1: a bad --limit must fail loudly rather than silently reporting
  // on everything. `Number('abc')` is NaN, and `.slice(-NaN)` behaves like
  // `.slice(0)`, so the unvalidated code returns every session; `Number('0')`
  // and `Number('-1')` are both valid numbers that still make no sense as a
  // count of rows to show. Each case here asserts the process both fails (a
  // non-zero exit) and prints nothing to stdout, since printing a partial or
  // full report alongside an error would still read as a report.
  for (const badLimit of ['abc', '0', '-1']) {
    test(`sessions rejects --limit ${badLimit} instead of silently ignoring it`, async () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        const code = await main(['sessions', '--limit', badLimit])
        expect(code).not.toBe(0)
        expect(logSpy).not.toHaveBeenCalled()
        expect(errorSpy).toHaveBeenCalledTimes(1)
        const [message] = errorSpy.mock.calls[0] as [string]
        expect(message).toContain('--limit')
        expect(message).toContain(badLimit)
      } finally {
        errorSpy.mockRestore()
        logSpy.mockRestore()
      }
    })
  }

  // Finding 5, for --limit: a flag typed with no value at all is a different
  // mistake from one typed with a bad value, and reading the next argument
  // blindly turned `--limit --project /x` into the limit "--project".
  for (const argv of [['sessions', '--limit'], ['sessions', '--limit', '--project', '/root/x']]) {
    test(`sessions rejects --limit with no value: ${argv.join(' ')}`, async () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        expect(await main(argv)).toBe(2)
        expect(logSpy).not.toHaveBeenCalled()
        expect(String((errorSpy.mock.calls[0] ?? [''])[0])).toContain('--limit')
      } finally {
        errorSpy.mockRestore()
        logSpy.mockRestore()
      }
    })
  }

  test('sessions still accepts a real positive integer limit', async () => {
    const cwd = '/root/fake-project-good-limit'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'sess-limit.jsonl'), `${record({ cwd })}\n`)

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await main(['sessions', '--project', cwd, '--limit', '3'])
      expect(code).toBe(0)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  // Ruling A1: `minos file` with no path argument. `args[0] ?? ''` turns a
  // missing argument into the empty string, and `"x".endsWith('')` is always
  // true, so every undone change in the session is printed under a header
  // with a blank filename instead of the command refusing to run. A session
  // is planted here so the fix is proven to trigger on the missing argument
  // itself, not merely on there being no session to report on.
  test('file with no path argument prints usage and exits non-zero rather than matching every file', async () => {
    const cwd = '/root/fake-project-file-usage'
    const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'sess-usage.jsonl'), `${record({ cwd })}\n`)

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await main(['file', '--project', cwd])
      expect(code).not.toBe(0)
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})

// Finding 6: a path this session never touched printed "0 of its changes did
// not survive" and nothing else, which reads as a clean bill of health for
// the file. The honest answer to a typo'd path is that nothing was found.
test('file says a path was never touched rather than reporting it as clean', async () => {
  const text = await runFile(paths, 'nonexistent.ts')
  expect(text.toLowerCase()).toContain('no operations')
  expect(text).not.toContain('0 of its changes did not survive')
})

// Finding 1, in the two commands that print times of their own: both sliced
// the UTC clock out of the timestamp exactly as the report did.
test('undone prints times in the reader\'s own zone', async () => {
  process.env.TZ = 'Europe/Amsterdam'
  try {
    const text = await runUndone(paths)
    expect(text).toContain('21:02')
    expect(text).not.toContain('19:02')
  } finally {
    process.env.TZ = 'UTC'
  }
})

test('file prints times in the reader\'s own zone', async () => {
  process.env.TZ = 'Europe/Amsterdam'
  try {
    const text = await runFile(paths, '/repo/src/auth.ts')
    expect(text).toContain('21:02')
    expect(text).not.toContain('19:02')
  } finally {
    process.env.TZ = 'UTC'
  }
})

// Single-session export with a window: every number in the JSON comes from
// changes inside the window, and an undone change is kept when the change
// that was undone is inside it, whenever the undoing happened.
test('export with a window counts only in-window changes and keeps undone findings by their introducing change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minos-export-window-'))
  const transcript = join(dir, 'session.jsonl')
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'acceptEdits', timestamp: '2026-09-01T10:00:00Z', sessionId: 's', cwd: '/repo', message: { content: 'edit' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-01T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u1', timestamp: '2026-09-03T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'y', new_string: 'x' } }] } },
    { type: 'assistant', uuid: 'a3', parentUuid: 'u1', timestamp: '2026-09-03T10:02:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/repo/b.ts', content: 'one\ntwo\n' } }] } },
  ]
  await writeFile(transcript, records.map((r) => JSON.stringify(r)).join('\n'))
  const at = { transcript, subagents: [] }
  try {
    const open = JSON.parse(await runExport(at))
    expect('window' in open).toBe(false)
    expect(open.operations.length).toBe(3)
    expect(open.undone.length).toBe(1)

    const late = JSON.parse(await runExport(at, { since: '2026-09-02', until: null }))
    expect(late.window).toEqual({ since: '2026-09-02', until: null })
    expect(late.operations.map((o: { toolUseId: string }) => o.toolUseId)).toEqual(['t2', 't3'])
    expect(late.undone.length).toBe(0)
    expect(late.totals.auto).toEqual({ files: 2, added: 3, removed: 1 })
    expect(late.filesTouched).toBe(2)
    expect(late.byPrompt[0].added).toBe(3)

    const early = JSON.parse(await runExport(at, { since: null, until: '2026-09-01' }))
    expect(early.operations.map((o: { toolUseId: string }) => o.toolUseId)).toEqual(['t1'])
    expect(early.undone.length).toBe(1)
    expect(early.byPrompt[0].undone).toBe(1)
    expect(early.largestAuto).toEqual([{ file: '/repo/a.ts', added: 1, removed: 1, promptIndex: 1 }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// --all walks a whole fake store: one directory that holds no transcript any
// more, one with a parent session and a fork that copies one of its changes,
// and one plain project.
describe('every project at once', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'minos-all-'))
    process.env.CLAUDE_CONFIG_DIR = root
    const projects = join(root, 'projects')
    const write = async (dir: string, name: string, records: object[]): Promise<void> => {
      await mkdir(join(projects, dir), { recursive: true })
      await writeFile(join(projects, dir, name), records.map((r) => JSON.stringify(r)).join('\n'))
    }
    await mkdir(join(projects, '-gone'), { recursive: true })
    await writeFile(join(projects, '-gone', 'notes.txt'), 'pruned')

    const prompt = { type: 'user', uuid: 'a-u1', parentUuid: null, promptId: 'a-p1', permissionMode: 'acceptEdits', timestamp: '2026-09-10T10:00:00Z', sessionId: 'parent', cwd: '/repo/a', message: { content: 'go' } }
    const first = { type: 'assistant', uuid: 'a-a1', parentUuid: 'a-u1', timestamp: '2026-09-10T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'a-t1', name: 'Write', input: { file_path: '/repo/a/x.ts', content: 'x\n' } }] } }
    const second = { type: 'assistant', uuid: 'a-a2', parentUuid: 'a-u1', timestamp: '2026-09-10T10:02:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'a-t2', name: 'Edit', input: { file_path: '/repo/a/x.ts', old_string: 'x', new_string: 'y' } }] } }
    await write('-repo-a', 'parent.jsonl', [prompt, first, second])
    // The fork keeps the copied records' original timestamps, as Claude Code does.
    const own = { type: 'assistant', uuid: 'f-a3', parentUuid: 'a-u1', timestamp: '2026-09-11T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'f-t3', name: 'Write', input: { file_path: '/repo/a/y.ts', content: 'y\n' } }] } }
    await write('-repo-a', 'fork.jsonl', [{ ...prompt, sessionId: 'fork' }, first, own])

    await write('-repo-b', 'plain.jsonl', [
      { type: 'user', uuid: 'b-u1', parentUuid: null, promptId: 'b-p1', permissionMode: 'default', timestamp: '2026-09-12T10:00:00Z', sessionId: 'plain', cwd: '/repo/b', message: { content: 'go' } },
      { type: 'assistant', uuid: 'b-a1', parentUuid: 'b-u1', timestamp: '2026-09-12T10:01:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'b-t1', name: 'Write', input: { file_path: '/repo/b/z.ts', content: 'z\n' } }] } },
    ])
  })

  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    await rm(root, { recursive: true, force: true })
  })

  test('renderAll prints a row per project, the total, the window, the dedup count and what the history covers', async () => {
    const lines = renderAll(await collectAll({ since: '2026-09-01', until: '2026-09-30' })).split('\n')
    expect(lines[0]).toBe('MINOS  all projects  window 2026-09-01 to 2026-09-30')
    expect(lines[1]).toBe('counts are changes: one Edit, Write or NotebookEdit tool call each, deduplicated by tool_use id')
    expect(lines[3]).toBe('project  sessions  decided  auto  subagent  undone')
    expect(lines[4]).toBe('/repo/a         2        0     3         0       0')
    expect(lines[5]).toBe('/repo/b         1        1     0         0       0')
    expect(lines[6]).toBe('total           3        1     3         0       0')
    expect(lines).toContain('auto by mode: acceptEdits 3')
    expect(lines).toContain('possibly unseen writes (shell commands that look like writes, a heuristic, not in the classes above): decided 0, auto 0, subagent 0')
    expect(lines).toContain('dropped 1 duplicate change copied between forked or resumed sessions')
    expect(lines.at(-1)).toBe('history: oldest transcript 2026-09-10, newest 2026-09-12; 1 project directory has no transcripts left (cleanupPeriodDays prunes them)')
  })

  test('renderAll with a window counts only the changes inside it', async () => {
    const lines = renderAll(await collectAll({ since: '2026-09-11', until: null })).split('\n')
    expect(lines[0]).toStartWith('MINOS  all projects  window 2026-09-11 to ')
    expect(lines.find((l) => l.startsWith('/repo/a'))).toBe('/repo/a         1        0     1         0       0')
    expect(lines).toContain('dropped 0 duplicate changes copied between forked or resumed sessions')
  })

  test('runExportAll gives the same total as the text, with the auto modes', async () => {
    const parsed = JSON.parse((await runExportAll({ since: null, until: null })) ?? '')
    const totalRow = renderAll(await collectAll({ since: null, until: null })).split('\n').find((l) => l.startsWith('total'))
    const [, sessions, decided, auto, subagent, undone] = (totalRow ?? '').split(/\s+/).map(Number)
    expect(parsed.total.sessions).toBe(sessions)
    expect(parsed.total.changes).toEqual({ decided, auto, subagent, undone })
    expect(parsed.total.autoModes).toEqual({ acceptEdits: 3 })
    expect(parsed.emptyProjectDirs).toBe(1)
  })

  test('a project recorded under several paths prints its newest and says how many older ones it has', async () => {
    const projects = join(root, 'projects', '-repo-b')
    await writeFile(join(projects, 'moved.jsonl'), JSON.stringify({ type: 'user', uuid: 'm-u1', parentUuid: null, promptId: 'm-p1', permissionMode: 'default', timestamp: '2026-09-13T10:00:00Z', sessionId: 'moved', cwd: '/home/b', message: { content: 'go' } }))
    // Newer than the beforeEach transcripts by mtime, whatever the clock resolution.
    await utimes(join(projects, 'moved.jsonl'), new Date('2030-01-01'), new Date('2030-01-01'))
    const text = renderAll(await collectAll({ since: null, until: null }))
    expect(text).toContain('/home/b (+1 older path)')
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { resolveSession, runReport } from '../src/commands/report'
import { runUndone } from '../src/commands/undone'
import { runFile } from '../src/commands/file'
import { runSessions } from '../src/commands/sessions'
import { runExport } from '../src/commands/export'
import { main } from '../src/cli'
import { encodeProjectSlug } from '../src/paths'
import { FIXTURE_DIR } from '../scripts/make-fixtures'

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

test('file matches by trailing path segment, and reports zero when nothing matches', async () => {
  // 'auth.ts' is a suffix of the fixture's real path, not the whole path: this
  // guards `endsWith` specifically, not just "some" filtering.
  const bySuffix = await runFile(paths, 'auth.ts')
  expect(bySuffix.startsWith('auth.ts: 1 of its changes did not survive')).toBe(true)

  const noMatch = await runFile(paths, 'nonexistent.ts')
  expect(noMatch).toBe('nonexistent.ts: 0 of its changes did not survive')
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

    expect(found).not.toBeNull()
    expect(found?.transcript).toBe(join(projectDir, 'sess-real.jsonl'))
    expect(found?.subagents).toEqual([join(subagentsDir, 'agent-1.jsonl')])
  })

  test('resolveSession returns null when no project directory matches the cwd', async () => {
    const found = await resolveSession({ cwd: '/root/nothing-here', session: null })
    expect(found).toBeNull()
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

    expect(found?.transcript).toBe(join(projectDir, 'session-older-abc123.jsonl'))
  })

  // runSessions: the "no store" branch. A regression that threw instead of
  // reporting, or that reported success, would break this.
  test('sessions reports plainly when there is no transcript store for the directory', async () => {
    const text = await runSessions('/root/nothing-here', 10)
    expect(text).toBe('minos: no transcripts for /root/nothing-here')
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

    const text = await runSessions(cwd, 10)
    expect(text).toBe('sess-sub  decided 0  auto 0  subagent 1  undone 0')
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

    const full = await runSessions(cwd, 10)
    const lines = full.split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('sess-001  decided 1  auto 0  subagent 0  undone 0')
    expect(lines[1]).toBe('sess-002  decided 0  auto 1  subagent 0  undone 1')

    const limited = await runSessions(cwd, 1)
    expect(limited.split('\n')).toEqual([lines[1]])
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

  test('sessions still accepts a real positive integer limit', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await main(['sessions', '--limit', '3'])
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

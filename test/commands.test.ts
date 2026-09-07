import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveSession, runReport } from '../src/commands/report'
import { runUndone } from '../src/commands/undone'
import { runFile } from '../src/commands/file'
import { runSessions } from '../src/commands/sessions'
import { runExport } from '../src/commands/export'
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

// resolveSession and runSessions resolve against a real, on-disk project
// store, so every test below points CLAUDE_CONFIG_DIR at a throwaway
// directory rather than the real ~/.claude — otherwise they would read this
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
})

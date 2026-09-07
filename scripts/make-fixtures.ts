import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const FIXTURE_DIR = join(import.meta.dir, '..', 'test', 'fixtures')

/** Writes the synthetic transcripts the suite reads. Gitignored, so it runs before every test run. */
export async function writeFixtures(): Promise<void> {
  await rm(FIXTURE_DIR, { recursive: true, force: true })
  await mkdir(FIXTURE_DIR, { recursive: true })
  await writeFile(join(FIXTURE_DIR, '.keep'), '')

  const lines = [
    JSON.stringify({ type: 'user', uuid: 'u1', promptId: 'p1', permissionMode: 'default' }),
    '{ this line is not json',
    JSON.stringify({ type: 'assistant', uuid: 'a1', parentUuid: 'u1' }),
    '',
  ]
  await writeFile(join(FIXTURE_DIR, 'malformed.jsonl'), lines.join('\n'))

  const session = [
    { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T19:01:00Z', sessionId: 's1', cwd: '/repo', gitBranch: 'main', message: { content: 'fix the login redirect' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-07T19:02:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'redirect(a)', new_string: 'redirect(b)' } }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', promptId: 'p2', permissionMode: 'acceptEdits', timestamp: '2026-09-07T20:09:00Z', message: { content: 'make the mailer use the queue' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: '2026-09-07T20:11:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'redirect(b)', new_string: 'redirect(a)' } }] } },
    { type: 'assistant', uuid: 'a3', parentUuid: 'u2', timestamp: '2026-09-07T20:12:00Z', isSidechain: true, message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/repo/src/mail.ts', content: 'queued\n' } }] } },
  ]
  await writeFile(join(FIXTURE_DIR, 'session.jsonl'), session.map((r) => JSON.stringify(r)).join('\n'))

  const subagent = [
    { type: 'assistant', uuid: 'sa1', parentUuid: null, timestamp: '2026-09-07T21:00:00Z', isSidechain: false, message: { content: [{ type: 'tool_use', id: 'st1', name: 'Write', input: { file_path: '/repo/src/notes.md', content: 'note\n' } }] } },
  ]
  await writeFile(
    join(FIXTURE_DIR, 'subagent.jsonl'),
    [...subagent.map((r) => JSON.stringify(r)), '{ not json'].join('\n'),
  )
}

if (import.meta.main) await writeFixtures()

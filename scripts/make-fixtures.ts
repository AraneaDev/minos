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
}

if (import.meta.main) await writeFixtures()

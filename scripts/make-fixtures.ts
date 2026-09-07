import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const FIXTURE_DIR = join(import.meta.dir, '..', 'test', 'fixtures')

/** Writes the synthetic transcripts the suite reads. Gitignored, so it runs before every test run. */
export async function writeFixtures(): Promise<void> {
  await rm(FIXTURE_DIR, { recursive: true, force: true })
  await mkdir(FIXTURE_DIR, { recursive: true })
  await writeFile(join(FIXTURE_DIR, '.keep'), '')
}

if (import.meta.main) await writeFixtures()

import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { eachRecord } from '../src/transcript'
import { FIXTURE_DIR } from '../scripts/make-fixtures'
import type { UnknownRecord } from '../src/types'

test('a line that does not parse is counted, not fatal', async () => {
  const seen: UnknownRecord[] = []
  const stats = await eachRecord(join(FIXTURE_DIR, 'malformed.jsonl'), (r) => seen.push(r))
  expect(seen.map((r) => r.uuid)).toEqual(['u1', 'a1'])
  expect(stats.skipped).toBe(1)
  expect(stats.lines).toBe(3)
})

test('a file that is not there reads as empty rather than throwing', async () => {
  const stats = await eachRecord(join(FIXTURE_DIR, 'absent.jsonl'), () => {})
  expect(stats).toEqual({ lines: 0, skipped: 0 })
})

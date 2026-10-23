import { afterEach, expect, test } from 'bun:test'
import { inWindow } from '../src/window'

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

test('since is inclusive from local midnight and until through the end of its local day', () => {
  process.env.TZ = 'Europe/Amsterdam'
  const w = { since: '2026-09-22', until: '2026-09-23' }
  expect(inWindow('2026-09-21T21:59:59.999Z', w)).toBe(false)
  expect(inWindow('2026-09-21T22:00:00.000Z', w)).toBe(true)
  expect(inWindow('2026-09-23T21:59:59.999Z', w)).toBe(true)
  expect(inWindow('2026-09-23T22:00:00.000Z', w)).toBe(false)
})

test('an open bound lets everything through on its side', () => {
  process.env.TZ = 'UTC'
  expect(inWindow('2020-01-01T00:00:00Z', { since: null, until: '2026-09-22' })).toBe(true)
  expect(inWindow('2030-01-01T00:00:00Z', { since: '2026-09-22', until: null })).toBe(true)
})

test('an unparseable timestamp is outside any bound and inside an open window', () => {
  process.env.TZ = 'UTC'
  expect(inWindow('', { since: '2026-09-22', until: null })).toBe(false)
  expect(inWindow('', { since: null, until: null })).toBe(true)
})

import { afterEach, expect, test } from 'bun:test'
import { describeWindow, inWindow, undoneInWindow } from '../src/window'
import type { Undone } from '../src/reverts'
import type { Operation } from '../src/types'

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

test('an undone finding is in the window when the change that was undone is, wherever the undoing was', () => {
  const at = (iso: string) => ({ at: iso }) as Operation
  const u = { introduced: at('2026-09-22T10:00:00Z'), undoneBy: at('2026-10-30T10:00:00Z') } as Undone
  expect(undoneInWindow(u, { since: '2026-09-22', until: '2026-09-22' })).toBe(true)
  expect(undoneInWindow(u, { since: '2026-09-23', until: null })).toBe(false)
  expect(undoneInWindow({ ...u, introduced: at('2026-09-01T00:00:00Z'), undoneBy: u.introduced } as Undone, { since: '2026-09-22', until: null })).toBe(false)
})

test('describeWindow names an open start and shows today for an open end', () => {
  process.env.TZ = 'UTC'
  expect(describeWindow({ since: null, until: '2026-09-01' })).toBe('start of history to 2026-09-01')
  expect(describeWindow({ since: '2026-09-02', until: null })).toBe(`2026-09-02 to ${new Date().toISOString().slice(0, 10)}`)
})

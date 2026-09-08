import { afterEach, expect, test } from 'bun:test'
import { CLOCK_WIDTH, clock, localDate } from '../src/clock'

afterEach(() => {
  process.env.TZ = 'UTC'
})

// Finding 1: every time in the report was `iso.slice(11, 16)`, which is the
// UTC clock. A session driven from Amsterdam at 21:02 local was reported as
// 19:02, two hours off what the reader saw in their own terminal.
test('a time is rendered in the local zone, not the UTC one the transcript records', () => {
  process.env.TZ = 'Europe/Amsterdam'
  expect(clock('2026-09-07T19:02:00Z', '2026-09-07T18:00:00Z')).toBe('21:02')
})

test('a time on the session\'s own day carries no day suffix', () => {
  expect(clock('2026-08-10T15:37:00Z', '2026-08-10T14:17:00Z')).toBe('15:37')
})

// Finding 2: an undone row reading "14:17 to 15:37" spanned 25 hours in a
// real session, and rendered as though it spanned 80 minutes.
test('a time on a later day than the session started names how many days later', () => {
  expect(clock('2026-08-11T15:37:00Z', '2026-08-10T14:17:00Z')).toBe('15:37+1d')
  expect(clock('2026-08-13T09:00:00Z', '2026-08-10T14:17:00Z')).toBe('09:00+3d')
})

// The day a change belongs to is the day the reader was living in, not the
// day UTC was having. 23:30Z is already the next morning in Amsterdam.
test('the day count is counted in local days, not UTC ones', () => {
  process.env.TZ = 'Europe/Amsterdam'
  expect(clock('2026-08-10T23:30:00Z', '2026-08-10T10:00:00Z')).toBe('01:30+1d')
})

// A subagent's first operation can carry a timestamp fractionally before the
// session's first prompt, so the backwards direction has to render too.
test('a time before the session started counts backwards rather than reading as the same day', () => {
  expect(clock('2026-08-09T22:00:00Z', '2026-08-10T14:17:00Z')).toBe('22:00-1d')
})

// A timestamp that does not parse must not be printed as though it were a
// real time, and must not take the report down with it.
test('an unparseable timestamp reads as unknown rather than as a plausible time', () => {
  expect(clock('not a timestamp', '2026-08-10T14:17:00Z')).toBe('--:--')
})

// An origin that cannot be read costs the day suffix, which is the part that
// depends on it. The time itself is still known, and is still worth printing.
test('an unreadable session origin drops the day suffix rather than the time', () => {
  expect(clock('2026-08-10T14:17:00Z', 'not a timestamp')).toBe('14:17')
})

test('every rendered clock value fits the column width the report pads to', () => {
  const widest = clock('2026-11-20T09:00:00Z', '2026-08-10T14:17:00Z')
  expect(widest).toBe('09:00+102d')
  expect(widest.length).toBeLessThanOrEqual(CLOCK_WIDTH)
})

// The header anchors every `+Nd` in the report, so it has to be the local
// date of the session's first prompt rather than the UTC one.
test('the session date is the local date of the moment it names', () => {
  process.env.TZ = 'Europe/Amsterdam'
  expect(localDate('2026-08-10T23:30:00Z')).toBe('2026-08-11')
  process.env.TZ = 'UTC'
  expect(localDate('2026-08-10T23:30:00Z')).toBe('2026-08-10')
  expect(localDate('not a timestamp')).toBe('(unknown date)')
})

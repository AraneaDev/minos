/**
 * A date window over local calendar days, for counting only part of the history.
 *
 * Dates are `YYYY-MM-DD` and read as days on the reader's own clock, the zone
 * the process runs in, matching `clock.ts`: `--since 2026-09-22` means from
 * midnight where the reader is, not from midnight in UTC.
 */

import { localDate } from './clock'
import type { Undone } from './reverts'

/** Both bounds are optional and inclusive; a null bound is open. */
export interface Window {
  since: string | null
  until: string | null
}

/** Local midnight at the start of the given day, shifted by `days` calendar days. */
function localMidnight(day: string, days: number): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d! + days).getTime()
}

/**
 * Whether an instant falls inside the window. `since` is inclusive from 00:00
 * local and `until` is inclusive through 23:59:59.999 local, which is the next
 * local midnight, exclusive. With neither bound set everything is inside, an
 * unparseable timestamp included; once a bound is set a timestamp that does
 * not parse is outside, since nothing says which side of it the instant is on.
 */
export function inWindow(iso: string, window: Window): boolean {
  if (window.since === null && window.until === null) return true
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return false
  if (window.since !== null && at < localMidnight(window.since, 0)) return false
  if (window.until !== null && at >= localMidnight(window.until, 1)) return false
  return true
}

/**
 * Whether a session's span overlaps the window: it did not end before `since`
 * and did not start after `until`. An unknown start or end cannot rule the
 * session out, so a span with a missing endpoint overlaps on that side.
 */
export function spansWindow(startedAt: string | null, endedAt: string | null, window: Window): boolean {
  if (endedAt !== null && !inWindow(endedAt, { since: window.since, until: null })) return false
  if (startedAt !== null && !inWindow(startedAt, { since: null, until: window.until })) return false
  return true
}

/**
 * Whether an undone finding belongs in the window: it is kept when the change
 * that was undone falls inside it, whenever the undoing happened.
 */
export function undoneInWindow(u: Undone, window: Window): boolean {
  return inWindow(u.introduced.at, window)
}

/**
 * The window as `<from> to <to>` for a header line. An open `since` reads
 * `start of history` and an open `until` reads as today's local date, so the
 * stated window is a pair of dates or says plainly that it has no start.
 */
export function describeWindow(window: Window): string {
  const today = localDate(new Date().toISOString())
  return `${window.since ?? 'start of history'} to ${window.until ?? today}`
}

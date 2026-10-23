/**
 * A date window over local calendar days, for counting only part of the history.
 *
 * Dates are `YYYY-MM-DD` and read as days on the reader's own clock, the zone
 * the process runs in, matching `clock.ts`: `--since 2026-09-22` means from
 * midnight where the reader is, not from midnight in UTC.
 */

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

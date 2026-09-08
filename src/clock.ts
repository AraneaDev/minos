/**
 * Rendering transcript timestamps as a reader's own clock.
 *
 * A transcript records every moment as an ISO instant in UTC. Slicing `HH:MM`
 * straight out of that string is the UTC clock, which is the wrong clock for
 * everyone not sitting on the meridian: a session driven from Amsterdam at
 * 21:02 reported itself as 19:02, and the whole point of naming a time is
 * that the reader can match it against what they remember. Every time in the
 * report therefore goes through here, and comes out in the zone the process
 * is running in.
 */

/** What a time reads as when its timestamp does not parse. Never a plausible-looking time. */
const UNKNOWN_TIME = '--:--'

/** What a date reads as when its timestamp does not parse. */
const UNKNOWN_DATE = '(unknown date)'

/**
 * Fixed display width of a `clock` value, so the column after it lines up
 * across rows. `HH:MM` is five, and a day suffix adds up to five more for a
 * session resumed across three digits' worth of days.
 */
export const CLOCK_WIDTH = 10

/** The instant, or null when the timestamp is not one this can read. */
function instant(iso: string): Date | null {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * The local calendar day an instant falls on, as a whole number of days. The
 * local Y/M/D are fed back through `Date.UTC` so the arithmetic is a plain
 * subtraction of two day counts, which is what makes the difference a count
 * of calendar days the reader lived through rather than of 24-hour chunks:
 * 23:30 UTC and 01:30 UTC an hour later are two different days in Amsterdam,
 * and one day in London.
 */
function localDayIndex(at: Date): number {
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86_400_000
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The local calendar date of an instant, as `YYYY-MM-DD`. */
export function localDate(iso: string): string {
  const at = instant(iso)
  if (at === null) return UNKNOWN_DATE
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

/**
 * One moment as local `HH:MM`, with a `+Nd` suffix when it falls on a later
 * local day than `originIso`, and `-Nd` when it falls on an earlier one. The
 * suffix is what stops a report of a long session from lying about its own
 * span: an undone change introduced at 14:17 and overwritten at 15:37 the
 * next day is 25 hours, not 80 minutes, and `15:37+1d` says so. The origin is
 * the session's first prompt, whose date the report header prints, so a
 * suffix always has something to be relative to.
 */
export function clock(iso: string, originIso: string): string {
  const at = instant(iso)
  if (at === null) return UNKNOWN_TIME

  const time = `${two(at.getHours())}:${two(at.getMinutes())}`

  // An origin that does not parse costs the suffix, not the time. The time is
  // known either way, and dropping it too would throw away the one thing
  // still worth printing.
  const origin = instant(originIso)
  if (origin === null) return time

  const days = localDayIndex(at) - localDayIndex(origin)
  if (days === 0) return time
  return `${time}${days > 0 ? '+' : '-'}${Math.abs(days)}d`
}

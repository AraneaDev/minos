import { basename } from 'node:path'
import { aggregate, type ClassCounts, type ProjectAggregate } from '../aggregate'
import { CHANGES_NOTE } from '../caveats'
import { localStamp } from '../clock'
import { projectFor, subagentFiles } from '../paths'
import { plural } from '../report'
import { analyseSession, type SessionReport } from '../session'
import { describeWindow, spansWindow, type Window } from '../window'

/** One session's row: its id, its first and last record on the reader's clock, and its counts. */
interface SessionRow {
  id: string
  short: string
  first: string
  last: string
  counts: ClassCounts
}

/** The rows, and their total counted the way `sessions --all` counts a project. */
interface Listing {
  cwds: string[]
  rows: SessionRow[]
  /** The shown sessions together, each change once: a resumed session's copy of an earlier change is not counted again. */
  total: Pick<ProjectAggregate, 'changes' | 'autoModes'>
  /** Changes copied between the shown sessions, counted in each row and once in the total. */
  duplicates: number
  /** Transcripts older than the oldest row that `limit` left unread, so the total does not cover them. */
  unread: number
}

/**
 * The newest `limit` sessions of the project at `cwd` inside the window,
 * newest last, or null when the directory has no transcripts. The rows the
 * text listing and `--json` both draw from.
 */
async function collectSessions(cwd: string, limit: number, window: Window): Promise<Listing | null> {
  const project = await projectFor(cwd)
  if (project === null) return null
  const { dir, files } = project
  if (files.length === 0) return null
  const rows: SessionRow[] = []
  const reports: SessionReport[] = []
  let read = 0
  // Newest first, stopping at `limit` rows that are inside the window, so the
  // limit counts rows shown rather than sessions looked at.
  for (const transcript of [...files].reverse()) {
    if (rows.length >= limit) break
    read++
    const id = basename(transcript, '.jsonl')
    const subagents = await subagentFiles(dir, id)
    // Analysed whole and windowed by `aggregate`, as `--all` does, so a row
    // and the project's row in `--all` count the same changes.
    const report = await analyseSession({ transcript, subagents })
    const { startedAt, endedAt } = report
    if (!spansWindow(startedAt, endedAt, window)) continue
    reports.unshift(report)
    rows.unshift({
      id,
      short: id.slice(0, 8),
      first: startedAt === null ? '(unknown date)' : localStamp(startedAt),
      last: endedAt === null ? '(unknown date)' : localStamp(endedAt),
      counts: aggregate([{ dir, cwds: [], reports: [report] }], window, 0).total.changes,
    })
  }
  const all = aggregate([{ dir, cwds: [], reports }], window, 0)
  return {
    cwds: project.cwds,
    rows,
    total: { changes: all.total.changes, autoModes: all.total.autoModes },
    duplicates: all.duplicatesDropped,
    unread: files.length - read,
  }
}

/**
 * Sessions for this directory, newest last, with the headline counts for
 * each. Each row resolves its own subagent transcripts the same way
 * `resolveSession` does for a single session, deriving the session id from
 * the transcript's own filename: a row that skipped this would always report
 * a subagent count of zero and an undone count missing every subagent
 * change, indistinguishable from a session with no subagent work at all.
 * This reads one more directory per row than the earlier version did, which
 * is why `--limit` exists and defaults to a small number of rows. The limit
 * counts rows inside the window, newest first, so a window older than the
 * newest sessions still lists what it holds.
 *
 * When the project's transcripts record more than one cwd (a moved or
 * renamed repository), the first line says so once, ahead of the rows.
 *
 * Each row gives the session's first and last record on the reader's clock,
 * and every count is changes, the unit `sessions --all` and `report` use, so
 * the project's total here and its row there agree. A total row counts each
 * change once over the sessions shown, since a resumed or forked session
 * copies its parent's changes into its own transcript; a per-session file
 * count is never summed, as one file touched in three sessions would count
 * three times. Under the total come the auto changes by permission mode, and
 * a line naming any older transcripts the limit left unread. With a window, a session is kept
 * when its span overlaps it (it did not end before `since` or start after
 * `until`; an unknown end or start cannot rule it out), and the last line
 * states the window, an open end reading `start of history` or today's local
 * date. The counts in a row are the changes inside the window, not the whole
 * session's, so a session spanning the edge shows only its in-window changes.
 *
 * Returns null when the directory has no transcripts at all, rather than a
 * line of prose (Finding 7). An error message returned as the result was
 * printed to stdout with a success exit code, so a caller piping this
 * received the failure as data and had nothing to tell it apart from a real
 * listing. Reporting it is the caller's job, on the same stream and with the
 * same exit code as every other command's version of this failure.
 */
export async function runSessions(cwd: string, limit: number, window: Window, json = false): Promise<string | null> {
  const found = await collectSessions(cwd, limit, window)
  if (found === null) return null
  if (json) {
    const { cwds, rows, total, duplicates, unread } = found
    return JSON.stringify({ cwds, window, sessions: rows, total, duplicatesDropped: duplicates, unreadTranscripts: unread }, null, 2)
  }
  const lines: string[] = []
  if (found.cwds.length > 1) lines.push(`recorded under ${found.cwds.length} paths: ${found.cwds.join(', ')}`)
  lines.push(CHANGES_NOTE, 'session   first             last              decided  auto  subagent  undone')
  const row = (left: string, c: ClassCounts): string =>
    `${left}  ${String(c.decided).padStart(7)}  ${String(c.auto).padStart(4)}  ${String(c.subagent).padStart(8)}  ${String(c.undone).padStart(6)}`
  for (const r of found.rows) lines.push(row(`${r.short.padEnd(8)}  ${r.first.padEnd(16)}  ${r.last.padEnd(16)}`, r.counts))
  if (found.rows.length > 0) {
    lines.push(row('total'.padEnd(44), found.total.changes))
    const modes = Object.entries(found.total.autoModes).sort(([x, m], [y, n]) => n - m || x.localeCompare(y))
    lines.push(`auto by mode: ${modes.length === 0 ? 'none' : modes.map(([m, n]) => `${m} ${n}`).join(', ')}`)
  }
  if (found.duplicates > 0) {
    const verb = found.duplicates === 1 ? 'counts' : 'count'
    lines.push(`${plural(found.duplicates, 'change', 'changes')} copied between resumed or forked sessions ${verb} in each row and once in the total`)
  }
  if (found.unread > 0) {
    lines.push(`the total covers the sessions shown; ${plural(found.unread, 'older transcript was', 'older transcripts were')} not read (raise --limit to count them)`)
  }
  if (window.since !== null || window.until !== null) {
    lines.push(`window: ${describeWindow(window)}`)
  }
  return lines.join('\n')
}

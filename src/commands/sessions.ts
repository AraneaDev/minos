import { basename } from 'node:path'
import { localStamp } from '../clock'
import { projectFor, subagentFiles } from '../paths'
import { analyseSession } from '../session'
import { describeWindow, spansWindow, type Window } from '../window'

/** One session's row: its id, its first and last record on the reader's clock, and its counts. */
interface SessionRow {
  id: string
  short: string
  first: string
  last: string
  counts: { decided: number; auto: number; subagent: number; undone: number }
}

/**
 * The newest `limit` sessions of the project at `cwd` inside the window,
 * newest last, or null when the directory has no transcripts. The rows the
 * text listing and `--json` both draw from.
 */
async function collectSessions(cwd: string, limit: number, window: Window): Promise<{ cwds: string[]; rows: SessionRow[] } | null> {
  const project = await projectFor(cwd)
  if (project === null) return null
  const { dir, files } = project
  if (files.length === 0) return null
  const rows: SessionRow[] = []
  // Newest first, stopping at `limit` rows that are inside the window, so the
  // limit counts rows shown rather than sessions looked at.
  for (const transcript of [...files].reverse()) {
    if (rows.length >= limit) break
    const id = basename(transcript, '.jsonl')
    const subagents = await subagentFiles(dir, id)
    const report = await analyseSession({ transcript, subagents }, { window })
    const { startedAt, endedAt } = report
    if (!spansWindow(startedAt, endedAt, window)) continue
    const t = report.totals
    rows.unshift({
      id,
      short: id.slice(0, 8),
      first: startedAt === null ? '(unknown date)' : localStamp(startedAt),
      last: endedAt === null ? '(unknown date)' : localStamp(endedAt),
      counts: { decided: t.decided.files, auto: t.auto.files, subagent: t.subagent.files, undone: report.undone.length },
    })
  }
  return { cwds: project.cwds, rows }
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
 * and a header under the column names says what the counts count: decided,
 * auto and subagent count files, undone counts changes, so the columns are
 * not compared as if they shared a unit. With a window, a session is kept
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
  if (json) return JSON.stringify({ cwds: found.cwds, window, sessions: found.rows }, null, 2)
  const lines: string[] = []
  if (found.cwds.length > 1) lines.push(`recorded under ${found.cwds.length} paths: ${found.cwds.join(', ')}`)
  lines.push(
    'session   first             last              decided  auto  subagent  undone',
    '          (decided, auto and subagent count files; undone counts changes)',
  )
  for (const r of found.rows) {
    const c = r.counts
    lines.push(
      `${r.short.padEnd(8)}  ${r.first.padEnd(16)}  ${r.last.padEnd(16)}  ` +
        `${String(c.decided).padStart(7)}  ${String(c.auto).padStart(4)}  ` +
        `${String(c.subagent).padStart(8)}  ${String(c.undone).padStart(6)}`,
    )
  }
  if (window.since !== null || window.until !== null) {
    lines.push(`window: ${describeWindow(window)}`)
  }
  return lines.join('\n')
}

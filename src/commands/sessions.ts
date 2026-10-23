import { basename } from 'node:path'
import { localStamp } from '../clock'
import { projectFor, sessionFiles, subagentFiles } from '../paths'
import { analyseSession } from '../session'
import { inWindow, type Window } from '../window'

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
 * states the window, an open end reading `start of history` or `today`.
 *
 * Returns null when the directory has no transcripts at all, rather than a
 * line of prose (Finding 7). An error message returned as the result was
 * printed to stdout with a success exit code, so a caller piping this
 * received the failure as data and had nothing to tell it apart from a real
 * listing. Reporting it is the caller's job, on the same stream and with the
 * same exit code as every other command's version of this failure.
 */
export async function runSessions(cwd: string, limit: number, window: Window): Promise<string | null> {
  const project = await projectFor(cwd)
  if (project === null) return null
  const { dir } = project
  const files = await sessionFiles(dir)
  if (files.length === 0) return null
  const lines: string[] = []
  if (project.cwds.length > 1) lines.push(`recorded under ${project.cwds.length} paths: ${project.cwds.join(', ')}`)
  lines.push(
    'session   first             last              decided  auto  subagent  undone',
    '          (decided, auto and subagent count files; undone counts changes)',
  )
  const rows: string[] = []
  // Newest first, stopping at `limit` rows that are inside the window, so the
  // limit counts rows shown rather than sessions looked at.
  for (const transcript of [...files].reverse()) {
    if (rows.length >= limit) break
    const sessionId = basename(transcript, '.jsonl')
    const subagents = await subagentFiles(dir, sessionId)
    const report = await analyseSession({ transcript, subagents })
    const { startedAt, endedAt } = report
    if (endedAt !== null && !inWindow(endedAt, { since: window.since, until: null })) continue
    if (startedAt !== null && !inWindow(startedAt, { since: null, until: window.until })) continue
    const t = report.totals
    const first = startedAt === null ? '(unknown date)' : localStamp(startedAt)
    const last = endedAt === null ? '(unknown date)' : localStamp(endedAt)
    rows.unshift(
      `${sessionId.slice(0, 8).padEnd(8)}  ${first.padEnd(16)}  ${last.padEnd(16)}  ` +
        `${String(t.decided.files).padStart(7)}  ${String(t.auto.files).padStart(4)}  ` +
        `${String(t.subagent.files).padStart(8)}  ${String(report.undone.length).padStart(6)}`,
    )
  }
  lines.push(...rows)
  if (window.since !== null || window.until !== null) {
    lines.push(`window: ${window.since ?? 'start of history'} to ${window.until ?? 'today'}`)
  }
  return lines.join('\n')
}

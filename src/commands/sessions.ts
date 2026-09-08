import { basename } from 'node:path'
import { projectDirFor, sessionFiles, subagentFiles } from '../paths'
import { analyseSession } from '../session'

/**
 * Sessions for this directory, newest last, with the headline counts for
 * each. Each row resolves its own subagent transcripts the same way
 * `resolveSession` does for a single session, deriving the session id from
 * the transcript's own filename: a row that skipped this would always report
 * a subagent count of zero and an undone count missing every subagent
 * change, indistinguishable from a session with no subagent work at all.
 * This reads one more directory per row than the earlier version did, which
 * is why `--limit` exists and defaults to a small number of rows.
 *
 * Returns null when the directory has no transcripts at all, rather than a
 * line of prose (Finding 7). An error message returned as the result was
 * printed to stdout with a success exit code, so a caller piping this
 * received the failure as data and had nothing to tell it apart from a real
 * listing. Reporting it is the caller's job, on the same stream and with the
 * same exit code as every other command's version of this failure.
 */
export async function runSessions(cwd: string, limit: number): Promise<string | null> {
  const dir = await projectDirFor(cwd)
  if (dir === null) return null
  const files = (await sessionFiles(dir)).slice(-limit)
  if (files.length === 0) return null
  const rows: string[] = []
  for (const transcript of files) {
    const sessionId = basename(transcript, '.jsonl')
    const subagents = await subagentFiles(dir, sessionId)
    const report = await analyseSession({ transcript, subagents })
    const t = report.totals
    rows.push(
      `${basename(transcript, '.jsonl').slice(0, 8)}  ` +
        `decided ${t.decided.files}  auto ${t.auto.files}  subagent ${t.subagent.files}  undone ${report.undone.length}`,
    )
  }
  return rows.join('\n')
}

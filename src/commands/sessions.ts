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
 */
export async function runSessions(cwd: string, limit: number): Promise<string> {
  const dir = await projectDirFor(cwd)
  if (dir === null) return `minos: no transcripts for ${cwd}`
  const files = (await sessionFiles(dir)).slice(-limit)
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

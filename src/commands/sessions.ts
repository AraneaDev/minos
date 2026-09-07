import { basename } from 'node:path'
import { projectDirFor, sessionFiles } from '../paths'
import { analyseSession } from '../session'

/** Sessions for this directory, newest last, with the headline counts for each. */
export async function runSessions(cwd: string, limit: number): Promise<string> {
  const dir = await projectDirFor(cwd)
  if (dir === null) return `minos: no transcripts for ${cwd}`
  const files = (await sessionFiles(dir)).slice(-limit)
  const rows: string[] = []
  for (const transcript of files) {
    const report = await analyseSession({ transcript, subagents: [] })
    const t = report.totals
    rows.push(
      `${basename(transcript, '.jsonl').slice(0, 8)}  ` +
        `decided ${t.decided.files}  auto ${t.auto.files}  subagent ${t.subagent.files}  undone ${report.undone.length}`,
    )
  }
  return rows.join('\n')
}

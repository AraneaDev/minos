import { basename } from 'node:path'
import { projectDirFor, sessionFiles, subagentFiles } from '../paths'
import { renderReport } from '../report'
import { analyseSession } from '../session'
import { readAllowRules } from '../settings'

/** The transcript and subagent files one command run reads. */
export interface SessionPaths {
  transcript: string
  subagents: string[]
}

/**
 * Finds the session to report on: the named one, or the most recent for this
 * directory. The session id `subagentFiles` needs is not carried anywhere in
 * the store's directory layout on its own; it is the transcript's own
 * filename with the `.jsonl` extension removed, so it is derived from the
 * chosen transcript rather than looked up separately.
 */
export async function resolveSession(options: { cwd: string; session: string | null }): Promise<SessionPaths | null> {
  const dir = await projectDirFor(options.cwd)
  if (dir === null) return null
  const files = await sessionFiles(dir)
  const transcript = options.session === null
    ? files.at(-1)
    : files.find((f) => f.includes(options.session as string))
  if (transcript === undefined) return null
  const sessionId = basename(transcript, '.jsonl')
  return { transcript, subagents: await subagentFiles(dir, sessionId) }
}

/**
 * The full report as text. The allow rules that would move a `decided` row
 * into `auto` are read alongside the session, from settings at report time,
 * never from the transcript itself.
 */
export async function runReport(paths: SessionPaths): Promise<string> {
  const [report, allowRules] = await Promise.all([analyseSession(paths), readAllowRules()])
  return renderReport(report, { allowRules })
}

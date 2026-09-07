import { sanitise } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/** Just the changes that did not survive, one per line. */
export async function runUndone(paths: SessionPaths): Promise<string> {
  const report = await analyseSession(paths)
  if (report.undone.length === 0) return 'Every change made in this session was still standing at the end of it.'
  return report.undone
    .map((u) => {
      const where = u.line === null ? u.file : `${u.file}:${u.line}`
      return `${sanitise(where).padEnd(40)}${u.kind.padEnd(13)}${u.introduced.at} to ${u.undoneBy.at}`
    })
    .join('\n')
}

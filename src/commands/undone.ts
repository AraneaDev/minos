import { pathCol, sanitise } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * Just the changes that did not survive, one per line. Timestamps are
 * transcript-derived text exactly like a path or a prompt, so they are
 * sliced to the same HH:MM window and sanitised before printing, same as
 * `renderReport`'s UNDONE section; the path column reuses `renderReport`'s
 * own `pathCol` helper rather than a second, drifting copy of its padding
 * and truncation logic.
 */
export async function runUndone(paths: SessionPaths): Promise<string> {
  const report = await analyseSession(paths)
  if (report.undone.length === 0) return 'Every change made in this session was still standing at the end of it.'
  return report.undone
    .map((u) => {
      const where = u.line === null ? u.file : `${u.file}:${u.line}`
      const introducedAt = sanitise(u.introduced.at.slice(11, 16))
      const undoneAt = sanitise(u.undoneBy.at.slice(11, 16))
      return `${pathCol(sanitise(where), 40)}${u.kind.padEnd(13)}${introducedAt} to ${undoneAt}`
    })
    .join('\n')
}

import { CLOCK_WIDTH, clock } from '../clock'
import { PROMPT_REF_WIDTH, pathCol, promptRef, sanitise, sessionOrigin } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * Just the changes that did not survive, one per line. Times go through the
 * same `clock` as `renderReport`'s UNDONE section, counted from the same
 * session origin, so the two never disagree about when something happened or
 * which day it happened on; the path column and the prompt named on each side
 * likewise reuse `renderReport`'s own `pathCol` and `promptRef` helpers
 * rather than a second, drifting copy of its logic.
 */
export async function runUndone(paths: SessionPaths): Promise<string> {
  const report = await analyseSession(paths)
  if (report.undone.length === 0) return 'Every change made in this session was still standing at the end of it.'
  const origin = sessionOrigin(report)
  return report.undone
    .map((u) => {
      const where = u.line === null ? u.file : `${u.file}:${u.line}`
      const introducedAt = clock(u.introduced.at, origin).padEnd(CLOCK_WIDTH)
      const undoneAt = clock(u.undoneBy.at, origin).padEnd(CLOCK_WIDTH)
      const introducedRef = promptRef(report.prompts, u.introduced.promptId).padEnd(PROMPT_REF_WIDTH)
      const undoneRef = promptRef(report.prompts, u.undoneBy.promptId).padEnd(PROMPT_REF_WIDTH)
      return `${pathCol(sanitise(where), 40)}${u.kind.padEnd(13)}${introducedAt} ${introducedRef} to ${undoneAt} ${undoneRef}`
    })
    .join('\n')
}

import { PROMPT_REF_WIDTH, pathCol, promptRef, sanitise } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * Just the changes that did not survive, one per line. Timestamps are
 * transcript-derived text exactly like a path or a prompt, so they are
 * sliced to the same HH:MM window and sanitised before printing, same as
 * `renderReport`'s UNDONE section; the path column and the prompt named on
 * each side reuse `renderReport`'s own `pathCol` and `promptRef` helpers
 * rather than a second, drifting copy of its logic.
 */
export async function runUndone(paths: SessionPaths): Promise<string> {
  const report = await analyseSession(paths)
  if (report.undone.length === 0) return 'Every change made in this session was still standing at the end of it.'
  return report.undone
    .map((u) => {
      const where = u.line === null ? u.file : `${u.file}:${u.line}`
      const introducedAt = sanitise(u.introduced.at.slice(11, 16))
      const undoneAt = sanitise(u.undoneBy.at.slice(11, 16))
      const introducedRef = promptRef(report.prompts, u.introduced.promptId).padEnd(PROMPT_REF_WIDTH)
      const undoneRef = promptRef(report.prompts, u.undoneBy.promptId).padEnd(PROMPT_REF_WIDTH)
      return `${pathCol(sanitise(where), 40)}${u.kind.padEnd(13)}${introducedAt} ${introducedRef} to ${undoneAt} ${undoneRef}`
    })
    .join('\n')
}

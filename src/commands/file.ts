import { PROMPT_REF_WIDTH, promptRef, sanitise } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * Ruling A2: whether a recorded path is the file the user meant by `target`.
 * A plain `endsWith` matches on raw characters rather than path segments, so
 * a target of `auth.ts` would also match `oauth.ts`. A match is the whole
 * path being equal to the target, or the path ending with a separator
 * followed by the target, so `auth.ts` matches `src/auth.ts` and
 * `/repo/src/auth.ts` but never `src/oauth.ts`.
 */
function matchesTarget(file: string, target: string): boolean {
  return file === target || file.endsWith(`/${target}`)
}

/** One file's operations in this session, in the order they happened. */
export async function runFile(paths: SessionPaths, target: string): Promise<string> {
  const report = await analyseSession(paths)
  const rows = report.undone.filter((u) => matchesTarget(u.file, target))
  const header = `${sanitise(target)}: ${rows.length} of its changes did not survive`
  return [
    header,
    ...rows.map((u) => {
      const introducedAt = sanitise(u.introduced.at.slice(11, 16))
      const undoneAt = sanitise(u.undoneBy.at.slice(11, 16))
      const introducedRef = promptRef(report.prompts, u.introduced.promptId).padEnd(PROMPT_REF_WIDTH)
      const undoneRef = promptRef(report.prompts, u.undoneBy.promptId).padEnd(PROMPT_REF_WIDTH)
      return `  ${u.kind.padEnd(13)}${introducedAt} ${introducedRef} to ${undoneAt} ${undoneRef}`
    }),
  ].join('\n')
}

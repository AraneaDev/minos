import { CLOCK_WIDTH, clock } from '../clock'
import { PROMPT_REF_WIDTH, plural, promptRef, sanitise, sessionOrigin } from '../report'
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

/**
 * One file's operation history in the session: every operation that touched
 * it, in the order it happened, with the time, the kind, the attestation
 * label and the prompt behind it where one resolves; the undone summary for
 * the file is kept below it exactly as before. `SessionReport.operations`
 * carries every operation across every file, so this is a filter over it
 * rather than new analysis.
 *
 * A target nothing in the session touched is answered as such (Finding 6).
 * Falling through to the undone summary alone printed "0 of its changes did
 * not survive", which reads as a clean bill of health for the file rather
 * than as the truth, which is that no file by that name was found at all.
 */
export async function runFile(paths: SessionPaths, target: string): Promise<string> {
  const report = await analyseSession(paths)
  const ops = report.operations.filter((op) => matchesTarget(op.file, target))
  const rows = report.undone.filter((u) => matchesTarget(u.file, target))
  const origin = sessionOrigin(report)

  if (ops.length === 0) return `${sanitise(target)}: no operations in this session`

  const lines: string[] = [
    `${sanitise(target)}: ${rows.length} of its changes did not survive`,
    ...rows.map((u) => {
      const introducedAt = clock(u.introduced.at, origin).padEnd(CLOCK_WIDTH)
      const undoneAt = clock(u.undoneBy.at, origin).padEnd(CLOCK_WIDTH)
      const introducedRef = promptRef(report.prompts, u.introduced.promptId).padEnd(PROMPT_REF_WIDTH)
      const undoneRef = promptRef(report.prompts, u.undoneBy.promptId).padEnd(PROMPT_REF_WIDTH)
      return `  ${u.kind.padEnd(13)}${introducedAt} ${introducedRef} to ${undoneAt} ${undoneRef}`
    }),
  ]

  lines.push('')
  lines.push(`${sanitise(target)}: ${plural(ops.length, 'operation', 'operations')} in this session`)
  lines.push(
    ...ops.map((op) => {
      const at = clock(op.at, origin).padEnd(CLOCK_WIDTH)
      const ref = promptRef(report.prompts, op.promptId)
      return `  ${at}  ${op.kind.padEnd(9)}${op.attestation.padEnd(10)}${ref}`
    }),
  )

  return lines.join('\n')
}

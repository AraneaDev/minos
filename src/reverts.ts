import { replay } from './replay'
import type { Operation } from './types'
import type { ReplayStep } from './replay'

/** The three ways a change fails to survive the session it was made in. */
export type UndoneKind = 'overwritten' | 'reverted' | 'discarded'

/** One change that did not survive, with the operation that ended it. */
export interface Undone {
  file: string
  kind: UndoneKind
  line: number | null
  introduced: Operation
  undoneBy: Operation
}

/**
 * Finds the changes a later operation ended. Detection is string-level, so it
 * works without a base to replay from; the replay only supplies the line
 * number. Each introducing operation is reported at most once, by the first
 * operation that ended it. When base is supplied, candidates are confirmed
 * against the reconstructed final content to avoid false positives from
 * incidental substring matches.
 */
export function findUndone(file: string, ops: Operation[], base: string | null): Undone[] {
  const steps: ReplayStep[] = replay(ops, base)
  const found: Undone[] = []
  const finalContent = steps.length > 0 ? steps[steps.length - 1]?.after : base

  for (let i = 0; i < ops.length; i += 1) {
    const introduced = ops[i]
    if (introduced === undefined) continue
    const added = introduced.kind === 'write' ? introduced.content : introduced.newString
    if (added === null || added === '') continue

    for (let j = i + 1; j < ops.length; j += 1) {
      const later = ops[j]
      if (later === undefined) continue

      if (later.kind === 'write') {
        if (later.content?.includes(added) === true) continue
        // A Write with null content defaults to treating the change as discarded.
        // This is safe: if content is unknown, we cannot confirm survival, so report cautiously.
        found.push({ file, kind: 'discarded', line: steps[i]?.line ?? null, introduced, undoneBy: later })
        break
      }

      if (later.oldString === null || !later.oldString.includes(added)) continue
      if (later.newString?.includes(added) === true) continue

      // When base is supplied and we have reconstructed content, confirm the candidate
      // against the final state. If added still exists, the change survived, so skip this
      // candidate and continue searching for a real undoing.
      if (base !== null && finalContent !== null && finalContent.includes(added)) continue

      const reverted = later.newString === introduced.oldString && later.oldString === introduced.newString
      found.push({
        file,
        kind: reverted ? 'reverted' : 'overwritten',
        line: steps[i]?.line ?? null,
        introduced,
        undoneBy: later,
      })
      break
    }
  }

  // Limitation: pairwise checks never detect cumulative reversals. A sequence
  // old -> new -> other -> old is reported as two overwrites, not as one revert.
  // Fixing this would require tracking cumulative content chains, deferred to v1.1.

  return found
}

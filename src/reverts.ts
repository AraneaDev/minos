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
 * operation that ended it.
 *
 * A candidate is confirmed against the reconstructed final content whenever
 * that content is recoverable, to avoid false positives from incidental
 * substring matches. That recovery does not require a supplied base:
 * `applyOperation` returns a `Write`'s own content unconditionally, so
 * `replay` recovers real content from the first `Write` onward even when
 * `base` is null. Only a file with neither a supplied base nor any `Write` in
 * its operations has no content to confirm against, and for that file this
 * false positive still stands (the file-history work the spec defers to
 * v1.1).
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
        // The immediate write does not carry the added text, but a later
        // operation might still restore it (a further Write bringing the
        // content back, an Edit reintroducing it): the same confirm-guard the
        // reverted/overwritten branch below applies, checked here too, rather
        // than reporting this write as the one that ended it before knowing
        // whether anything after it brought the change back.
        if (finalContent !== null && finalContent.includes(added)) continue
        // A Write with null content defaults to treating the change as discarded.
        // This is safe: if content is unknown, we cannot confirm survival, so report cautiously.
        found.push({ file, kind: 'discarded', line: steps[i]?.line ?? null, introduced, undoneBy: later })
        break
      }

      if (later.oldString === null || !later.oldString.includes(added)) continue
      if (later.newString?.includes(added) === true) continue

      // Whenever the final content was recovered (from a supplied base, or from a
      // later Write even without one), confirm the candidate against it. If added
      // still exists, the change survived, so skip this candidate and continue
      // searching for a real undoing.
      if (finalContent !== null && finalContent.includes(added)) continue

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

  // A sibling limitation: the confirm-guard above checks the whole file, not the
  // position a change was introduced at, so a coincidental reappearance of the
  // introduced text elsewhere in the final content (a duplicated literal, an
  // unrelated line reusing the same token) can suppress a genuine finding.
  // Position-scoped confirmation needs the file-history base the spec defers to
  // v1.1; until then this is a live under-reporting risk, traded for closing the
  // live over-reporting one the guard exists to fix.

  return found
}

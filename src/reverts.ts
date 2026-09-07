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
 */
export function findUndone(file: string, ops: Operation[], base: string | null): Undone[] {
  const steps: ReplayStep[] = replay(ops, base)
  const found: Undone[] = []

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
        found.push({ file, kind: 'discarded', line: steps[i]?.line ?? null, introduced, undoneBy: later })
        break
      }

      if (later.oldString === null || !later.oldString.includes(added)) continue
      if (later.newString?.includes(added) === true) continue

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

  return found
}

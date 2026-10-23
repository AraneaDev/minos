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

/** The lines of a text, trimmed, for comparing what a change added with what later ones remove. */
const trimmedLines = (text: string | null): string[] => (text === null ? [] : text.split('\n').map((l) => l.trim()))

/** A line that says something on its own: a letter or a digit in it, not only braces and punctuation. */
const significant = (line: string): boolean => /[\p{L}\p{N}]/u.test(line)

/**
 * What became of one change, judged line by line: the significant lines it
 * added (in its new text, not its old) are followed through every later
 * operation on the file. An Edit that takes a line out of its old text and not
 * into its new one removes it; one that puts it in, or a Write that holds it,
 * brings it back. The change did not survive when more than half of its lines
 * are gone at the end, and, when the file's final content is known, more than
 * half are missing from that too.
 *
 * Returns the operation after which most of it was gone and how (`discarded` for a
 * Write, `reverted` when that operation put back what the change had taken
 * out, `overwritten` otherwise); null when it survived; `unjudged` when it
 * added no significant line, which the whole-text rule then judges.
 */
function lineFate(introduced: Operation, later: Operation[], finalContent: string | null): { by: Operation; kind: UndoneKind } | null | 'unjudged' {
  const before = new Set(introduced.kind === 'write' ? [] : trimmedLines(introduced.oldString))
  const addedText = introduced.kind === 'write' ? introduced.content : introduced.newString
  const lines = [...new Set(trimmedLines(addedText).filter((l) => significant(l) && !before.has(l)))]
  if (lines.length === 0) return 'unjudged'
  const present = new Set(lines)
  let by: Operation | null = null
  // A line is looked for as text, as the whole-text rule looks for a change:
  // finding it inside a longer line keeps it alive, which can only ever make
  // a change look surviving, never undone.
  const holds = (text: string | null, l: string): boolean => text !== null && text.includes(l)
  // Gone means more than half of what it added: a rewrite that keeps an
  // import line still discards the file it replaced, and a fix to one line
  // of a file the session wrote does not undo the write.
  const gone = (left: number): boolean => left * 2 < lines.length
  for (const op of later) {
    const wasGone = gone(present.size)
    if (op.kind === 'write') {
      for (const l of lines) {
        if (holds(op.content, l)) present.add(l)
        else present.delete(l)
      }
    } else {
      for (const l of lines) {
        if (holds(op.oldString, l) && !holds(op.newString, l)) present.delete(l)
        else if (holds(op.newString, l) && !holds(op.oldString, l)) present.add(l)
      }
    }
    if (!wasGone && gone(present.size)) by = op
    if (!gone(present.size)) by = null
  }
  if (by === null) return null
  if (finalContent !== null && !gone(lines.filter((l) => finalContent.includes(l)).length)) return null
  if (by.kind === 'write') return { by, kind: 'discarded' }
  const takenOut = introduced.kind === 'write' ? [] : trimmedLines(introduced.oldString).filter((l) => significant(l) && !trimmedLines(addedText).includes(l))
  const reverted = takenOut.length > 0 && takenOut.every((l) => holds(by.newString, l))
  return { by, kind: reverted ? 'reverted' : 'overwritten' }
}

/**
 * Finds the changes a later operation ended. Each change is judged line by
 * line first (`lineFate`); one that added only punctuation falls back to the
 * whole-text rule below. Detection is text-level, so it works without a base
 * to replay from; the replay only supplies the line number. Each introducing
 * operation is reported at most once, by the operation that ended it.
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

    // Line by line first: an agent takes a change back by editing the
    // smallest snippet that finds its place, which rarely carries the
    // change's whole new text. A change whose added lines carry nothing
    // significant (braces, blank lines) falls through to the whole-text rule.
    const fate = lineFate(introduced, ops.slice(i + 1), finalContent ?? null)
    if (fate !== 'unjudged') {
      if (fate !== null) found.push({ file, kind: fate.kind, line: steps[i]?.line ?? null, introduced, undoneBy: fate.by })
      continue
    }

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

import type { Operation } from './types'

/** One operation with the content either side of it, and the line it landed on. */
export interface ReplayStep {
  op: Operation
  before: string | null
  after: string | null
  line: number | null
}

/**
 * Applies one operation the way Claude Code applied it: a write replaces
 * everything, an edit replaces the first occurrence unless replace_all is set.
 * Returns null when it cannot be applied, which is a fact to report rather than
 * a case to paper over. The replacement is inserted literally, so dollar sequences
 * like $$, $&, or $` are not interpreted as special patterns.
 */
export function applyOperation(content: string | null, op: Operation): string | null {
  if (op.kind === 'write') return op.content
  if (content === null || op.oldString === null || op.newString === null) return null
  if (!content.includes(op.oldString)) return null
  const newString = op.newString
  return op.replaceAll
    ? content.replaceAll(op.oldString, () => newString)
    : content.replace(op.oldString, () => newString)
}

/** The 1-based line an edit landed on, or null when the content is unknown. */
function lineOf(content: string | null, needle: string | null): number | null {
  if (content === null || needle === null) return null
  const at = content.indexOf(needle)
  if (at === -1) return null
  return content.slice(0, at).split('\n').length
}

/**
 * Walks a file's operations from a known base. Once one fails to apply, every
 * later step reports unknown content rather than a reconstruction built on a
 * divergence nobody would see.
 */
export function replay(ops: Operation[], base: string | null): ReplayStep[] {
  let content = base
  const steps: ReplayStep[] = []
  for (const op of ops) {
    const before = content
    const after = applyOperation(content, op)
    steps.push({ op, before, after, line: lineOf(before, op.oldString) })
    content = after
  }
  return steps
}

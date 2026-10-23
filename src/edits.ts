import { clock } from './clock'
import { promptRef, sessionOrigin } from './report'
import { replay } from './replay'
import type { SessionReport } from './session'
import type { Operation } from './types'

/** The most lines one change's diff carries; a longer one is cut, and says so. */
const MAX_DIFF_LINES = 40

/** What `sanitise` strips, without its folding of whitespace, which would change code's indentation. */
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** One change to a file, ready to draw: when, how, under which label and prompt, and the change itself. */
export interface FileEdit {
  at: string
  kind: Operation['kind']
  attestation: Operation['attestation']
  prompt: string
  /**
   * The change as text. With `numbered`, unified-diff hunks (`@@ -a,b +c,d @@`
   * then `-`/`+` lines) at the line the replay placed it. Without, the same
   * `-`/`+` lines and no hunk header: the session never read the whole file,
   * so where in it the change landed is not known, and no number is invented.
   */
  diff: string
  numbered: boolean
  /** Lines left out of `diff` because the change was longer than it shows. */
  cut: number
}

const linesOf = (text: string | null): string[] => {
  if (text === null || text === '') return []
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

/**
 * The change as diff lines: the lines old and new share at either end as
 * context (` `), the rest as `-` then `+` lines, cut to MAX_DIFF_LINES. An
 * Edit's strings usually carry a line or two around what changed so the tool
 * can find its place; drawn as removed and added again, those lines would
 * claim a change that never happened.
 */
function body(removed: string[], added: string[]): { lines: string[]; cut: number } {
  let head = 0
  while (head < removed.length && head < added.length && removed[head] === added[head]) head++
  let tail = 0
  while (tail < removed.length - head && tail < added.length - head && removed[removed.length - 1 - tail] === added[added.length - 1 - tail]) tail++
  const all = [
    ...removed.slice(0, head).map((l) => ` ${l}`),
    ...removed.slice(head, removed.length - tail).map((l) => `-${l}`),
    ...added.slice(head, added.length - tail).map((l) => `+${l}`),
    ...added.slice(added.length - tail).map((l) => ` ${l}`),
  ]
  return { lines: all.slice(0, MAX_DIFF_LINES), cut: Math.max(0, all.length - MAX_DIFF_LINES) }
}

/**
 * Every change the session made to `matches` files, oldest first, each with
 * its diff. An Edit is its old and new strings; a Write is its whole content,
 * added. Times count from the session's first prompt, and the prompt is named
 * as the report names it.
 */
export function fileEdits(report: SessionReport, matches: (file: string) => boolean): FileEdit[] {
  const origin = sessionOrigin(report)
  const ops = report.operations.filter((o) => matches(o.file))
  const byFile = new Map<string, Operation[]>()
  for (const o of ops) byFile.set(o.file, [...(byFile.get(o.file) ?? []), o])
  const lineFor = new Map<Operation, number | null>()
  for (const fileOps of byFile.values()) for (const step of replay(fileOps, null)) lineFor.set(step.op, step.line)
  return ops.map((op) => {
    const removed = op.kind === 'write' ? [] : linesOf(op.oldString)
    const added = linesOf(op.kind === 'write' ? op.content : op.newString)
    const { lines, cut } = body(removed.map(sanitiseLine), added.map(sanitiseLine))
    const line = op.kind === 'write' ? 1 : (lineFor.get(op) ?? null)
    const numbered = line !== null
    const header = numbered ? [`@@ -${line},${removed.length} +${line},${added.length} @@`] : []
    return {
      at: clock(op.at, origin),
      kind: op.kind,
      attestation: op.attestation,
      prompt: promptRef(report.prompts, op.promptId),
      diff: [...header, ...lines].join('\n'),
      numbered,
      cut,
    }
  })
}

/** A diff line keeps its text and indentation but loses the characters that could repaint a terminal. */
const sanitiseLine = (line: string): string => line.replace(UNSAFE, '')

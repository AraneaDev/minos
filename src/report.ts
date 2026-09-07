import { basename } from 'node:path'
import type { SessionReport } from './session'
import type { Prompt } from './types'

// Prompt text and file paths come out of a transcript unchanged, and both are
// printed into a terminal. C0, C1 and the bidi overrides are removed so a
// prompt cannot reorder or repaint the report that quotes it.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Strips the control and bidi characters that would let quoted text rewrite the report. */
export function sanitise(text: string): string {
  return text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim()
}

const pad = (text: string, width: number): string => text.padEnd(width)
const num = (value: number, width: number): string => String(value).padStart(width)

/** Leads a truncated path so the reader can see it was cut, not the whole thing. */
const ELLIPSIS = '…'

/**
 * Renders a path-like column of a fixed width, followed by a single
 * guaranteed separator space. A real repository path routinely runs past a
 * column's padding width; `pad` alone leaves nothing between it and whatever
 * prints next, so the two run together with no space at all. A path longer
 * than `width` is truncated from the front, with a leading ellipsis, because
 * the tail of a path (the file itself) identifies it better than the leading
 * directories do.
 */
export const pathCol = (text: string, width: number): string =>
  text.length <= width ? `${pad(text, width)} ` : `${ELLIPSIS}${text.slice(-(width - 1))} `

/** A count with its word in the right number, e.g. "1 file" against "3 files". */
export const plural = (n: number, singular: string, pluralWord: string): string => `${n} ${n === 1 ? singular : pluralWord}`

/**
 * The prompt named for one side of a finding: "prompt N" when `promptId`
 * resolves against the session's own prompt list, `(unattributed)` otherwise
 * (no promptId at all, or one that resolves to nothing, which is the common
 * case for a subagent operation). Shared by every place a finding is
 * printed, so `minos report`, `minos undone` and `minos file` never drift
 * out of agreement on how an unresolved prompt reads.
 */
export function promptRef(prompts: Prompt[], promptId: string | null): string {
  const found = promptId === null ? undefined : prompts.find((p) => p.id === promptId)
  return found === undefined ? '(unattributed)' : `prompt ${found.index}`
}

/** Fixed display width of a `promptRef` value, so the text after it lines up across rows. */
export const PROMPT_REF_WIDTH = 14

/**
 * The "file(s)" word for a per-row file count, padded to the width of its
 * longer form. Rows in the same table can disagree on singular/plural, and a
 * varying word width would carry the columns after it out of alignment.
 */
const filesWord = (n: number): string => pad(n === 1 ? 'file' : 'files', 5)

/**
 * How many files the "applied without asking" section names. The spec's own
 * illustrative report shows two; five gives a reader a useful sample of what
 * changed without turning the section into a second full file listing.
 */
const LARGEST_AUTO_LIMIT = 5

/** Fixed display width of a quoted prompt, so the column after it lines up across rows. */
const PROMPT_TEXT_WIDTH = 40

/**
 * What `renderReport` needs beyond the analysed session itself: data that is
 * true right now rather than something the transcript carries, and so cannot
 * live on `SessionReport`. Optional, and treated as unresolved when omitted,
 * so every caller that built a `SessionReport` before this option existed
 * still renders, with the caveat's own "could not be read" branch covering
 * the gap rather than the caveat going missing outright.
 */
export interface RenderOptions {
  /**
   * The Edit/Write/NotebookEdit allow rules in force right now, read from
   * settings at report time; null when no settings file could be read or
   * parsed at all. These are the rules that would move a `decided` row into
   * `auto`, and they reflect today's settings, not necessarily the settings
   * in force when the session ran.
   */
  allowRules: string[] | null
}

/** Renders the whole report. Space-aligned, so the slash command prints it verbatim. */
export function renderReport(report: SessionReport, options?: RenderOptions): string {
  const out: string[] = []
  const id = report.sessionId === '' ? '(unknown)' : sanitise(report.sessionId).slice(0, 7)
  const cwd = sanitise(basename(report.cwd)) || '(unknown)'
  const branch = sanitise(report.branch)

  out.push(`MINOS  ${id}  ${cwd}  ${branch}`)
  out.push(`       ${plural(report.prompts.length, 'prompt', 'prompts')}`)
  out.push('')

  const added = report.totals.decided.added + report.totals.auto.added + report.totals.subagent.added
  const removed = report.totals.decided.removed + report.totals.auto.removed + report.totals.subagent.removed
  out.push(`CHANGED  ${plural(report.filesTouched, 'file', 'files')}, +${added} / -${removed}`)
  out.push('  (a file changed under more than one label below is counted in each; the rows overlap by design)')
  out.push('  (+/- are not diff lines: an Edit counts its whole old and new strings, a Write counts its whole content with 0 removed)')
  out.push('')

  const legend = {
    decided: 'you were asked before it was applied',
    auto: 'acceptEdits or auto, no prompt',
    subagent: 'applied inside a subagent, never rendered',
  } as const
  for (const label of ['decided', 'auto', 'subagent'] as const) {
    const t = report.totals[label]
    out.push(`  ${pad(label, 12)}${num(t.files, 3)} ${filesWord(t.files)}  +${num(t.added, 4)}  -${num(t.removed, 4)}   ${legend[label]}`)
  }
  out.push('')

  if (report.largestAuto.length > 0) {
    const shown = report.largestAuto.slice(0, LARGEST_AUTO_LIMIT)
    out.push(`APPLIED WITHOUT ASKING  ${plural(report.largestAuto.length, 'file', 'files')}. The largest:`)
    out.push('')
    for (const f of shown) {
      const where = f.promptIndex === null ? '(unattributed)' : `prompt ${f.promptIndex}`
      out.push(`  ${pathCol(sanitise(f.file), 30)}+${num(f.added, 4)}  -${num(f.removed, 4)}   ${where}`)
    }
    out.push('')
  }

  out.push(`UNDONE  ${plural(report.undone.length, 'change', 'changes')} did not survive the session`)
  out.push('')
  for (const u of report.undone) {
    const where = u.line === null ? u.file : `${u.file}:${u.line}`
    const introducedAt = sanitise(u.introduced.at.slice(11, 16))
    const undoneAt = sanitise(u.undoneBy.at.slice(11, 16))
    const introducedRef = pad(promptRef(report.prompts, u.introduced.promptId), PROMPT_REF_WIDTH)
    const undoneRef = pad(promptRef(report.prompts, u.undoneBy.promptId), PROMPT_REF_WIDTH)
    out.push(`  ${pathCol(sanitise(where), 40)}${pad(u.kind, 13)}${introducedAt} ${introducedRef} to ${undoneAt} ${undoneRef}`)
  }
  out.push('')

  out.push('BY PROMPT')
  out.push('')
  out.push(
    `  ${pad('#', 3)}  ${pad('when', 5)}  ${pad('files', 9)}  ${pad('+/-', 12)}  ${pad('asked for', PROMPT_TEXT_WIDTH + 2)}  ${pad('undone', 6)}`,
  )
  for (const p of report.byPrompt) {
    const when = sanitise(p.prompt.at.slice(11, 16))
    const text = sanitise(p.prompt.text).slice(0, PROMPT_TEXT_WIDTH)
    const quoted = pad(`"${text}"`, PROMPT_TEXT_WIDTH + 2)
    const filesCol = `${num(p.files, 3)} ${filesWord(p.files)}`
    const deltaCol = `+${num(p.added, 4)}  -${num(p.removed, 4)}`
    out.push(`  ${num(p.prompt.index, 3)}  ${pad(when, 5)}  ${filesCol}  ${deltaCol}  ${quoted}  ${num(p.undone, 6)}`)
  }
  out.push('')

  if (report.unrecognisedModes.length > 0) {
    out.push(`  Permission modes this build does not know, counted as auto: ${report.unrecognisedModes.map(sanitise).join(', ')}`)
  }
  if (report.skippedLines > 0) {
    out.push(`  ${report.skippedLines} transcript lines did not parse and were skipped.`)
  }
  if (report.unattributedCount > 0) {
    out.push(
      `  ${plural(report.unattributedCount, 'change', 'changes')} could not be attributed to a prompt. They are counted above but do not appear in the BY PROMPT table above, and an unattributed undone change does not appear in that table's undone column either.`,
    )
  }

  // `decided` is an inference from permission mode, not a recorded approval:
  // a standing allow rule (Edit(src/**) and the like) can mean a `default`-mode
  // turn never actually prompted anyone. This caveat only makes sense once
  // some row is actually labelled `decided`, and it names the rules read from
  // settings at report time, never the settings that were in force when the
  // session ran, since only the former is ever recoverable.
  if (report.totals.decided.files > 0) {
    out.push(
      '  decided is inferred from permission mode alone, not from a recorded approval; a standing allow rule can mean nothing was ever put on screen.',
    )
    const allowRules = options?.allowRules ?? null
    if (allowRules === null) {
      out.push('  The allow rules in force right now could not be read, so which ones would do that is not known here.')
    } else {
      const rulesText = allowRules.length > 0 ? allowRules.map(sanitise).join(', ') : '(none configured)'
      out.push(`  Allow rules in force right now (not necessarily when this session ran): ${rulesText}`)
    }
  }

  return out.join('\n')
}

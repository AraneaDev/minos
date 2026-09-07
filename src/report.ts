import { basename } from 'node:path'
import type { SessionReport } from './session'

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
const pathCol = (text: string, width: number): string =>
  text.length <= width ? `${pad(text, width)} ` : `${ELLIPSIS}${text.slice(-(width - 1))} `

/** A count with its word in the right number, e.g. "1 file" against "3 files". */
const plural = (n: number, singular: string, pluralWord: string): string => `${n} ${n === 1 ? singular : pluralWord}`

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

/** Renders the whole report. Space-aligned, so the slash command prints it verbatim. */
export function renderReport(report: SessionReport): string {
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
    out.push(`  ${pathCol(sanitise(where), 40)}${pad(u.kind, 13)}${introducedAt} to ${undoneAt}`)
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
      `  ${plural(report.unattributedCount, 'change', 'changes')} could not be attributed to a prompt. They are counted above but do not appear in the BY PROMPT table above.`,
    )
  }

  return out.join('\n')
}

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

/**
 * How many files the "applied without asking" section names. The spec's own
 * illustrative report shows two; five gives a reader a useful sample of what
 * changed without turning the section into a second full file listing.
 */
const LARGEST_AUTO_LIMIT = 5

/** Renders the whole report. Space-aligned, so the slash command prints it verbatim. */
export function renderReport(report: SessionReport): string {
  const out: string[] = []
  const id = report.sessionId === '' ? '(unknown)' : report.sessionId.slice(0, 7)

  out.push(`MINOS  ${id}  ${basename(report.cwd) || '(unknown)'}  ${report.branch}`)
  out.push(`       ${report.prompts.length} prompts`)
  out.push('')

  const added = report.totals.decided.added + report.totals.auto.added + report.totals.subagent.added
  const removed = report.totals.decided.removed + report.totals.auto.removed + report.totals.subagent.removed
  out.push(`CHANGED  ${report.filesTouched} files, +${added} / -${removed}`)
  out.push('')

  const legend = {
    decided: 'you were asked before it was applied',
    auto: 'acceptEdits or auto, no prompt',
    subagent: 'applied inside a subagent, never rendered',
  } as const
  for (const label of ['decided', 'auto', 'subagent'] as const) {
    const t = report.totals[label]
    out.push(`  ${pad(label, 12)}${num(t.files, 3)} files  ${num(t.added, 5)} ${num(-t.removed, 5)}   ${legend[label]}`)
  }
  out.push('')

  if (report.largestAuto.length > 0) {
    const shown = report.largestAuto.slice(0, LARGEST_AUTO_LIMIT)
    out.push(`APPLIED WITHOUT ASKING  ${report.largestAuto.length} files. The largest:`)
    out.push('')
    for (const f of shown) {
      const where = f.promptIndex === null ? '(unattributed)' : `prompt ${f.promptIndex}`
      out.push(`  ${pad(sanitise(f.file), 30)}+${num(f.added, 4)}  -${num(f.removed, 4)}   ${where}`)
    }
    out.push('')
  }

  out.push(`UNDONE  ${report.undone.length} changes did not survive the session`)
  out.push('')
  for (const u of report.undone) {
    const where = u.line === null ? u.file : `${u.file}:${u.line}`
    out.push(`  ${pad(sanitise(where), 40)}${pad(u.kind, 13)}${u.introduced.at.slice(11, 16)} to ${u.undoneBy.at.slice(11, 16)}`)
  }
  out.push('')

  out.push('BY PROMPT')
  out.push('')
  for (const p of report.byPrompt) {
    const text = sanitise(p.prompt.text).slice(0, 40)
    out.push(`  ${num(p.prompt.index, 3)}  ${num(p.files, 3)} files  ${num(p.added, 5)} ${num(-p.removed, 5)}  "${text}"  undone ${p.undone}`)
  }
  out.push('')

  if (report.unrecognisedModes.length > 0) {
    out.push(`  Permission modes this build does not know, counted as auto: ${report.unrecognisedModes.join(', ')}`)
  }
  if (report.skippedLines > 0) {
    out.push(`  ${report.skippedLines} transcript lines did not parse and were skipped.`)
  }
  if (report.unattributedCount > 0) {
    out.push(
      `  ${report.unattributedCount} changes could not be attributed to a prompt. They are counted above but do not appear in the BY PROMPT table below.`,
    )
  }

  return out.join('\n')
}

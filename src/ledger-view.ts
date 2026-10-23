import { DECIDED_NOTE } from './caveats'
import { clock, localStamp } from './clock'
import { failedNote, pathCol, plural, promptRef, sanitise, sessionOrigin } from './report'
import type { UndoneKind } from './reverts'
import type { SessionReport } from './session'

/** One file changed without being asked, with how often and when last. */
interface LedgerFile {
  file: string
  label: 'auto' | 'subagent'
  changes: number
  lastAt: string
}

/** One change that did not survive the session, as plain data. */
interface LedgerUndone {
  file: string
  kind: UndoneKind
  introducedAt: string
  introducedPrompt: number | null
  /** The prompt as the report names it: `prompt N`, or `(unattributed)`. */
  introducedRef: string
  undoneAt: string
}

/** A session's ledger reduced to what a live view shows. */
export interface LedgerView {
  sessionId: string
  /** The directory the session ran in; paths inside it print relative to it. */
  cwd: string
  /** What every `+Nd` suffix counts from: the first prompt, as `minos report` counts it. */
  origin: string
  startedAt: string | null
  /** Files per class and undone in changes, as `minos sessions` counts them. */
  counts: { decided: number; auto: number; subagent: number; undone: number }
  /** Auto and subagent files, most recent change first. */
  unaskedFiles: LedgerFile[]
  /** Most recent first. */
  undone: LedgerUndone[]
  failedChanges: number
  decidedNote: string
}

/** Instants compare as time, not text, so an offset in a transcript timestamp cannot misorder them. */
const when = (iso: string): number => Date.parse(iso) || 0

/**
 * Reduces a session report to its ledger. Counts come straight from the
 * report's totals, the same numbers `minos sessions` prints; the file list is
 * the auto and subagent operations grouped by file, labelled by the file's
 * latest such operation.
 */
export function buildLedgerView(report: SessionReport): LedgerView {
  const byFile = new Map<string, LedgerFile>()
  for (const o of report.operations) {
    if (o.attestation === 'decided') continue
    const seen = byFile.get(o.file)
    const newer = seen === undefined || when(o.at) >= when(seen.lastAt)
    byFile.set(o.file, {
      file: o.file,
      label: newer ? o.attestation : (seen as LedgerFile).label,
      changes: (seen?.changes ?? 0) + 1,
      lastAt: newer ? o.at : (seen as LedgerFile).lastAt,
    })
  }
  const promptIndex = (id: string | null): number | null =>
    id === null ? null : (report.prompts.find((p) => p.id === id)?.index ?? null)
  return {
    sessionId: report.sessionId,
    cwd: report.cwd,
    origin: sessionOrigin(report),
    startedAt: report.startedAt,
    counts: {
      decided: report.totals.decided.files,
      auto: report.totals.auto.files,
      subagent: report.totals.subagent.files,
      undone: report.undone.length,
    },
    unaskedFiles: [...byFile.values()].sort((a, b) => when(b.lastAt) - when(a.lastAt)),
    undone: report.undone
      .map((u) => ({
        file: u.file,
        kind: u.kind,
        introducedAt: u.introduced.at,
        introducedPrompt: promptIndex(u.introduced.promptId),
        introducedRef: promptRef(report.prompts, u.introduced.promptId),
        undoneAt: u.undoneBy.at,
      }))
      .sort((a, b) => when(b.undoneAt) - when(a.undoneAt)),
    failedChanges: report.failedChanges.length,
    decidedNote: DECIDED_NOTE,
  }
}

/** A path relative to the session directory when it is inside it, the whole path otherwise. */
export function shown(file: string, cwd: string): string {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return cwd !== '' && file.startsWith(root) && file.length > root.length ? file.slice(root.length) : file
}

/** The verb a note or a ledger row uses for each way a change ends. */
export const VERB: Record<UndoneKind, string> = { overwritten: 'replaced', reverted: 'reverted', discarded: 'discarded' }

/** The units line under the counts. */
const UNITS = '(decided, auto and subagent count files; undone counts changes)'

/**
 * The ledger as lines, in the report's own wording and helpers, with the lines
 * a display should draw quietly (the units line and the caveats) named, so the
 * pane does not have to recognise them by their wording. Times count from the
 * session's first prompt, the origin `minos report` uses, so a change from a
 * later day carries the same `+Nd` suffix there and here.
 */
export function ledgerLines(view: LedgerView): { lines: string[]; dim: string[] } {
  const since = view.origin === '' ? '' : `  since ${localStamp(view.origin)}`
  const c = view.counts
  const out = [
    `MINOS  ledger  session ${sanitise(view.sessionId).slice(0, 8)}${since}`,
    `decided ${c.decided}  auto ${c.auto}  subagent ${c.subagent}  undone ${c.undone}`,
    UNITS,
  ]
  if (view.unaskedFiles.length === 0 && view.undone.length === 0) out.push('', 'No changes yet.')
  if (view.unaskedFiles.length > 0) {
    out.push('', 'changed without being asked')
    for (const f of view.unaskedFiles) {
      out.push(`  ${pathCol(sanitise(shown(f.file, view.cwd)), 40)}${f.label.padEnd(9)} ${plural(f.changes, 'change', 'changes')}`.trimEnd())
    }
  }
  if (view.undone.length > 0) {
    out.push('', 'did not survive')
    for (const u of view.undone) {
      const at = clock(u.introducedAt, view.origin)
      out.push(`  ${pathCol(sanitise(shown(u.file, view.cwd)), 40)}${u.kind}  ${at} (${u.introducedRef}), ${VERB[u.kind]} ${clock(u.undoneAt, view.origin)}`)
    }
  }
  const caveats: string[] = []
  if (c.decided > 0) caveats.push(`${view.decidedNote}.`)
  if (view.failedChanges > 0) caveats.push(failedNote(view.failedChanges))
  if (caveats.length > 0) out.push('', ...caveats)
  return { lines: out, dim: [UNITS, ...caveats] }
}

/** The ledger as text, as `minos ledger` prints it. */
export function renderLedger(view: LedgerView): string {
  return ledgerLines(view).lines.join('\n')
}

import { CHANGES_NOTE, DECIDED_NOTE } from './caveats'
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
  /** Changes per class and undone, as `minos sessions` counts them. */
  counts: { decided: number; auto: number; subagent: number; undone: number }
  /** Auto and subagent files, most recent change first. */
  unaskedFiles: LedgerFile[]
  /** Most recent first. */
  undone: LedgerUndone[]
  failedChanges: number
  decidedNote: string
  /** The prompts that changed something, most recent first, with the files each changed. */
  prompts: LedgerPrompt[]
}

/** One prompt that changed something: its number, its first line, and what it changed. */
interface LedgerPrompt {
  index: number
  text: string
  files: string[]
  changes: number
  undone: number
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
      decided: report.totals.decided.changes,
      auto: report.totals.auto.changes,
      subagent: report.totals.subagent.changes,
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
    prompts: report.byPrompt
      .map((p) => {
        const ops = report.operations.filter((o) => o.promptId === p.prompt.id)
        return {
          index: p.prompt.index,
          text: p.prompt.text.split('\n').find((l) => l.trim() !== '') ?? '',
          files: [...new Set(ops.map((o) => o.file))],
          changes: ops.length,
          undone: p.undone,
        }
      })
      .filter((p) => p.changes > 0)
      .reverse(),
  }
}

/** A path relative to the session directory when it is inside it, the whole path otherwise. */
export function shown(file: string, cwd: string): string {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return cwd !== '' && file.startsWith(root) && file.length > root.length ? file.slice(root.length) : file
}

/** The verb a note or a ledger row uses for each way a change ends. */
export const VERB: Record<UndoneKind, string> = { overwritten: 'replaced', reverted: 'reverted', discarded: 'discarded' }

/** What each class means, in the README's terms. */
const LEGEND = [
  'decided   made in default or plan mode, where Claude Code asks before it writes',
  'auto      applied without asking: acceptEdits, auto or bypassPermissions',
  'subagent  made inside a subagent, whose diff never reached your terminal',
  'undone    made and then ended later in the same session',
]


/**
 * Every word, number and time a display of the ledger shows, already written
 * the way the report writes them: paths shown relative to the session and
 * sanitised, times on the reader's clock counted from the first prompt, the
 * prompt named as the report names it, the caveats in the report's wording.
 * The text form and any pane lay these out; neither composes one of its own.
 */
export interface LedgerDisplay {
  session: string
  since: string | null
  counts: LedgerView['counts']
  units: string
  files: { file: string; shown: string; label: 'auto' | 'subagent'; changes: string }[]
  undone: { shown: string; kind: UndoneKind; verb: string; at: string; prompt: string; endedAt: string }[]
  caveats: string[]
  empty: string | null
  /** What each count means, one line per class, for a reader who has not met the classes yet. */
  legend: string[]
  /** The prompts that changed something, most recent first, as the report names them. */
  prompts: { ref: string; text: string; summary: string; files: string[] }[]
}

/** The ledger's display strings, for the text form and for a pane. */
export function ledgerDisplay(view: LedgerView): LedgerDisplay {
  const c = view.counts
  const caveats: string[] = []
  if (c.decided > 0) caveats.push(`${view.decidedNote}.`)
  if (view.failedChanges > 0) caveats.push(failedNote(view.failedChanges))
  return {
    session: sanitise(view.sessionId).slice(0, 8),
    since: view.origin === '' ? null : localStamp(view.origin),
    counts: c,
    units: CHANGES_NOTE,
    files: view.unaskedFiles.map((f) => ({
      file: f.file,
      shown: sanitise(shown(f.file, view.cwd)),
      label: f.label,
      changes: plural(f.changes, 'change', 'changes'),
    })),
    undone: view.undone.map((u) => ({
      shown: sanitise(shown(u.file, view.cwd)),
      kind: u.kind,
      verb: VERB[u.kind],
      at: clock(u.introducedAt, view.origin),
      prompt: u.introducedRef,
      endedAt: clock(u.undoneAt, view.origin),
    })),
    caveats,
    empty: c.decided === 0 && view.unaskedFiles.length === 0 && view.undone.length === 0 ? 'No changes yet.' : null,
    legend: LEGEND,
    prompts: view.prompts.map((p) => ({
      ref: `prompt ${p.index}`,
      text: sanitise(p.text),
      summary: [plural(p.files.length, 'file', 'files'), plural(p.changes, 'change', 'changes'), ...(p.undone > 0 ? [`${p.undone} undone`] : [])].join(' · '),
      files: p.files.map((f) => sanitise(shown(f, view.cwd))),
    })),
  }
}

/**
 * The ledger as lines, laid out from `ledgerDisplay`, with the lines a display
 * should draw quietly (the units line and the caveats) named.
 */
export function ledgerLines(view: LedgerView): { lines: string[]; dim: string[] } {
  const d = ledgerDisplay(view)
  const c = d.counts
  const out = [
    `MINOS  ledger  session ${d.session}${d.since === null ? '' : `  since ${d.since}`}`,
    `decided ${c.decided}  auto ${c.auto}  subagent ${c.subagent}  undone ${c.undone}`,
    d.units,
  ]
  if (d.empty !== null) out.push('', d.empty)
  if (d.files.length > 0) {
    out.push('', 'changed without being asked')
    for (const f of d.files) out.push(`  ${pathCol(f.shown, 40)}${f.label.padEnd(9)} ${f.changes}`.trimEnd())
  }
  if (d.undone.length > 0) {
    out.push('', 'did not survive')
    for (const u of d.undone) out.push(`  ${pathCol(u.shown, 40)}${u.kind}  ${u.at} (${u.prompt}), ${u.verb} ${u.endedAt}`)
  }
  if (d.caveats.length > 0) out.push('', ...d.caveats)
  return { lines: out, dim: [d.units, ...d.caveats] }
}

/** The ledger as text, as `minos ledger` prints it. */
export function renderLedger(view: LedgerView): string {
  return ledgerLines(view).lines.join('\n')
}

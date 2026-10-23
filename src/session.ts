import { Ledger } from './ledger'
import { subagentToolUseId } from './paths'
import { PromptIndex } from './prompts'
import { findUndone } from './reverts'
import { eachRecord } from './transcript'
import type { Attestation, Operation, Prompt, ShellWrite, UnknownRecord } from './types'
import type { Undone } from './reverts'
import { inWindow } from './window'
import type { Window } from './window'

/** One file's contribution to a total. */
export interface FileTotals {
  file: string
  added: number
  removed: number
  promptIndex: number | null
}

/** What one prompt changed, and how much of it did not survive. */
export interface PromptTotals {
  prompt: Prompt
  files: number
  added: number
  removed: number
  undone: number
}

/** Everything the report renders, with no formatting decided yet. */
export interface SessionReport {
  sessionId: string
  cwd: string
  branch: string
  prompts: Prompt[]
  totals: Record<Attestation, { files: number; added: number; removed: number }>
  undone: Undone[]
  unrecognisedModes: string[]
  skippedLines: number
  /** The earliest timestamp of any record in the transcript or its subagent files, as written; null when none parses. */
  startedAt: string | null
  /** The latest such timestamp, as written. */
  endedAt: string | null
  byPrompt: PromptTotals[]
  /**
   * The files with the most change applied without asking, ranked by lines
   * touched. The name refers to the report's "applied without asking"
   * section, not to the `auto` attestation alone: it deliberately includes
   * `subagent` operations too, since a change made inside a subagent was
   * likewise never put to the user as a decision.
   */
  largestAuto: FileTotals[]
  /**
   * The count of distinct files touched by any operation, regardless of
   * label. The three per-label file counts in `totals` are not mutually
   * exclusive: a file edited once under `decided` and once under `auto`
   * appears in both counts, so their sum overcounts. This is the true count
   * for the headline.
   */
  filesTouched: number
  /**
   * Operations whose `promptId` could not be resolved to a prompt. Such a
   * change still lands in `totals` and, if undone, in the full `undone`
   * list, but it matches no row in `byPrompt` (which filters by promptId)
   * and no per-prompt count in `undone` (its introducing operation's empty
   * key matches no real prompt id). The report must say so rather than let
   * the change go quietly missing from that table.
   */
  unattributedCount: number
  /**
   * Every operation across every file in the session, in timestamp order,
   * exactly as `Ledger.operations` returns it. `minos file` filters this by
   * path to print one file's full operation history; nothing else in the
   * report needs it grouped by file, so it is kept flat here rather than as
   * a `Map`, which `JSON.stringify` would silently reduce to `{}` and so
   * would not survive `minos export`'s JSON round trip the way an array does.
   */
  operations: Operation[]
  /** Bash calls inside the window that look like file writes: a heuristic, outside `totals` and every other count. */
  shellWrites: ShellWrite[]
}

const lines = (text: string | null): number => {
  if (text === null || text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n').length
}

/** Lines an operation added and removed. A write counts its whole content as added. */
function delta(op: Operation): { added: number; removed: number } {
  if (op.kind === 'write') return { added: lines(op.content), removed: 0 }
  return { added: lines(op.newString), removed: lines(op.oldString) }
}

/**
 * Reads one session and everything derived from it. Two passes over the
 * transcript: the first builds the prompt index, the second the ledger, because
 * a change can only be attributed once every prompt above it has been seen.
 *
 * With a window, every count and list is built from the operations inside it
 * only. Undone detection still runs over every operation, since the change
 * that undid something may sit on the other side of the window's edge, and a
 * finding is kept when the change that was undone is inside the window: the
 * same rule `aggregate` applies. `startedAt`, `endedAt` and `prompts` always
 * describe the whole session.
 */
export async function analyseSession(
  paths: { transcript: string; subagents: string[] },
  options: { window?: Window } = {},
): Promise<SessionReport> {
  const window = options.window ?? { since: null, until: null }
  const inside = (op: Operation): boolean => inWindow(op.at, window)
  const prompts = new PromptIndex()
  let sessionId = ''
  let cwd = ''
  let branch = ''

  const header = (r: UnknownRecord): void => {
    if (sessionId === '' && typeof r.sessionId === 'string') sessionId = r.sessionId
    if (cwd === '' && typeof r.cwd === 'string') cwd = r.cwd
    if (branch === '' && typeof r.gitBranch === 'string') branch = r.gitBranch
  }

  let skippedLines = 0
  const bounds: { first: { at: number; iso: string } | null; last: { at: number; iso: string } | null } = { first: null, last: null }
  const span = (r: UnknownRecord): void => {
    if (typeof r.timestamp !== 'string') return
    const at = Date.parse(r.timestamp)
    if (Number.isNaN(at)) return
    if (bounds.first === null || at < bounds.first.at) bounds.first = { at, iso: r.timestamp }
    if (bounds.last === null || at > bounds.last.at) bounds.last = { at, iso: r.timestamp }
  }
  const first = await eachRecord(paths.transcript, (r) => {
    header(r)
    span(r)
    prompts.observe(r)
  })
  skippedLines += first.skipped

  const ledger = new Ledger()
  await eachRecord(paths.transcript, (r) => ledger.observe(r, prompts))
  for (const file of paths.subagents) {
    // A subagent's own parentUuid chain terminates inside its own file, so on
    // its own it resolves to no prompt at all. The sidecar names the call that
    // spawned it, and that call sits on a record of the parent session, so
    // grafting the subagent's root onto that record lets the ordinary walk
    // carry on across the file boundary and reach the prompt behind it. A
    // subagent with no recoverable link, which is what a workflow-nested one
    // records, keeps its null parent and stays unattributed.
    const toolUseId = await subagentToolUseId(file)
    const spawnedBy = toolUseId === null ? null : prompts.recordForToolUse(toolUseId)

    const stats = await eachRecord(file, (r) => {
      const graft = spawnedBy !== null && typeof r.parentUuid !== 'string'
      // isSidechain is forced regardless: the diff never reached the terminal,
      // whichever prompt turns out to have caused it.
      const record = graft ? { ...r, isSidechain: true, parentUuid: spawnedBy } : { ...r, isSidechain: true }
      span(record)
      prompts.observe(record)
      ledger.observe(record, prompts)
    })
    skippedLines += stats.skipped
  }

  const totals: Record<Attestation, { files: number; added: number; removed: number }> = {
    decided: { files: 0, added: 0, removed: 0 },
    auto: { files: 0, added: 0, removed: 0 },
    subagent: { files: 0, added: 0, removed: 0 },
  }
  const seenPerLabel: Record<Attestation, Set<string>> = { decided: new Set(), auto: new Set(), subagent: new Set() }

  const undone: Undone[] = []
  const perFile = new Map<string, Operation[]>()
  for (const [file, all] of ledger.byFile()) {
    undone.push(...findUndone(file, all, null).filter((u) => inside(u.introduced)))
    const ops = all.filter(inside)
    if (ops.length === 0) continue
    perFile.set(file, ops)
    for (const op of ops) {
      const d = delta(op)
      totals[op.attestation].added += d.added
      totals[op.attestation].removed += d.removed
      seenPerLabel[op.attestation].add(file)
    }
  }
  for (const label of ['decided', 'auto', 'subagent'] as const) {
    totals[label].files = seenPerLabel[label].size
  }

  const undoneByPrompt = new Map<string, number>()
  for (const u of undone) {
    const id = u.introduced.promptId ?? ''
    undoneByPrompt.set(id, (undoneByPrompt.get(id) ?? 0) + 1)
  }

  const operations = ledger.operations().filter(inside)
  const byPrompt: PromptTotals[] = prompts.all().map((prompt) => {
    const ops = operations.filter((o) => o.promptId === prompt.id)
    const files = new Set(ops.map((o) => o.file))
    const added = ops.reduce((sum, o) => sum + delta(o).added, 0)
    const removed = ops.reduce((sum, o) => sum + delta(o).removed, 0)
    return { prompt, files: files.size, added, removed, undone: undoneByPrompt.get(prompt.id) ?? 0 }
  })

  const largestAuto: FileTotals[] = [...perFile]
    .map(([file, ops]) => {
      const auto = ops.filter((o) => o.attestation !== 'decided')
      const added = auto.reduce((sum, o) => sum + delta(o).added, 0)
      const removed = auto.reduce((sum, o) => sum + delta(o).removed, 0)
      const promptIndex = prompts.all().find((p) => p.id === auto[0]?.promptId)?.index ?? null
      return { file, added, removed, promptIndex }
    })
    .filter((f) => f.added + f.removed > 0)
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))

  const unattributedCount = operations.filter((o) => o.promptId === null).length

  return {
    sessionId,
    cwd,
    branch,
    prompts: prompts.all(),
    totals,
    undone,
    unrecognisedModes: ledger.unrecognisedModes(),
    skippedLines,
    startedAt: bounds.first?.iso ?? null,
    endedAt: bounds.last?.iso ?? null,
    byPrompt,
    largestAuto,
    filesTouched: perFile.size,
    unattributedCount,
    operations,
    shellWrites: ledger.shellWrites().filter((w) => inWindow(w.at, window)),
  }
}

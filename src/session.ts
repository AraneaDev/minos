import { Ledger } from './ledger'
import { subagentToolUseId } from './paths'
import { PromptIndex } from './prompts'
import { findUndone } from './reverts'
import { eachRecord } from './transcript'
import type { Attestation, Operation, Prompt, UnknownRecord } from './types'
import type { Undone } from './reverts'

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
 */
export async function analyseSession(paths: { transcript: string; subagents: string[] }): Promise<SessionReport> {
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
  const first = await eachRecord(paths.transcript, (r) => {
    header(r)
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
  const perFile = ledger.byFile()
  for (const [file, ops] of perFile) {
    undone.push(...findUndone(file, ops, null))
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

  const byPrompt: PromptTotals[] = prompts.all().map((prompt) => {
    const ops = ledger.operations().filter((o) => o.promptId === prompt.id)
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

  const operations = ledger.operations()
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
    byPrompt,
    largestAuto,
    filesTouched: perFile.size,
    unattributedCount,
    operations,
  }
}

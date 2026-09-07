import { Ledger } from './ledger'
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
    const stats = await eachRecord(file, (r) => {
      prompts.observe(r)
      ledger.observe({ ...r, isSidechain: true }, prompts)
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
  }
}

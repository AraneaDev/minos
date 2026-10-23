import { clock } from '../clock'
import { VERB, shown } from '../ledger-view'
import { promptRef, sanitise, sessionOrigin } from '../report'
import { findUndone } from '../reverts'
import type { UndoneKind } from '../reverts'
import { analyseSession } from '../session'
import type { SessionReport } from '../session'
import type { Operation } from '../types'
import type { SessionPaths } from './report'

/** One Edit or Write as Claude Code is about to run it, or has just run it. */
export interface ProposedChange {
  kind: 'edit' | 'write'
  file: string
  old_string?: string
  new_string?: string
  content?: string
  replace_all?: boolean
  /** The call's own id, when the caller has it: how a call the transcript already holds is recognised. */
  tool_use_id?: string
}

/** An earlier change the proposed one ends, with the sentence to show for it. */
export interface EndedChange {
  file: string
  kind: UndoneKind
  introducedAt: string
  introducedPrompt: number | null
  line: number | null
  /** How many earlier changes this entry stands for: identical ones are merged into one note. */
  count: number
  note: string
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** The change on stdin, or null when it is not JSON or lacks a `kind` of edit/write and a `file`. */
export function parseProposed(stdin: string): ProposedChange | null {
  let data: unknown
  try {
    data = JSON.parse(stdin)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if ((d.kind !== 'edit' && d.kind !== 'write') || typeof d.file !== 'string' || d.file === '') return null
  return {
    kind: d.kind,
    file: d.file,
    old_string: asString(d.old_string),
    new_string: asString(d.new_string),
    content: asString(d.content),
    replace_all: d.replace_all === true,
    tool_use_id: asString(d.tool_use_id),
  }
}

/**
 * The session's earlier changes this one would end. The proposed change joins
 * the file's operations as the last one and `findUndone` does the judging; only
 * findings it ends are kept. A call the transcript already holds, recognised by
 * its tool_use id, is judged where it stands rather than added a second time.
 * Findings that would read as the same sentence are merged into one, with how
 * many changes it covers, so the agent is not told the same thing four times.
 * Times count from the session's first prompt and the prompt is named as the
 * report names it, through the report's own helpers.
 */
export function endedBy(report: SessionReport, proposed: ProposedChange): EndedChange[] {
  const ops = report.operations.filter((o) => o.file === proposed.file)
  const recorded = proposed.tool_use_id === undefined ? undefined : ops.find((o) => o.toolUseId === proposed.tool_use_id)
  let ender: Operation
  if (recorded !== undefined) {
    ender = recorded
  } else {
    const latest = ops.reduce((m, o) => Math.max(m, Date.parse(o.at) || 0), 0)
    ender = {
      file: proposed.file,
      kind: proposed.kind,
      at: new Date(latest + 1).toISOString(),
      uuid: 'proposed',
      toolUseId: proposed.tool_use_id ?? 'proposed',
      permissionMode: null,
      promptId: null,
      attestation: 'auto',
      oldString: proposed.old_string ?? null,
      newString: proposed.new_string ?? null,
      replaceAll: proposed.replace_all === true,
      content: proposed.content ?? null,
    }
    ops.push(ender)
  }
  const origin = sessionOrigin(report)
  const merged = new Map<string, EndedChange>()
  for (const u of findUndone(proposed.file, ops, null).filter((f) => f.undoneBy === ender)) {
    const prompt = u.introduced.promptId === null ? null : (report.prompts.find((p) => p.id === u.introduced.promptId)?.index ?? null)
    const where = sanitise(shown(u.file, report.cwd))
    const tail = `${where} made at ${clock(u.introduced.at, origin)} for ${promptRef(report.prompts, u.introduced.promptId)}`
    const key = `${u.kind}\u0000${tail}`
    const seen = merged.get(key)
    if (seen !== undefined) {
      seen.count += 1
      seen.note = `Minos: this ${VERB[u.kind]} ${seen.count} changes to ${tail}`
      continue
    }
    merged.set(key, {
      file: u.file,
      kind: u.kind,
      introducedAt: u.introduced.at,
      introducedPrompt: prompt,
      line: u.line,
      count: 1,
      note: `Minos: this ${VERB[u.kind]} the change to ${tail}`,
    })
  }
  return [...merged.values()]
}

/** Runs `endedBy` on the session at `paths` for the change given as JSON. */
export async function runUndoes(paths: SessionPaths, stdin: string): Promise<{ code: number; out: string }> {
  const proposed = parseProposed(stdin)
  if (proposed === null) return { code: 2, out: 'minos: undoes reads one change as JSON on stdin' }
  return { code: 0, out: JSON.stringify(endedBy(await analyseSession(paths), proposed)) }
}

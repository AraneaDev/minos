import { clock } from '../clock'
import { shown } from '../ledger-view'
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
}

/** An earlier change the proposed one ends, with the sentence to show for it. */
export interface EndedChange {
  file: string
  kind: UndoneKind
  introducedAt: string
  introducedPrompt: number | null
  line: number | null
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
  }
}

/** Whether a transcript operation is this very call, already recorded. */
function sameCall(o: Operation, p: ProposedChange): boolean {
  return (
    o.kind === p.kind &&
    o.oldString === (p.old_string ?? null) &&
    o.newString === (p.new_string ?? null) &&
    o.content === (p.content ?? null)
  )
}

/**
 * The session's earlier changes this one would end. The proposed change joins
 * the file's operations as the last one and `findUndone` does the judging; only
 * findings it ends are kept. A call the transcript already holds as the file's
 * last operation is not added a second time.
 */
export function endedBy(report: SessionReport, proposed: ProposedChange): EndedChange[] {
  const ops = report.operations.filter((o) => o.file === proposed.file)
  const last = ops.at(-1)
  let ender: Operation
  if (last !== undefined && sameCall(last, proposed)) {
    ender = last
  } else {
    const latest = ops.reduce((m, o) => Math.max(m, Date.parse(o.at) || 0), 0)
    ender = {
      file: proposed.file,
      kind: proposed.kind,
      at: new Date(latest + 1).toISOString(),
      uuid: 'proposed',
      toolUseId: 'proposed',
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
  const origin = report.startedAt ?? ''
  return findUndone(proposed.file, ops, null)
    .filter((u) => u.undoneBy === ender)
    .map((u) => {
      const prompt = u.introduced.promptId === null ? null : (report.prompts.find((p) => p.id === u.introduced.promptId)?.index ?? null)
      const verb = u.kind === 'overwritten' ? 'replaced' : u.kind
      const ref = prompt === null ? '(unattributed)' : `prompt ${prompt}`
      return {
        file: u.file,
        kind: u.kind,
        introducedAt: u.introduced.at,
        introducedPrompt: prompt,
        line: u.line,
        note: `Minos: this ${verb} the change to ${shown(u.file, report.cwd)} made at ${clock(u.introduced.at, origin)} for ${ref}`,
      }
    })
}

/** Runs `endedBy` on the session at `paths` for the change given as JSON. */
export async function runUndoes(paths: SessionPaths, stdin: string): Promise<{ code: number; out: string }> {
  const proposed = parseProposed(stdin)
  if (proposed === null) return { code: 2, out: 'minos: undoes reads one change as JSON on stdin' }
  return { code: 0, out: JSON.stringify(endedBy(await analyseSession(paths), proposed)) }
}

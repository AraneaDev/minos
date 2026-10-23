import type { EngineInterface, On } from 'claude-code'

import { forSession } from './minos'
import { addNotes } from './state'

/** The undo check may add at most this much to an Edit or Write; past it the result goes through as it was. */
const UNDO_BUDGET_MS = 1500

/** What `minos undoes` prints per earlier change the call ended; only `note` is shown. */
interface Ended {
  note: string
}

/**
 * The earlier changes this Edit or Write ended, as the CLI words them, or none
 * when the check fails, times out or finds nothing. Never throws.
 */
async function endedBy($: EngineInterface, change: Record<string, unknown>): Promise<string[]> {
  const run = await forSession($, ['undoes'], { stdin: JSON.stringify(change), timeoutMs: UNDO_BUDGET_MS })
  if (!run.ok) return []
  try {
    const parsed = JSON.parse(run.stdout) as Ended[]
    return Array.isArray(parsed) ? parsed.map((e) => e.note).filter((n) => typeof n === 'string' && n !== '') : []
  } catch {
    return []
  }
}

/**
 * Tells the agent, in the result it is about to read, when an Edit or Write
 * just undid a change this session made earlier, and raises the same line as
 * a toast. It runs only after the call succeeded, never refuses or rewrites
 * the call, and on any failure hands the result back as it came.
 */
export function watchForUndo(on: On): void {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write') return ran
    if (ran.deny !== undefined || ran.isError === true) return ran
    const change =
      e.tool === 'Edit'
        ? { kind: 'edit', file: e.file_path, old_string: e.old_string, new_string: e.new_string, replace_all: e.replace_all === true }
        : { kind: 'write', file: e.file_path, content: e.content }
    const notes = await endedBy($, change)
    if (notes.length === 0) return ran
    const [first] = notes as [string, ...string[]]
    await $.ui.toast(notes.length === 1 ? first : `${first} (+${notes.length - 1} more)`)
    await addNotes($, notes)
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}

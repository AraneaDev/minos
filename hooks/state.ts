import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LiveView } from '../types'

// Change a tag when that value's fields change: it declines what an earlier
// version kept in the session, which outlives a reload.
/** The last ledger the CLI printed for this session, or null before the first refresh. */
export const view = atom({ plugin: 'minos', key: 'view' } as const, null as LiveView | null, { shape: 'view-1' })
/** Why the last refresh failed, or null when it did not. */
export const error = atom({ plugin: 'minos', key: 'error' } as const, null as string | null, { shape: 'error-1' })
/** Every undo note raised this session, oldest first. */
export const notes = atom({ plugin: 'minos', key: 'notes' } as const, [] as string[], { shape: 'notes-1' })

/** Appends undo notes for the pane, keeping the last 50. */
export async function addNotes($: EngineInterface, added: string[]): Promise<void> {
  await update($, notes, (list) => [...list, ...added].slice(-50))
}

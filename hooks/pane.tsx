import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { forSession } from './minos'

/** The pane's id. */
export const PANE = 'minos-ledger'
/** The slash command that opens the pane. */
export const COMMAND = 'minos'

// Change a tag when that value's type changes: it declines what an earlier
// version kept in the session, which outlives a reload.

/** The last `minos ledger` text for this session, or null before the first refresh. */
const view = atom({ plugin: 'minos', key: 'view' } as const, null as string | null, { shape: 'view-text-1' })
/** Why the last refresh failed, or null when it did not. */
const error = atom({ plugin: 'minos', key: 'error' } as const, null as string | null, { shape: 'error-1' })
/** Every undo note raised this session, oldest first. */
const notes = atom({ plugin: 'minos', key: 'notes' } as const, [] as string[], { shape: 'notes-1' })

/** Appends undo notes for the pane, keeping the last 50. */
export async function addNotes($: EngineInterface, added: string[]): Promise<void> {
  await update($, notes, (list) => [...list, ...added].slice(-50))
}

/** How long a burst of changes waits before the ledger is read again. */
const DEBOUNCE_MS = 1000

// One refresh at a time: a request while one runs asks for exactly one more
// after it, and a burst of requests within the debounce becomes one run.
let pending: { cancel: () => void } | null = null
let running = false
let again = false

/** Reads the ledger now and keeps its text for the pane, or why it could not be read. */
async function refresh($: EngineInterface): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    const run = await forSession($, ['ledger'])
    if (run.ok) {
      await update($, view, () => run.stdout.trimEnd())
      await update($, error, () => null)
    } else {
      await update($, error, () => run.error)
    }
  } finally {
    running = false
  }
  if (again) {
    again = false
    await refresh($)
  }
}

/** Asks for a refresh once the session has been quiet for the debounce. */
export function schedule($: EngineInterface): void {
  pending?.cancel()
  pending = $.clock.after(DEBOUNCE_MS, () => {
    pending = null
    void refresh($)
  })
}

/** Lines the pane draws dim: the units line and the caveats under the counts. */
const quiet = (line: string): boolean =>
  line.startsWith('(') || line.startsWith('decided is inferred') || line.startsWith('Left out')

/**
 * The pane beside the chat: `/minos` opens it, and it shows the same
 * `minos ledger` text the agent's tool returns, refreshed after every change
 * and at the end of each turn, never on a tool call's own path. The tool
 * calls that schedule a refresh are hooked in register.tsx, beside the undo note.
 */
export function livePane(on: On): void {
  on('command.run', { command: COMMAND }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Minos' })
    void refresh($)
    return { text: 'Minos pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    schedule($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [text, failed, raised] = await Promise.all([read($, view), read($, error), read($, notes)])
    const lines = text === null ? [] : text.split('\n')
    return (
      <Box flexDirection="column">
        {failed !== null && <Text dimColor>Minos could not run: {failed}</Text>}
        {text === null && failed === null && <Text dimColor>Reading this session's ledger.</Text>}
        {lines.map((line) => (quiet(line) ? <Text dimColor>{line}</Text> : <Text>{line}</Text>))}
        {raised.length > 0 && <Text> </Text>}
        {raised.length > 0 && <Text>noted this session</Text>}
        {raised.map((note) => (
          <Text>  {note}</Text>
        ))}
      </Box>
    )
  })
}

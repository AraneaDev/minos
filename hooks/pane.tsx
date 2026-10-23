import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { MinosHistory, MinosLedger } from '../types'
import { forSession } from './minos'

/** The pane's id. */
export const PANE = 'minos-ledger'
/** The slash command that opens the pane. */
export const COMMAND = 'minos'

// Change a tag when that value's type changes: it declines what an earlier
// version kept in the session, which outlives a reload.

/** The last ledger the CLI printed for this session, or null before the first refresh. */
const view = atom({ plugin: 'minos', key: 'view' } as const, null as MinosLedger | null, { shape: 'view-json-1' })
/** Why the last refresh failed, or null when it did not. */
const error = atom({ plugin: 'minos', key: 'error' } as const, null as string | null, { shape: 'error-1' })
/** Every undo note raised this session, oldest first. */
const notes = atom({ plugin: 'minos', key: 'notes' } as const, [] as string[], { shape: 'notes-1' })
/** Whether the pane is open: nothing is refreshed for a pane nobody opened. */
const isOpen = atom({ plugin: 'minos', key: 'isOpen' } as const, false, { shape: 'open-1' })
/** The file whose history the person opened in the pane, and what `minos file` said about it. */
const history = atom({ plugin: 'minos', key: 'history' } as const, null as MinosHistory | null, { shape: 'history-1' })

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

/** The ledger JSON reduced to what the pane draws, or null when it does not read as one. */
function parseLedger(stdout: string): MinosLedger | null {
  try {
    const j = JSON.parse(stdout) as { text?: unknown; dim?: unknown; cwd?: unknown; unaskedFiles?: { file?: unknown }[] }
    if (typeof j.text !== 'string') return null
    return {
      text: j.text,
      dim: Array.isArray(j.dim) ? j.dim.filter((d): d is string => typeof d === 'string') : [],
      cwd: typeof j.cwd === 'string' ? j.cwd : '',
      files: (j.unaskedFiles ?? []).map((f) => f.file).filter((f): f is string => typeof f === 'string'),
    }
  } catch {
    return null
  }
}

/** Reads the ledger now and keeps it for the pane, or why it could not be read. Never throws. */
async function refresh($: EngineInterface): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    const run = await forSession($, ['ledger', '--json'])
    const ledger = run.ok ? parseLedger(run.stdout) : null
    if (ledger !== null) {
      await update($, view, () => ledger)
      await update($, error, () => null)
    } else {
      await update($, error, () => (run.ok ? 'the ledger did not read as JSON' : run.error))
    }
  } catch (thrown) {
    await update($, error, () => (thrown instanceof Error ? thrown.message : String(thrown))).catch(() => {})
  } finally {
    running = false
  }
  if (again) {
    again = false
    await refresh($)
  }
}

/** Asks for a refresh once the session has been quiet for the debounce, but only while the pane is open. */
export async function schedule($: EngineInterface): Promise<void> {
  try {
    if (!(await read($, isOpen))) return
    pending?.cancel()
    pending = $.clock.after(DEBOUNCE_MS, () => {
      pending = null
      void refresh($)
    })
  } catch {
    // A refresh is a convenience: failing to schedule one must never reach the tool call.
  }
}

/** Shows one file's history in the pane, as `minos file` prints it. */
async function openHistory($: EngineInterface, file: string): Promise<void> {
  const run = await forSession($, ['file', file])
  await update($, history, () => ({ file, text: run.ok ? run.stdout.trimEnd() : `Minos could not read this file's history: ${run.error}` }))
}

/** A path as the ledger shows it: relative to the session's directory when it is inside it. */
const shown = (file: string, cwd: string): string => (cwd !== '' && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file)

/**
 * The pane beside the chat: `/minos` opens it, and it shows the same
 * `minos ledger` text the agent's tool returns, refreshed after every change
 * and at the end of each turn while it is open, never on a tool call's own
 * path. Pressing a file shows that file's history below the ledger. The tool
 * calls that schedule a refresh are hooked in register.tsx, beside the undo note.
 */
export function livePane(on: On): void {
  on('command.run', { command: COMMAND }, async ($) => {
    await update($, isOpen, () => true)
    await $.ui.open({ id: PANE, title: 'Minos' })
    void refresh($)
    return { text: 'Minos pane opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isOpen, () => false)
    pending?.cancel()
    pending = null
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await schedule($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [ledger, failed, raised, opened] = await Promise.all([read($, view), read($, error), read($, notes), read($, history)])
    const dim = new Set(ledger?.dim ?? [])
    const lines = ledger === null ? [] : ledger.text.split('\n')
    const files = ledger?.files ?? []
    return (
      <Box flexDirection="column">
        {failed !== null && <Text dimColor>Minos could not run: {failed}</Text>}
        {ledger === null && failed === null && <Text dimColor>Reading this session's ledger.</Text>}
        {lines.map((line) => (dim.has(line) ? <Text dimColor>{line}</Text> : <Text>{line}</Text>))}
        {files.length > 0 && <Text> </Text>}
        {files.length > 0 && <Text dimColor>history of a file:</Text>}
        {files.map((file) => (
          <Button key={`file:${file}`} label={shown(file, ledger?.cwd ?? '')} onPress={() => openHistory($, file)} />
        ))}
        {opened !== null && <Text> </Text>}
        {opened !== null && opened.text.split('\n').map((line) => <Text>{line}</Text>)}
        {raised.length > 0 && <Text> </Text>}
        {raised.length > 0 && <Text>noted this session</Text>}
        {raised.map((note) => (
          <Text>  {note}</Text>
        ))}
      </Box>
    )
  })
}

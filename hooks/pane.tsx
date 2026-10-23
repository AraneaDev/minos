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
const view = atom({ plugin: 'minos', key: 'view' } as const, null as MinosLedger | null, { shape: 'view-display-1' })
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

/** What the pane shows for a session that has no transcript yet. */
const EMPTY: MinosLedger = {
  session: '',
  since: null,
  counts: { decided: 0, auto: 0, subagent: 0, undone: 0 },
  units: '',
  files: [],
  undone: [],
  caveats: [],
  empty: 'No changes yet.',
}

/** The `display` part of the ledger JSON, or null when the output does not read as one. */
function parseLedger(stdout: string): MinosLedger | null {
  try {
    const d = (JSON.parse(stdout) as { display?: MinosLedger }).display
    if (d === undefined || typeof d.counts !== 'object' || !Array.isArray(d.files) || !Array.isArray(d.undone)) return null
    return d
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
    // Claude Code writes a session's transcript with its first prompt, so a
    // pane opened before then finds none: that is an empty session, not a fault.
    const ledger = run.ok ? parseLedger(run.stdout) : run.error.includes('no transcript found') ? EMPTY : null
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
    if (failed !== null) return <Text color="error">Minos could not run: {failed}</Text>
    if (ledger === null) return <Text dimColor>Reading this session's ledger…</Text>
    const c = ledger.counts
    const tiles = [
      { label: 'decided', value: c.decided, unit: 'files', color: 'success' },
      { label: 'auto', value: c.auto, unit: 'files', color: 'warning' },
      { label: 'subagent', value: c.subagent, unit: 'files', color: 'claude' },
      { label: 'undone', value: c.undone, unit: 'changes', color: 'error' },
    ] as const
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Text bold>Minos</Text>
          {ledger.session !== '' && (
            <Text dimColor>
              session {ledger.session}
              {ledger.since === null ? '' : ` · since ${ledger.since}`}
            </Text>
          )}
        </Box>

        <Box flexWrap="wrap" columnGap={1}>
          {tiles.map((t) => (
            <Box key={`tile:${t.label}`} flexDirection="column" borderStyle="round" borderColor={t.value > 0 ? t.color : 'inactive'} paddingX={1} minWidth={12}>
              <Text bold color={t.value > 0 ? t.color : 'inactive'}>
                {t.value}
              </Text>
              <Text>{t.label}</Text>
              <Text dimColor>{t.unit}</Text>
            </Box>
          ))}
        </Box>

        {ledger.empty !== null && <Text dimColor>{ledger.empty}</Text>}

        {ledger.files.length > 0 && (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text bold>CHANGED WITHOUT ASKING</Text>
              <Text dimColor>press a file for its history</Text>
            </Box>
            {ledger.files.map((f) => (
              <Box key={`row:${f.file}`} gap={1}>
                <Text color={f.label === 'auto' ? 'warning' : 'claude'}>●</Text>
                <Button key={`file:${f.file}`} label={f.shown} onPress={() => openHistory($, f.file)} />
                <Text dimColor>
                  {f.label} · {f.changes}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {opened !== null && (
          <Box flexDirection="column" borderStyle="single" borderColor="subtle" paddingX={1}>
            {opened.text.split('\n').map((line) => (
              <Text>{line}</Text>
            ))}
          </Box>
        )}

        {ledger.undone.length > 0 && (
          <Box flexDirection="column">
            <Text bold>DID NOT SURVIVE</Text>
            {ledger.undone.map((u) => (
              <Text>
                <Text color="error">↺ </Text>
                {u.shown} <Text dimColor>{u.verb} at {u.endedAt}, made at {u.at} ({u.prompt})</Text>
              </Text>
            ))}
          </Box>
        )}

        {raised.length > 0 && (
          <Box flexDirection="column">
            <Text bold>NOTED THIS SESSION</Text>
            {raised.map((note) => (
              <Text>
                <Text color="error">↺ </Text>
                {note.replace(/^Minos: this /, '')}
              </Text>
            ))}
          </Box>
        )}

        {ledger.caveats.length > 0 && (
          <Box flexDirection="column">
            {ledger.caveats.map((line) => (
              <Text dimColor italic>
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

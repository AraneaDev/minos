import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { MinosHistory, MinosLedger, MinosSession } from '../types'
import { CLOSE_PRESS, FILE_PRESS, FILES_PRESS, SESSION_PRESS, paneRows } from './layout'
import type { Segment } from './layout'
import { forSession, minos } from './minos'

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

/** Whether the changed-files card lists every file, or folds them after the first ten. */
const allFiles = atom({ plugin: 'minos', key: 'allFiles' } as const, false, { shape: 'all-files-1' })

/** The project's latest sessions, read when the pane opens and at each turn's end. */
const project = atom({ plugin: 'minos', key: 'project' } as const, [] as MinosSession[], { shape: 'project-1' })

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
  legend: [],
}

/** The `display` part of the ledger JSON, or null when the output does not read as one. */
function parseLedger(stdout: string): MinosLedger | null {
  try {
    const d = (JSON.parse(stdout) as { display?: Partial<MinosLedger> | null }).display
    if (d === undefined || d === null || typeof d !== 'object') return null
    const counts = d.counts
    const isCounts = counts !== null && typeof counts === 'object' && (['decided', 'auto', 'subagent', 'undone'] as const).every((k) => typeof counts[k] === 'number')
    const isLists = [d.files, d.undone, d.caveats, d.legend].every(Array.isArray)
    const isText = typeof d.session === 'string' && (d.since === null || typeof d.since === 'string') && (d.empty === null || typeof d.empty === 'string')
    return isCounts && isLists && isText ? (d as MinosLedger) : null
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

/** How many of the project's sessions the pane lists. */
const PROJECT_SESSIONS = 6

/**
 * Reads the project's latest sessions for the pane. Each one is a whole
 * transcript to read, so this runs when the pane opens and at a turn's end,
 * never after each change. Never throws; on any failure the list stays as it was.
 */
async function readProject($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const run = await minos($, ['sessions', '--json', '--limit', String(PROJECT_SESSIONS), '--project', cwd])
    if (!run.ok) return
    const parsed = JSON.parse(run.stdout) as { sessions?: MinosSession[] }
    if (Array.isArray(parsed.sessions)) await update($, project, () => parsed.sessions as MinosSession[])
  } catch {
    // The project list is context, not the ledger: missing it must never disturb the pane.
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

/** Shows another session's ledger in the pane, as `minos ledger` prints it. */
async function openSession($: EngineInterface, id: string): Promise<void> {
  const cwd = await $.session.cwd().catch(() => '')
  const run = await minos($, ['ledger', '--session', id, '--project', cwd])
  await update($, history, () => ({ file: `session ${id.slice(0, 8)}`, text: run.ok ? run.stdout.trimEnd() : `Minos could not read that session: ${run.error}` }))
}

/** Shows one file's history in the pane, as `minos file` prints it. */
async function openHistory($: EngineInterface, file: string): Promise<void> {
  const run = await forSession($, ['file', file])
  await update($, history, () => ({ file, text: run.ok ? run.stdout.trimEnd() : `Minos could not read this file's history: ${run.error}` }))
}

/** A plain segment's text style. */
const style = (s: Segment) => ({
  ...(s.color === undefined ? {} : { color: s.color }),
  ...(s.bold === true ? { bold: true } : {}),
  ...(s.dim === true ? { dimColor: true } : {}),
  ...(s.italic === true ? { italic: true } : {}),
})

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
    void readProject($)
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
    if (await read($, isOpen).catch(() => false)) void readProject($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [ledger, failed, raised, opened, earlier, everyFile] = await Promise.all([read($, view), read($, error), read($, notes), read($, history), read($, project), read($, allFiles)])
    const room = Math.max(20, e.props.bodyColumns)
    if (failed !== null) return <Text wrap="truncate-end" color="error">Minos could not run: {failed}</Text>
    if (ledger === null) return <Text dimColor>Reading this session's ledger…</Text>
    const press = (id: string) =>
      id === FILES_PRESS
        ? update($, allFiles, (all) => !all)
        : id === CLOSE_PRESS ? update($, history, () => null) : id.startsWith(SESSION_PRESS) ? openSession($, id.slice(SESSION_PRESS.length)) : openHistory($, id.slice(FILE_PRESS.length))
    return (
      <Box flexDirection="column">
        {paneRows(ledger, raised, opened, room, earlier, everyFile).map((line) => (
          <Box key={line.key} width={room} overflow="hidden">
            {line.segments.map((s) =>
              s.press === undefined ? (
                <Text wrap="truncate-end" {...style(s)}>
                  {s.text}
                </Text>
              ) : (
                <Button key={s.press} plain label={s.text} {...(s.dim === true ? { dimColor: true } : {})} onPress={() => press(s.press!)} />
              ),
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

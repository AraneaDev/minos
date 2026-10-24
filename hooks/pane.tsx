import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { MinosEdit, MinosHead, MinosHistory, MinosLedger, MinosSession } from '../types'
import { CLOSE_PRESS, FILE_PRESS, FILES_PRESS, PROMPT_PRESS, PROMPTS_PRESS, SESSION_PRESS, FOLDED, fitWindows, paneRows, wheel } from './layout'
import type { Segment, Windows } from './layout'
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

/** Whether the prompts card lists every prompt, or a window of them as tall as the pane allows. */
const allPrompts = atom({ plugin: 'minos', key: 'allPrompts' } as const, false, { shape: 'all-prompts-1' })

/** Whether the changed-files card lists every file, or a window of them as tall as the pane allows. */
const allFiles = atom({ plugin: 'minos', key: 'allFiles' } as const, false, { shape: 'all-files-1' })

/** The first changed file and the first prompt each card's window shows, moved by the wheel over that list. */
const listFrom = atom({ plugin: 'minos', key: 'listFrom' } as const, { files: 0, prompts: 0 }, { shape: 'list-from-1' })

/**
 * What the pane drew last, for the wheel to find the row under the pointer:
 * the window's offset, each row's key, and the lists' windows. The module's
 * own, so a reload forgets it until the next draw.
 */
let drawn: { offset: number; keys: string[]; windows: Windows; files: number; prompts: number } | null = null

/** The project's latest sessions, read when the pane opens and at each turn's end. */
const project = atom({ plugin: 'minos', key: 'project' } as const, [] as MinosSession[], { shape: 'project-1' })

/** The project's name, branch and commit the header shows, or null before the first read. */
const head = atom({ plugin: 'minos', key: 'head' } as const, null as MinosHead | null, { shape: 'head-1' })

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
  prompts: [],
}

/** The `display` part of the ledger JSON, or null when the output does not read as one. */
function parseLedger(stdout: string): MinosLedger | null {
  try {
    const d = (JSON.parse(stdout) as { display?: Partial<MinosLedger> | null }).display
    if (d === undefined || d === null || typeof d !== 'object') return null
    const counts = d.counts
    const isCounts = counts !== null && typeof counts === 'object' && (['decided', 'auto', 'subagent', 'undone'] as const).every((k) => typeof counts[k] === 'number')
    const isLists = [d.files, d.undone, d.caveats, d.legend, d.prompts].every(Array.isArray)
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

/**
 * Reads the project's name and where its checkout stands for the header:
 * when the pane opens and at a turn's end (one may commit or switch
 * branches), never in a render. A project git does not hold, or a git that
 * fails, shows the name alone. Never throws.
 */
async function readHead($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const project = cwd.split('/').filter((part) => part !== '').pop() ?? cwd
    const run = await $.process.run(['git', '-C', cwd, 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { timeoutMs: 5_000 }).catch(() => null)
    const [rev = '', branch = ''] = run?.exitCode === 0 ? run.stdout.trim().split('\n') : []
    const git = /^[0-9a-f]{7,}$/.test(rev) && branch !== '' ? { rev, branch: branch === 'HEAD' ? null : branch } : null
    await update($, head, () => ({ project, git }))
  } catch {
    // The header is context: missing it must never disturb the pane.
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

/** Shows one file's changes in the pane, each with its diff, as `minos file --json` gives them. */
async function openHistory($: EngineInterface, file: string): Promise<void> {
  const run = await forSession($, ['file', file, '--json'])
  let edits: MinosEdit[] | null = null
  if (run.ok) {
    try {
      const parsed = (JSON.parse(run.stdout) as { edits?: unknown }).edits
      if (Array.isArray(parsed)) edits = parsed as MinosEdit[]
    } catch {
      edits = null
    }
  }
  await update($, history, () =>
    edits !== null ? { file, text: '', edits } : { file, text: `Minos could not read this file's changes: ${run.ok ? 'the answer did not read as JSON' : run.error}` },
  )
}

/** Shows the files one prompt changed, from the ledger the pane already holds. */
async function openPrompt($: EngineInterface, ref: string): Promise<void> {
  const ledger = await read($, view)
  const prompt = ledger?.prompts.find((p) => p.ref === ref)
  if (prompt === undefined) return
  await update($, history, () => ({ file: ref, text: [prompt.text, prompt.summary, '', ...prompt.files].join('\n') }))
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
    void readHead($)
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
    if (await read($, isOpen).catch(() => false)) {
      void readProject($)
      void readHead($)
    }
    return done
  })

  // The wheel over a folded list moves that list's window; anywhere else, or
  // at the list's top or end, the engine scrolls the pane's body as usual.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const at = drawn
    if (e.origin.kind !== 'person' || e.pointer === undefined || at === null) return next(e)
    const moved = wheel(at.keys, at.offset + e.pointer.row, e.by, at.windows, at)
    if (moved === null) return next(e)
    await update($, listFrom, (from) => ({ ...from, [moved.list]: moved.from }))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const [ledger, failed, raised, opened, earlier, everyFile, everyPrompt, from, where] = await Promise.all([
      read($, view),
      read($, error),
      read($, notes),
      read($, history),
      read($, project),
      read($, allFiles),
      read($, allPrompts),
      read($, listFrom),
      read($, head),
    ])
    const room = Math.max(20, e.props.bodyColumns)
    if (failed !== null) return <Text wrap="truncate-end" color="error">Minos could not run: {failed}</Text>
    if (ledger === null) return <Text dimColor>Reading this session's ledger…</Text>
    const press = async (id: string): Promise<unknown> => {
      if (id === FILES_PRESS) return update($, allFiles, (all) => !all)
      if (id === PROMPTS_PRESS) return update($, allPrompts, (all) => !all)
      if (id === CLOSE_PRESS) return update($, history, () => null)
      if (id.startsWith(PROMPT_PRESS)) return openPrompt($, id.slice(PROMPT_PRESS.length))
      if (id.startsWith(SESSION_PRESS)) return openSession($, id.slice(SESSION_PRESS.length))
      return openHistory($, id.slice(FILE_PRESS.length))
    }
    const windows = fitWindows(e.props.scroll.bodyRows, from, ledger, raised, opened, room, earlier, everyFile, everyPrompt, FOLDED, where)
    const rows = paneRows(ledger, raised, opened, room, earlier, everyFile, everyPrompt, windows, where)
    drawn = { offset: e.props.scroll.offset, keys: rows.map((r) => r.key), windows, files: everyFile ? 0 : ledger.files.length, prompts: everyPrompt ? 0 : ledger.prompts.length }
    return (
      <Box flexDirection="column">
        {rows.map((line) => (
          line.code !== undefined ? (
            <Box key={line.key} width={room} overflow="hidden" paddingLeft={2}>
              {line.code.diff ? (
                <Code source={line.code.source} format="diff" wrap="truncate-end" />
              ) : (
                <Code source={line.code.source} language="diff" wrap="truncate-end" />
              )}
            </Box>
          ) : (
          // Every plain row is one line: held to it so a blank row (a card's margin) is never drawn as none.
          <Box key={line.key} width={room} height={1} overflow="hidden">
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
          )
        ))}
      </Box>
    )
  })
}

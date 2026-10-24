/**
 * The pane laid out as rows exactly `width` cells wide, in the shape the
 * Knossos pane uses: a band of count tiles, then cards whose title is set into
 * a rule (`── ± Changed without asking ──── 3 files ──`), every row cut at the
 * pane's edge so nothing wraps or widens it. Pure: the words, numbers and
 * times all come from `minos ledger --json`; this only places them.
 */
import type { MinosEdit, MinosHistory, MinosLedger, MinosSession } from '../types'
import { cells, fit, fitPath, spaces } from './text'

/** One run of text in a row, how it is drawn, and the press it carries. */
export type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean; italic?: boolean; press?: string }
/** One line of the pane. */
/** One line of the pane, or a block of code drawn by Claude Code's own renderer (a diff), `room` wide. */
export type Row = { key: string; segments: Segment[]; code?: { source: string; diff: boolean } }
/** How much room the pane has: below 80 columns the tiles fold into one line. */
export type Tier = 'narrow' | 'medium' | 'wide'

/** Frames and rules. */
const FRAME = 'subtle'
/** A card's glyph. */
const TITLE = 'claude'
/** Each class in its own colour, as the report's cards colour them. */
const HUE = { decided: 'success', auto: 'warning', subagent: 'suggestion', undone: 'error' } as const

/** A press that opens a file's history: its id carries the absolute path. */
export const FILE_PRESS = 'file:'
/** A press that opens another session's ledger: its id carries the session id. */
export const SESSION_PRESS = 'session:'
/** A press that shows one prompt's files: its id carries the prompt's reference. */
export const PROMPT_PRESS = 'prompt:'
/** The press that shows every prompt, or folds the list back. */
export const PROMPTS_PRESS = 'prompts:toggle'
/** The fewest prompts the card lists before it folds the rest; a taller pane lists more. */
export const PROMPTS_FOLDED = 6
/** The press that shows every changed file, or folds the list back. */
export const FILES_PRESS = 'files:toggle'
/** The fewest changed files the card lists before it folds the rest behind a press; a taller pane lists more. */
export const FILES_FOLDED = 10
/** Which rows of one list a card shows: from the `from`th, `rows` of them. */
export type Window = { from: number; rows: number }
/** The windows over the changed files and the prompts, each at least its fold. */
export type Windows = { files: Window; prompts: Window }
/** The windows a pane too short to grow them shows: the first rows, up to each fold. */
export const FOLDED: Windows = { files: { from: 0, rows: FILES_FOLDED }, prompts: { from: 0, rows: PROMPTS_FOLDED } }
/** The press that closes an open file history. */
export const CLOSE_PRESS = 'history:close'

/** The pane's size class from its body width. */
export const tierOf = (columns: number): Tier => (columns < 80 ? 'narrow' : columns <= 130 ? 'medium' : 'wide')

const width = (segments: Segment[]): number => segments.reduce((n, s) => n + cells(s.text), 0)

/** `segments` cut to `room` cells: the segment that crosses the edge is cut with an ellipsis, the rest dropped. */
export function clip(segments: Segment[], room: number): Segment[] {
  const out: Segment[] = []
  let used = 0
  for (const s of segments) {
    const w = cells(s.text)
    if (used + w <= room) {
      out.push(s)
      used += w
      continue
    }
    if (room - used > 0) out.push({ ...s, text: fit(s.text, room - used) })
    break
  }
  return out
}

/** A row cut to `room` and filled to it, so every row is exactly as wide as the pane. */
const row = (key: string, segments: Segment[], room: number): Row => {
  const fitted = clip(segments, room)
  return { key, segments: [...fitted, { text: spaces(room - width(fitted)) }] }
}

/** A card's top edge: glyph and title set into a rule, the note before its end, the note dropped first when narrow. */
export function ruleRow(key: string, glyph: string, title: string, note: string, room: number): Row {
  const lead: Segment[] = [{ text: '── ', color: FRAME }, { text: `${glyph} `, color: TITLE }, { text: title, bold: true }]
  const tail: Segment[] = note === '' ? [{ text: ' ──', color: FRAME }] : [{ text: ' ' }, { text: note, dim: true }, { text: ' ──', color: FRAME }]
  const withNote = room - width(lead) - width(tail) - 1
  if (withNote >= 1) return row(key, [...lead, { text: ` ${'─'.repeat(withNote)}`, color: FRAME }, ...tail], room)
  const bare = room - width(lead) - 3
  return row(key, [...lead, ...(bare >= 1 ? [{ text: ` ${'─'.repeat(bare)}`, color: FRAME }, { text: ' ──', color: FRAME }] : [])], room)
}

/** The four counts as one framed band of tiles, or one summary line when narrow. */
export function tileRows(counts: MinosLedger['counts'], room: number, tier: Tier): Row[] {
  const tiles = [
    { key: 'decided', value: counts.decided, label: 'decided', unit: 'changes' },
    { key: 'auto', value: counts.auto, label: 'auto', unit: 'changes' },
    { key: 'subagent', value: counts.subagent, label: 'subagent', unit: 'changes' },
    { key: 'undone', value: counts.undone, label: 'undone', unit: 'changes' },
  ] as const
  const figure = (t: (typeof tiles)[number]): Segment => ({ text: String(t.value), bold: true, ...(t.value > 0 ? { color: HUE[t.key] } : { dim: true }) })
  if (tier === 'narrow') {
    const line = tiles.flatMap((t, i): Segment[] => [...(i === 0 ? [] : [{ text: '  ' }]), figure(t), { text: ` ${t.label}`, dim: true }])
    return [row('tiles-line', line, room)]
  }
  const inner = room - 4
  const slot = Math.max(1, Math.floor((inner - 3 * (tiles.length - 1)) / tiles.length))
  const join = (parts: Segment[][]): Segment[] => parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' │ ', color: FRAME }, ...p]))
  const cell = (segments: Segment[]): Segment[] => [...clip(segments, slot), { text: spaces(slot - width(clip(segments, slot))) }]
  const framed = (key: string, segments: Segment[]): Row => row(key, [{ text: '│ ', color: FRAME }, ...segments, { text: spaces(inner - width(segments)) }, { text: ' │', color: FRAME }], room)
  return [
    row('tiles-top', [{ text: `╭${'─'.repeat(Math.max(0, room - 2))}╮`, color: FRAME }], room),
    framed('tiles-value', join(tiles.map((t) => cell([figure(t)])))),
    framed('tiles-label', join(tiles.map((t) => cell([{ text: t.label }, { text: ` · ${t.unit}`, dim: true }])))),
    row('tiles-end', [{ text: `╰${'─'.repeat(Math.max(0, room - 2))}╯`, color: FRAME }], room),
  ]
}

/** Words wrapped to `room` cells, one dim italic row per line: the caveats, which are sentences. */
function wrapped(key: string, text: string, room: number): Row[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line === '') line = word
    else if (cells(line) + 1 + cells(word) <= room) line = `${line} ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines.map((l, i) => row(`${key}-${i}`, [{ text: l, dim: true, italic: true }], room))
}

/**
 * One file changed without being asked: a dot in its class's colour, its path
 * with the folder dim and the name pressable, and its class and change count
 * against the right edge.
 */
function fileRow(f: MinosLedger['files'][number], room: number): Row {
  const right: Segment[] = [{ text: f.label, color: HUE[f.label] }, { text: ` · ${f.changes}`, dim: true }]
  const pathRoom = Math.max(4, room - 4 - width(right) - 2)
  const { dir, name } = fitPath(f.shown, pathRoom)
  const left: Segment[] = [{ text: '  ' }, { text: '●', color: HUE[f.label] }, { text: ' ' }, { text: dir, dim: true }, { text: name, press: `${FILE_PRESS}${f.file}` }]
  const gap = room - width(left) - width(right)
  return row(`file:${f.file}`, gap >= 2 ? [...left, { text: spaces(gap) }, ...right] : left, room)
}

/**
 * One change as a header line (when, how, under which class and prompt) and
 * its diff, drawn by Claude Code's diff renderer when the line is known.
 */
function editRows(e: MinosEdit, i: number, room: number): Row[] {
  const hue = (HUE as Record<string, string>)[e.attestation]
  const head = row(`edit-${i}`, [
    { text: '  ' },
    { text: e.at, bold: true },
    { text: `  ${e.kind}`, dim: true },
    { text: ` · ` , dim: true },
    { text: e.attestation, ...(hue === undefined ? {} : { color: hue }) },
    { text: ` · ${e.prompt}`, dim: true },
    ...(e.cut > 0 ? [{ text: ` · ${e.cut} more lines not shown`, dim: true }] : []),
  ], room)
  return [head, { key: `edit-${i}-diff`, segments: [], code: { source: e.diff, diff: e.numbered } }]
}

/** `w` kept inside a list of `n`: never past its end, never above its top. */
export function within(w: Window, n: number): Window {
  const rows = Math.max(0, Math.min(w.rows, n))
  return { from: Math.max(0, Math.min(w.from, n - rows)), rows }
}

/** A folded list's last row: the press that shows it all or folds it back, and where the window stands. */
function toggleRow(key: string, press: string, all: boolean, n: number, at: Window, room: number): Row {
  const below = n - at.from - at.rows
  const rest = all ? '' : at.from === 0 ? ` · ${below} more` : ` · ${at.from} above · ${below} below`
  return row(key, [{ text: '  ' }, { text: all ? 'show fewer' : `show all ${n}`, dim: true, press }, { text: rest, dim: true }], room)
}

/**
 * The windows that fill a pane `bodyRows` tall: the rows the folded pane
 * leaves empty go to the changed files first, then to the prompts, so the
 * lists grow before anything has to scroll. `from` is kept as given.
 */
export function fitWindows(bodyRows: number, from: { files: number; prompts: number }, ...args: Parameters<typeof paneRows>): Windows {
  const [ledger, , , , , allFiles = false, allPrompts = false] = args
  let spare = bodyRows - paneRows(...args).length
  const grow = (n: number, fold: number, all: boolean): number => {
    const base = Math.min(n, fold)
    // A list shown whole already has its rows, and keeps its press to fold it back.
    if (all || spare <= 0 || n <= base) return base
    const rows = Math.min(n, base + spare)
    // A list shown whole drops its toggle row, which the next list may take.
    spare -= rows - base - (rows === n ? 1 : 0)
    return rows
  }
  const files = grow(ledger.files.length, FILES_FOLDED, allFiles)
  const prompts = grow(ledger.prompts.length, PROMPTS_FOLDED, allPrompts)
  return { files: { from: from.files, rows: files }, prompts: { from: from.prompts, rows: prompts } }
}

/**
 * Where a wheel tick `by` over the drawn row `at` moves a list: the list and
 * its window's new first row, or null when that row is in no list, the list
 * shows whole, or its window is already at that end, so the pane scrolls instead.
 * `counts` holds each list's length, 0 for one shown whole.
 */
export function wheel(keys: string[], at: number, by: number, windows: Windows, counts: { files: number; prompts: number }): { list: keyof Windows; from: number } | null {
  const key = keys[at] ?? ''
  const list = key.startsWith('file:') || key === 'files-toggle' ? 'files' : key.startsWith('prompt-') || key === 'prompts-toggle' ? 'prompts' : null
  if (list === null) return null
  const now = within(windows[list], counts[list])
  const from = within({ ...now, from: now.from + by }, counts[list]).from
  return from === now.from ? null : { list, from }
}

/** Everything the pane shows, as rows `room` wide. */
export function paneRows(
  ledger: MinosLedger,
  notes: string[],
  history: MinosHistory | null,
  room: number,
  earlier: MinosSession[] = [],
  allFiles = false,
  allPrompts = false,
  windows: Windows = FOLDED,
): Row[] {
  const tier = tierOf(room)
  const out: Row[] = []
  const gap = (key: string) => out.push(row(key, [], room))
  /** A card's title rule, with a blank row below it before the card's content. */
  const card = (key: string, glyph: string, name: string, note: string) => {
    out.push(ruleRow(key, glyph, name, note, room))
    gap(`space:${key}`)
  }
  const head: Segment[] = [
    { text: '± ', color: TITLE },
    { text: 'Minos', bold: true },
    ...(ledger.session === '' ? [] : [{ text: `  session ${ledger.session}`, dim: true }]),
    ...(ledger.since === null ? [] : [{ text: ` · since ${ledger.since}`, dim: true }]),
  ]
  out.push(row('head', head, room))
  gap('head-gap')
  out.push(...tileRows(ledger.counts, room, tier))

  if (ledger.empty !== null) {
    gap('empty-gap')
    out.push(row('empty', [{ text: '  ' }, { text: ledger.empty, dim: true }], room))
    if (ledger.legend.length > 0) {
      gap('legend-gap')
      card('legend-head', '◇', 'What the counts mean', '')
      ledger.legend.forEach((line, i) => {
        const [word = '', ...rest] = line.split(/(?<=^\S+)\s+/)
        const hue = (HUE as Record<string, string>)[word]
        out.push(row(`legend-${i}`, [{ text: '  ' }, { text: word.padEnd(10), ...(hue === undefined ? {} : { color: hue }) }, { text: rest.join(' '), dim: true }], room))
      })
    }
  }

  if (ledger.files.length > 0) {
    gap('files-gap')
    const n = ledger.files.length
    card('files-head', '≡', 'Changed without asking', `${n} ${n === 1 ? 'file' : 'files'} · press one for its history`)
    // The most recent first; past the window the rest wait behind a press or the wheel, so a busy session cannot push every other card off the pane.
    const at = within(windows.files, n)
    const shown = allFiles ? ledger.files : ledger.files.slice(at.from, at.from + at.rows)
    for (const f of shown) out.push(fileRow(f, room))
    if (n > at.rows) out.push(toggleRow('files-toggle', FILES_PRESS, allFiles, n, at, room))
  }

  if (ledger.prompts.length > 0) {
    gap('prompts-gap')
    const n = ledger.prompts.length
    card('prompts-head', '›', 'By prompt', `${n} ${n === 1 ? 'prompt' : 'prompts'} changed something · press one for its files`)
    const at = within(windows.prompts, n)
    const shown = allPrompts ? ledger.prompts : ledger.prompts.slice(at.from, at.from + at.rows)
    for (const p of shown) {
      const right: Segment[] = [{ text: p.summary, dim: true }]
      const lead: Segment[] = [{ text: '  ' }, { text: p.ref, press: `${PROMPT_PRESS}${p.ref}` }, { text: '  ' }]
      const room2 = room - width(lead) - width(right) - 2
      const said: Segment[] = room2 >= 8 ? [{ text: fit(p.text, room2) }, { text: spaces(room2 - cells(fit(p.text, room2)) + 2) }] : [{ text: '  ' }]
      out.push(row(`prompt-${p.ref}`, [...lead, ...said, ...right], room))
    }
    if (n > at.rows) out.push(toggleRow('prompts-toggle', PROMPTS_PRESS, allPrompts, n, at, room))
  }

  if (history !== null) {
    gap('history-gap')
    const lines = history.text === '' ? [] : history.text.split('\n')
    const edits = history.edits ?? []
    const title = history.file.startsWith('session ') ? `Ledger of ${history.file}` : history.file.startsWith('prompt ') ? history.file : 'Edits'
    const note = edits.length > 0 ? `${edits.length} ${edits.length === 1 ? 'change' : 'changes'}` : ''
    card('history-head', '◇', title, note)
    out.push(row('history-close', [{ text: '  ' }, { text: '× close', dim: true, press: CLOSE_PRESS }], room))
    lines.forEach((l, i) => out.push(row(`history-${i}`, [{ text: `  ${l}` }], room)))
    edits.forEach((e, i) => out.push(...editRows(e, i, room)))
  }

  if (ledger.undone.length > 0) {
    gap('undone-gap')
    card('undone-head', '↻', 'Did not survive', `${ledger.undone.length}`)
    ledger.undone.forEach((u, i) => {
      const { dir, name } = fitPath(u.shown, Math.max(4, Math.floor(room / 2)))
      out.push(row(`undone-${i}`, [{ text: '  ' }, { text: dir, dim: true }, { text: name }, { text: `  ${u.verb} ${u.endedAt}`, color: HUE.undone }, { text: ` · made ${u.at} (${u.prompt})`, dim: true }], room))
    })
  }

  if (notes.length > 0) {
    gap('notes-gap')
    card('notes-head', '✎', 'Noted this session', `${notes.length}`)
    notes.forEach((note, i) => out.push(row(`note-${i}`, [{ text: '  ' }, { text: '↻ ', color: HUE.undone }, { text: note.replace(/^Minos: this /, '') }], room)))
  }

  const others = earlier.filter((s) => s.short !== ledger.session).reverse()
  if (others.length > 0) {
    gap('project-gap')
    card('project-head', '◷', 'This project', `${others.length} earlier ${others.length === 1 ? 'session' : 'sessions'} · press one for its ledger`)
    for (const s of others) {
      const c = s.counts
      const figures: Segment[] = (['decided', 'auto', 'subagent', 'undone'] as const).flatMap((k, i): Segment[] => [
        ...(i === 0 ? [] : [{ text: ' · ', dim: true }]),
        { text: String(c[k]), ...(c[k] > 0 ? { color: HUE[k], bold: true } : { dim: true }) },
        { text: ` ${k}`, dim: true },
      ])
      const lead: Segment[] = [{ text: '  ' }, { text: s.short, press: `${SESSION_PRESS}${s.id}` }, { text: `  ${s.first}`, dim: true }]
      const spare = room - width(lead) - width(figures)
      out.push(row(`project-${s.id}`, spare >= 2 ? [...lead, { text: spaces(spare) }, ...figures] : [...lead, { text: '  ' }, ...figures], room))
    }
  }

  if (ledger.caveats.length > 0) {
    gap('caveats-gap')
    ledger.caveats.forEach((c, i) => out.push(...wrapped(`caveat-${i}`, c, room)))
  }
  return out
}

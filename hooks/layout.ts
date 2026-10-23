/**
 * The pane laid out as rows exactly `width` cells wide, in the shape the
 * Knossos pane uses: a band of count tiles, then cards whose title is set into
 * a rule (`── ± Changed without asking ──── 3 files ──`), every row cut at the
 * pane's edge so nothing wraps or widens it. Pure: the words, numbers and
 * times all come from `minos ledger --json`; this only places them.
 */
import type { MinosHistory, MinosLedger, MinosSession } from '../types'
import { cells, fit, fitPath, spaces } from './text'

/** One run of text in a row, how it is drawn, and the press it carries. */
export type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean; italic?: boolean; press?: string }
/** One line of the pane. */
export type Row = { key: string; segments: Segment[] }
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
    { key: 'decided', value: counts.decided, label: 'decided', unit: 'files' },
    { key: 'auto', value: counts.auto, label: 'auto', unit: 'files' },
    { key: 'subagent', value: counts.subagent, label: 'subagent', unit: 'files' },
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

/** Everything the pane shows, as rows `room` wide. */
export function paneRows(ledger: MinosLedger, notes: string[], history: MinosHistory | null, room: number, earlier: MinosSession[] = []): Row[] {
  const tier = tierOf(room)
  const out: Row[] = []
  const gap = (key: string) => out.push(row(key, [], room))
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
      out.push(ruleRow('legend-head', '◇', 'What the counts mean', '', room))
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
    out.push(ruleRow('files-head', '≡', 'Changed without asking', `${n} ${n === 1 ? 'file' : 'files'} · press one for its history`, room))
    for (const f of ledger.files) out.push(fileRow(f, room))
  }

  if (history !== null) {
    gap('history-gap')
    const lines = history.text.split('\n')
    out.push(ruleRow('history-head', '◇', history.file.startsWith('session ') ? `Ledger of ${history.file}` : 'History', '', room))
    out.push(row('history-close', [{ text: '  ' }, { text: '× close', dim: true, press: CLOSE_PRESS }], room))
    lines.forEach((l, i) => out.push(row(`history-${i}`, [{ text: `  ${l}` }], room)))
  }

  if (ledger.undone.length > 0) {
    gap('undone-gap')
    out.push(ruleRow('undone-head', '↻', 'Did not survive', `${ledger.undone.length}`, room))
    ledger.undone.forEach((u, i) => {
      const { dir, name } = fitPath(u.shown, Math.max(4, Math.floor(room / 2)))
      out.push(row(`undone-${i}`, [{ text: '  ' }, { text: dir, dim: true }, { text: name }, { text: `  ${u.verb} ${u.endedAt}`, color: HUE.undone }, { text: ` · made ${u.at} (${u.prompt})`, dim: true }], room))
    })
  }

  if (notes.length > 0) {
    gap('notes-gap')
    out.push(ruleRow('notes-head', '✎', 'Noted this session', `${notes.length}`, room))
    notes.forEach((note, i) => out.push(row(`note-${i}`, [{ text: '  ' }, { text: '↻ ', color: HUE.undone }, { text: note.replace(/^Minos: this /, '') }], room)))
  }

  const others = earlier.filter((s) => s.short !== ledger.session).reverse()
  if (others.length > 0) {
    gap('project-gap')
    out.push(ruleRow('project-head', '◷', 'This project', `${others.length} earlier ${others.length === 1 ? 'session' : 'sessions'} · press one for its ledger`, room))
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

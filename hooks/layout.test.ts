import { expect, test } from 'claude-code/testing'

import { FOLDED, fitWindows, paneRows, tierOf, wheel } from './layout'
import { cells, fitPath } from './text'
import type { MinosLedger } from '../types'

const LEDGER: MinosLedger = {
  session: 'ab263592',
  since: '2026-10-23 21:31',
  counts: { decided: 0, auto: 12, subagent: 3, undone: 2 },
  units: 'counts are changes: one Edit, Write or NotebookEdit tool call each, deduplicated by tool_use id',
  files: [
    { file: '/repo/src/a.ts', shown: 'src/a.ts', label: 'auto', changes: '3 changes' },
    { file: '/repo/content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md', shown: 'content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md', label: 'subagent', changes: '1 change' },
  ],
  undone: [{ shown: 'src/a.ts', kind: 'overwritten', verb: 'replaced', at: '21:32', prompt: 'prompt 1', endedAt: '21:33' }],
  caveats: ['decided is inferred from permission mode alone, not from a recorded approval; a standing allow rule can mean nothing was ever put on screen.'],
  empty: null,
  legend: ['decided   made in default or plan mode', 'auto      applied without asking'],
  prompts: [
    { ref: 'prompt 2', text: 'make the mailer use the queue, and retry twice before giving up on a message', summary: '1 file · 2 changes', files: ['src/mail.ts'] },
    { ref: 'prompt 1', text: 'fix the login redirect', summary: '1 file · 1 change · 1 undone', files: ['src/a.ts'] },
  ],
}
const EARLIER = [
  { id: 'aaaa1111-x', short: 'aaaa1111', first: '2026-10-22 09:00', last: '2026-10-22 10:00', counts: { decided: 0, auto: 4, subagent: 2, undone: 1 } },
  { id: 'ab263592-x', short: 'ab263592', first: '2026-10-23 21:31', last: '2026-10-23 21:40', counts: { decided: 0, auto: 1, subagent: 0, undone: 0 } },
]
const NOTES = ['Minos: this replaced the change to src/a.ts made at 21:32 for prompt 1']
const rowWidth = (r: { segments: { text: string }[] }) => r.segments.reduce((n, s) => n + cells(s.text), 0)

test('every row is exactly as wide as the pane, narrow, medium and wide', () => {
  for (const room of [44, 79, 100, 160]) {
    const rows = [
      ...paneRows(LEDGER, NOTES, { file: '/repo/src/a.ts', text: 'src/a.ts: 3 operations in this session' }, room, EARLIER),
      ...paneRows({ ...LEDGER, files: [], undone: [], empty: 'No changes yet.' }, [], null, room, EARLIER),
    ]
    for (const r of rows) if (r.code === undefined) expect(rowWidth(r)).toBe(room)
  }
})

test('narrow, the tiles fold into one summary line; wider, they are a framed band', () => {
  expect(tierOf(60)).toBe('narrow')
  const narrow = paneRows(LEDGER, [], null, 60).filter((r) => r.key.startsWith('tiles'))
  expect(narrow.map((r) => r.key)).toEqual(['tiles-line'])
  const wide = paneRows(LEDGER, [], null, 120).filter((r) => r.key.startsWith('tiles'))
  expect(wide.map((r) => r.key)).toEqual(['tiles-top', 'tiles-value', 'tiles-label', 'tiles-end'])
})

test('a long path is cut in its folders, never in the file name', () => {
  const { dir, name } = fitPath('content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md', 50)
  expect(name).toBe('judging-an-ai-safety-sprint.md')
  expect(dir.startsWith('…')).toBe(true)
  expect(cells(dir) + cells(name)).toBeLessThanOrEqual(50)
})

test('each file name is pressable, and a card title carries its count', () => {
  const rows = paneRows(LEDGER, [], null, 100)
  const presses = rows.flatMap((r) => r.segments.filter((s) => s.press?.startsWith('file:') === true).map((s) => s.press))
  expect(presses).toEqual(['file:/repo/src/a.ts', 'file:/repo/content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md'])
  const head = rows.find((r) => r.key === 'files-head')!
  expect(head.segments.map((s) => s.text).join('')).toContain('Changed without asking')
  expect(head.segments.map((s) => s.text).join('')).toContain('2 files')
})

test('an empty session shows what the counts mean, and the project lists the other sessions, pressable', () => {
  const rows = paneRows({ ...LEDGER, files: [], undone: [], empty: 'No changes yet.' }, [], null, 100, EARLIER)
  expect(rows.some((r) => r.key === 'legend-head')).toBe(true)
  expect(rows.filter((r) => r.key.startsWith('legend-') && r.key !== 'legend-head' && r.key !== 'legend-gap')).toHaveLength(2)
  const project = rows.filter((r) => r.key.startsWith('project-') && r.key !== 'project-head' && r.key !== 'project-gap')
  // The current session is left out of the list.
  expect(project.map((r) => r.key)).toEqual(['project-aaaa1111-x'])
  expect(project[0]!.segments.find((s) => s.press !== undefined)?.press).toBe('session:aaaa1111-x')
  // With changes in the session, the legend gives way to them.
  expect(paneRows(LEDGER, [], null, 100, EARLIER).some((r) => r.key === 'legend-head')).toBe(false)
})

test('flags and supplementary CJK ideographs take two cells, and the pane still fits', () => {
  expect(cells('🇳🇱')).toBe(2)
  expect(cells('𠮷')).toBe(2)
  const wide = { ...LEDGER, files: [{ file: '/repo/🇳🇱/𠮷𠮷𠮷𠮷.md', shown: '🇳🇱/𠮷𠮷𠮷𠮷.md', label: 'auto' as const, changes: '1 change' }] }
  for (const room of [44, 100]) for (const r of paneRows(wide, [], null, room)) expect(rowWidth(r)).toBe(room)
})

test('when only the file name fits, an ellipsis stands for the dropped folders', () => {
  expect(fitPath('a/b/name.ts', 8)).toEqual({ dir: '…', name: 'name.ts' })
  expect(fitPath('a/b/name.ts', 6)).toEqual({ dir: '', name: 'name.…' })
})

test('a long file list folds after ten, behind a press that shows them all', () => {
  const many = { ...LEDGER, files: Array.from({ length: 14 }, (_, i) => ({ file: `/repo/f${i}.ts`, shown: `f${i}.ts`, label: 'auto' as const, changes: '1 change' })) }
  const folded = paneRows(many, [], null, 100)
  expect(folded.filter((r) => r.key.startsWith('file:'))).toHaveLength(10)
  const toggle = folded.find((r) => r.key === 'files-toggle')!
  expect(toggle.segments.map((s) => s.text).join('')).toContain('show all 14 · 4 more')
  expect(toggle.segments.find((s) => s.press !== undefined)?.press).toBe('files:toggle')
  const open = paneRows(many, [], null, 100, [], true)
  expect(open.filter((r) => r.key.startsWith('file:'))).toHaveLength(14)
  expect(open.find((r) => r.key === 'files-toggle')!.segments.map((s) => s.text).join('')).toContain('show fewer')
})

test('the prompts card lists each prompt, pressable, with what it changed against the right edge', () => {
  const rows = paneRows(LEDGER, [], null, 100)
  const prompt = rows.find((r) => r.key === 'prompt-prompt 2')!
  expect(prompt.segments.find((s) => s.press !== undefined)?.press).toBe('prompt:prompt 2')
  const text = prompt.segments.map((s) => s.text).join('')
  expect(text).toContain('make the mailer')
  expect(text.trimEnd().endsWith('1 file · 2 changes')).toBe(true)
  for (const room of [44, 160]) for (const r of paneRows(LEDGER, [], null, room)) expect(rowWidth(r)).toBe(room)
})

test('an opened file shows each change as a header and a diff block for Claude Code to draw', () => {
  const history = {
    file: '/repo/src/a.ts',
    text: '',
    edits: [
      { at: '21:32', kind: 'edit', attestation: 'auto', prompt: 'prompt 1', diff: '@@ -3,1 +3,1 @@\n-a\n+b', numbered: true, cut: 0 },
      { at: '21:33', kind: 'edit', attestation: 'subagent', prompt: '(unattributed)', diff: '-x\n+y', numbered: false, cut: 4 },
    ],
  }
  const rows = paneRows(LEDGER, [], history, 100)
  const blocks = rows.filter((r) => r.code !== undefined)
  expect(blocks.map((r) => r.code)).toEqual([
    { source: '@@ -3,1 +3,1 @@\n-a\n+b', diff: true },
    { source: '-x\n+y', diff: false },
  ])
  const head = rows.find((r) => r.key === 'edit-1')!.segments.map((s) => s.text).join('')
  expect(head).toContain('21:33')
  expect(head).toContain('4 more lines not shown')
  expect(rows.find((r) => r.key === 'history-head')!.segments.map((s) => s.text).join('')).toContain('2 changes')
})

const MANY: MinosLedger = {
  ...LEDGER,
  files: Array.from({ length: 30 }, (_, i) => ({ file: `/repo/f${i}.ts`, shown: `f${i}.ts`, label: 'auto' as const, changes: '1 change' })),
  prompts: Array.from({ length: 20 }, (_, i) => ({ ref: `prompt ${i + 1}`, text: `ask ${i + 1}`, summary: '1 file · 1 change', files: [`f${i}.ts`] })),
}

test('a tall pane grows the lists into the rows the folded pane leaves empty, files first', () => {
  const folded = paneRows(MANY, [], null, 100).length
  const windows = fitWindows(folded + 12, { files: 0, prompts: 0 }, MANY, [], null, 100)
  expect(windows.files.rows).toBe(22)
  expect(windows.prompts.rows).toBe(6)
  expect(paneRows(MANY, [], null, 100, [], false, false, windows)).toHaveLength(folded + 12)
})

test('a list grown whole drops its toggle, and the row it frees goes to the next list', () => {
  const folded = paneRows(MANY, [], null, 100).length
  const windows = fitWindows(folded + 25, { files: 0, prompts: 0 }, MANY, [], null, 100)
  expect(windows.files.rows).toBe(30)
  expect(windows.prompts.rows).toBe(12)
  const rows = paneRows(MANY, [], null, 100, [], false, false, windows)
  expect(rows.some((r) => r.key === 'files-toggle')).toBe(false)
  expect(rows).toHaveLength(folded + 25)
})

test('a pane shorter than the folded lists keeps them folded, and the pane scrolls', () => {
  expect(fitWindows(10, { files: 0, prompts: 0 }, MANY, [], null, 100)).toEqual(FOLDED)
})

test('a list shown whole keeps its fold back, and takes none of the spare rows', () => {
  const windows = fitWindows(500, { files: 0, prompts: 0 }, MANY, [], null, 100, [], true)
  expect(windows.files.rows).toBe(10)
  const rows = paneRows(MANY, [], null, 100, [], true, false, windows)
  expect(rows.filter((r) => r.key.startsWith('file:'))).toHaveLength(30)
  expect(rows.find((r) => r.key === 'files-toggle')!.segments.map((s) => s.text).join('')).toContain('show fewer')
})

test('a window scrolled down shows its rows and says how many lie above and below', () => {
  const rows = paneRows(MANY, [], null, 100, [], false, false, { ...FOLDED, files: { from: 5, rows: 10 } })
  expect(rows.filter((r) => r.key.startsWith('file:')).map((r) => r.key)).toEqual(Array.from({ length: 10 }, (_, i) => `file:/repo/f${i + 5}.ts`))
  expect(rows.find((r) => r.key === 'files-toggle')!.segments.map((s) => s.text).join('')).toContain('show all 30 · 5 above · 15 below')
})

test('the wheel over a list moves its window, and stops at its ends so the pane scrolls instead', () => {
  const keys = paneRows(MANY, [], null, 100).map((r) => r.key)
  const file = keys.indexOf('file:/repo/f3.ts')
  const prompt = keys.indexOf('prompt-prompt 2')
  const counts = { files: 30, prompts: 20 }
  expect(wheel(keys, file, 3, FOLDED, counts)).toEqual({ list: 'files', from: 3 })
  expect(wheel(keys, prompt, 1, FOLDED, counts)).toEqual({ list: 'prompts', from: 1 })
  expect(wheel(keys, file, -1, FOLDED, counts)).toBeNull()
  expect(wheel(keys, file, 100, { ...FOLDED, files: { from: 20, rows: 10 } }, counts)).toBeNull()
  expect(wheel(keys, file, 100, FOLDED, counts)).toEqual({ list: 'files', from: 20 })
  expect(wheel(keys, keys.indexOf('head'), 1, FOLDED, counts)).toBeNull()
  expect(wheel(keys, file, 1, FOLDED, { ...counts, files: 0 })).toBeNull()
})

test('the header names the project and where its checkout stands, as the Knossos pane does', () => {
  const text = (where: Parameters<typeof paneRows>[8], room = 100) => paneRows(LEDGER, [], null, room, [], false, false, FOLDED, where).find((r) => r.key === 'head')!.segments.map((s) => s.text).join('').trimEnd()
  expect(text({ project: 'minos', git: { branch: 'main', rev: '857857fdaa51' } })).toBe('  minos  main · 857857f')
  expect(text({ project: 'minos', git: { branch: null, rev: '857857fdaa51' } })).toBe('  minos  @ 857857f')
  expect(text({ project: 'minos', git: null })).toBe('  minos')
  expect(text(null)).toBe('  Minos')
  expect(text(null, 60)).toBe(' Minos')
})

test('the header has a blank row above it (none on a narrow pane), and a rule below it', () => {
  expect(paneRows(LEDGER, [], null, 100).slice(0, 5).map((r) => r.key)).toEqual(['head-top', 'head', 'head-end', 'head-rule', 'head-gap'])
  expect(paneRows(LEDGER, [], null, 60)[0]!.key).toBe('head')
})

import { expect, test } from 'claude-code/testing'

import { paneRows, tierOf } from './layout'
import { cells, fitPath } from './text'
import type { MinosLedger } from '../types'

const LEDGER: MinosLedger = {
  session: 'ab263592',
  since: '2026-10-23 21:31',
  counts: { decided: 0, auto: 12, subagent: 3, undone: 2 },
  units: '(decided, auto and subagent count files; undone counts changes)',
  files: [
    { file: '/repo/src/a.ts', shown: 'src/a.ts', label: 'auto', changes: '3 changes' },
    { file: '/repo/content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md', shown: 'content/en/blog/a-very-long-directory-name/judging-an-ai-safety-sprint.md', label: 'subagent', changes: '1 change' },
  ],
  undone: [{ shown: 'src/a.ts', kind: 'overwritten', verb: 'replaced', at: '21:32', prompt: 'prompt 1', endedAt: '21:33' }],
  caveats: ['decided is inferred from permission mode alone, not from a recorded approval; a standing allow rule can mean nothing was ever put on screen.'],
  empty: null,
  legend: ['decided   made in default or plan mode', 'auto      applied without asking'],
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
    for (const r of rows) expect(rowWidth(r)).toBe(room)
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
  const presses = rows.flatMap((r) => r.segments.filter((s) => s.press !== undefined).map((s) => s.press))
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

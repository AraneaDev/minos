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
}
const NOTES = ['Minos: this replaced the change to src/a.ts made at 21:32 for prompt 1']
const rowWidth = (r: { segments: { text: string }[] }) => r.segments.reduce((n, s) => n + cells(s.text), 0)

test('every row is exactly as wide as the pane, narrow, medium and wide', () => {
  for (const room of [44, 79, 100, 160]) {
    const rows = paneRows(LEDGER, NOTES, { file: '/repo/src/a.ts', text: 'src/a.ts: 3 operations in this session' }, room)
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

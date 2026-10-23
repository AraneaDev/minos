import { expect, mock, test } from 'claude-code/testing'

import { engine, start } from './testkit'
import type { Run } from './testkit'

const PANE = {
  plugin: 'minos',
  component: 'Pane',
  requestId: 'minos-ledger',
  props: { title: 'Minos', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The `/minos` command as a person runs it at the terminal prompt. */
const OPEN = { command: 'minos', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

const UNITS = '(decided, auto and subagent count files; undone counts changes)'
const DISPLAY = {
  session: 'sess-1',
  since: '2026-10-23 18:50',
  counts: { decided: 0, auto: 1, subagent: 0, undone: 1 },
  units: UNITS,
  files: [{ file: '/repo/src/a.ts', shown: 'src/a.ts', label: 'auto', changes: '1 change' }],
  undone: [{ shown: 'src/a.ts', kind: 'overwritten', verb: 'replaced', at: '18:51', prompt: 'prompt 2', endedAt: '18:58' }],
  caveats: [],
  empty: null,
  legend: [],
}
const LEDGER_JSON = JSON.stringify({ text: 'unused by the pane', display: DISPLAY })

/** A CLI stand-in: the ledger as JSON, a file's history, and no undo findings. */
const cli = (run: Run) =>
  run.argv[2] === 'sessions'
    ? { exitCode: 0, stdout: JSON.stringify({ sessions: [{ id: 'old-1', short: 'old-1', first: '2026-10-22 09:00', last: '2026-10-22 10:00', counts: { decided: 0, auto: 2, subagent: 0, undone: 0 } }] }) }
    : run.argv[2] === 'ledger' && run.argv.includes('old-1')
      ? { exitCode: 0, stdout: 'MINOS  ledger  session old-1  earlier session text\n' }
      : run.argv[2] === 'ledger'
        ? { exitCode: 0, stdout: LEDGER_JSON }
        : run.argv[2] === 'file'
      ? { exitCode: 0, stdout: 'src/a.ts: 1 operation in this session\n' }
      : { exitCode: 0, stdout: '[]' }

const ledgerRuns = (runs: Run[]) => runs.filter((r) => r.argv[2] === 'ledger').length

test('/minos opens the pane and it shows the ledger the CLI prints, on every surface', async ($, on) => {
  engine(on, cli)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  expect(JSON.stringify(await $.command.run(OPEN))).toContain('Minos pane opened.')
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /session sess-1/ }))?.text).toContain('session sess-1')
    expect((await ui.find({ type: 'Text', text: /since 2026-10-23 18:50/ }))).toBeDefined()
    expect((await ui.find({ key: 'file:/repo/src/a.ts' }))?.text).toContain('a.ts')
    expect(await ui.find({ type: 'Text', text: /· 1 change/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /replaced 18:58/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /made 18:51 \(prompt 2\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a file in the pane shows its history', async ($, on) => {
  const { runs } = engine(on, cli)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'file:/repo/src/a.ts' })
  expect(runs.some((r) => r.argv[2] === 'file' && r.argv[3] === '/repo/src/a.ts')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /operation in this session/ }))?.text).toContain('src/a.ts: 1 operation in this session')
  await ui.press({ key: 'history:close' })
  expect(await ui.find({ type: 'Text', text: /operation in this session/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane says so when Minos could not run', async ($, on) => {
  engine(on, () => ({ exitCode: 2, stderr: 'minos: something broke\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /could not run/ }))?.text).toContain('minos: something broke')
  await ui.unmount()
})

test('nothing is refreshed while the pane has not been opened', async ($, on) => {
  const { runs } = engine(on, cli)
  on('tool.call', () => ({ result: { filePath: '/repo/a.ts' } }))
  const clock = mock.clock(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
  await clock.advance(2000)
  expect(ledgerRuns(runs)).toBe(0)
})

test('while open, a burst of changes of every kind and a turn end become one refresh', async ($, on) => {
  const { runs } = engine(on, cli)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { filePath: '/repo/a.ts' } }))
  on('turn.complete', () => ({ text: '', reason: 'answer', category: null, explanation: null }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const opened = ledgerRuns(runs)
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: '1' })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb', new_source: 'x' } as never)
  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'general-purpose' } as never)
  expect(ledgerRuns(runs)).toBe(opened)
  await clock.advance(1000)
  expect(ledgerRuns(runs)).toBe(opened + 1)
  // The end of a turn asks for a refresh of its own.
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1000)
  expect(ledgerRuns(runs)).toBe(opened + 2)
})

test('a malformed ledger is shown as a failure, not drawn', async ($, on) => {
  engine(on, () => ({ exitCode: 0, stdout: JSON.stringify({ display: { session: 's', counts: null, files: [], undone: [] } }) }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /could not run/ }))?.text).toContain('did not read as JSON')
  await ui.unmount()
})

test('a refresh asked for while one runs causes exactly one more after it', async ($, on) => {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  // The first ledger run holds until released, so the later requests land while it runs.
  const { runs } = engine(on, async (run) => {
    if (run.argv[2] === 'ledger' && ledgerRuns(runs) === 1) await held
    return cli(run)
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await $.command.run(OPEN)
  await $.command.run(OPEN)
  expect(ledgerRuns(runs)).toBe(1)
  release()
  await clock.settle()
  expect(ledgerRuns(runs)).toBe(2)
})

test('a session with no transcript yet reads as No changes yet., not as a failure', async ($, on) => {
  engine(on, () => ({ exitCode: 1, stderr: 'minos: no transcript found for /repo\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No changes yet/ }))?.text).toBe('No changes yet.')
  expect(await ui.find({ type: 'Text', text: /could not run/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane lists the earlier sessions of the project, and pressing one shows its ledger', async ($, on) => {
  const { runs } = engine(on, cli)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(OPEN)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'session:old-1' })).toBeDefined()
  await ui.press({ key: 'session:old-1' })
  expect(runs.some((r) => r.argv[2] === 'ledger' && r.argv.includes('old-1'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /earlier session text/ })).toBeDefined()
  await ui.unmount()
})

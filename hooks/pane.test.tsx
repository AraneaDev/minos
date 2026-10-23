import { expect, mock, test } from 'claude-code/testing'

import { engine, start } from './testkit'

const PANE = {
  plugin: 'minos',
  component: 'Pane',
  requestId: 'minos-ledger',
  props: { title: 'Minos', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const LEDGER_TEXT = [
  'MINOS  ledger  session sess-1  since 2026-10-23 18:51',
  'decided 0  auto 1  subagent 0  undone 0',
  '(decided, auto and subagent count files; undone counts changes)',
  '',
  'changed without being asked',
  '  src/a.ts                                 auto      1 change',
].join('\n')

/** The `/minos` command as a person runs it at the terminal prompt. */
const LIVE = { command: 'minos', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

const ledgerRuns = (runs: { argv: readonly string[] }[]) => runs.filter((r) => r.argv[2] === 'ledger').length

test('/minos opens the pane and it shows the ledger the CLI prints, on every surface', async ($, on) => {
  engine(on, () => ({ exitCode: 0, stdout: `${LEDGER_TEXT}\n` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mock.clock(on)
  await start($)
  const opened = await $.command.run(LIVE)
  expect(JSON.stringify(opened)).toContain('Minos pane opened.')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /auto 1/ }))?.text).toBe('decided 0  auto 1  subagent 0  undone 0')
    expect((await ui.find({ type: 'Text', text: /src\/a\.ts/ }))?.text).toContain('1 change')
    await ui.unmount()
  }
})

test('the pane says so when Minos could not run', async ($, on) => {
  engine(on, () => ({ exitCode: 1, stderr: 'minos: no transcript found for /repo\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mock.clock(on)
  await start($)
  await $.command.run(LIVE)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /could not run/ }))?.text).toContain('minos: no transcript found for /repo')
  await ui.unmount()
})

test('a burst of edits becomes one refresh after the session goes quiet', async ($, on) => {
  const { runs } = engine(on, (run) => (run.argv[2] === 'undoes' ? { exitCode: 0, stdout: '[]' } : { exitCode: 0, stdout: LEDGER_TEXT }))
  on('tool.call', () => ({ result: { filePath: '/repo/a.ts' } }))
  const clock = mock.clock(on)
  await start($)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: `${i}` })
  expect(ledgerRuns(runs)).toBe(0)
  await clock.advance(1000)
  expect(ledgerRuns(runs)).toBe(1)
})

test('a refresh asked for while one runs causes exactly one more after it', async ($, on) => {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  // The first ledger run holds until released, so the later requests land while it runs.
  const { runs } = engine(on, async () => {
    if (runs.length === 1) await held
    return { exitCode: 0, stdout: LEDGER_TEXT }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  await start($)
  await $.command.run(LIVE)
  await $.command.run(LIVE)
  await $.command.run(LIVE)
  expect(ledgerRuns(runs)).toBe(1)
  release()
  await clock.settle()
  expect(ledgerRuns(runs)).toBe(2)
})

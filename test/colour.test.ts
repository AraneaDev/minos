import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, spyOn, test } from 'bun:test'
import { main } from '../src/cli'
import { encodeProjectSlug } from '../src/paths'
import { colourEnabled, paint, runsFor } from '../src/colour'

const ESC = '\u001b'

test('colour is on when stdout is a terminal and nothing forbids it', () => {
  expect(colourEnabled({ isTTY: true, env: {} })).toBe(true)
})

test('colour is off when stdout is not a terminal, so a pipe stays plain', () => {
  expect(colourEnabled({ isTTY: false, env: {} })).toBe(false)
})

test('NO_COLOR wins over a terminal, whatever it is set to', () => {
  expect(colourEnabled({ isTTY: true, env: { NO_COLOR: '1' } })).toBe(false)
  expect(colourEnabled({ isTTY: true, env: { NO_COLOR: '' } })).toBe(false)
})

test('a dumb terminal gets no escapes', () => {
  expect(colourEnabled({ isTTY: true, env: { TERM: 'dumb' } })).toBe(false)
})

test('FORCE_COLOR turns it on without a terminal, for a capture that wants it', () => {
  expect(colourEnabled({ isTTY: false, env: { FORCE_COLOR: '1' } })).toBe(true)
})

test('NO_COLOR beats FORCE_COLOR, because the refusal is the safer of the two', () => {
  expect(colourEnabled({ isTTY: false, env: { FORCE_COLOR: '1', NO_COLOR: '1' } })).toBe(false)
})

/** The runs a line is split into, as `role:text` pairs, for a compact assertion. */
const rolesOf = (line: string): string[] => runsFor(line).map((r) => `${r.role}:${r.text}`)

test('a run split never loses or reorders a character, so columns cannot shift', () => {
  const line = '  decided       6 files  + 210  -  12   you were asked before it was applied'
  expect(runsFor(line).map((r) => r.text).join('')).toBe(line)
})

test('each class row carries its own colour on its own name', () => {
  expect(rolesOf('  decided       6 files  +   0  -   0   you were asked before it was applied')).toContain('decided:decided')
  expect(rolesOf('  auto          6 files  +   0  -   0   acceptEdits or auto, no prompt')).toContain('auto:auto')
  expect(rolesOf('  subagent     54 files  +   0  -   0   applied inside a subagent, never rendered')).toContain('subagent:subagent')
})

test('a section heading is the tool speaking, and its counts stay plain', () => {
  const roles = rolesOf('CHANGED  57 files, +10807 / -1176')
  expect(roles[0]).toBe('bone:CHANGED  ')
  expect(roles).toContain('body:57 files')
})

test('a parenthetical caveat is dim from end to end', () => {
  const line = '  (a file changed under more than one label below is counted in each)'
  expect(rolesOf(line)).toEqual([`dim:${line}`])
})

test('the three undone kinds share one colour', () => {
  for (const kind of ['overwritten', 'reverted', 'discarded']) {
    expect(rolesOf(`src/report.ts:55            ${kind}  20:34      prompt 1`)).toContain(`undone:${kind}`)
  }
})

test('times are dim, with or without a day suffix', () => {
  expect(rolesOf('src/x.ts  overwritten  20:34  to  23:53')).toContain('dim:20:34')
  expect(rolesOf('scripts/fp-harness.ts  discarded  23:38  to  00:00+1d')).toContain('dim:00:00+1d')
})

test('a quoted prompt and an unattributed marker are dim, since neither is a finding', () => {
  expect(rolesOf('    1  19:10   56 files  "see @docs/spec.md and @docs/plan.md ... "')).toContain('dim:"see @docs/spec.md and @docs/plan.md ... "')
  expect(rolesOf('  21:09       edit      subagent  (unattributed)')).toContain('dim:(unattributed)')
})

test('an ordinary line is one plain run', () => {
  expect(rolesOf('nothing special here')).toEqual(['body:nothing special here'])
})

/** What is left of a painted string once the escapes are taken back out. */
const stripped = (text: string): string => text.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')

test('with colour off, the output is returned byte for byte', () => {
  const report = 'CHANGED  57 files\n  decided       6 files\n  (a caveat)'
  expect(paint(report, false)).toBe(report)
})

test('with colour on, the text survives the escapes exactly', () => {
  const report = 'CHANGED  57 files\n  decided       6 files\n  (a caveat)\n'
  expect(stripped(paint(report, true))).toBe(report)
})

test('a painted run closes its colour, so what follows starts clean', () => {
  expect(paint('  decided       6 files', true).endsWith(`${ESC}[0m`)).toBe(true)
})

test('each class gets its own escape, and the same one every time it appears', () => {
  const decided = paint('  decided       6 files', true)
  const elsewhere = paint('src/x.ts  edit  decided  prompt 1', true)
  const code = new RegExp(`${ESC}\\[38;2;[0-9;]+m(?=decided)`).exec(decided)?.[0]
  expect(code).toBeDefined()
  expect(elsewhere).toContain(`${code}decided`)
})

test('an empty line paints to an empty line rather than a stray escape', () => {
  expect(paint('a\n\nb', true).split('\n')[1]).toBe('')
})

/* The wiring: a command's own output goes through paint, and the decision is
   made once, in the CLI, rather than in each command. A store with one session
   in it is the smallest thing `minos sessions` will print a row for. */

/** Builds a throwaway transcript store holding one session for `cwd`. */
async function storeWith(cwd: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'minos-colour-'))
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  const record = {
    type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default',
    timestamp: '2026-09-07T10:00:00Z', sessionId: 's', cwd, gitBranch: 'main',
    message: { content: 'a prompt' },
  }
  await writeFile(join(projectDir, 'sess.jsonl'), `${JSON.stringify(record)}\n`)
  return root
}

test('the CLI paints what a command printed when colour is allowed', async () => {
  const cwd = '/root/fake-project-colour-on'
  const root = await storeWith(cwd)
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  process.env.CLAUDE_CONFIG_DIR = root
  process.env.FORCE_COLOR = '1'
  try {
    expect(await main(['sessions', '--project', cwd])).toBe(0)
    expect(String((logSpy.mock.calls[0] ?? [''])[0])).toContain(ESC)
  } finally {
    delete process.env.FORCE_COLOR
    delete process.env.CLAUDE_CONFIG_DIR
    logSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

test('the same command through a pipe carries no escape at all', async () => {
  const cwd = '/root/fake-project-colour-off'
  const root = await storeWith(cwd)
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  process.env.CLAUDE_CONFIG_DIR = root
  process.env.NO_COLOR = '1'
  try {
    expect(await main(['sessions', '--project', cwd])).toBe(0)
    expect(String((logSpy.mock.calls[0] ?? [''])[0])).not.toContain(ESC)
  } finally {
    delete process.env.NO_COLOR
    delete process.env.CLAUDE_CONFIG_DIR
    logSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

/* A guard rather than a discovery: export was raw before this change and must
   stay raw after it, because its reader is a program. */
test('export is never painted, even on a terminal', async () => {
  const cwd = '/root/fake-project-colour-export'
  const root = await storeWith(cwd)
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  process.env.CLAUDE_CONFIG_DIR = root
  process.env.FORCE_COLOR = '1'
  try {
    expect(await main(['export', '--project', cwd])).toBe(0)
    const printed = String((logSpy.mock.calls[0] ?? [''])[0])
    expect(printed).not.toContain(ESC)
    expect(() => JSON.parse(printed)).not.toThrow()
  } finally {
    delete process.env.FORCE_COLOR
    delete process.env.CLAUDE_CONFIG_DIR
    logSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

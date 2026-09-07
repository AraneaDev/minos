import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readAllowRules } from '../src/settings'

// Finding 5: the caveat needs the Edit/Write/NotebookEdit allow rules in force
// right now, read from settings under the Claude config directory. Every test
// below points CLAUDE_CONFIG_DIR at a throwaway directory, exactly like the
// paths.test.ts suite, so nothing here ever reads or writes the real ~/.claude.
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'minos-settings-'))
  process.env.CLAUDE_CONFIG_DIR = root
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(root, { recursive: true, force: true })
})

test('reads Edit/Write/NotebookEdit allow rules from settings.json', async () => {
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Edit(src/**)', 'Bash(npm run *)', 'Write(dist/**)'] } }),
  )
  const rules = await readAllowRules()
  expect(rules).not.toBeNull()
  expect(rules).toContain('Edit(src/**)')
  expect(rules).toContain('Write(dist/**)')
  // A rule for a tool the ledger never tracks (Bash) is not what would move a
  // decided row into auto, and naming it would only be noise.
  expect(rules).not.toContain('Bash(npm run *)')
})

test('merges rules from settings.json and settings.local.json, without duplicates', async () => {
  await writeFile(join(root, 'settings.json'), JSON.stringify({ permissions: { allow: ['Edit(src/**)'] } }))
  await writeFile(
    join(root, 'settings.local.json'),
    JSON.stringify({ permissions: { allow: ['Edit(src/**)', 'Write(src/**)'] } }),
  )
  const rules = await readAllowRules()
  expect(rules).not.toBeNull()
  expect((rules ?? []).sort()).toEqual(['Edit(src/**)', 'Write(src/**)'])
})

test('returns null when neither settings file can be read at all', async () => {
  const rules = await readAllowRules()
  expect(rules).toBeNull()
})

test('returns an empty list, not null, when a settings file parses but carries no allow rules', async () => {
  await writeFile(join(root, 'settings.json'), JSON.stringify({ permissions: {} }))
  const rules = await readAllowRules()
  expect(rules).toEqual([])
})

test('a malformed settings file is skipped rather than failing the whole read', async () => {
  await writeFile(join(root, 'settings.json'), '{ not json')
  await writeFile(join(root, 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Edit(src/**)'] } }))
  const rules = await readAllowRules()
  expect(rules).toEqual(['Edit(src/**)'])
})

test('honours CLAUDE_CONFIG_DIR rather than the real home directory', async () => {
  await mkdir(join(root, 'nested'), { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = join(root, 'nested')
  await writeFile(join(root, 'nested', 'settings.json'), JSON.stringify({ permissions: { allow: ['Edit(a/**)'] } }))
  const rules = await readAllowRules()
  expect(rules).toEqual(['Edit(a/**)'])
})

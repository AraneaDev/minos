import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  claudeHome,
  encodeProjectSlug,
  fileHistoryDir,
  projectDirFor,
  sessionFiles,
  subagentFiles,
} from '../src/paths'

test('a project path becomes the directory name Claude Code uses', () => {
  // Both of these exist verbatim in a real store, which is why they are the cases.
  expect(encodeProjectSlug('/root/yielder-customer-insights')).toBe('-root-yielder-customer-insights')
  expect(encodeProjectSlug('/root/3d-wasm')).toBe('-root-3d-wasm')
})

test('CLAUDE_CONFIG_DIR overrides the home directory', () => {
  process.env.CLAUDE_CONFIG_DIR = '/tmp/elsewhere'
  expect(claudeHome()).toBe('/tmp/elsewhere')
  delete process.env.CLAUDE_CONFIG_DIR
  expect(claudeHome().endsWith('/.claude')).toBe(true)
})

test('the file history directory is per session', () => {
  process.env.CLAUDE_CONFIG_DIR = '/tmp/elsewhere'
  expect(fileHistoryDir('abc')).toBe('/tmp/elsewhere/file-history/abc')
  delete process.env.CLAUDE_CONFIG_DIR
})

// The remaining tests build a fake store under a temp directory, so they
// never depend on (or risk touching) the real ~/.claude.
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'minos-paths-'))
  process.env.CLAUDE_CONFIG_DIR = root
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(root, { recursive: true, force: true })
})

test('sessionFiles returns only .jsonl files, sorted, with full paths', async () => {
  const projectDir = join(root, 'projects', '-root-example')
  await mkdir(projectDir, { recursive: true })
  await writeFile(join(projectDir, 'b.jsonl'), '')
  await writeFile(join(projectDir, 'a.jsonl'), '')
  await writeFile(join(projectDir, 'notes.txt'), '')

  const files = await sessionFiles(projectDir)

  expect(files).toEqual([join(projectDir, 'a.jsonl'), join(projectDir, 'b.jsonl')])
})

test('sessionFiles returns an empty array for a directory that does not exist', async () => {
  const files = await sessionFiles(join(root, 'projects', 'does-not-exist'))

  expect(files).toEqual([])
})

test('subagentFiles finds a direct agent transcript and a nested workflow one, and skips the journal', async () => {
  const projectDir = join(root, 'projects', '-root-example')
  const sessionId = 'session-1'
  const subagentsDir = join(projectDir, sessionId, 'subagents')
  const workflowDir = join(subagentsDir, 'workflows', 'wf-1')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(join(subagentsDir, 'agent-x.jsonl'), '')
  // A sidecar that a naive ".jsonl" filter would already exclude.
  await writeFile(join(subagentsDir, 'agent-x.meta.json'), '')
  await writeFile(join(workflowDir, 'agent-y.jsonl'), '')
  // A workflow journal: real .jsonl content, but not a subagent transcript.
  // A filter of ".jsonl" alone would wrongly include this.
  await writeFile(join(workflowDir, 'journal.jsonl'), '')

  const files = await subagentFiles(projectDir, sessionId)

  expect(files).toEqual([join(subagentsDir, 'agent-x.jsonl'), join(workflowDir, 'agent-y.jsonl')])
})

test('subagentFiles returns an empty array when the session has no subagents directory', async () => {
  const projectDir = join(root, 'projects', '-root-example')
  await mkdir(projectDir, { recursive: true })

  const files = await subagentFiles(projectDir, 'session-without-subagents')

  expect(files).toEqual([])
})

test('projectDirFor returns the encoded directory when it exists', async () => {
  const cwd = '/root/example'
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(join(projectDir, 'session-1.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)

  const found = await projectDirFor(cwd)

  expect(found).toBe(projectDir)
})

test('projectDirFor falls back to the cwd recorded on the first line when the encoded guess misses', async () => {
  const cwd = '/root/renamed-project'

  // A candidate whose first line has no newline within the bound: unreadable,
  // so the scan must move past it rather than throwing.
  const unreadableDir = join(root, 'projects', '-root-unreadable-first-line')
  await mkdir(unreadableDir, { recursive: true })
  await writeFile(join(unreadableDir, 'session-1.jsonl'), 'no newline in this whole file at all')

  // A candidate whose first line is not JSON at all.
  const malformedDir = join(root, 'projects', '-root-malformed-first-line')
  await mkdir(malformedDir, { recursive: true })
  await writeFile(join(malformedDir, 'session-1.jsonl'), 'not json\nmore content\n')

  // The directory that actually matches, filed under a name the encoded
  // guess would never produce for this cwd.
  const projectDir = join(root, 'projects', '-root-old-name-for-the-project')
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'session-1.jsonl'),
    `${JSON.stringify({ type: 'user', cwd })}\n${JSON.stringify({ type: 'user', cwd: 'irrelevant' })}\n`,
  )

  const found = await projectDirFor(cwd)

  expect(found).toBe(projectDir)
})

test('projectDirFor returns null when nothing matches', async () => {
  const unrelatedDir = join(root, 'projects', '-root-unrelated')
  await mkdir(unrelatedDir, { recursive: true })
  await writeFile(
    join(unrelatedDir, 'session-1.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: '/root/unrelated' })}\n`,
  )

  const found = await projectDirFor('/root/nowhere')

  expect(found).toBeNull()
})

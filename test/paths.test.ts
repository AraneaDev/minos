import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  claudeHome,
  encodeProjectSlug,
  projectFor,
  recordedCwds,
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

test('sessionFiles returns only .jsonl files, with full paths', async () => {
  const projectDir = join(root, 'projects', '-root-example')
  await mkdir(projectDir, { recursive: true })
  await writeFile(join(projectDir, 'b.jsonl'), '')
  await writeFile(join(projectDir, 'a.jsonl'), '')
  await writeFile(join(projectDir, 'notes.txt'), '')

  const files = await sessionFiles(projectDir)

  // Order is covered by its own test below; this one is purely about the
  // .jsonl filter and full-path shape.
  expect([...files].sort()).toEqual([join(projectDir, 'a.jsonl'), join(projectDir, 'b.jsonl')].sort())
})

test('sessionFiles returns an empty array for a directory that does not exist', async () => {
  const files = await sessionFiles(join(root, 'projects', 'does-not-exist'))

  expect(files).toEqual([])
})

test('sessionFiles orders sessions by modification time, oldest first, even when that disagrees with name order', async () => {
  // Session filenames are UUIDs and carry no chronological meaning, so this
  // pins ordering to mtime rather than to a lexicographic sort of the names.
  // Names are picked so the two orders disagree, and mtimes are set
  // explicitly so the test does not depend on write-order timing.
  const projectDir = join(root, 'projects', '-root-example')
  await mkdir(projectDir, { recursive: true })
  const olderPath = join(projectDir, 'zzz-actually-oldest.jsonl')
  const newerPath = join(projectDir, 'aaa-actually-newest.jsonl')
  await writeFile(olderPath, '')
  await writeFile(newerPath, '')
  const earlier = new Date('2024-01-01T00:00:00Z')
  const later = new Date('2024-06-01T00:00:00Z')
  await utimes(olderPath, earlier, earlier)
  await utimes(newerPath, later, later)

  const files = await sessionFiles(projectDir)

  expect(files).toEqual([olderPath, newerPath])
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

test('projectFor returns the encoded directory when it exists', async () => {
  const cwd = '/root/example'
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(join(projectDir, 'session-1.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)

  const found = await projectFor(cwd)

  expect(found?.dir).toBe(projectDir)
})

test('projectFor falls back to a project whose transcript records the cwd when the encoded guess misses', async () => {
  const cwd = '/root/renamed-project'

  // A candidate with no parseable JSON anywhere in it. On the fallback scan
  // (no prior evidence from the name) this must be skipped, not accepted.
  const unparseableDir = join(root, 'projects', '-root-unparseable-transcript')
  await mkdir(unparseableDir, { recursive: true })
  await writeFile(join(unparseableDir, 'session-1.jsonl'), 'not json\nstill not json\n')

  // A candidate that records a real but different cwd.
  const differentCwdDir = join(root, 'projects', '-root-different-cwd')
  await mkdir(differentCwdDir, { recursive: true })
  await writeFile(join(differentCwdDir, 'session-1.jsonl'), `${JSON.stringify({ type: 'user', cwd: 'irrelevant' })}\n`)

  // The directory that actually matches, filed under a name the encoded
  // guess would never produce for this cwd, with cwd recorded a few lines in
  // as it is on a real transcript.
  const projectDir = join(root, 'projects', '-root-old-name-for-the-project')
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'session-1.jsonl'),
    [
      JSON.stringify({ type: 'last-prompt' }),
      JSON.stringify({ type: 'mode' }),
      JSON.stringify({ type: 'user', cwd }),
    ].join('\n') + '\n',
  )

  const found = await projectFor(cwd)

  expect(found?.dir).toBe(projectDir)
})

test('projectFor returns null when nothing matches', async () => {
  const unrelatedDir = join(root, 'projects', '-root-unrelated')
  await mkdir(unrelatedDir, { recursive: true })
  await writeFile(
    join(unrelatedDir, 'session-1.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: '/root/unrelated' })}\n`,
  )

  const found = await projectFor('/root/nowhere')

  expect(found).toBeNull()
})

test('projectFor finds a cwd recorded on a later line of the encoded guess, not just the first', async () => {
  // As on a real transcript: session-level records come first, and cwd only
  // shows up a few lines in.
  const cwd = '/root/example-later-cwd'
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'session-1.jsonl'),
    [
      JSON.stringify({ type: 'last-prompt' }),
      JSON.stringify({ type: 'mode' }),
      JSON.stringify({ type: 'permission-mode' }),
      JSON.stringify({ type: 'user', cwd }),
    ].join('\n') + '\n',
  )

  const found = await projectFor(cwd)

  expect(found?.dir).toBe(projectDir)
})

test('projectFor rejects the encoded guess when its transcript records a different cwd', async () => {
  // This is the failure the function exists to prevent: the encoded name
  // happens to exist, but it belongs to a different project.
  const cwd = '/root/actually-somebody-elses-project'
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'session-1.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: '/root/a-completely-different-project' })}\n`,
  )

  const found = await projectFor(cwd)

  expect(found).toBeNull()
})

test('projectFor accepts the encoded guess when no cwd is recoverable anywhere in its transcript', async () => {
  // Refusing here would make Minos report nothing on a legitimate store just
  // because a transcript happens to be short or unusual; the encoding having
  // matched is itself evidence.
  const cwd = '/root/no-cwd-anywhere'
  const projectDir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'session-1.jsonl'),
    [JSON.stringify({ type: 'last-prompt' }), JSON.stringify({ type: 'mode' })].join('\n') + '\n',
  )

  const found = await projectFor(cwd)

  expect(found?.dir).toBe(projectDir)
})

test('projectFor does not throw when a candidate transcript cannot be read as a file, and keeps scanning', async () => {
  const cwd = '/root/nothing-matches-here'

  // A ".jsonl"-named entry that is actually a directory: sessionFiles lists
  // it as a candidate (it only checks the name), but reading it as a file
  // throws. Neither this nor the other candidate below matches cwd, so the
  // scan has to run to completion and actually reach this one, rather than
  // returning early before it is read.
  const unreadableDir = join(root, 'projects', '-root-unreadable-candidate')
  await mkdir(join(unreadableDir, 'session-1.jsonl'), { recursive: true })

  const unrelatedDir = join(root, 'projects', '-root-unrelated-candidate')
  await mkdir(unrelatedDir, { recursive: true })
  await writeFile(
    join(unrelatedDir, 'session-1.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: '/root/somewhere-else' })}\n`,
  )

  const found = await projectFor(cwd)

  expect(found).toBeNull()
})

test('projectFor accepts the encoded directory when a newer transcript records the cwd and the oldest records an older path', async () => {
  const cwd = '/home/tim/site'
  const dir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'old.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/root/site' })}\n`)
  await writeFile(join(dir, 'new.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)
  await utimes(join(dir, 'old.jsonl'), new Date('2024-01-01'), new Date('2024-01-01'))
  await utimes(join(dir, 'new.jsonl'), new Date('2024-06-01'), new Date('2024-06-01'))

  expect(await projectFor(cwd)).toEqual({ dir, cwds: ['/home/tim/site', '/root/site'], files: [join(dir, 'old.jsonl'), join(dir, 'new.jsonl')] })
})

test('projectFor finds a moved project through the fallback scan when the newest transcript records the cwd', async () => {
  const cwd = '/home/tim/site'
  const dir = join(root, 'projects', '-unrelated-name')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'old.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/root/site' })}\n`)
  await writeFile(join(dir, 'new.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)
  await utimes(join(dir, 'old.jsonl'), new Date('2024-01-01'), new Date('2024-01-01'))
  await utimes(join(dir, 'new.jsonl'), new Date('2024-06-01'), new Date('2024-06-01'))

  expect((await projectFor(cwd))?.dir).toBe(dir)
})

test('projectFor accepts the guess when no transcript records a cwd', async () => {
  const cwd = '/home/tim/quiet'
  const dir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.jsonl'), `${JSON.stringify({ type: 'mode' })}\n`)

  expect(await projectFor(cwd)).toEqual({ dir, cwds: [], files: [join(dir, 'a.jsonl')] })
})

test('projectFor rejects the guess when every recovered cwd differs', async () => {
  const cwd = '/home/tim/site'
  const dir = join(root, 'projects', encodeProjectSlug(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/elsewhere' })}\n`)

  expect(await projectFor(cwd)).toBeNull()
})

test('recordedCwds returns each distinct cwd once, sorted, and nothing for a missing directory or file', async () => {
  const dir = join(root, 'projects', '-any')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.jsonl'), `${JSON.stringify({ cwd: '/root/site' })}\n`)
  await writeFile(join(dir, 'b.jsonl'), `${JSON.stringify({ cwd: '/home/tim/site' })}\n`)
  await writeFile(join(dir, 'c.jsonl'), `${JSON.stringify({ cwd: '/root/site' })}\n`)

  expect(await recordedCwds(await sessionFiles(dir))).toEqual(['/home/tim/site', '/root/site'])
  expect(await recordedCwds(await sessionFiles(join(root, 'projects', '-missing')))).toEqual([])
  expect(await recordedCwds([join(dir, 'gone.jsonl')])).toEqual([])
})

test('the fallback scan stops at the first directory that matches: no later directory is read', async () => {
  const cwd = '/home/tim/scan-stop'
  const first = join(root, 'projects', '-a-first')
  const later = join(root, 'projects', '-b-later')
  await mkdir(first, { recursive: true })
  await mkdir(later, { recursive: true })
  await writeFile(join(first, 'one.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)
  await writeFile(join(later, 'two.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)
  const opened = spyOn(Bun, 'file')
  try {
    expect((await projectFor(cwd))?.dir).toBe(first)
    const paths = opened.mock.calls.map(([p]) => String(p))
    expect(paths.some((p) => p.startsWith(first))).toBe(true)
    expect(paths.some((p) => p.startsWith(later))).toBe(false)
  } finally {
    opened.mockRestore()
  }
})

test('the fallback scan accepts a directory whose newest transcript matches though an older one cannot be read', async () => {
  const cwd = '/home/tim/scan-unreadable'
  const dir = join(root, 'projects', '-moved')
  await mkdir(join(dir, 'old.jsonl'), { recursive: true })
  await writeFile(join(dir, 'new.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`)
  await utimes(join(dir, 'old.jsonl'), new Date('2024-01-01'), new Date('2024-01-01'))
  await utimes(join(dir, 'new.jsonl'), new Date('2024-06-01'), new Date('2024-06-01'))
  expect(await projectFor(cwd)).toEqual({ dir, cwds: [cwd], files: [join(dir, 'old.jsonl'), join(dir, 'new.jsonl')] })
})

import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { subagentToolUseId } from '../src/paths'
import { PromptIndex } from '../src/prompts'
import { analyseSession } from '../src/session'

const store = async (): Promise<string> => mkdtemp(join(tmpdir(), 'minos-attr-'))

test('the sidecar beside a subagent transcript gives up the call that spawned it', async () => {
  const dir = await store()
  await writeFile(join(dir, 'agent-a1.jsonl'), '')
  await writeFile(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_01ABC' }))
  expect(await subagentToolUseId(join(dir, 'agent-a1.jsonl'))).toBe('toolu_01ABC')
  await rm(dir, { recursive: true, force: true })
})

test('a sidecar that is missing, malformed, or carries no usable id reads as no link at all', async () => {
  const dir = await store()
  await writeFile(join(dir, 'agent-none.jsonl'), '')

  await writeFile(join(dir, 'agent-bad.jsonl'), '')
  await writeFile(join(dir, 'agent-bad.meta.json'), '{ not json')

  // A workflow-nested subagent: the sidecar exists but records no spawning call.
  await writeFile(join(dir, 'agent-wf.jsonl'), '')
  await writeFile(join(dir, 'agent-wf.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', toolUseId: null }))

  expect(await subagentToolUseId(join(dir, 'agent-none.jsonl'))).toBe(null)
  expect(await subagentToolUseId(join(dir, 'agent-bad.jsonl'))).toBe(null)
  expect(await subagentToolUseId(join(dir, 'agent-wf.jsonl'))).toBe(null)
  await rm(dir, { recursive: true, force: true })
})

test('a tool call id resolves to the record that emitted it', () => {
  const index = new PromptIndex()
  index.observe({
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    message: { content: [{ type: 'tool_use', id: 'toolu_01ABC', name: 'Agent', input: {} }] },
  })
  expect(index.recordForToolUse('toolu_01ABC')).toBe('a1')
  expect(index.recordForToolUse('toolu_NOPE')).toBe(null)
})

/**
 * Builds a store holding one session that spawns a subagent, and returns the
 * paths analyseSession needs. `linked` decides whether the sidecar names the
 * spawning call, which is the whole difference between an attributed subagent
 * change and an unattributed one.
 */
const spawningSession = async (linked: boolean): Promise<{ transcript: string; subagents: string[] }> => {
  const dir = await store()
  const main = [
    {
      type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', promptSource: 'typed',
      permissionMode: 'default', timestamp: '2026-09-07T19:00:00Z', sessionId: 's1', cwd: '/repo',
      gitBranch: 'main', message: { content: 'audit the dark mode' },
    },
    {
      type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-07T19:01:00Z', isSidechain: false,
      message: { content: [{ type: 'tool_use', id: 'toolu_SPAWN', name: 'Agent', input: { description: 'audit' } }] },
    },
  ]
  await writeFile(join(dir, 's1.jsonl'), main.map((r) => JSON.stringify(r)).join('\n'))

  const subDir = join(dir, 's1', 'subagents')
  await mkdir(subDir, { recursive: true })
  const sub = [
    {
      type: 'assistant', uuid: 'sa1', parentUuid: null, timestamp: '2026-09-07T19:02:00Z', isSidechain: true,
      message: { content: [{ type: 'tool_use', id: 't-sa1', name: 'Edit', input: { file_path: '/repo/src/theme.ts', old_string: 'light', new_string: 'dark' } }] },
    },
  ]
  await writeFile(join(subDir, 'agent-x.jsonl'), sub.map((r) => JSON.stringify(r)).join('\n'))
  await writeFile(join(subDir, 'agent-x.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: linked ? 'toolu_SPAWN' : null }))

  return { transcript: join(dir, 's1.jsonl'), subagents: [join(subDir, 'agent-x.jsonl')] }
}

test('a subagent change is attributed to the prompt behind the call that spawned it', async () => {
  const report = await analyseSession(await spawningSession(true))

  const op = report.operations.find((o) => o.file === '/repo/src/theme.ts')
  expect(op?.promptId).toBe('p1')
  expect(report.unattributedCount).toBe(0)
  expect(report.byPrompt[0]?.files).toBe(1)
})

test('attribution does not move a subagent change out of the subagent class', async () => {
  const report = await analyseSession(await spawningSession(true))

  // The diff never reached the terminal whichever prompt caused it, so the
  // label must not soften just because the change can now be attributed.
  const op = report.operations.find((o) => o.file === '/repo/src/theme.ts')
  expect(op?.attestation).toBe('subagent')
  expect(report.totals.subagent.files).toBe(1)
  expect(report.totals.decided.files).toBe(0)
})

test('a subagent whose sidecar names no spawning call stays unattributed', async () => {
  const report = await analyseSession(await spawningSession(false))

  const op = report.operations.find((o) => o.file === '/repo/src/theme.ts')
  expect(op?.promptId).toBe(null)
  expect(op?.attestation).toBe('subagent')
  expect(report.unattributedCount).toBe(1)
})

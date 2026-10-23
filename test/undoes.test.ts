import { afterEach, beforeEach, expect, test } from 'bun:test'
import { endedBy, parseProposed, runUndoes } from '../src/commands/undoes'
import type { SessionReport } from '../src/session'
import type { Attestation, Operation } from '../src/types'

const originalTz = process.env.TZ
beforeEach(() => {
  process.env.TZ = 'UTC'
})
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

function op(id: string, over: Partial<Operation> = {}): Operation {
  return {
    file: '/r/src/a.ts',
    kind: 'edit',
    at: '2026-10-23T18:52:00Z',
    uuid: `u-${id}`,
    toolUseId: id,
    permissionMode: 'acceptEdits',
    promptId: null,
    attestation: 'auto' as Attestation,
    oldString: null,
    newString: null,
    replaceAll: false,
    content: null,
    ...over,
  }
}

function report(operations: Operation[]): SessionReport {
  return {
    sessionId: 's1',
    cwd: '/r',
    branch: 'main',
    prompts: [{ id: 'p2', index: 2, uuid: 'x', text: 'go', at: '2026-10-23T18:50:00Z', permissionMode: 'acceptEdits' }],
    totals: {
      decided: { files: 0, added: 0, removed: 0 },
      auto: { files: 0, added: 0, removed: 0 },
      subagent: { files: 0, added: 0, removed: 0 },
    },
    undone: [],
    unrecognisedModes: [],
    skippedLines: 0,
    startedAt: '2026-10-23T18:50:00Z',
    endedAt: null,
    byPrompt: [],
    largestAuto: [],
    filesTouched: 0,
    unattributedCount: 0,
    operations,
    shellWrites: [],
    undatedDropped: 0,
    undatedShellWrites: 0,
    failedChanges: [],
  }
}

const earlier = (): Operation => op('t1', { oldString: 'x', newString: 'y', promptId: 'p2' })

test('an edit that removes text an earlier edit added ends that change', () => {
  const ended = endedBy(report([earlier()]), { kind: 'edit', file: '/r/src/a.ts', old_string: 'y', new_string: 'z' })
  expect(ended).toHaveLength(1)
  expect(ended[0]).toMatchObject({ file: '/r/src/a.ts', kind: 'overwritten', introducedPrompt: 2, introducedAt: '2026-10-23T18:52:00Z' })
  expect(ended[0]?.note).toBe('Minos: this replaced the change to src/a.ts made at 18:52 for prompt 2')
})

test('a write that drops an earlier edit text ends it as discarded', () => {
  const ended = endedBy(report([earlier()]), { kind: 'write', file: '/r/src/a.ts', content: 'nothing of it' })
  expect(ended.map((e) => e.kind)).toEqual(['discarded'])
  expect(ended[0]?.note).toContain('Minos: this discarded the change to src/a.ts')
})

test('a revert reads as reverted', () => {
  const ended = endedBy(report([earlier()]), { kind: 'edit', file: '/r/src/a.ts', old_string: 'y', new_string: 'x' })
  expect(ended.map((e) => e.kind)).toEqual(['reverted'])
  expect(ended[0]?.note).toStartWith('Minos: this reverted the change to')
})

test('a change with no resolvable prompt is unattributed, and a file outside the cwd keeps its path', () => {
  const o = op('t1', { file: '/elsewhere/b.ts', oldString: 'x', newString: 'y' })
  const ended = endedBy(report([o]), { kind: 'edit', file: '/elsewhere/b.ts', old_string: 'y', new_string: 'z' })
  expect(ended[0]?.introducedPrompt).toBeNull()
  expect(ended[0]?.note).toBe('Minos: this replaced the change to /elsewhere/b.ts made at 18:52 for (unattributed)')
})

test('a change to a file the session never touched ends nothing', () => {
  expect(endedBy(report([earlier()]), { kind: 'edit', file: '/r/other.ts', old_string: 'y', new_string: 'z' })).toEqual([])
})

test('a call the transcript already holds is not counted twice', () => {
  const second = op('t2', { at: '2026-10-23T18:58:00Z', oldString: 'y', newString: 'z' })
  const ended = endedBy(report([earlier(), second]), { kind: 'edit', file: '/r/src/a.ts', old_string: 'y', new_string: 'z' })
  expect(ended).toHaveLength(1)
  expect(ended[0]?.kind).toBe('overwritten')
})

test('parseProposed rejects malformed JSON and a missing kind or file', () => {
  expect(parseProposed('{nope')).toBeNull()
  expect(parseProposed('null')).toBeNull()
  expect(parseProposed('{"file":"/x"}')).toBeNull()
  expect(parseProposed('{"kind":"edit"}')).toBeNull()
  expect(parseProposed('{"kind":"edit","file":"/x","replace_all":true}')?.replace_all).toBe(true)
})

test('runUndoes exits 2 on a bad change without reading the session', async () => {
  const r = await runUndoes({ transcript: '/nonexistent', subagents: [] }, 'x')
  expect(r).toEqual({ code: 2, out: 'minos: undoes reads one change as JSON on stdin' })
})

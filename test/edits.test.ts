import { expect, test } from 'bun:test'
import { fileEdits } from '../src/edits'
import type { SessionReport } from '../src/session'
import type { Attestation, Operation } from '../src/types'

function op(id: string, over: Partial<Operation> = {}): Operation {
  return {
    file: '/r/a.ts', kind: 'edit', at: '2026-10-23T18:52:00Z', uuid: `u-${id}`, toolUseId: id, permissionMode: 'acceptEdits',
    promptId: 'p1', attestation: 'auto' as Attestation, oldString: null, newString: null, replaceAll: false, content: null, ...over,
  }
}

const report = (operations: Operation[]): SessionReport => ({
  sessionId: 's', cwd: '/r', branch: 'main',
  prompts: [{ id: 'p1', index: 1, uuid: 'x', text: 'go', at: '2026-10-23T18:50:00Z', permissionMode: 'acceptEdits' }],
  totals: { decided: { files: 0, changes: 0, added: 0, removed: 0 }, auto: { files: 0, changes: 0, added: 0, removed: 0 }, subagent: { files: 0, changes: 0, added: 0, removed: 0 } },
  undone: [], unrecognisedModes: [], skippedLines: 0, startedAt: null, endedAt: null, byPrompt: [], largestAuto: [],
  filesTouched: 0, unattributedCount: 0, operations, shellWrites: [], undatedDropped: 0, undatedShellWrites: 0, failedChanges: [],
})

const all = () => true

test('a write is drawn as its whole content added, numbered from line 1', () => {
  const [e] = fileEdits(report([op('t1', { kind: 'write', content: 'one\ntwo\n' })]), all)
  expect(e).toMatchObject({ kind: 'write', numbered: true, cut: 0, prompt: 'prompt 1', attestation: 'auto' })
  expect(e!.diff).toBe('@@ -1,0 +1,2 @@\n+one\n+two')
})

test('an edit after a write lands at the line the replay found it on', () => {
  const ops = [op('t1', { kind: 'write', content: 'a\nb\nc\n' }), op('t2', { at: '2026-10-23T18:53:00Z', oldString: 'c', newString: 'C\nD' })]
  const [, e] = fileEdits(report(ops), all)
  expect(e!.diff).toBe('@@ -3,1 +3,2 @@\n-c\n+C\n+D')
  expect(e!.at).toBe('18:53')
})

test('an edit to a file the session never read whole is not given a line number', () => {
  const [e] = fileEdits(report([op('t1', { oldString: '  x', newString: '  y' })]), all)
  expect(e!.numbered).toBe(false)
  // Indentation stays: code is drawn as written.
  expect(e!.diff).toBe('-  x\n+  y')
})

test('a long change is cut and says how much, and control characters are stripped', () => {
  const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
  const [e] = fileEdits(report([op('t1', { kind: 'write', content: `${long}\n\u001b[31mred` })]), all)
  expect(e!.cut).toBe(11)
  expect(e!.diff.split('\n')).toHaveLength(41)
  const [f] = fileEdits(report([op('t2', { oldString: 'a', newString: '‮b' })]), all)
  expect(f!.diff).toBe('-a\n+b')
})

test('only the matching files are returned', () => {
  const ops = [op('t1', { file: '/r/a.ts', oldString: 'a', newString: 'b' }), op('t2', { file: '/r/b.ts', oldString: 'a', newString: 'b' })]
  expect(fileEdits(report(ops), (f) => f.endsWith('/b.ts'))).toHaveLength(1)
})

test('lines an edit only carried for context are drawn as context, not as removed and added again', () => {
  const ops = [op('t1', { kind: 'write', content: 'a\nb\nc\nd\n' }), op('t2', { at: '2026-10-23T18:53:00Z', oldString: 'b\nc\nd', newString: 'b\nC\nd' })]
  const [, e] = fileEdits(report(ops), all)
  expect(e!.diff).toBe('@@ -2,3 +2,3 @@\n b\n-c\n+C\n d')
})

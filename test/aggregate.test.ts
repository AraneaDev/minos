import { expect, test } from 'bun:test'
import { aggregate } from '../src/aggregate'
import { renderAll } from '../src/commands/all'
import type { SessionReport } from '../src/session'
import type { Attestation, Operation } from '../src/types'
import type { Window } from '../src/window'

const NO_WINDOW: Window = { since: null, until: null }

function op(id: string, over: Partial<Operation> = {}): Operation {
  return {
    file: '/r/a.ts',
    kind: 'edit',
    at: '2026-09-22T10:00:00Z',
    uuid: `u-${id}`,
    toolUseId: id,
    permissionMode: 'default',
    promptId: null,
    attestation: 'decided' as Attestation,
    oldString: null,
    newString: null,
    replaceAll: false,
    content: null,
    ...over,
  }
}

function report(operations: Operation[], over: Partial<SessionReport> = {}): SessionReport {
  return {
    sessionId: 's',
    cwd: '/r',
    branch: 'main',
    prompts: [],
    totals: {} as SessionReport['totals'],
    undone: [],
    unrecognisedModes: [],
    skippedLines: 0,
    startedAt: operations[0]?.at ?? null,
    endedAt: operations.at(-1)?.at ?? null,
    byPrompt: [],
    largestAuto: [],
    filesTouched: 0,
    unattributedCount: 0,
    operations,
    shellWrites: [],
    undatedDropped: 0,
    undatedShellWrites: 0,
    failedChanges: [],
    ...over,
  }
}

const one = (reports: SessionReport[], window = NO_WINDOW) =>
  aggregate([{ dir: 'p', cwds: ['/r'], reports }], window, 0)

test('counts a session that spans the window boundary only for its in-window changes', () => {
  const r = report([
    op('t1', { at: '2026-09-21T23:00:00Z', attestation: 'auto' }),
    op('t2', { at: '2026-09-22T10:00:00Z', attestation: 'auto' }),
  ])
  const a = one([r], { since: '2026-09-22', until: null })
  expect(a.total.changes.auto).toBe(1)
  expect(a.total.sessions).toBe(1)
})

test('deduplicates operations shared by a fork and its parent, and says how many it dropped', () => {
  const parent = report([op('t1'), op('t2')], { sessionId: 'p' })
  const fork = report([op('t1'), op('t2'), op('t3')], { sessionId: 'f' })
  const a = one([parent, fork])
  expect(a.total.changes.decided).toBe(3)
  expect(a.duplicatesDropped).toBe(2)
  expect(a.projects[0]!.changes.decided).toBe(3)
})

test('deduplicates subagent operations copied into a fork', () => {
  const sub = op('t1', { attestation: 'subagent' })
  const a = one([report([sub], { sessionId: 'p' }), report([sub, op('t2')], { sessionId: 'f' })])
  expect(a.total.changes.subagent).toBe(1)
  expect(a.duplicatesDropped).toBe(1)
})

test('deduplicates across projects in the total only', () => {
  const a = aggregate(
    [
      { dir: 'a', cwds: ['/a'], reports: [report([op('t1')])] },
      { dir: 'b', cwds: ['/b'], reports: [report([op('t1')])] },
    ],
    NO_WINDOW,
    0,
  )
  expect(a.total.changes.decided).toBe(1)
  expect(a.duplicatesDropped).toBe(1)
  expect(a.projects.map((p) => p.changes.decided)).toEqual([1, 1])
})

test('drops operations without a timestamp from a window and counts them', () => {
  const r = report([op('t1', { at: '' }), op('t2')])
  const windowed = one([r], { since: '2026-09-01', until: null })
  expect(windowed.total.changes.decided).toBe(1)
  expect(windowed.undatedDropped).toBe(1)
  const open = one([r])
  expect(open.total.changes.decided).toBe(2)
  expect(open.undatedDropped).toBe(0)
})

test('breaks auto changes down per recorded mode, keeping unknown apart', () => {
  const modes = ['acceptEdits', 'auto', null, 'weird']
  const r = report(modes.map((m, i) => op(`t${i}`, { attestation: 'auto', permissionMode: m })))
  const a = one([r])
  expect(a.total.autoModes).toEqual({ acceptEdits: 1, auto: 1, unknown: 1, weird: 1 })
  expect(a.projects[0]!.autoModes).toEqual(a.total.autoModes)
})

test('counts undone by the introducing change, deduplicated', () => {
  const intro = op('t1', { attestation: 'auto' })
  const undoneBy = op('t2', { attestation: 'auto' })
  const finding = { file: '/r/a.ts', kind: 'reverted' as const, line: null, introduced: intro, undoneBy }
  const parent = report([intro, undoneBy], { undone: [finding] })
  const fork = report([intro, undoneBy], { undone: [finding] })
  expect(one([parent, fork]).total.changes.undone).toBe(1)
  const outside = one([parent], { since: '2026-10-01', until: null })
  expect(outside.total.changes.undone).toBe(0)
})

test('reports the oldest and newest transcript seen, independent of the window', () => {
  const early = report([op('t1', { at: '2026-01-05T00:00:00Z' })])
  const late = report([op('t2', { at: '2026-09-22T10:00:00Z' })])
  const a = one([late, early], { since: '2026-09-01', until: null })
  expect(a.oldestTranscript).toBe('2026-01-05T00:00:00Z')
  expect(a.newestTranscript).toBe('2026-09-22T10:00:00Z')
  expect(a.total.sessions).toBe(1)
})

test('sorts projects by total changes and carries the empty-directory count', () => {
  const a = aggregate(
    [
      { dir: 'small', cwds: ['/s'], reports: [report([op('t1')])] },
      { dir: 'big', cwds: ['/b'], reports: [report([op('t2'), op('t3')])] },
    ],
    NO_WINDOW,
    4,
  )
  expect(a.projects.map((p) => p.dir)).toEqual(['big', 'small'])
  expect(a.total.dir).toBe('(all)')
  expect(a.total.cwds).toEqual(['/b', '/s'])
  expect(a.emptyProjectDirs).toBe(4)
  expect(a.total.firstAt).not.toBeNull()
})

test('does not count duplicates of operations outside the window', () => {
  const old = op('t1', { at: '2026-01-05T00:00:00Z' })
  const a = one([report([old], { sessionId: 'p' }), report([old], { sessionId: 'f' })], {
    since: '2026-09-01',
    until: null,
  })
  expect(a.duplicatesDropped).toBe(0)
})

test('keeps a project span to its counted sessions', () => {
  const old = report([op('t1', { at: '2026-01-05T00:00:00Z' })])
  const recent = report([op('t2', { at: '2026-09-22T10:00:00Z' })])
  const a = one([old, recent], { since: '2026-09-01', until: null })
  expect(a.projects[0]!.firstAt).toBe('2026-09-22T10:00:00Z')
  expect(a.total.firstAt).toBe('2026-09-22T10:00:00Z')
  expect(a.oldestTranscript).toBe('2026-01-05T00:00:00Z')
})

test('shell writes are counted apart from the classes, once by tool_use id, inside the window', () => {
  const w = (id: string, at: string, attestation: Attestation) => ({ toolUseId: id, at, attestation })
  const a = one(
    [
      report([], { shellWrites: [w('s1', '2026-09-22T10:00:00Z', 'auto'), w('s2', '2026-09-21T10:00:00Z', 'auto')] }),
      report([], { shellWrites: [w('s1', '2026-09-22T10:00:00Z', 'auto'), w('s3', '2026-09-23T10:00:00Z', 'subagent')] }),
    ],
    { since: '2026-09-22', until: null },
  )
  expect(a.total.possiblyUnseenWrites).toEqual({ decided: 0, auto: 1, subagent: 1 })
  expect(a.total.possiblyUnseenWritesNote).toContain('loose heuristic')
  expect(a.total.changes).toEqual({ decided: 0, auto: 0, subagent: 0, undone: 0 })
})

test('counts a session whose span straddles a narrow window with no change inside it', () => {
  const r = report([
    op('t1', { at: '2026-09-20T10:00:00Z', attestation: 'auto' }),
    op('t2', { at: '2026-09-25T10:00:00Z', attestation: 'auto' }),
  ])
  const a = one([r], { since: '2026-09-22', until: '2026-09-23' })
  expect(a.total.sessions).toBe(1)
  expect(a.total.changes.auto).toBe(0)
})

test('does not count a session with no known start or end and no change in the window', () => {
  const r = report([], { startedAt: null, endedAt: null })
  expect(one([r], { since: '2026-09-22', until: null }).total.sessions).toBe(0)
})

test('counts undated shell writes apart under a window, per project and in the total, and none without one', () => {
  const w = (id: string, at: string) => ({ toolUseId: id, at, attestation: 'auto' as Attestation })
  const r = report([], { startedAt: '2026-09-22T10:00:00Z', shellWrites: [w('s1', ''), w('s2', 'garbage'), w('s3', '2026-09-22T10:00:00Z')] })
  const fork = report([], { startedAt: '2026-09-22T10:00:00Z', shellWrites: [w('s1', '')] })
  const windowed = one([r, fork], { since: '2026-09-22', until: null })
  expect(windowed.total.possiblyUnseenWrites.auto).toBe(1)
  expect(windowed.total.undatedShellWrites).toBe(2)
  expect(windowed.projects[0]!.undatedShellWrites).toBe(2)
  const open = one([r])
  expect(open.total.possiblyUnseenWrites.auto).toBe(3)
  expect(open.total.undatedShellWrites).toBe(0)
})

test('an undone change copied into two projects counts in each row and once in the total', () => {
  const intro = op('t1', { attestation: 'auto' })
  const undoneBy = op('t2', { attestation: 'auto' })
  const finding = { file: '/r/a.ts', kind: 'reverted' as const, line: null, introduced: intro, undoneBy }
  const a = aggregate(
    [
      { dir: 'a', cwds: ['/a'], reports: [report([intro, undoneBy], { undone: [finding] })] },
      { dir: 'b', cwds: ['/b'], reports: [report([intro, undoneBy], { undone: [finding] })] },
    ],
    NO_WINDOW,
    0,
  )
  expect(a.projects.map((p) => p.changes.undone)).toEqual([1, 1])
  expect(a.total.changes.undone).toBe(1)
})

test('an undone change with no readable timestamp is not counted under a window', () => {
  const intro = op('t1', { attestation: 'auto', at: '' })
  const undoneBy = op('t2', { attestation: 'auto' })
  const finding = { file: '/r/a.ts', kind: 'reverted' as const, line: null, introduced: intro, undoneBy }
  const r = report([intro, undoneBy], { undone: [finding], startedAt: '2026-09-22T10:00:00Z' })
  expect(one([r], { since: '2026-09-01', until: null }).total.changes.undone).toBe(0)
  expect(one([r]).total.changes.undone).toBe(1)
})

test('counts failed changes apart, once by tool_use id, inside the window', () => {
  const failed = [
    { toolUseId: 'f1', at: '2026-09-22T10:00:00Z' },
    { toolUseId: 'f2', at: '2026-09-21T10:00:00Z' },
  ]
  const a = one([report([], { failedChanges: failed }), report([], { failedChanges: [failed[0]!] })], { since: '2026-09-22', until: null })
  expect(a.failedDropped).toBe(1)
  expect(a.total.changes).toEqual({ decided: 0, auto: 0, subagent: 0, undone: 0 })
})

test('renderAll says how many failed changes it left out, and nothing when there are none', () => {
  const failed = report([], { failedChanges: [{ toolUseId: 'f1', at: '2026-09-22T10:00:00Z' }] })
  expect(renderAll(one([failed]))).toContain('left out 1 change whose tool call failed or was refused, so nothing was written')
  expect(renderAll(one([report([op('t1')])]))).not.toContain('failed or was refused')
})

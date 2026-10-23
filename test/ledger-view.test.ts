import { afterEach, beforeEach, expect, test } from 'bun:test'
import { DECIDED_NOTE } from '../src/caveats'
import { buildLedgerView, ledgerDisplay, ledgerLines, renderLedger } from '../src/ledger-view'
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
    file: '/r/a.ts',
    kind: 'edit',
    at: '2026-10-23T18:51:00Z',
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

function report(operations: Operation[], over: Partial<SessionReport> = {}): SessionReport {
  const files = (label: Attestation) => new Set(operations.filter((o) => o.attestation === label).map((o) => o.file)).size
  return {
    sessionId: '1a2b3c4d-0000',
    cwd: '/r',
    branch: 'main',
    prompts: [],
    totals: {
      decided: { files: files('decided'), added: 0, removed: 0 },
      auto: { files: files('auto'), added: 0, removed: 0 },
      subagent: { files: files('subagent'), added: 0, removed: 0 },
    },
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

const sample = (): SessionReport => {
  const first = op('t1', { file: '/r/a.ts', at: '2026-10-23T18:51:00Z', promptId: 'p2' })
  const second = op('t2', { file: '/r/a.ts', at: '2026-10-23T18:58:00Z' })
  const sub = op('t3', { file: '/r/b.ts', at: '2026-10-23T19:10:00Z', attestation: 'subagent' })
  return report([first, second, sub], {
    prompts: [{ id: 'p2', index: 2, uuid: 'x', text: 'go', at: '2026-10-23T18:50:00Z', permissionMode: 'acceptEdits' }],
    undone: [{ file: '/r/a.ts', kind: 'overwritten', line: null, introduced: first, undoneBy: second }],
  })
}

test('builds counts in the same units as minos sessions', () => {
  const view = buildLedgerView(sample())
  expect(view.counts).toEqual({ decided: 0, auto: 1, subagent: 1, undone: 1 })
  expect(view.sessionId).toBe('1a2b3c4d-0000')
  expect(view.decidedNote).toBe(DECIDED_NOTE)
  expect(view.undone).toEqual([
    { file: '/r/a.ts', kind: 'overwritten', introducedAt: '2026-10-23T18:51:00Z', introducedPrompt: 2, introducedRef: 'prompt 2', undoneAt: '2026-10-23T18:58:00Z' },
  ])
})

test('lists files changed without being asked, most recent first, never decided ones', () => {
  const ops = [
    op('t1', { file: '/r/a.ts', at: '2026-10-23T18:51:00Z' }),
    op('t2', { file: '/r/d.ts', at: '2026-10-23T18:52:00Z', attestation: 'decided' }),
    op('t3', { file: '/r/b.ts', at: '2026-10-23T18:53:00Z', attestation: 'subagent' }),
    op('t4', { file: '/r/a.ts', at: '2026-10-23T18:54:00Z' }),
  ]
  const view = buildLedgerView(report(ops))
  expect(view.unaskedFiles).toEqual([
    { file: '/r/a.ts', label: 'auto', changes: 2, lastAt: '2026-10-23T18:54:00Z' },
    { file: '/r/b.ts', label: 'subagent', changes: 1, lastAt: '2026-10-23T18:53:00Z' },
  ])
})

test('renders the counts, the units line, the file list and the undone list', () => {
  const text = renderLedger(buildLedgerView(sample()))
  // Since the first prompt, the origin minos report counts from, not the first record.
  expect(text).toContain('MINOS  ledger  session 1a2b3c4d  since 2026-10-23 18:50')
  expect(text).toContain('decided 0  auto 1  subagent 1  undone 1')
  expect(text).toContain('(decided, auto and subagent count files; undone counts changes)')
  expect(text).toContain('changed without being asked')
  expect(text).toMatch(/^ {2}b\.ts\s+subagent\s+1 change$/m)
  expect(text).toMatch(/^ {2}a\.ts\s+auto\s+2 changes$/m)
  expect(text).toContain('did not survive')
  expect(text).toMatch(/a\.ts\s+overwritten {2}18:51 \(prompt 2\), replaced 18:58/)
})

test('renders zeros, the units line and no file list for a session with no changes', () => {
  const text = renderLedger(buildLedgerView(report([])))
  expect(text).toContain('decided 0  auto 0  subagent 0  undone 0')
  expect(text).toContain('(decided, auto and subagent count files; undone counts changes)')
  expect(text).not.toContain('changed without being asked')
  expect(text).not.toContain('did not survive')
  expect(text).not.toContain('since')
})

test('prints the decided caveat only when decided > 0, and the failed line only when failedChanges > 0', () => {
  const plain = renderLedger(buildLedgerView(report([op('t1')])))
  expect(plain).not.toContain(DECIDED_NOTE)
  expect(plain).not.toContain('Left out')

  const failed = { file: '/r/x.ts', kind: 'edit', at: '2026-10-23T18:51:00Z', toolUseId: 'f1', promptId: null } as unknown as SessionReport['failedChanges'][number]
  const text = renderLedger(buildLedgerView(report([op('t1', { attestation: 'decided' })], { failedChanges: [failed] })))
  expect(text).toContain(DECIDED_NOTE)
  expect(text).toContain('Left out 1 change whose tool call failed or was refused, so nothing was written.')
})

test('sanitises file paths before printing', () => {
  const text = renderLedger(buildLedgerView(report([op('t1', { file: '/r/ev‮il.ts' })])))
  expect(text).not.toContain('‮')
  expect(text).toContain('  evil.ts')
})

test('orders undone changes most recent first and keeps the label of the latest change', () => {
  const a1 = op('t1', { file: '/r/a.ts', at: '2026-10-23T18:51:00Z' })
  const a2 = op('t2', { file: '/r/a.ts', at: '2026-10-23T18:52:00Z' })
  const b1 = op('t3', { file: '/r/b.ts', at: '2026-10-23T18:53:00Z', attestation: 'subagent' })
  const b2 = op('t4', { file: '/r/b.ts', at: '2026-10-23T18:54:00Z', attestation: 'subagent' })
  const view = buildLedgerView(
    report([b2, a1, a2, b1], {
      undone: [
        { file: '/r/a.ts', kind: 'reverted', line: null, introduced: a1, undoneBy: a2 },
        { file: '/r/b.ts', kind: 'discarded', line: null, introduced: b1, undoneBy: b2 },
      ],
    }),
  )
  expect(view.undone.map((u) => u.file)).toEqual(['/r/b.ts', '/r/a.ts'])
  expect(view.unaskedFiles.map((f) => [f.file, f.lastAt])).toEqual([
    ['/r/b.ts', '2026-10-23T18:54:00Z'],
    ['/r/a.ts', '2026-10-23T18:52:00Z'],
  ])
  expect(renderLedger(view)).toContain('(unattributed)')
})

test('prints paths inside the session directory relative to it and others in full', () => {
  const text = renderLedger(buildLedgerView(report([op('t1', { file: '/r/src/a.ts' }), op('t2', { file: '/elsewhere/b.ts' })])))
  expect(text).toMatch(/^ {2}src\/a\.ts +auto/m)
  expect(text).not.toContain('/r/src/a.ts')
  expect(text).toMatch(/^ {2}\/elsewhere\/b\.ts +auto/m)
})

test('keeps absolute files and the cwd in the data', () => {
  const view = buildLedgerView(report([op('t1', { file: '/r/src/a.ts' })]))
  expect(view.cwd).toBe('/r')
  expect(view.unaskedFiles[0]?.file).toBe('/r/src/a.ts')
})

test('truncates a long undone path with the ellipsis', () => {
  const file = `/r/${'deep/'.repeat(12)}file.ts`
  const a = op('t1', { file })
  const b = op('t2', { file })
  const text = renderLedger(buildLedgerView(report([a, b], { undone: [{ file, kind: 'reverted', line: null, introduced: a, undoneBy: b }] })))
  expect(text).toMatch(/^ {2}….*file\.ts +reverted/m)
  expect(text).not.toContain(file)
})

test('names each way a change ended with its own verb', () => {
  const r = sample()
  const u = r.undone[0]!
  for (const [kind, verb] of [['reverted', 'reverted'], ['discarded', 'discarded'], ['overwritten', 'replaced']] as const) {
    const text = renderLedger(buildLedgerView({ ...r, undone: [{ ...u, kind }] }))
    expect(text).toMatch(new RegExp(`${kind}  18:51 \\(prompt 2\\), ${verb} 18:58$`, 'm'))
  }
})

test('says No changes yet. for a session that changed nothing', () => {
  expect(renderLedger(buildLedgerView(report([])))).toContain('No changes yet.')
  expect(renderLedger(buildLedgerView(sample()))).not.toContain('No changes yet.')
})

test('names the lines a display should draw quietly', () => {
  const { dim } = ledgerLines({ ...buildLedgerView(sample()), counts: { decided: 1, auto: 0, subagent: 0, undone: 0 }, failedChanges: 1 })
  expect(dim).toContain('(decided, auto and subagent count files; undone counts changes)')
  expect(dim.some((l) => l.startsWith('decided is inferred'))).toBe(true)
  expect(dim.some((l) => l.startsWith('Left out 1 change'))).toBe(true)
})

test('the display strings carry the report wording, and the text form is laid out from them', () => {
  const view = buildLedgerView(sample())
  const d = ledgerDisplay(view)
  expect(d.since).toBe('2026-10-23 18:50')
  expect(d.files[0]).toEqual({ file: '/r/b.ts', shown: 'b.ts', label: 'subagent', changes: '1 change' })
  expect(d.undone[0]).toEqual({ shown: 'a.ts', kind: 'overwritten', verb: 'replaced', at: '18:51', prompt: 'prompt 2', endedAt: '18:58' })
  expect(d.empty).toBeNull()
  for (const f of d.files) expect(renderLedger(view)).toContain(f.shown)
})

test('a session whose only changes were decided is not called empty', () => {
  const view = { ...buildLedgerView(report([])), counts: { decided: 1, auto: 0, subagent: 0, undone: 0 } }
  expect(ledgerDisplay(view).empty).toBeNull()
  expect(renderLedger(view)).not.toContain('No changes yet.')
})

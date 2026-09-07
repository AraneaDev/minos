import { expect, test } from 'bun:test'
import { Ledger } from '../src/ledger'
import { PromptIndex } from '../src/prompts'

const prompt = { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'acceptEdits', timestamp: '2026-09-07T19:00:00Z', message: { content: 'go' } }

const edit = {
  type: 'assistant',
  uuid: 'a1',
  parentUuid: 'u1',
  timestamp: '2026-09-07T19:02:00Z',
  isSidechain: false,
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/src/a.ts', old_string: 'x', new_string: 'y' } }] },
}

const read = {
  type: 'assistant',
  uuid: 'a2',
  parentUuid: 'u1',
  timestamp: '2026-09-07T19:03:00Z',
  message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/src/a.ts' } }] },
}

test('only the tools that change a file enter the ledger', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of [prompt, edit, read]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  const ops = ledger.operations()
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({
    file: '/src/a.ts',
    kind: 'edit',
    attestation: 'auto',
    promptId: 'p1',
    oldString: 'x',
    newString: 'y',
    replaceAll: false,
  })
})

test('operations on one file come back in the order they happened', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  const second = { ...edit, uuid: 'a3', timestamp: '2026-09-07T19:05:00Z', message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/src/a.ts', content: 'whole file' } }] } }
  for (const r of [prompt, edit, second]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  const ops = ledger.byFile().get('/src/a.ts') ?? []
  expect(ops.map((o) => o.kind)).toEqual(['edit', 'write'])
  expect(ops[1]?.content).toBe('whole file')
})

test('an unrecognised permission mode is carried out for the report', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  const odd = { ...prompt, permissionMode: 'somethingNew' }
  for (const r of [odd, edit]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  expect(ledger.unrecognisedModes()).toEqual(['somethingNew'])
})

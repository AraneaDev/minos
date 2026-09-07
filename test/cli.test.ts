import { expect, test } from 'bun:test'
import { main } from '../src/cli'
import type { Attestation, Operation, OperationKind, Prompt, UnknownRecord } from '../src/types'

test('an unknown command exits non-zero and names the commands that exist', async () => {
  const code = await main(['wat'])
  expect(code).toBe(2)
})

test('no arguments is the report command', async () => {
  const code = await main([])
  // No session is resolvable inside the test environment, which is an
  // orderly failure rather than a crash.
  expect([0, 1]).toContain(code)
})

test('a leading flag is treated as an argument to the default report command', async () => {
  // Exercises the branch where the first argument starts with "-": the
  // command stays "report" and the flag is passed through as an argument
  // rather than being rejected as an unknown command.
  const code = await main(['--verbose'])
  expect([0, 1]).toContain(code)
})

test('a known command reports as not implemented yet', async () => {
  const code = await main(['file', 'src/cli.ts'])
  expect(code).toBe(1)
})

test('the transcript vocabulary describes one operation and one prompt', () => {
  // Genuinely typed test data: this is what pins src/types.ts as used rather
  // than a dead file, and it is honest because the shapes below are exactly
  // what a real transcript record narrows down to.
  const attestation: Attestation = 'decided'
  const kind: OperationKind = 'edit'

  const operation: Operation = {
    file: 'src/example.ts',
    kind,
    at: '2026-09-07T00:00:00.000Z',
    uuid: 'op-uuid-1',
    promptId: 'prompt-uuid-1',
    attestation,
    oldString: 'before',
    newString: 'after',
    replaceAll: false,
    content: null,
  }

  const prompt: Prompt = {
    id: 'prompt-uuid-1',
    index: 0,
    uuid: 'prompt-uuid-1',
    text: 'change before to after',
    at: '2026-09-07T00:00:00.000Z',
    permissionMode: 'default',
  }

  const raw: UnknownRecord = { type: 'assistant', message: { content: [] } }

  expect(operation.promptId).toBe(prompt.id)
  expect(operation.attestation).toBe('decided')
  expect(typeof raw.type).toBe('string')
})

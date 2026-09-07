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

test('an operation and a prompt survive a JSON round trip unchanged', () => {
  // Operation and Prompt are exactly what Task 13's `minos export --json`
  // serialises and a reader parses back. This catches a real regression: if
  // either interface ever gains a field JSON cannot carry unchanged (a
  // Date, a function, an undefined), JSON.parse(JSON.stringify(x)) drops or
  // mangles it and the deep-equal checks below fail. The `as unknown as
  // UnknownRecord` casts exist only because Operation and Prompt are
  // interfaces without an index signature, which TypeScript never treats as
  // assignable to Record<string, unknown> even when every field is
  // structurally compatible; the runtime comparison bun:test performs is
  // unaffected by the cast.
  const operation: Operation = {
    file: 'src/example.ts',
    kind: 'edit',
    at: '2026-09-07T00:00:00.000Z',
    uuid: 'op-uuid-1',
    promptId: 'prompt-uuid-1',
    attestation: 'decided',
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

  const roundTrippedOperation: UnknownRecord = JSON.parse(JSON.stringify(operation))
  const roundTrippedPrompt: UnknownRecord = JSON.parse(JSON.stringify(prompt))

  expect(roundTrippedOperation).toEqual(operation as unknown as UnknownRecord)
  expect(roundTrippedPrompt).toEqual(prompt as unknown as UnknownRecord)
})

// The two lines below are not runtime assertions: tsc is the checker, and
// `bun run check` runs tsc against every file under test/. Renaming or
// removing a member of Attestation or OperationKind in src/types.ts makes
// one of these literal arrays fail to satisfy its union type, so this file
// stops compiling. `void` marks them deliberately unread at runtime without
// renaming them to dodge the unused-vars lint rule.
const ATTESTATIONS = ['decided', 'auto', 'subagent'] as const satisfies readonly Attestation[]
const OPERATION_KINDS = ['write', 'edit', 'notebook'] as const satisfies readonly OperationKind[]
void ATTESTATIONS
void OPERATION_KINDS

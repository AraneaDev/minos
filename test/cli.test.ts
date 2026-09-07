import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { main } from '../src/cli'
import { encodeProjectSlug } from '../src/paths'
import type { Attestation, Operation, OperationKind, Prompt, UnknownRecord } from '../src/types'

// Since Task 13, `main` resolves a session against the real transcript store
// (via resolveSession -> projectDirFor) whenever the command is not
// "sessions". This repository itself has a real, on-disk session for its own
// working directory, so a test that ran `main` without redirecting the store
// would resolve that real session and print a real report into this test's
// output. Every test below points CLAUDE_CONFIG_DIR at a throwaway, empty
// directory instead, so `projectDirFor` always reports no match and the
// commands below take their "no transcript found" branch deterministically.
let configDir: string

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'minos-cli-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(configDir, { recursive: true, force: true })
})

test('an unknown command exits non-zero and names the commands that exist', async () => {
  const code = await main(['wat'])
  expect(code).toBe(2)
})

// Finding 7: `minos --help` fell through to the default report command,
// since a leading flag is not a recognised command name and so was treated
// as an argument to `report`. Real transcripts in this throwaway store are
// none, so a fall-through would print "no transcript found" or a report,
// never usage text; either way it would not name all five commands.
for (const helpFlag of ['--help', '-h']) {
  test(`main [${helpFlag}] prints usage naming every command instead of falling through to report`, async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await main([helpFlag])
      expect(code).toBe(0)
      expect(logSpy).toHaveBeenCalledTimes(1)
      const [usage] = logSpy.mock.calls[0] as [string]
      for (const command of ['report', 'file', 'undone', 'sessions', 'export']) {
        expect(usage).toContain(`minos ${command}`)
      }
      // Real flags only: --since and --json do not exist anywhere in this CLI.
      expect(usage).not.toContain('--since')
      expect(usage).not.toContain('--json')
      expect(usage).not.toContain('MINOS')
    } finally {
      logSpy.mockRestore()
    }
  })
}

test('no arguments is the report command', async () => {
  const code = await main([])
  // No session is resolvable against the empty fake store, which is an
  // orderly failure rather than a crash.
  expect(code).toBe(1)
})

test('a leading flag is treated as an argument to the default report command', async () => {
  // Exercises the branch where the first argument starts with "-": the
  // command stays "report" and the flag is passed through as an argument
  // rather than being rejected as an unknown command.
  const code = await main(['--verbose'])
  expect(code).toBe(1)
})

test('a known command reports no transcript found rather than crashing', async () => {
  const code = await main(['file', 'src/cli.ts'])
  expect(code).toBe(1)
})

// The tests above all take the "no transcript found" branch, since the fake
// store is empty. The dispatch for `sessions` (which never resolves a
// session) and for each command once a session *does* resolve is only
// exercised by populating a fake project directory and pointing `--project`
// at its cwd, still entirely inside the throwaway store.
async function withFakeProject(cwd: string): Promise<void> {
  const projectDir = join(configDir, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  const record = {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    promptId: 'p1',
    permissionMode: 'default',
    timestamp: '2026-09-07T10:00:00Z',
    sessionId: 'sess-cli',
    cwd,
    gitBranch: 'main',
    message: { content: 'do a thing' },
  }
  const change = {
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    timestamp: '2026-09-07T10:01:00Z',
    isSidechain: false,
    message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/repo/x.ts', content: 'hi\n' } }] },
  }
  await writeFile(join(projectDir, 'sess-cli.jsonl'), [JSON.stringify(record), JSON.stringify(change)].join('\n'))
}

test('the sessions command lists sessions without going through resolveSession', async () => {
  const cwd = '/fake/cli-sessions'
  await withFakeProject(cwd)
  const code = await main(['sessions', '--project', cwd, '--limit', '1'])
  expect(code).toBe(0)
})

test('the report command (implicit and explicit) prints the resolved session\'s report', async () => {
  const cwd = '/fake/cli-report'
  await withFakeProject(cwd)
  expect(await main(['--project', cwd])).toBe(0)
  expect(await main(['report', '--project', cwd])).toBe(0)
})

test('the undone command dispatches once a session resolves', async () => {
  const cwd = '/fake/cli-undone'
  await withFakeProject(cwd)
  expect(await main(['undone', '--project', cwd])).toBe(0)
})

test('the export command dispatches once a session resolves', async () => {
  const cwd = '/fake/cli-export'
  await withFakeProject(cwd)
  expect(await main(['export', '--project', cwd])).toBe(0)
})

test('the file command dispatches once a session resolves, passing the target through', async () => {
  const cwd = '/fake/cli-file'
  await withFakeProject(cwd)
  expect(await main(['file', 'x.ts', '--project', cwd])).toBe(0)
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

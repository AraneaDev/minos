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
      for (const name of ['--all', '--since', '--until']) expect(usage).toContain(name)
      expect(usage).toContain('minos ledger')
      expect(usage).toContain('--json')
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

// Finding 4: a session id that matched nothing reported "no transcript found
// for <cwd>", which is false whenever the project has transcripts and only
// the id was wrong. The two failures need different answers, since the fix
// for one (run `minos sessions` and pick an id) is not the fix for the other.
test('an unmatched --session names the session, not the project, and points at the sessions command', async () => {
  const cwd = '/fake/cli-unmatched-session'
  await withFakeProject(cwd)
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const code = await main(['report', '--project', cwd, '--session', 'nosuchid'])
    expect(code).toBe(1)
    const message = String((errorSpy.mock.calls[0] ?? [''])[0])
    expect(message).toContain('nosuchid')
    expect(message).toContain('minos sessions')
    expect(message).not.toContain('no transcript found')
  } finally {
    errorSpy.mockRestore()
  }
})

test('a project with no transcripts at all still reports the project, not a session id', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const code = await main(['report', '--project', '/fake/cli-nothing-here', '--session', 'nosuchid'])
    expect(code).toBe(1)
    expect(String((errorSpy.mock.calls[0] ?? [''])[0])).toContain('no transcript found')
  } finally {
    errorSpy.mockRestore()
  }
})

// Finding 5: `flag` read the next argument blindly, so `--session` at the end
// of the line silently reported the latest session instead, and
// `--session --project /x` took "--project" as the session id and then lost
// the project entirely. Both are typos that must not quietly report on
// something other than what was asked for.
for (const argv of [['report', '--session'], ['report', '--session', '--project', '/fake/cli-eaten']]) {
  test(`--session with no value is rejected rather than silently defaulting: ${argv.join(' ')}`, async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const code = await main(argv)
      expect(code).toBe(2)
      expect(String((errorSpy.mock.calls[0] ?? [''])[0])).toContain('--session')
    } finally {
      errorSpy.mockRestore()
    }
  })
}

test('--project with no value is rejected the same way', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(await main(['report', '--project'])).toBe(2)
  } finally {
    errorSpy.mockRestore()
  }
})

// Finding 7: `sessions` printed "no transcripts for <cwd>" on stdout and
// exited 0, while `report` printed the same condition on stderr and exited 1.
// A caller piping `minos sessions` into anything got an error message in the
// data and a success code to go with it.
test('sessions reports having found nothing on stderr with a non-zero exit, as report does', async () => {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const code = await main(['sessions', '--project', '/fake/cli-no-sessions'])
    expect(code).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(String((errorSpy.mock.calls[0] ?? [''])[0])).toContain('/fake/cli-no-sessions')
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }
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
    toolUseId: 't', permissionMode: null,
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

/** Runs main with stdout and stderr captured, returning the exit code and the first error line. */
async function capture(argv: string[]): Promise<{ code: number; error: string; out: string }> {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const code = await main(argv)
    return { code, error: String((errorSpy.mock.calls[0] ?? [''])[0]), out: String((logSpy.mock.calls[0] ?? [''])[0]) }
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }
}

// A malformed bound would reach `inWindow` as NaN and quietly drop every
// change, so the CLI rejects it before a Window exists.
for (const argv of [
  ['sessions', '--since', '2026-9-22'],
  ['export', '--since', '2026-13-01'],
  ['sessions', '--all', '--since', '2026-02-30'],
  ['sessions', '--since'],
]) {
  test(`a --since that is not a real YYYY-MM-DD day is rejected: ${argv.join(' ')}`, async () => {
    const { code, error, out } = await capture(argv)
    expect(code).toBe(2)
    expect(error).toBe('minos: --since must be YYYY-MM-DD')
    expect(out).toBe('')
  })
}

test('a malformed --until is rejected the same way', async () => {
  const { code, error } = await capture(['sessions', '--until', 'yesterday'])
  expect(code).toBe(2)
  expect(error).toBe('minos: --until must be YYYY-MM-DD')
})

test('a window whose start is after its end is rejected', async () => {
  const { code, error } = await capture(['sessions', '--since', '2026-10-02', '--until', '2026-10-01'])
  expect(code).toBe(2)
  expect(error).toBe('minos: --since is after --until')
})

for (const argv of [
  ['sessions', '--all', '--project', '/x'],
  ['export', '--all', '--session', 'abc'],
]) {
  test(`--all refuses a project or session: ${argv.join(' ')}`, async () => {
    const { code, error } = await capture(argv)
    expect(code).toBe(2)
    expect(error).toBe('minos: --all reports every project, so it takes no --project or --session')
  })
}

test('--all refuses a limit rather than silently ignoring it', async () => {
  const { code, error } = await capture(['sessions', '--all', '--limit', '3'])
  expect(code).toBe(2)
  expect(error).toBe('minos: --all lists every project, so it takes no --limit')
})

test('--all works only with sessions and export', async () => {
  const { code, error } = await capture(['report', '--all'])
  expect(code).toBe(2)
  expect(error).toBe('minos: --all works with sessions and export')
})

test('a window on a command that cannot apply it is rejected rather than ignored', async () => {
  const { code, error } = await capture(['undone', '--since', '2026-10-01'])
  expect(code).toBe(2)
  expect(error).toBe('minos: --since and --until work with sessions and export')
})

test('--all over a store with no transcripts says so on stderr', async () => {
  const { code, error, out } = await capture(['sessions', '--all'])
  expect(code).toBe(1)
  expect(error).toContain('no transcripts found under')
  expect(out).toBe('')
})

test('sessions --all and export --all dispatch once a project exists', async () => {
  await withFakeProject('/fake/cli-all')
  const text = await capture(['sessions', '--all', '--since', '2026-09-01', '--until', '2026-09-30'])
  expect(text.code).toBe(0)
  const lines = text.out.split('\n')
  expect(lines[0]).toBe('MINOS  all projects  window 2026-09-01 to 2026-09-30')
  expect(lines[3]).toBe('project        sessions  decided  auto  subagent  undone')
  expect(lines[4]).toBe('/fake/cli-all         1        1     0         0       0')
  expect(lines[5]).toBe('total                 1        1     0         0       0')
  expect(lines).toContain('auto by mode: none')
  const json = await capture(['export', '--all'])
  expect(json.code).toBe(0)
  expect(JSON.parse(json.out).total.changes.auto + JSON.parse(json.out).total.changes.decided).toBe(1)
})

test('export with a window dispatches and carries the window', async () => {
  await withFakeProject('/fake/cli-export-window')
  const { code, out } = await capture(['export', '--project', '/fake/cli-export-window', '--since', '2026-09-07'])
  expect(code).toBe(0)
  expect(JSON.parse(out).window).toEqual({ since: '2026-09-07', until: null })
})

test('--json on any command but ledger and sessions exits 2 and says so', async () => {
  const errSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(await main(['report', '--json'])).toBe(2)
    expect(errSpy).toHaveBeenCalledWith('minos: --json only applies to ledger and sessions')
  } finally {
    errSpy.mockRestore()
  }
})

test('minos ledger --json prints parseable JSON for the latest session', async () => {
  const cwd = '/root/fake-ledger-cli'
  const projectDir = join(configDir, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'sess-1.jsonl'),
    `${JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-10-23T18:51:00Z', cwd, sessionId: 'sess-1', message: { content: 'hi' } })}\n`,
  )
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await main(['ledger', '--json', '--project', cwd])).toBe(0)
    const view = JSON.parse((logSpy.mock.calls[0] as [string])[0])
    expect(view.sessionId).toBe('sess-1')
    expect(view.counts).toEqual({ decided: 0, auto: 0, subagent: 0, undone: 0 })
  } finally {
    logSpy.mockRestore()
  }
})

test('minos undoes exits 2 on malformed stdin and prints a JSON array for a valid change', async () => {
  const cwd = '/root/fake-undoes-cli'
  const projectDir = join(configDir, 'projects', encodeProjectSlug(cwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'sess-1.jsonl'),
    `${JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-10-23T18:51:00Z', cwd, sessionId: 'sess-1', message: { content: 'hi' } })}\n`,
  )
  const errSpy = spyOn(console, 'error').mockImplementation(() => {})
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await main(['undoes', '--project', cwd], async () => '{nope')).toBe(2)
    expect(errSpy).toHaveBeenCalledWith('minos: undoes reads one change as JSON on stdin')
    const change = JSON.stringify({ kind: 'edit', file: '/x', old_string: 'a', new_string: 'b' })
    expect(await main(['undoes', '--project', cwd], async () => change)).toBe(0)
    expect(JSON.parse((logSpy.mock.calls[0] as [string])[0])).toEqual([])
  } finally {
    errSpy.mockRestore()
    logSpy.mockRestore()
  }
})

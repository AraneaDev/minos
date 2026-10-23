import { expect, test } from 'claude-code/testing'

import { LEDGER, NOTE, engine, start } from './testkit'

const textOf = (r: unknown): string => JSON.stringify(r)

test('minos_ledger answers with the ledger the CLI prints for this session', async ($, on) => {
  const { runs } = engine(on, () => ({ exitCode: 0, stdout: 'MINOS  ledger  session sess-1\n' }))
  await start($)
  const answer = await $.tool.call({ tool: LEDGER })
  // The engine accepts a string, an array of blocks or nothing as a plugin tool's result; an object is refused.
  expect(typeof answer.result).toBe('string')
  expect(answer.result).toContain('MINOS  ledger  session sess-1')
  expect(runs[0]!.argv[0]).toBe('bun')
  expect(runs[0]!.argv.slice(2)).toEqual(['ledger', '--session', 'sess-1', '--project', '/repo'])
})

test('minos_ledger says in words why Minos could not run', async ($, on) => {
  engine(on, () => new Error('spawn bun ENOENT'))
  await start($)
  // A run that rejects reaches the plugin as a rejection; its wording is the engine's, so only the frame is pinned.
  const answer = await $.tool.call({ tool: LEDGER })
  expect(typeof answer.result).toBe('string')
  expect(answer.result).toContain('Minos could not read this session: ')
})

test("an unknown session id falls back to the project's newest session", async ($, on) => {
  const { runs } = engine(on, (run) =>
    run.argv.includes('--session')
      ? { exitCode: 1, stderr: 'minos: no session matching "sess-1" for /repo.\n' }
      : { exitCode: 0, stdout: 'ledger\n' },
  )
  await start($)
  expect(textOf(await $.tool.call({ tool: LEDGER }))).toContain('ledger')
  expect(runs.map((r) => r.argv.slice(2))).toEqual([
    ['ledger', '--session', 'sess-1', '--project', '/repo'],
    ['ledger', '--project', '/repo'],
  ])
})

test('an edit that undoes an earlier change adds the note to the result and raises a toast', async ($, on) => {
  const { runs, toasts } = engine(on, () => ({ exitCode: 0, stdout: JSON.stringify([{ note: NOTE }]) }))
  on('tool.call', () => ({ result: { filePath: '/repo/src/a.ts' } }))
  await start($)
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'b', new_string: 'c' })
  expect(ran.context).toContain(NOTE)
  expect(toasts.join('\n')).toContain(NOTE)
  const sent = JSON.parse(runs[0]!.init!.stdin!)
  expect(sent).toEqual({ kind: 'edit', file: '/repo/src/a.ts', old_string: 'b', new_string: 'c', replace_all: false })
  expect(runs[0]!.init!.timeoutMs).toBe(1500)
})

test('nothing is added when the check finds nothing, fails, or the call itself failed', async ($, on) => {
  let answer: { exitCode: number; stdout?: string } = { exitCode: 0, stdout: '[]' }
  const { runs, toasts } = engine(on, () => answer)
  let failCall = false
  on('tool.call', () => (failCall ? { result: 'String to replace not found', isError: true } : { result: { filePath: 'x' } }))
  await start($)

  const clean = await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  expect(clean.context ?? []).toEqual([])

  answer = { exitCode: 1 }
  const broken = await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  expect(broken.context ?? []).toEqual([])

  failCall = true
  const before = runs.length
  await $.tool.call({ tool: 'Edit', file_path: '/repo/b.ts', old_string: 'q', new_string: 'r' })
  expect(runs.length).toBe(before)
  expect(toasts).toEqual([])
})

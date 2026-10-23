import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

/** What the mod's tests hand the CLI stand-in: the argv after `bun cli.ts`, and the run's options. */
export type Run = { argv: readonly string[]; init?: { stdin?: string; timeoutMs?: number } }

/** The model-facing name of the ledger tool. */
export const LEDGER = 'mcp__minos__minos_ledger'

/** An undo note as `minos undoes` words one. */
export const NOTE = 'Minos: this replaced the change to src/a.ts made at 18:52 for prompt 2'

/** What the CLI stand-in answers a run with. */
type Answer = { exitCode: number; stdout?: string; stderr?: string }

/** The engine beneath the plugin: a session, a CLI whose answers the test picks, and the toasts it raised. */
export function engine(on: On, cli: (run: Run) => Answer | Error | Promise<Answer>) {
  const runs: Run[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: (e as { name: string }).name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__minos__${(e as { name: string }).name}` } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('process.run', async (_, e) => {
    const run = e as Run
    runs.push(run)
    const answer = await cli(run)
    if (answer instanceof Error) throw answer
    return { value: { exitCode: answer.exitCode, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { runs, toasts }
}

/** Starts an interactive terminal session in /repo, which registers the mod's tool and command. */
export const start = ($: Engine) =>
  $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })


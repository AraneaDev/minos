import type { EngineInterface } from 'claude-code'

/** What one run of the Minos CLI came to: its output, or one line saying why there is none. */
export type MinosResult = { ok: true; stdout: string } | { ok: false; error: string }

/** How long a run may take when the caller names no budget. */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Runs the Minos CLI that ships in this plugin, with Bun, and never throws.
 *
 * The mod has no file access of its own, and the CLI is where every label,
 * dedup and undo rule lives, so the mod asks it rather than reading a
 * transcript itself. A non-zero exit, a timeout and a CLI that cannot start
 * all come back as `ok: false` with a short reason, so a hook can pass a
 * tool's result through untouched instead of failing the call.
 */
export async function minos(
  $: EngineInterface,
  args: string[],
  init: { stdin?: string; timeoutMs?: number } = {},
): Promise<MinosResult> {
  try {
    const run = await $.process.run(['bun', `${$.plugin.root}/src/cli.ts`, ...args], {
      stdin: init.stdin,
      timeoutMs: init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (run.exitCode === 0) return { ok: true, stdout: run.stdout }
    const reason = run.stderr.split('\n').find((line) => line.trim() !== '') ?? `exit ${run.exitCode}`
    return { ok: false, error: reason }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The flags that name this session to the CLI: its id and its directory.
 * Passing the directory keeps the CLI from guessing it from wherever Bun was
 * started.
 */
export async function sessionArgs($: EngineInterface): Promise<string[]> {
  return ['--session', await $.session.id(), '--project', await $.session.cwd()]
}

/**
 * Runs a CLI command for this session. When the CLI knows no session by this
 * id (a session id that does not name its transcript, as can happen after a
 * resume), it is asked again for the project's newest session, which is the
 * one this session is writing.
 */
export async function forSession(
  $: EngineInterface,
  command: string[],
  init: { stdin?: string; timeoutMs?: number } = {},
): Promise<MinosResult> {
  const named = await sessionArgs($)
  const first = await minos($, [...command, ...named], init)
  if (first.ok || !first.error.includes('no session matching')) return first
  return minos($, [...command, '--project', named[3] as string], init)
}

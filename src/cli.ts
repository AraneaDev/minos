import { resolveSession, runReport } from './commands/report'
import { runExport } from './commands/export'
import { runFile } from './commands/file'
import { runSessions } from './commands/sessions'
import { runUndone } from './commands/undone'

const COMMANDS = ['report', 'file', 'undone', 'sessions', 'export'] as const

const FLAG_NAMES = ['project', 'session', 'limit'] as const

/**
 * Usage text for `--help`/`-h`, naming the five real commands and only the
 * flags each one actually accepts. `--since` and `--json` are named in the
 * spec's illustrative command surface but implemented nowhere in this CLI,
 * so they are deliberately absent here rather than promising a flag that
 * would silently do nothing.
 */
const USAGE = `minos: reports what a Claude Code session changed, and which of it was ever put to you as a decision.

  minos report [--session <id>] [--project <path>]   the default; latest session for the cwd
  minos file <path> [--session <id>] [--project <path>]   one file's operation history in the session
  minos undone [--session <id>] [--project <path>]   the undone changes on their own
  minos sessions [--limit <n>] [--project <path>]     sessions with headline counts, to pick one
  minos export [--session <id>] [--project <path>]    the ledger as data`

const flag = (argv: string[], name: string): string | null => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? null : argv[at + 1] ?? null
}

/**
 * The arguments that are not a recognised `--flag` or that flag's value, in
 * order. `minos file`'s path can be given before or after `--project` and
 * friends, so detecting "no path was given" (Ruling A1) by looking at
 * `argv[0]` alone is wrong whenever a flag happens to come first: it would
 * read the flag's own name as the path instead of noticing nothing was
 * given.
 */
function positional(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith('--') && (FLAG_NAMES as readonly string[]).includes(a.slice(2))) {
      i++
      continue
    }
    out.push(a)
  }
  return out
}

/**
 * Ruling A1: a limit the user typed, parsed strictly. `Number('abc')` is
 * NaN and `.slice(-NaN)` behaves like `.slice(0)`, and `Number('0')` /
 * `Number('-1')` both parse to a real number that still makes no sense as a
 * count of rows to show, so all three must be rejected rather than quietly
 * producing "every session" or "none". Returns null for anything that is not
 * a positive integer, leaving the caller to report the error.
 */
function parsePositiveInt(value: string): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Entry point. Returns the exit code rather than calling exit, so it is testable. */
export async function main(argv: string[]): Promise<number> {
  // Checked before any command dispatch: a leading flag is not a recognised
  // command name, so without this it falls through to the default `report`
  // command and either prints a real report or "no transcript found",
  // neither of which is what someone asking for help wants to see.
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  const [first, ...rest] = argv
  const named = first !== undefined && !first.startsWith('-') && (COMMANDS as readonly string[]).includes(first)
  const command = named ? (first as (typeof COMMANDS)[number]) : 'report'
  const args = named ? rest : argv

  if (first !== undefined && !first.startsWith('-') && !named) {
    console.error(`minos: no command "${first}". Try: ${COMMANDS.join(', ')}`)
    return 2
  }

  const cwd = flag(args, 'project') ?? process.cwd()

  if (command === 'sessions') {
    const limitFlag = flag(args, 'limit')
    const limit = limitFlag === null ? 10 : parsePositiveInt(limitFlag)
    if (limit === null) {
      console.error(`minos: --limit must be a positive integer, got "${limitFlag}"`)
      return 2
    }
    console.log(await runSessions(cwd, limit))
    return 0
  }

  const target = positional(args)[0]
  if (command === 'file' && target === undefined) {
    console.error('minos: usage: minos file <path>')
    return 2
  }

  const paths = await resolveSession({ cwd, session: flag(args, 'session') })
  if (paths === null) {
    console.error(`minos: no transcript found for ${cwd}`)
    return 1
  }

  if (command === 'undone') console.log(await runUndone(paths))
  else if (command === 'export') console.log(await runExport(paths))
  else if (command === 'file') console.log(await runFile(paths, target as string))
  else console.log(await runReport(paths))

  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

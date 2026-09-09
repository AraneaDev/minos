#!/usr/bin/env bun
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

/**
 * A flag as it was typed: absent altogether, or present with the value that
 * followed it. Finding 5: reading `argv[at + 1]` blindly conflated three
 * different things. `--session` at the end of the line read as "no session
 * given" and quietly reported the most recent one instead, and
 * `--session --project /repo` took the string "--project" as the session id
 * and then lost the project. A value that begins with `--` is therefore
 * treated as the next flag rather than as this one's value: session ids are
 * UUIDs and project values are absolute paths, so neither ever begins that
 * way.
 */
type Flag = { given: false } | { given: true; value: string | null }

const flag = (argv: string[], name: string): Flag => {
  const at = argv.indexOf(`--${name}`)
  if (at === -1) return { given: false }
  const next = argv[at + 1]
  return { given: true, value: next === undefined || next.startsWith('--') ? null : next }
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

  const projectFlag = flag(args, 'project')
  if (projectFlag.given && projectFlag.value === null) {
    console.error('minos: --project needs a path')
    return 2
  }
  const cwd = projectFlag.given ? (projectFlag.value as string) : process.cwd()

  const sessionFlag = flag(args, 'session')
  if (sessionFlag.given && sessionFlag.value === null) {
    console.error('minos: --session needs a session id. Run `minos sessions` to list them.')
    return 2
  }
  const session = sessionFlag.given ? (sessionFlag.value as string) : null

  if (command === 'sessions') {
    const limitFlag = flag(args, 'limit')
    if (limitFlag.given && limitFlag.value === null) {
      console.error('minos: --limit needs a positive integer')
      return 2
    }
    const typed = limitFlag.given ? limitFlag.value : null
    const limit = typed === null ? 10 : parsePositiveInt(typed)
    if (limit === null) {
      console.error(`minos: --limit must be a positive integer, got "${typed}"`)
      return 2
    }
    const listing = await runSessions(cwd, limit)
    if (listing === null) {
      console.error(`minos: no transcript found for ${cwd}`)
      return 1
    }
    console.log(listing)
    return 0
  }

  const target = positional(args)[0]
  if (command === 'file' && target === undefined) {
    console.error('minos: usage: minos file <path>')
    return 2
  }

  const lookup = await resolveSession({ cwd, session })
  if (lookup.kind === 'no-project') {
    console.error(`minos: no transcript found for ${cwd}`)
    return 1
  }
  if (lookup.kind === 'no-session') {
    console.error(`minos: no session matching "${session}" for ${cwd}. Run \`minos sessions\` to list them.`)
    return 1
  }
  const paths = lookup.paths

  if (command === 'undone') console.log(await runUndone(paths))
  else if (command === 'export') console.log(await runExport(paths))
  else if (command === 'file') console.log(await runFile(paths, target as string))
  else console.log(await runReport(paths))

  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

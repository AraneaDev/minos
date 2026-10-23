#!/usr/bin/env bun
import { colourEnabled, paint } from './colour'
import { runAll } from './commands/all'
import { resolveSession, runReport } from './commands/report'
import { runExport, runExportAll } from './commands/export'
import { runFile } from './commands/file'
import { runLedger } from './commands/ledger'
import { runSessions } from './commands/sessions'
import { runUndoes, parseProposed } from './commands/undoes'
import { runUndone } from './commands/undone'
import { claudeHome } from './paths'
import type { Window } from './window'

const COMMANDS = ['report', 'file', 'undone', 'sessions', 'export', 'ledger', 'undoes'] as const

const FLAG_NAMES = ['project', 'session', 'limit', 'since', 'until'] as const

/** Flags that take no value. Kept apart from FLAG_NAMES, whose entries consume the argument after them. */
const BARE_FLAGS = ['all', 'json'] as const

/**
 * Usage text for `--help`/`-h`, naming the real commands and only the flags
 * each one actually accepts. `--json` is listed for `ledger`, `sessions` and
 * `file`, the commands that take it.
 */
const USAGE = `minos: reports what a Claude Code session changed, and which of it was ever put to you as a decision.

  minos report [--session <id>] [--project <path>]   the default; latest session for the cwd
  minos file <path> [--session <id>] [--project <path>] [--json]   one file's operation history in the session
  minos undone [--session <id>] [--project <path>]   the undone changes on their own
  minos sessions [--limit <n>] [--project <path>] [--json]     sessions with headline counts, to pick one
  minos sessions --all                                every project, with totals
  minos export [--session <id>] [--project <path>]    the ledger as data
  minos export --all                                  every project's counts as data
  minos ledger [--session <id>] [--project <path>] [--json]   what changed without being asked, as text or data
  minos undoes [--session <id>] [--project <path>]   reads one Edit or Write as JSON on stdin, prints the earlier changes it ends

  --since <YYYY-MM-DD> and --until <YYYY-MM-DD> bound sessions, export and --all
  to local calendar days, both inclusive.`

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
    if (a.startsWith('--') && (BARE_FLAGS as readonly string[]).includes(a.slice(2))) continue
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

/**
 * A `--since`/`--until` value, accepted only as a real calendar day written
 * `YYYY-MM-DD`. `inWindow` turns a malformed bound into NaN and so quietly
 * drops every change, and `new Date` rolls `2026-02-30` over into March, so
 * both the shape and the day itself are checked here, before any Window is
 * built. Returns null for anything else, leaving the caller to report it.
 */
function parseDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(y, m - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? value : null
}

/** The window the user typed, or the error line that explains why it is not one. */
function readWindow(args: string[]): { window: Window } | { error: string } {
  const bounds: Record<'since' | 'until', string | null> = { since: null, until: null }
  for (const name of ['since', 'until'] as const) {
    const typed = flag(args, name)
    if (!typed.given) continue
    const day = typed.value === null ? null : parseDay(typed.value)
    if (day === null) return { error: `minos: --${name} must be YYYY-MM-DD` }
    bounds[name] = day
  }
  // Both are YYYY-MM-DD, so string order is calendar order.
  if (bounds.since !== null && bounds.until !== null && bounds.since > bounds.until) {
    return { error: 'minos: --since is after --until' }
  }
  return { window: bounds }
}

/**
 * Prints a command's output, coloured where that is allowed.
 *
 * Usage text and errors go through plain `console.log` and `console.error`
 * instead: the rules in `colour.ts` read a report's shapes, and a usage line
 * indented like a caveat would come out dim for no reason. `minos export` is
 * left alone too, since its JSON is read by a program.
 * @param text one command's whole output
 */
function show(text: string): void {
  console.log(paint(text, colourEnabled({ isTTY: process.stdout.isTTY === true, env: process.env })))
}

/** Entry point. Returns the exit code rather than calling exit, so it is testable. */
export async function main(argv: string[], stdin?: () => Promise<string>): Promise<number> {
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

  if (args.includes('--json') && command !== 'ledger' && command !== 'sessions' && command !== 'file') {
    console.error('minos: --json only applies to ledger, sessions and file')
    return 2
  }
  if (args.includes('--json') && args.includes('--all')) {
    console.error('minos: --json does not combine with --all; use minos export --all for the data')
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

  const typedWindow = readWindow(args)
  if ('error' in typedWindow) {
    console.error(typedWindow.error)
    return 2
  }
  const { window } = typedWindow
  const windowed = command === 'sessions' || command === 'export'
  if (!windowed && (window.since !== null || window.until !== null)) {
    console.error('minos: --since and --until work with sessions and export')
    return 2
  }

  // --all is checked before anything resolves a project: it reads the whole
  // store, so a flag naming one project or session would be silently ignored.
  if (args.includes('--all')) {
    if (!windowed) {
      console.error('minos: --all works with sessions and export')
      return 2
    }
    if (projectFlag.given || sessionFlag.given) {
      console.error('minos: --all reports every project, so it takes no --project or --session')
      return 2
    }
    if (flag(args, 'limit').given) {
      console.error('minos: --all lists every project, so it takes no --limit')
      return 2
    }
    const out = command === 'export' ? await runExportAll(window) : await runAll(window)
    if (out === null) {
      console.error(`minos: no transcripts found under ${claudeHome()}/projects`)
      return 1
    }
    // Not `show` for export: its JSON is for a program to parse.
    if (command === 'export') console.log(out)
    else show(out)
    return 0
  }

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
    const asJson = args.includes('--json')
    const listing = await runSessions(cwd, limit, window, asJson)
    if (listing === null) {
      console.error(`minos: no transcript found for ${cwd}`)
      return 1
    }
    if (asJson) console.log(listing)
    else show(listing)
    return 0
  }

  let undoesInput = ''
  if (command === 'undoes') {
    undoesInput = stdin === undefined ? await Bun.stdin.text() : await stdin()
    if (parseProposed(undoesInput) === null) {
      console.error('minos: undoes reads one change as JSON on stdin')
      return 2
    }
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

  if (command === 'undoes') {
    const result = await runUndoes(paths, undoesInput)
    console.log(result.out)
    return result.code
  } else if (command === 'undone') show(await runUndone(paths))
  // Not `show`: export is JSON for a program to parse, so it never gets escapes.
  else if (command === 'export') console.log(await runExport(paths, window))
  // Same for the JSON ledger; the text form is a report-shaped view and is coloured like one.
  else if (command === 'ledger') {
    const json = args.includes('--json')
    const out = await runLedger(paths, json)
    if (json) console.log(out)
    else show(out)
  }
  else if (command === 'file') {
    const out = await runFile(paths, target as string, args.includes('--json'))
    if (args.includes('--json')) console.log(out)
    else show(out)
  }
  else show(await runReport(paths))

  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

import { resolveSession, runReport } from './commands/report'
import { runExport } from './commands/export'
import { runFile } from './commands/file'
import { runSessions } from './commands/sessions'
import { runUndone } from './commands/undone'

const COMMANDS = ['report', 'file', 'undone', 'sessions', 'export'] as const

const flag = (argv: string[], name: string): string | null => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? null : argv[at + 1] ?? null
}

/** Entry point. Returns the exit code rather than calling exit, so it is testable. */
export async function main(argv: string[]): Promise<number> {
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
    console.log(await runSessions(cwd, Number(flag(args, 'limit') ?? 10)))
    return 0
  }

  const paths = await resolveSession({ cwd, session: flag(args, 'session') })
  if (paths === null) {
    console.error(`minos: no transcript found for ${cwd}`)
    return 1
  }

  if (command === 'undone') console.log(await runUndone(paths))
  else if (command === 'export') console.log(await runExport(paths))
  else if (command === 'file') console.log(await runFile(paths, args[0] ?? ''))
  else console.log(await runReport(paths))

  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

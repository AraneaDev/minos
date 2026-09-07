const COMMANDS = ['report', 'file', 'undone', 'sessions', 'export'] as const

/** Entry point. Returns the process exit code rather than calling exit, so it is testable. */
export async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv
  const command = first === undefined || first.startsWith('-') ? 'report' : first
  const args = command === first ? rest : argv

  if (!(COMMANDS as readonly string[]).includes(command)) {
    console.error(`minos: no command "${command}". Try: ${COMMANDS.join(', ')}`)
    return 2
  }

  console.error(`minos: ${command} is not implemented yet (${args.length} arguments)`)
  return 1
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

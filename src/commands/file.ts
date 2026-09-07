import { sanitise } from '../report'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/** One file's operations in this session, in the order they happened. */
export async function runFile(paths: SessionPaths, target: string): Promise<string> {
  const report = await analyseSession(paths)
  const rows = report.undone.filter((u) => u.file.endsWith(target))
  const header = `${sanitise(target)}: ${rows.length} of its changes did not survive`
  return [header, ...rows.map((u) => `  ${u.kind.padEnd(13)}${u.introduced.at} to ${u.undoneBy.at}`)].join('\n')
}

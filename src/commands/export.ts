import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/** The whole report model as JSON, for anything that wants the numbers rather than the layout. */
export async function runExport(paths: SessionPaths): Promise<string> {
  return JSON.stringify(await analyseSession(paths), null, 2)
}

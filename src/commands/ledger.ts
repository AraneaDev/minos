import { buildLedgerView, renderLedger } from '../ledger-view'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * The session's ledger: counts, the files changed without being asked and
 * the changes that did not survive. Text by default; with `json` the view
 * itself, for a program to parse.
 */
export async function runLedger(paths: SessionPaths, json: boolean): Promise<string> {
  const view = buildLedgerView(await analyseSession(paths))
  return json ? JSON.stringify(view, null, 2) : renderLedger(view)
}

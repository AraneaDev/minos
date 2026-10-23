import { buildLedgerView, ledgerLines, renderLedger } from '../ledger-view'
import { analyseSession } from '../session'
import type { SessionPaths } from './report'

/**
 * The session's ledger: counts, the files changed without being asked and
 * the changes that did not survive. Text by default; with `json` the view
 * itself, for a program to parse, with the text and the lines to dim.
 */
export async function runLedger(paths: SessionPaths, json: boolean): Promise<string> {
  const view = buildLedgerView(await analyseSession(paths))
  if (!json) return renderLedger(view)
  // The text rides along with the data, so a display shows the CLI's own wording
  // and dims the lines the CLI names, rather than rebuilding either.
  const { lines, dim } = ledgerLines(view)
  return JSON.stringify({ ...view, text: lines.join('\n'), dim }, null, 2)
}

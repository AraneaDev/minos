import { analyseSession } from '../session'
import type { Window } from '../window'
import { collectAll } from './all'
import type { SessionPaths } from './report'

/**
 * The whole report model as JSON, for anything that wants the numbers rather
 * than the layout. With a window set, every number comes from the changes
 * inside it and the JSON says which window that was; with none, the output is
 * exactly the unwindowed model, with no `window` field at all.
 */
export async function runExport(paths: SessionPaths, window: Window = { since: null, until: null }): Promise<string> {
  const bounded = window.since !== null || window.until !== null
  const report = await analyseSession(paths, { window })
  return JSON.stringify(bounded ? { ...report, window } : report, null, 2)
}

/**
 * Every project's counts as JSON: the same numbers `minos sessions --all`
 * prints. Null when the store holds no transcript at all, so the caller
 * reports that on stderr rather than printing an empty aggregate as data.
 */
export async function runExportAll(window: Window): Promise<string | null> {
  const all = await collectAll(window)
  return all.projects.length === 0 ? null : JSON.stringify(all, null, 2)
}

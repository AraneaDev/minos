import { analyseSession } from '../session'
import type { Window } from '../window'
import { collectAll } from './all'
import type { SessionPaths } from './report'

/**
 * The whole report model as JSON, for anything that wants the numbers rather
 * than the layout. With a window set, every number comes from the changes
 * inside it and the JSON says which window that was; with none, the output is
 * exactly the unwindowed model, with no `window` or `undatedDropped` field at all. `undatedDropped` counts the
 * changes a window had to leave out for lack of a readable timestamp.
 */
export async function runExport(paths: SessionPaths, window: Window = { since: null, until: null }): Promise<string> {
  const bounded = window.since !== null || window.until !== null
  const report = await analyseSession(paths, { window })
  const { undatedDropped, ...model } = report
  return JSON.stringify(bounded ? { ...model, window, undatedDropped } : model, null, 2)
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

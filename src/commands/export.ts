import { analyseSession } from '../session'
import type { Window } from '../window'
import { collectAll, type ProjectFilter } from './all'
import type { SessionPaths } from './report'

/**
 * The whole report model as JSON, for anything that wants the numbers rather
 * than the layout. With a window set, every number comes from the changes
 * inside it and the JSON says which window that was, along with
 * `undatedDropped` and `undatedShellWrites`: the changes and the shell writes
 * the window had to leave out for lack of a readable timestamp. With no
 * window, the output is exactly the unwindowed model, with none of those
 * three fields.
 */
export async function runExport(paths: SessionPaths, window: Window = { since: null, until: null }): Promise<string> {
  const bounded = window.since !== null || window.until !== null
  const report = await analyseSession(paths, { window })
  const { undatedDropped, undatedShellWrites, ...model } = report
  return JSON.stringify(bounded ? { ...model, window, undatedDropped, undatedShellWrites } : model, null, 2)
}

/**
 * Every project's counts as JSON: the same numbers `minos sessions --all`
 * prints. Null when the store holds no transcript at all, so the caller
 * reports that on stderr rather than printing an empty aggregate as data.
 */
export async function runExportAll(window: Window, filter?: ProjectFilter): Promise<string | null> {
  const all = await collectAll(window, filter)
  return all.projects.length === 0 && all.tempSkipped + all.excludedSkipped === 0 ? null : JSON.stringify(all, null, 2)
}

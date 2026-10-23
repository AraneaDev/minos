import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { aggregate } from '../aggregate'
import type { Aggregate, ClassCounts, ProjectAggregate } from '../aggregate'
import { localDate } from '../clock'
import { claudeHome, sessionFiles, subagentFiles } from '../paths'
import { analyseSession } from '../session'
import type { SessionReport } from '../session'
import type { Window } from '../window'

/**
 * How many projects are read at once. Each project's sessions are read one
 * after another, so the slowest project bounds the run; four in flight keeps
 * the rest finishing behind it without holding every transcript open at once.
 */
const PROJECTS_IN_FLIGHT = 4

/** Runs `work` over every item with at most `limit` in flight, keeping the input order in the result. */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++
      out[at] = await work(items[at] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * The cwds a project's sessions record, newest session first. Read from the
 * reports already in hand rather than from the transcript heads again, so the
 * first entry is the path the project lives at now.
 */
function newestFirst(reports: SessionReport[]): string[] {
  const cwds: string[] = []
  for (const r of [...reports].reverse()) if (r.cwd !== '' && !cwds.includes(r.cwd)) cwds.push(r.cwd)
  return cwds
}

/**
 * Every project under `claudeHome()/projects`, counted inside the window.
 *
 * Each session is analysed whole and the window applied by `aggregate`, so a
 * change undone after the window's end is still seen as undone. Directories
 * holding no transcript are skipped and counted, since Claude Code prunes old
 * transcripts and the count says how much history is gone. Projects are read
 * in name order, which fixes which copy of a forked change counts as the
 * first. A missing store yields an aggregate with no projects rather than
 * throwing.
 */
export async function collectAll(window: Window): Promise<Aggregate> {
  const root = join(claudeHome(), 'projects')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name)).sort()
  const read = await pooled(dirs, PROJECTS_IN_FLIGHT, async (dir) => {
    const files = await sessionFiles(dir)
    if (files.length === 0) return null
    const reports: SessionReport[] = []
    for (const transcript of files) {
      const subagents = await subagentFiles(dir, basename(transcript, '.jsonl'))
      reports.push(await analyseSession({ transcript, subagents }))
    }
    return { dir, cwds: newestFirst(reports), reports }
  })
  const projects = read.filter((p) => p !== null)
  return aggregate(projects, window, read.length - projects.length)
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** A project's name in the table: the path it was last used at, and how many older ones it had. */
function label(p: ProjectAggregate): string {
  const newest = p.cwds[0] ?? basename(p.dir)
  const older = p.cwds.length - 1
  return older > 0 ? `${newest} (+${plural(older, 'older path', 'older paths')})` : newest
}

const COLUMNS = ['sessions', 'decided', 'auto', 'subagent', 'undone'] as const

const cells = (p: ProjectAggregate): number[] => [p.sessions, p.changes.decided, p.changes.auto, p.changes.subagent, p.changes.undone]

/** True when a cross-project fork makes the rows add up to more than the deduplicated total. */
function rowsExceedTotal(a: Aggregate): boolean {
  const keys: (keyof ClassCounts)[] = ['decided', 'auto', 'subagent', 'undone']
  return keys.some((k) => a.projects.reduce((sum, p) => sum + p.changes[k], 0) !== a.total.changes[k])
}

/**
 * `minos sessions --all` as text: a row per project, the total, and the lines
 * that say what the numbers count, what they leave out, and how much history
 * there was to count from. An open `since` reads `start of history`, and an
 * open `until` reads as today's local date, so the stated window is always a
 * pair of dates or says plainly that it has no start.
 */
export function renderAll(a: Aggregate): string {
  const today = localDate(new Date().toISOString())
  const rows = [...a.projects.map((p) => [label(p), ...cells(p).map(String)]), ['total', ...cells(a.total).map(String)]]
  const header = ['project', ...COLUMNS]
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] as string).length)))
  const line = (r: string[]): string => r.map((c, i) => (i === 0 ? c.padEnd(widths[0] as number) : c.padStart(widths[i] as number))).join('  ')

  const modes = Object.entries(a.total.autoModes).sort(([x, m], [y, n]) => n - m || x.localeCompare(y))
  const day = (iso: string | null): string => (iso === null ? 'unknown' : localDate(iso))
  const w = a.total.possiblyUnseenWrites
  const out = [
    `MINOS  all projects  window ${a.window.since ?? 'start of history'} to ${a.window.until ?? today}`,
    'counts are changes: one Edit, Write or NotebookEdit tool call each, deduplicated by tool_use id',
    '',
    line(header),
    ...rows.map(line),
    '',
    `auto by mode: ${modes.length === 0 ? 'none' : modes.map(([m, n]) => `${m} ${n}`).join(', ')}`,
    `possibly unseen writes (shell commands that look like writes, a heuristic, not in the classes above): decided ${w.decided}, auto ${w.auto}, subagent ${w.subagent}`,
    `dropped ${plural(a.duplicatesDropped, 'duplicate change', 'duplicate changes')} copied between forked or resumed sessions`,
  ]
  if (rowsExceedTotal(a)) out.push('a change copied into another project counts in both rows and once in the total')
  if (a.undatedDropped > 0) {
    out.push(`left out ${plural(a.undatedDropped, 'change', 'changes')} with no readable timestamp, which no window can place`)
  }
  out.push(
    `history: oldest transcript ${day(a.oldestTranscript)}, newest ${day(a.newestTranscript)}; ` +
      `${plural(a.emptyProjectDirs, 'project directory has', 'project directories have')} no transcripts left (cleanupPeriodDays prunes them)`,
  )
  return out.join('\n')
}

/** `minos sessions --all`: the rendered table, or null when the store holds no transcript at all. */
export async function runAll(window: Window): Promise<string | null> {
  const all = await collectAll(window)
  return all.projects.length === 0 ? null : renderAll(all)
}

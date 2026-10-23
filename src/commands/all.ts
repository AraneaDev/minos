import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { aggregate } from '../aggregate'
import { DECIDED_NOTE } from '../caveats'
import type { Aggregate, ClassCounts, ProjectAggregate } from '../aggregate'
import { localDate } from '../clock'
import { middlePath, plural, sanitise } from '../report'
import { claudeHome, sessionFiles, subagentFiles } from '../paths'
import { analyseSession } from '../session'
import type { SessionReport } from '../session'
import { describeWindow } from '../window'
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

/** Which projects `--all` leaves out: those matching an `--exclude` glob, and those that only ever ran in the temp directory. */
export interface ProjectFilter {
  exclude: string[]
  includeTemp: boolean
}

const DEFAULT_FILTER: ProjectFilter = { exclude: [], includeTemp: false }

/** The system temp directory and `/tmp`, which Minos's own test runs and agent scratchpads use. */
function tempRoots(): string[] {
  return [...new Set([tmpdir(), '/tmp'].map((d) => d.replace(/\/+$/, '') || '/'))]
}

const under = (path: string, root: string): boolean => path === root || path.startsWith(root === '/' ? '/' : `${root}/`)

/**
 * Why a project is left out, or null to keep it. Both rules need every
 * recorded cwd to match, so a project that only once ran from a scratch
 * directory keeps its row; a project with no recorded cwd is always kept,
 * since nothing says where it ran.
 */
function skipReason(cwds: string[], filter: ProjectFilter): 'excluded' | 'temp' | null {
  if (cwds.length === 0) return null
  const globs = filter.exclude.map((g) => new Bun.Glob(g))
  if (globs.length > 0 && cwds.every((c) => globs.some((g) => g.match(c)))) return 'excluded'
  const roots = tempRoots()
  if (!filter.includeTemp && cwds.every((c) => roots.some((r) => under(c, r)))) return 'temp'
  return null
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
 * throwing. Projects the filter leaves out are read, since their cwds are
 * only known from their transcripts, then counted apart and kept out of
 * every row and the total.
 */
export async function collectAll(window: Window, filter: ProjectFilter = DEFAULT_FILTER): Promise<Aggregate> {
  const root = join(claudeHome(), 'projects')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name)).sort()
  let unreadable = 0
  const read = await pooled(dirs, PROJECTS_IN_FLIGHT, async (dir) => {
    const files = await sessionFiles(dir)
    if (files.length === 0) return null
    const reports: SessionReport[] = []
    for (const transcript of files) {
      try {
        const subagents = await subagentFiles(dir, basename(transcript, '.jsonl'))
        reports.push(await analyseSession({ transcript, subagents }))
      } catch {
        unreadable++
      }
    }
    return { dir, cwds: newestFirst(reports), reports }
  })
  const projects = read.filter((p) => p !== null)
  const skipped = { temp: 0, excluded: 0 }
  const kept = projects.filter((p) => {
    const reason = skipReason(p.cwds, filter)
    if (reason !== null) skipped[reason]++
    return reason === null
  })
  return aggregate(kept, window, read.length - projects.length, unreadable, skipped)
}

/** The widest the project column gets, so one long scratch path cannot widen the whole table. */
const PROJECT_WIDTH = 48

/**
 * A project's name in the table: the path it was last used at, and how many
 * older ones it had. The path is cut in the middle to keep the whole label
 * within `PROJECT_WIDTH`, so the suffix about older paths always survives.
 */
function label(p: ProjectAggregate): string {
  const newest = sanitise(p.cwds[0] ?? basename(p.dir))
  const older = p.cwds.length - 1
  const suffix = older > 0 ? ` (+${plural(older, 'older path', 'older paths')})` : ''
  return `${middlePath(newest, PROJECT_WIDTH - suffix.length)}${suffix}`
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
 * pair of dates or says plainly that it has no start. A project with no
 * session in the window gets no row, only a count in one line under the
 * table, which says the project had no session with a known time when no
 * window is set; the total and the JSON still cover every project.
 */
export function renderAll(a: Aggregate): string {
  const shown = a.projects.filter((p) => p.sessions > 0)
  const idle = a.projects.length - shown.length
  const rows = [...shown.map((p) => [label(p), ...cells(p).map(String)]), ['total', ...cells(a.total).map(String)]]
  const header = ['project', ...COLUMNS]
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] as string).length)))
  const line = (r: string[]): string => r.map((c, i) => (i === 0 ? c.padEnd(widths[0] as number) : c.padStart(widths[i] as number))).join('  ')

  const modes = Object.entries(a.total.autoModes).sort(([x, m], [y, n]) => n - m || x.localeCompare(y))
  const day = (iso: string | null): string => (iso === null ? 'unknown' : localDate(iso))
  const w = a.total.possiblyUnseenWrites
  const out = [
    `MINOS  all projects  window ${describeWindow(a.window)}`,
    'counts are changes: one Edit, Write or NotebookEdit tool call each, deduplicated by tool_use id',
    '',
    line(header),
    ...rows.map(line),
    '',
    `auto by mode: ${modes.length === 0 ? 'none' : modes.map(([m, n]) => `${m} ${n}`).join(', ')}`,
    `shell commands matching a write pattern (a loose heuristic, not counted above: it misses some writes, and many matches write outside the repository): decided ${w.decided}, auto ${w.auto}, subagent ${w.subagent}`,
    `dropped ${plural(a.duplicatesDropped, 'duplicate change', 'duplicate changes')} copied between forked or resumed sessions`,
  ]
  if (a.total.undatedShellWrites > 0) {
    out.push(
      `left out ${plural(a.total.undatedShellWrites, 'shell command', 'shell commands')} matching a write pattern with no readable timestamp, which no window can place`,
    )
  }
  if (idle > 0) {
    // With no window every session with a known start or end counts, so a
    // project left without a row is one whose sessions carry no time at all.
    const open = a.window.since === null && a.window.until === null
    out.push(`${plural(idle, 'project', 'projects')} had no session ${open ? 'with a known time' : 'in the window'}`)
  }
  if (rowsExceedTotal(a)) out.push('a change copied into another project counts in both rows and once in the total')
  if (a.undatedDropped > 0) {
    out.push(`left out ${plural(a.undatedDropped, 'change', 'changes')} with no readable timestamp, which no window can place`)
  }
  if (a.failedDropped > 0) {
    out.push(`left out ${plural(a.failedDropped, 'change', 'changes')} whose tool call failed or was refused, so nothing was written`)
  }
  if (a.total.changes.decided > 0) out.push(DECIDED_NOTE)
  if (a.tempSkipped > 0) {
    out.push(`skipped ${plural(a.tempSkipped, 'project', 'projects')} that only ran under the temp directory (--include-temp lists them)`)
  }
  if (a.excludedSkipped > 0) out.push(`excluded ${plural(a.excludedSkipped, 'project', 'projects')} matching --exclude`)
  if (a.unreadableSkipped > 0) out.push(`skipped ${plural(a.unreadableSkipped, 'unreadable transcript', 'unreadable transcripts')}`)
  out.push(
    `history: oldest transcript ${day(a.oldestTranscript)}, newest ${day(a.newestTranscript)}; ` +
      `${plural(a.emptyProjectDirs, 'project directory has', 'project directories have')} no transcripts left (cleanupPeriodDays prunes them)`,
  )
  return out.join('\n')
}

/** `minos sessions --all`: the rendered table, or null when the store holds no transcript at all. */
export async function runAll(window: Window, filter?: ProjectFilter): Promise<string | null> {
  const all = await collectAll(window, filter)
  return all.projects.length === 0 && all.tempSkipped + all.excludedSkipped === 0 ? null : renderAll(all)
}

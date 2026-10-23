/**
 * Counting changes over many sessions, for `minos sessions --all` and its kin.
 *
 * Every count here is operations ("changes"), never files: a file edited five
 * times is five changes, and the same change must never be counted twice. A
 * forked session replays its parent's history, so the same tool_use id turns
 * up in several transcripts; the first occurrence wins and later ones are
 * only counted as duplicates.
 */
import { DECIDED_NOTE } from './caveats'
import type { SessionReport } from './session'
import type { Operation, ShellWrite } from './types'
import type { Undone } from './reverts'
import { inWindow, spansWindow, undoneInWindow } from './window'
import type { Window } from './window'

/** Changes per label. `undone` is a count over the others, not a fourth label. */
export interface ClassCounts {
  decided: number
  auto: number
  subagent: number
  undone: number
}

/** What the export says about `possiblyUnseenWrites`, beside the numbers. */
const POSSIBLY_UNSEEN_WRITES_NOTE =
  'shell commands matching a write pattern: a loose heuristic, not counted in changes; it misses some writes, and many matches write outside the repository'

/** One project's counts, or the deduplicated total over all of them. */
export interface ProjectAggregate {
  dir: string
  /** For a project, its cwds in the order given (newest first from `collectAll`); for the total, sorted. */
  cwds: string[]
  /** Sessions with at least one operation, or a recorded start or end, inside the window. */
  sessions: number
  /** Operations, deduplicated by tool_use id. */
  changes: ClassCounts
  /** Bash calls that look like file writes, deduplicated by tool_use id: a heuristic, never part of `changes`. */
  possiblyUnseenWrites: Omit<ClassCounts, 'undone'>
  /** Shell writes with no readable timestamp, left out of `possiblyUnseenWrites` because a window is set; 0 with no window. */
  undatedShellWrites: number
  /** The caveat for `possiblyUnseenWrites`, repeated so the JSON carries it. */
  possiblyUnseenWritesNote: string
  /** The caveat for the `decided` count, repeated so the JSON carries it. */
  decidedNote: string
  /** Auto operations per recorded permission mode; a null mode counts as 'unknown'. */
  autoModes: Record<string, number>
  /** The earliest startedAt among its counted sessions, as written. */
  firstAt: string | null
  /** The latest endedAt among its counted sessions, as written. */
  lastAt: string | null
}

/** Everything `--all` prints, and the numbers that explain what it left out. */
export interface Aggregate {
  window: Window
  /** Sorted by total changes, descending. */
  projects: ProjectAggregate[]
  /** Directory '(all)', deduplicated across every project. */
  total: ProjectAggregate
  /** Operations inside the window seen more than once by tool_use id. */
  duplicatesDropped: number
  /** Operations with no parseable timestamp, dropped only when a window is set. */
  undatedDropped: number
  /** Edits and writes whose tool call failed or was refused, left out of every count. */
  failedDropped: number
  /** Sessions whose transcript could not be read and were left out. */
  unreadableSkipped: number
  /** Project directories with no transcript left. */
  emptyProjectDirs: number
  /** The earliest startedAt over every session seen, window or not. */
  oldestTranscript: string | null
  /** The latest endedAt over every session seen, window or not. */
  newestTranscript: string | null
}

/** The instant of an ISO string, or NaN. */
const instant = (iso: string): number => new Date(iso).getTime()

/** The earlier of two timestamps by instant; an unparseable one never wins. */
function earlier(a: string | null, b: string | null): string | null {
  if (a === null || Number.isNaN(instant(a))) return b
  if (b === null || Number.isNaN(instant(b))) return a
  return instant(b) < instant(a) ? b : a
}

/** The later of two timestamps by instant. */
function later(a: string | null, b: string | null): string | null {
  if (a === null || Number.isNaN(instant(a))) return b
  if (b === null || Number.isNaN(instant(b))) return a
  return instant(b) > instant(a) ? b : a
}

/** A running count over one scope: a single project, or all of them. */
class Tally {
  readonly changes: ClassCounts = { decided: 0, auto: 0, subagent: 0, undone: 0 }
  readonly shellWrites: Omit<ClassCounts, 'undone'> = { decided: 0, auto: 0, subagent: 0 }
  readonly autoModes: Record<string, number> = {}
  readonly cwds = new Set<string>()
  sessions = 0
  firstAt: string | null = null
  lastAt: string | null = null
  duplicates = 0
  undated = 0
  undatedShell = 0
  failed = 0
  private readonly seen = new Set<string>()
  private readonly seenFailed = new Set<string>()
  private readonly seenShell = new Set<string>()
  private readonly seenUndone = new Set<string>()

  constructor(private readonly window: Window) {}

  /** Count one operation unless its tool_use id was seen or it falls outside the window. */
  add(op: Operation): void {
    if (this.seen.has(op.toolUseId)) {
      if (inWindow(op.at, this.window)) this.duplicates++
      return
    }
    this.seen.add(op.toolUseId)
    if (!inWindow(op.at, this.window)) {
      if (Number.isNaN(instant(op.at))) this.undated++
      return
    }
    this.changes[op.attestation]++
    if (op.attestation === 'auto') {
      const mode = op.permissionMode ?? 'unknown'
      this.autoModes[mode] = (this.autoModes[mode] ?? 0) + 1
    }
  }

  /** Count one shell write once by tool_use id, when it falls inside the window; an undated one is counted apart. */
  addShellWrite(w: ShellWrite): void {
    if (this.seenShell.has(w.toolUseId)) return
    this.seenShell.add(w.toolUseId)
    if (inWindow(w.at, this.window)) this.shellWrites[w.attestation]++
    else if (Number.isNaN(instant(w.at))) this.undatedShell++
  }

  /** Count an undone finding by the operation that introduced it, once. */
  addUndone(u: Undone): void {
    if (this.seenUndone.has(u.introduced.toolUseId)) return
    this.seenUndone.add(u.introduced.toolUseId)
    if (undoneInWindow(u, this.window)) this.changes.undone++
  }

  /** Fold one session in: its operations, its undone findings and its time span. */
  addSession(report: SessionReport): void {
    for (const op of report.operations) this.add(op)
    for (const w of report.shellWrites) this.addShellWrite(w)
    for (const u of report.undone) this.addUndone(u)
    for (const f of report.failedChanges) {
      if (this.seenFailed.has(f.toolUseId)) continue
      this.seenFailed.add(f.toolUseId)
      if (inWindow(f.at, this.window)) this.failed++
    }
    const touched = report.operations.some((o) => inWindow(o.at, this.window))
    // A session counts when its span overlaps the window, even with no change
    // inside it, but only when at least one end of that span is known.
    const known = report.startedAt !== null || report.endedAt !== null
    const spans = known && spansWindow(report.startedAt, report.endedAt, this.window)
    if (!touched && !spans) return
    this.sessions++
    this.firstAt = earlier(this.firstAt, report.startedAt)
    this.lastAt = later(this.lastAt, report.endedAt)
  }

  result(dir: string, sortCwds: boolean): ProjectAggregate {
    return {
      dir,
      cwds: sortCwds ? [...this.cwds].sort() : [...this.cwds],
      sessions: this.sessions,
      changes: this.changes,
      possiblyUnseenWrites: this.shellWrites,
      undatedShellWrites: this.undatedShell,
      possiblyUnseenWritesNote: POSSIBLY_UNSEEN_WRITES_NOTE,
      decidedNote: DECIDED_NOTE,
      autoModes: this.autoModes,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
    }
  }
}

const totalChanges = (p: ProjectAggregate): number => p.changes.decided + p.changes.auto + p.changes.subagent

/**
 * Count changes over every project's sessions inside the window.
 *
 * The window filters operations by their own timestamp, so a session spanning
 * its edge contributes only the changes made inside it. An undone change is
 * counted when the change that was undone falls inside the window, whenever
 * the undoing happened. Each project is deduplicated on its own, and the
 * total is deduplicated across all of them, so a fork in another project is
 * counted once in the total but in both projects' rows.
 */
export function aggregate(
  input: { dir: string; cwds: string[]; reports: SessionReport[] }[],
  window: Window,
  emptyProjectDirs: number,
  unreadableSkipped = 0,
): Aggregate {
  const total = new Tally(window)
  const projects: ProjectAggregate[] = []
  // The history the store still holds, over every session whether or not
  // the window counts it; only the total reports it, so no project tracks it.
  let oldest: string | null = null
  let newest: string | null = null
  for (const { dir, cwds, reports } of input) {
    const tally = new Tally(window)
    for (const cwd of cwds) {
      tally.cwds.add(cwd)
      total.cwds.add(cwd)
    }
    for (const report of reports) {
      tally.addSession(report)
      total.addSession(report)
      oldest = earlier(oldest, report.startedAt)
      newest = later(newest, report.endedAt)
    }
    projects.push(tally.result(dir, false))
  }
  projects.sort((a, b) => totalChanges(b) - totalChanges(a) || a.dir.localeCompare(b.dir))
  return {
    window,
    projects,
    total: total.result('(all)', true),
    duplicatesDropped: total.duplicates,
    undatedDropped: total.undated,
    failedDropped: total.failed,
    unreadableSkipped,
    emptyProjectDirs,
    oldestTranscript: oldest,
    newestTranscript: newest,
  }
}

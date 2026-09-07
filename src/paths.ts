import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

// Sampled across every top-level transcript on this machine, the recorded cwd
// never showed up past line 14, and the first 40 lines of a transcript ran up
// to about 400KB where early lines carried a large tool result. 1MiB and 40
// lines both give real margin over what was observed, while staying a small
// slice of a transcript that can run to tens of megabytes: bounded, not a
// whole-file read.
const CWD_SCAN_BYTE_BOUND = 1024 * 1024
const CWD_SCAN_MAX_LINES = 40

/** Root of the Claude Code state directory. CLAUDE_CONFIG_DIR wins, which is also how tests point it elsewhere. */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

/**
 * The directory name Claude Code derives from a project path. Undocumented, so
 * every use of it is verified against the cwd recorded inside the transcript
 * before anything is reported.
 */
export function encodeProjectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Where the per-version file backups for one session live. */
export function fileHistoryDir(sessionId: string): string {
  return join(claudeHome(), 'file-history', sessionId)
}

/**
 * A file's modification time, or a sentinel that sorts before every real
 * timestamp when it cannot be read (removed between the readdir that found
 * it and here, a permissions problem, ...). A session whose mtime cannot be
 * read must never be mistaken for the most recently active one, so it sorts
 * as the oldest instead of the read throwing.
 */
async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return -Infinity
  }
}

/**
 * Session transcripts in a project directory, ordered oldest to newest by
 * modification time, so the most recently active session is always the last
 * element. Session filenames are UUIDs, which carry no chronological
 * information of their own, so the ordering comes from `stat` rather than a
 * lexicographic sort of the names; a project directory holds at most a few
 * tens of sessions, so statting each one costs nothing. Names are sorted
 * first and the mtime sort applied on top of that stable, so two sessions
 * that share an mtime, or one whose mtime could not be read, fall back to
 * name order between themselves rather than an arbitrary one. A missing
 * directory yields no files rather than throwing.
 */
export async function sessionFiles(projectDir: string): Promise<string[]> {
  const names = await readdir(projectDir).catch(() => [] as string[])
  const jsonlNames = names.filter((n) => n.endsWith('.jsonl')).sort()
  const withMtimes = await Promise.all(
    jsonlNames.map(async (n) => {
      const path = join(projectDir, n)
      return { path, mtime: await mtimeMs(path) }
    }),
  )
  return withMtimes.sort((a, b) => a.mtime - b.mtime).map((f) => f.path)
}

/**
 * Subagent transcripts for one session. On disk these sit one level below the
 * session itself, under `<projectDir>/<sessionId>/subagents/`, and a workflow
 * run nests its agents an extra level under `subagents/workflows/<wf_id>/`, so
 * a flat listing is not enough: the directory is scanned recursively. The
 * `subagents/` tree also holds files that are not subagent transcripts, such
 * as `agent-*.meta.json` sidecars and, inside a workflow directory,
 * `journal.jsonl` (workflow-level started/result markers rather than an
 * agent's own turns), so the filter is a basename that both starts with
 * `agent-` and ends with `.jsonl`, not `.jsonl` alone. A session with no
 * `subagents` directory at all yields no files rather than throwing.
 */
export async function subagentFiles(projectDir: string, sessionId: string): Promise<string[]> {
  const dir = join(projectDir, sessionId, 'subagents')
  const names = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  return names
    .filter((n) => basename(n).startsWith('agent-') && n.endsWith('.jsonl'))
    .sort()
    .map((n) => join(dir, n))
}

/**
 * The cwd a transcript records, recovered without loading the whole file into
 * memory. Real transcripts do not carry it on the first line: session-level
 * records (last-prompt, mode, permission-mode, and the like) come first, so a
 * bounded head of the file is read and parsed line by line, tolerating lines
 * that are not JSON, until a record with a string `cwd` turns up or the bound
 * runs out. Returns null when nothing is recovered within the bound, which
 * covers both an unusually short transcript and one that could not be parsed
 * at all; the two are indistinguishable from here and are handled identically
 * by the caller. The read itself is never fatal either: a file that vanishes
 * between the readdir that found it and this read (session pruning, a
 * concurrent store cleanup, any other I/O failure) is treated the same way,
 * rather than rejecting out of this function and crashing the lookup.
 */
async function recordedCwd(path: string): Promise<string | null> {
  let text: string
  try {
    text = await Bun.file(path).slice(0, CWD_SCAN_BYTE_BOUND).text()
  } catch {
    return null
  }
  const lines = text.split('\n').slice(0, CWD_SCAN_MAX_LINES)
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as { cwd?: unknown }
      if (typeof record.cwd === 'string') return record.cwd
    } catch {}
  }
  return null
}

/**
 * The project directory for a working directory. Tries the encoded name
 * first, verifying it against the cwd recorded in its own transcript, and
 * falls back to scanning every project directory for one whose transcript
 * records this cwd, because the encoding is a guess and a wrong guess would
 * report on somebody else's project without saying so.
 *
 * The two paths apply the recovered cwd differently. On the encoded guess,
 * the directory name itself is evidence: if its transcript records a
 * different cwd the guess is rejected, but if none is recoverable at all the
 * guess is still accepted, since refusing it would make Minos report nothing
 * on a legitimate, if short or unusual, transcript. On the fallback scan
 * there is no such prior evidence, so only an exact match is accepted; a
 * candidate with an unrecoverable cwd is skipped rather than guessed at.
 */
export async function projectDirFor(cwd: string): Promise<string | null> {
  const root = join(claudeHome(), 'projects')

  const guess = join(root, encodeProjectSlug(cwd))
  const guessFiles = await sessionFiles(guess)
  if (guessFiles.length > 0) {
    const recorded = await recordedCwd(guessFiles[0]!)
    if (recorded === null || recorded === cwd) return guess
  }

  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    const candidate = join(root, name)
    const [first] = await sessionFiles(candidate)
    if (first === undefined) continue
    const recorded = await recordedCwd(first)
    if (recorded === cwd) return candidate
  }
  return null
}

/**
 * The tool call that spawned a subagent, read from the `agent-<id>.meta.json`
 * sidecar Claude Code writes beside every subagent transcript. That id is the
 * only link back to the parent session: a subagent's own parentUuid chain
 * terminates inside its own file, so without this its changes can be labelled
 * but never attributed to the prompt that caused them.
 *
 * Returns null whenever no usable link exists, which is a real case rather
 * than an error: a workflow-nested subagent records `toolUseId: null`, and a
 * sidecar may be absent, unreadable or malformed. Never throws, matching the
 * never-fatal rule the rest of this module follows.
 */
export async function subagentToolUseId(transcriptPath: string): Promise<string | null> {
  const sidecar = transcriptPath.replace(/\.jsonl$/, '.meta.json')
  if (sidecar === transcriptPath) return null
  try {
    const file = Bun.file(sidecar)
    if (!(await file.exists())) return null
    const parsed: unknown = JSON.parse(await file.text())
    if (parsed === null || typeof parsed !== 'object') return null
    const id = (parsed as { toolUseId?: unknown }).toolUseId
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

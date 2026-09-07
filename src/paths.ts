import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

// A first line comfortably fits in a few tens of kilobytes; this is generous
// headroom without reading anywhere near a whole transcript into memory.
const FIRST_LINE_BOUND = 64 * 1024

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

/** Session transcripts in a project directory, newest last. */
export async function sessionFiles(projectDir: string): Promise<string[]> {
  const names = await readdir(projectDir).catch(() => [] as string[])
  return names.filter((n) => n.endsWith('.jsonl')).sort().map((n) => join(projectDir, n))
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
 * The first line of a file, read without loading the rest of it into memory.
 * A bounded slice is read and only the text before the first newline is
 * returned; when no newline turns up inside that bound the file is treated as
 * unreadable for this purpose rather than read further.
 */
async function firstLine(path: string): Promise<string | null> {
  const text = await Bun.file(path).slice(0, FIRST_LINE_BOUND).text()
  const end = text.indexOf('\n')
  if (end === -1) return null
  return text.slice(0, end)
}

/**
 * The project directory for a working directory. Tries the encoded name first
 * and falls back to scanning every project directory for one whose first
 * transcript line records this cwd, because the encoding is a guess and a
 * wrong guess would report on somebody else's project without saying so.
 */
export async function projectDirFor(cwd: string): Promise<string | null> {
  const root = join(claudeHome(), 'projects')
  const guess = join(root, encodeProjectSlug(cwd))
  const files = await sessionFiles(guess)
  if (files.length > 0) return guess

  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    const candidate = join(root, name)
    const [first] = await sessionFiles(candidate)
    if (first === undefined) continue
    const line = await firstLine(first)
    if (line === null) continue
    try {
      if ((JSON.parse(line) as { cwd?: string }).cwd === cwd) return candidate
    } catch {}
  }
  return null
}

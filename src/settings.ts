import { join } from 'node:path'
import { claudeHome } from './paths'

/** The shape read out of a settings file; everything else in it is ignored. */
interface SettingsFile {
  permissions?: { allow?: unknown }
}

/** Tools the ledger tracks, so only an allow rule for one of these could move a `decided` row into `auto`. */
const TRACKED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

/** True for an allow rule naming one of `TRACKED_TOOLS`, whether bare or with a `(pattern)`. */
function isTrackedRule(rule: string): boolean {
  return TRACKED_TOOLS.some((tool) => rule === tool || rule.startsWith(`${tool}(`))
}

/**
 * The tracked-tool allow rules in one settings file, or null when the file
 * does not exist, cannot be read, or does not parse as the expected shape.
 * A read failure of any kind is not fatal to the caller: it is one of
 * potentially several settings files, and the others may still be readable.
 */
async function readAllowFile(path: string): Promise<string[] | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const parsed = JSON.parse(await file.text()) as SettingsFile
    const allow = parsed.permissions?.allow
    if (!Array.isArray(allow)) return []
    return allow.filter((rule): rule is string => typeof rule === 'string' && isTrackedRule(rule))
  } catch {
    return null
  }
}

/**
 * Every Edit/Write/NotebookEdit allow rule in force right now, read from
 * `settings.json` and `settings.local.json` under the Claude config
 * directory (`CLAUDE_CONFIG_DIR` honoured via `claudeHome`, exactly like
 * every other path in this project). This is the only place Minos reads
 * outside a transcript, and it only ever reads: nothing under the config
 * directory is written.
 *
 * Returns null when neither file could be read or parsed at all, so the
 * caller can print "could not be read" rather than the misleading "no rules
 * configured". A settings file that parses but carries no allow rules (or no
 * `permissions` block at all) still counts as read, and contributes an empty
 * list rather than null.
 */
export async function readAllowRules(): Promise<string[] | null> {
  const dir = claudeHome()
  const results = await Promise.all(
    ['settings.json', 'settings.local.json'].map((name) => readAllowFile(join(dir, name))),
  )
  const readable = results.filter((result): result is string[] => result !== null)
  if (readable.length === 0) return null

  const merged = new Set<string>()
  for (const rules of readable) for (const rule of rules) merged.add(rule)
  return [...merged]
}

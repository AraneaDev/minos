import type { UnknownRecord } from './types'

/** One tool call as the transcript records it, with the input the tool actually received. */
export interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

const asObject = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null

/**
 * True for a prompt the user actually supplied, told apart from a
 * system-injected `<task-notification>` or reminder. `type === 'user'`,
 * `isMeta !== true` and a string `permissionMode` are necessary but not
 * sufficient: an injected record satisfies all three exactly as a typed
 * prompt does, and on a real transcript this is not a rare edge case (one
 * session measured had 44 injected records against a single typed prompt).
 *
 * `promptSource` is the discriminator that actually separates them, checked
 * against the full local corpus (2,908 prompt-shaped records across 172
 * transcripts) with no counter-example: `system` is exclusively injected,
 * while `typed`, `suggestion_accepted`, `queued` and `sdk` are all genuinely
 * user-supplied (typed text, an accepted suggestion, a prompt queued while
 * busy, and one submitted by the SDK on the user's behalf, respectively).
 * Only the explicit `'system'` value is excluded; a transcript predating this
 * field carries no `promptSource` at all, and must keep counting as a prompt
 * exactly as it did before this field existed.
 */
export function isPromptRecord(r: UnknownRecord): boolean {
  return r.type === 'user' && r.isMeta !== true && typeof r.permissionMode === 'string' && r.promptSource !== 'system'
}

/** The prompt's text, from either the string or the content-block form. */
export function promptText(r: UnknownRecord): string {
  const content = asObject(r.message)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => asObject(block))
    .filter((block): block is UnknownRecord => block !== null && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
}

/** Every tool call in an assistant record, in the order the model emitted them. */
export function toolUses(r: UnknownRecord): ToolUse[] {
  const content = asObject(r.message)?.content
  if (!Array.isArray(content)) return []
  const uses: ToolUse[] = []
  for (const block of content) {
    const b = asObject(block)
    if (b === null || b.type !== 'tool_use') continue
    if (typeof b.id !== 'string' || typeof b.name !== 'string') continue
    uses.push({ id: b.id, name: b.name, input: asObject(b.input) ?? {} })
  }
  return uses
}

/** One tool call whose result was an error, and whether that error says the call never ran. */
export interface FailedResult {
  id: string
  refused: boolean
}

/**
 * Openings of an error result that say the harness stopped the call before
 * it started, each matched against a real store: a permission denial (by a
 * rule, a safety check or the auto mode classifier), a `PreToolUse` hook
 * block, a harness block, a classifier that gave no verdict, a user
 * rejection, and a deny rule naming the path it blocked. Anchored to the
 * first line, so a command that ran and printed `Permission denied` or `rejected`
 * after its `Exit code N` line is never read as a refusal.
 */
const REFUSALS: readonly RegExp[] = [
  /^Permission (?:to use|for this)\b[^\n]*?\bdenied\b/,
  /^PreToolUse:/,
  /^(?:<tool_use_error>)?Blocked:/,
  /^The server-side auto mode classifier gave no verdict\b/,
  /^The user doesn't want to proceed\b/,
  /^[^\n]*\bwas blocked by a deny rule\.?(?:\n|$)/,
]

/** A tool_result's text, from either the string or the content-block form. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => asObject(block))
    .map((block) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

/**
 * True when an error result says the call never ran. Any other error, such
 * as the `Exit code N` the Bash tool reports for a non-zero exit, means the
 * call did run and may have changed something before it failed.
 */
const isRefusal = (text: string): boolean => {
  const trimmed = text.trimStart()
  return REFUSALS.some((re) => re.test(trimmed))
}

/**
 * The tool calls whose tool_result in this record is an error, each marked
 * `refused` when the error says the call never ran. Results arrive in a later
 * `user` record as `tool_result` content blocks, each naming the call it
 * answers.
 */
export function failedToolResults(r: UnknownRecord): FailedResult[] {
  const content = asObject(r.message)?.content
  if (!Array.isArray(content)) return []
  const failed: FailedResult[] = []
  for (const block of content) {
    const b = asObject(block)
    if (b?.type === 'tool_result' && b.is_error === true && typeof b.tool_use_id === 'string') {
      failed.push({ id: b.tool_use_id, refused: isRefusal(resultText(b.content)) })
    }
  }
  return failed
}

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
 * True for a prompt the user typed. `permissionMode` is the discriminator: it
 * appears on typed prompts and not on the tool results and injected context
 * that share the `user` type.
 */
export function isPromptRecord(r: UnknownRecord): boolean {
  return r.type === 'user' && r.isMeta !== true && typeof r.permissionMode === 'string'
}

/** True for a record carrying an assistant turn. */
export function isAssistantRecord(r: UnknownRecord): boolean {
  return r.type === 'assistant' && asObject(r.message) !== null
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

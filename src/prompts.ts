import { isPromptRecord, promptText, toolUses } from './records'
import type { Prompt, UnknownRecord } from './types'

/** A corrupt transcript can point a record at itself. The walk is capped rather than trusted. */
const MAX_HOPS = 10_000

/**
 * Holds every prompt in a session and the parent links needed to say which one
 * caused a given record. Attribution is structural, from the parentUuid chain,
 * so nothing here matches prose against file names.
 */
export class PromptIndex {
  private readonly parents: Map<string, string | null>
  private readonly byUuid: Map<string, Prompt>
  private readonly order: Prompt[]
  private readonly toolUseOwners: Map<string, string>

  constructor() {
    this.parents = new Map()
    this.byUuid = new Map()
    this.order = []
    this.toolUseOwners = new Map()
  }

  /** Takes one record in transcript order. Safe to call for records of every type. */
  observe(record: UnknownRecord): void {
    const uuid = typeof record.uuid === 'string' ? record.uuid : null
    if (uuid === null) return
    this.parents.set(uuid, typeof record.parentUuid === 'string' ? record.parentUuid : null)
    for (const use of toolUses(record)) this.toolUseOwners.set(use.id, uuid)

    if (!isPromptRecord(record)) return
    const prompt: Prompt = {
      id: typeof record.promptId === 'string' ? record.promptId : uuid,
      index: this.order.length + 1,
      uuid,
      text: promptText(record),
      at: typeof record.timestamp === 'string' ? record.timestamp : '',
      permissionMode: typeof record.permissionMode === 'string' ? record.permissionMode : '',
    }
    this.byUuid.set(uuid, prompt)
    this.order.push(prompt)
  }

  /** The prompt a record descends from, or null when it descends from none. */
  resolve(uuid: string): Prompt | null {
    let current: string | null | undefined = uuid
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      if (current === null || current === undefined) return null
      const prompt = this.byUuid.get(current)
      if (prompt !== undefined) return prompt
      const next: string | null | undefined = this.parents.get(current)
      if (next === current) return null
      current = next
    }
    return null
  }

  /**
   * The record that emitted a given tool call, or null when no record seen so
   * far did. A subagent transcript names the call that spawned it, and this is
   * what turns that name back into a place in the parent session's record
   * graph, so the walk to a prompt can carry on across the file boundary.
   */
  recordForToolUse(id: string): string | null {
    return this.toolUseOwners.get(id) ?? null
  }

  /** Every prompt, in the order it was typed. */
  all(): Prompt[] {
    return [...this.order]
  }
}

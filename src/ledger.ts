import { attest } from './attest'
import type { PromptIndex } from './prompts'
import { toolUses } from './records'
import type { Operation, OperationKind, UnknownRecord } from './types'

const KINDS: Record<string, OperationKind> = {
  Edit: 'edit',
  Write: 'write',
  NotebookEdit: 'notebook',
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * Orders two operations by their ISO 8601 timestamp, lexicographic order
 * being chronological order for that format. An empty timestamp (a record
 * this build could not read one from) sorts first rather than crashing or
 * being dropped, since `''` compares less than any non-empty string. Used
 * with a stable sort, so operations sharing a timestamp keep the order they
 * were observed in, which is correct for several tool calls issued in a
 * single assistant turn.
 */
const byTimestamp = (a: Operation, b: Operation): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

/**
 * Every change to every file in one session, in the order it happened. The
 * transcript carries each tool call's full input, so this needs nothing that
 * was not already written down.
 */
export class Ledger {
  private readonly ops: Operation[]
  private readonly modes: Set<string>

  constructor() {
    this.ops = []
    this.modes = new Set()
  }

  /** Takes one record in transcript order, along with the prompt index built so far. */
  observe(record: UnknownRecord, prompts: PromptIndex): void {
    const uuid = str(record.uuid)
    if (uuid === null) return

    for (const use of toolUses(record)) {
      const kind = KINDS[use.name]
      if (kind === undefined) continue
      const file = str(use.input.file_path) ?? str(use.input.notebook_path)
      if (file === null) continue

      const prompt = prompts.resolve(uuid)
      const result = attest({
        isSidechain: record.isSidechain === true,
        permissionMode: prompt?.permissionMode ?? null,
      })
      if (result.unrecognisedMode !== null) this.modes.add(result.unrecognisedMode)

      this.ops.push({
        file,
        kind,
        at: str(record.timestamp) ?? '',
        uuid,
        promptId: prompt?.id ?? null,
        attestation: result.label,
        oldString: str(use.input.old_string),
        newString: str(use.input.new_string),
        replaceAll: use.input.replace_all === true,
        content: str(use.input.content),
      })
    }
  }

  /**
   * Every operation, sorted into timestamp order. `analyseSession` observes
   * the main transcript before any subagent transcript, regardless of which
   * actually ran first, so transcript-observation order is not chronological
   * order and cannot be relied on here either.
   */
  operations(): Operation[] {
    return [...this.ops].sort(byTimestamp)
  }

  /**
   * Operations grouped by file, each group sorted into timestamp order. This
   * is what `findUndone` walks to decide which operation undid which, so an
   * unsorted group would let a subagent operation (observed after the main
   * transcript, but possibly timestamped before it) read as undoing a change
   * that in fact happened first.
   */
  byFile(): Map<string, Operation[]> {
    const grouped = new Map<string, Operation[]>()
    for (const op of this.ops) {
      const list = grouped.get(op.file)
      if (list === undefined) grouped.set(op.file, [op])
      else list.push(op)
    }
    for (const [file, ops] of grouped) grouped.set(file, [...ops].sort(byTimestamp))
    return grouped
  }

  /** Permission modes this build did not recognise, for the report to name. */
  unrecognisedModes(): string[] {
    return [...this.modes]
  }
}

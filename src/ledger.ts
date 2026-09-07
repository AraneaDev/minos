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

  /** Every operation, in transcript order. */
  operations(): Operation[] {
    return [...this.ops]
  }

  /** Operations grouped by file, each group still in transcript order. */
  byFile(): Map<string, Operation[]> {
    const grouped = new Map<string, Operation[]>()
    for (const op of this.ops) {
      const list = grouped.get(op.file)
      if (list === undefined) grouped.set(op.file, [op])
      else list.push(op)
    }
    return grouped
  }

  /** Permission modes this build did not recognise, for the report to name. */
  unrecognisedModes(): string[] {
    return [...this.modes]
  }
}

import { attest } from './attest'
import type { PromptIndex } from './prompts'
import { toolUses } from './records'
import type { Operation, OperationKind, ShellWrite, UnknownRecord } from './types'

const KINDS: Record<string, OperationKind> = {
  Edit: 'edit',
  Write: 'write',
  NotebookEdit: 'notebook',
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** A heredoc (not a `<<<` here-string): the operator line is kept, the body up to its terminator is dropped. */
const HEREDOC = /((?<!<)<<(?!<)-?[ \t]*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?(?:\n[ \t]*\3(?=\n|$)|$)/g

/** Single- and double-quoted strings, whose contents are code or text, not shell syntax. */
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g

/** A comment: a `#` at the start of a word, to the end of the line. */
const COMMENT = /(^|\s)#[^\n]*/g

/** Stands in for a quoted string while operators are matched; the index points into the saved strings. */
const HOLE = /\u0001(\d+)\u0001/g

/** A redirect used as a shell operator, with its target: not `=>`, `->`, `<>`, `>=` or `>&2`. */
const REDIRECT = /(?:^|[\s;|&(\w])\d?>>?(?![=&])[ \t]*(\S+)/g

/**
 * `tee`, `mv` or `rm` in command position (first in the command, after `;`,
 * `|`, `&` or `(`, optionally behind `sudo` or `xargs`), past any flags, with
 * its first path token. `git rm` and `docker rm` are arguments, so they miss.
 */
const FILE_COMMAND =
  /(?:^|[;|&(\n])\s*(?:(?:sudo|xargs)\s+(?:-\S+\s+)*)?(?:tee|mv|rm)(?=[\s;|&)]|$)(?:[ \t]+-\S+)*(?:[ \t]+(\S+))?/g

const SED_INPLACE = /(?:^|[\s;|&(])sed[ \t]+-i\b/

/** Targets outside the working tree: temp files and devices. */
const OUTSIDE_TREE = /^(?:\/tmp\/|\/dev\/|\$TMPDIR|\$\{TMPDIR)/

/**
 * True when a shell command looks like it writes a file in the working tree.
 * Heredoc bodies, quoted strings and comments are taken out before the
 * operators are matched, so code handed to `bun -e` or `php -r` never
 * matches; a quoted target is put back before its path is judged. A
 * heuristic: a write through an interpreter is missed, and so is one whose
 * target is built in a variable.
 */
function looksLikeWrite(command: string): boolean {
  const quoted: string[] = []
  const bare = command
    .replace(HEREDOC, '$1')
    .replace(QUOTED, (q) => `\u0001${quoted.push(q.slice(1, -1)) - 1}\u0001`)
    .replace(COMMENT, '$1')
  const outside = (target: string | undefined): boolean => OUTSIDE_TREE.test((target ?? '').replace(HOLE, (_, i: string) => quoted[Number(i)] ?? ''))
  if (SED_INPLACE.test(bare)) return true
  for (const m of bare.matchAll(REDIRECT)) if (!outside(m[1])) return true
  for (const m of bare.matchAll(FILE_COMMAND)) if (!outside(m[1])) return true
  return false
}

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
  private readonly shell: ShellWrite[] = []

  constructor() {
    this.ops = []
    this.modes = new Set()
  }

  /** Takes one record in transcript order, along with the prompt index built so far. */
  observe(record: UnknownRecord, prompts: PromptIndex): void {
    const uuid = str(record.uuid)
    if (uuid === null) return

    for (const use of toolUses(record)) {
      const command = use.name === 'Bash' ? str(use.input.command) : null
      if (command !== null && looksLikeWrite(command)) {
        const prompt = prompts.resolve(uuid)
        const result = attest({ isSidechain: record.isSidechain === true, permissionMode: prompt?.permissionMode ?? null })
        this.shell.push({ toolUseId: use.id, at: str(record.timestamp) ?? '', attestation: result.label })
      }
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
        toolUseId: use.id,
        permissionMode: prompt?.permissionMode ? prompt.permissionMode : null,
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

  /**
   * Bash calls that look like file writes, in timestamp order. Separate from
   * `operations` on purpose: the diff is not in the transcript, so none of
   * these can be called a change, only a possibly unseen one.
   */
  shellWrites(): ShellWrite[] {
    return [...this.shell].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  }

  /** Permission modes this build did not recognise, for the report to name. */
  unrecognisedModes(): string[] {
    return [...this.modes]
  }
}

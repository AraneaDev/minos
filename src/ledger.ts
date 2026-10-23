import { attest } from './attest'
import type { PromptIndex } from './prompts'
import { failedToolResults, toolUses } from './records'
import type { Operation, OperationKind, ShellWrite, UnknownRecord } from './types'

const KINDS: Record<string, OperationKind> = {
  Edit: 'edit',
  Write: 'write',
  NotebookEdit: 'notebook',
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** A heredoc (not a `<<<` here-string): the operator line is kept, the body up to its terminator is dropped. */
const HEREDOC = /((?<!<)<<(?!<)-?[ \t]*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?(?:\n[ \t]*\3(?=\n|$)|$)/g

/** Stands in for a quoted string while operators are matched; the index points into the saved strings. */
const HOLE = /\u0001(\d+)\u0001/g

/** A redirect used as a shell operator, with its target: not `=>`, `->`, `<>`, `>=` or `>&2`. */
const REDIRECT = /(^|[\s;|&(\w])(\d?)>>?(?![=&])[ \t]*(\S+)/g

/** How far back from a `>` the word it closes is looked at, which keeps the check linear. */
const TYPE_LOOKBACK = 256

/** What separates one simple command from the next. */
const SEPARATOR = /[;|&()`\n]/

/** Reserved words after which the next word is in command position again. */
const KEYWORDS: ReadonlySet<string> = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!'])

/** Commands that run the word after their flags as a command of its own. */
const WRAPPERS: ReadonlySet<string> = new Set(['sudo', 'xargs'])

/** A leading `VAR=value` assignment, which leaves the next word in command position. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/

/** Commands whose first path argument is a file they write or remove. */
const FILE_COMMANDS: ReadonlySet<string> = new Set(['tee', 'mv', 'rm'])

/** A short-flag cluster holding `i`, as in `-i`, `-Ei` or `-i.bak`. */
const SED_SHORT_INPLACE = /^-[A-Za-z]*i/

/** Targets outside the working tree: temp files and devices. */
const OUTSIDE_TREE = /^(?:\/tmp\/|\/dev\/|\$TMPDIR|\$\{TMPDIR)/

/**
 * Replaces quoted strings, escaped characters and comments in one pass, so
 * nothing inside them is read as shell syntax. Each quoted string and each
 * escaped character becomes a hole whose contents are saved in `quoted`; a
 * comment (a `#` at the start of a word) is dropped to the end of its line;
 * a backslash-newline is a line continuation and reads as a space. Handles
 * `'...'`, `"..."` with backslash escapes, and `$'...'` with backslash
 * escapes; an unterminated quote runs to the end. Each character is visited
 * once, so a long run of escapes costs linear time.
 */
function stripQuotes(text: string, quoted: string[]): string {
  const out: string[] = []
  const hole = (contents: string): void => {
    out.push(`\u0001${quoted.push(contents) - 1}\u0001`)
  }
  /** The index of the quote that closes one opened at `from`, honouring backslash escapes; `text.length` when none does. */
  const closing = (from: number, quote: string): number => {
    let j = from
    while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
    return Math.min(j, text.length)
  }
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === '\\') {
      if (text[i + 1] === '\n') out.push(' ')
      else hole(text[i + 1] ?? '')
      i += 2
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1)
      const stop = end === -1 ? text.length : end
      hole(text.slice(i + 1, stop))
      i = stop + 1
    } else if (c === '$' && text[i + 1] === "'") {
      const stop = closing(i + 2, "'")
      hole(text.slice(i + 2, stop))
      i = stop + 1
    } else if (c === '"') {
      const stop = closing(i + 1, '"')
      hole(text.slice(i + 1, stop))
      i = stop + 1
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1] as string))) {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
    } else {
      out.push(c)
      i++
    }
  }
  return out.join('')
}

/**
 * True when the `>` at `at` closes a type such as `Array<string>` or
 * `Map<K,V>`: it follows a word character and the word it ends holds a `<`.
 * `echo x>f` has no `<` in its word, so it stays a redirect.
 */
function closesType(bare: string, at: number): boolean {
  if (!/\w/.test(bare[at - 1] ?? '')) return false
  for (let j = at - 1; j >= Math.max(0, at - TYPE_LOOKBACK); j--) {
    const c = bare[j] as string
    if (c === '<') return true
    if (/\s/.test(c) || SEPARATOR.test(c)) return false
  }
  return false
}

/** True when the words after a `sed` carry `-i` among its leading flags, or `--in-place`. */
function sedInPlace(flags: string[]): boolean {
  for (const flag of flags) {
    if (!flag.startsWith('-')) return false
    if (flag === '--in-place' || flag.startsWith('--in-place=')) return true
    if (!flag.startsWith('--') && SED_SHORT_INPLACE.test(flag)) return true
  }
  return false
}

/**
 * True when a shell command looks like it writes a file in the working tree.
 * Heredoc bodies, quoted strings, escaped characters and comments are taken
 * out before the operators are matched, so code handed to `bun -e` or
 * `php -r` never matches; a quoted target is put back before its path is
 * judged. `tee`, `mv` and `rm` count in command position: first in a simple
 * command, after a reserved word such as `then` or `{`, after `VAR=value`
 * assignments, or behind `sudo` or `xargs` and their flags. `git rm` and
 * `docker rm` are arguments, so they miss. `sed -i` counts wherever `sed` is
 * a word, so `find -exec sed -i` is seen. A heuristic: a write through an
 * interpreter is missed, and so is one whose target is built in a variable.
 */
function looksLikeWrite(command: string): boolean {
  const quoted: string[] = []
  const bare = stripQuotes(command.replace(HEREDOC, '$1'), quoted)
  const outside = (target: string | undefined): boolean => OUTSIDE_TREE.test((target ?? '').replace(HOLE, (_, i: string) => quoted[Number(i)] ?? ''))

  for (const m of bare.matchAll(REDIRECT)) {
    const at = (m.index ?? 0) + (m[1] ?? '').length + (m[2] ?? '').length
    if (!closesType(bare, at) && !outside(m[3])) return true
  }

  for (const simple of bare.split(SEPARATOR)) {
    const words = simple.split(/\s+/).filter((w) => w !== '')
    for (let k = 0; k < words.length; k++) if (words[k] === 'sed' && sedInPlace(words.slice(k + 1))) return true
    let i = 0
    while (i < words.length) {
      const word = words[i] as string
      if (KEYWORDS.has(word) || ASSIGNMENT.test(word)) i++
      else if (WRAPPERS.has(word)) {
        i++
        while (words[i]?.startsWith('-') === true) i++
      } else break
    }
    if (!FILE_COMMANDS.has(words[i] ?? '')) continue
    i++
    while (words[i]?.startsWith('-') === true) i++
    if (!outside(words[i])) return true
  }
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
  /** Tool calls whose result was an error or a denial, so a shell write among them never ran. */
  private readonly failed = new Set<string>()

  constructor() {
    this.ops = []
    this.modes = new Set()
  }

  /** Takes one record in transcript order, along with the prompt index built so far. */
  observe(record: UnknownRecord, prompts: PromptIndex): void {
    for (const id of failedToolResults(record)) this.failed.add(id)
    const uuid = str(record.uuid)
    if (uuid === null) return

    // Resolved once per record, and only when a tool call on it needs it:
    // a shell write and a change on the same record share the answer.
    let resolved: { prompt: ReturnType<PromptIndex['resolve']>; label: Operation['attestation']; unrecognised: string | null } | null = null
    const attestation = (): NonNullable<typeof resolved> => {
      if (resolved !== null) return resolved
      const prompt = prompts.resolve(uuid)
      const result = attest({ isSidechain: record.isSidechain === true, permissionMode: prompt?.permissionMode ?? null })
      resolved = { prompt, label: result.label, unrecognised: result.unrecognisedMode }
      return resolved
    }

    for (const use of toolUses(record)) {
      const command = use.name === 'Bash' ? str(use.input.command) : null
      if (command !== null && looksLikeWrite(command)) {
        this.shell.push({ toolUseId: use.id, at: str(record.timestamp) ?? '', attestation: attestation().label })
      }
      const kind = KINDS[use.name]
      if (kind === undefined) continue
      const file = str(use.input.file_path) ?? str(use.input.notebook_path)
      if (file === null) continue

      const { prompt, label, unrecognised } = attestation()
      // Only a change is counted as auto, so only a change names its mode.
      if (unrecognised !== null) this.modes.add(unrecognised)
      this.ops.push({
        file,
        kind,
        at: str(record.timestamp) ?? '',
        uuid,
        toolUseId: use.id,
        permissionMode: prompt?.permissionMode ? prompt.permissionMode : null,
        promptId: prompt?.id ?? null,
        attestation: label,
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
   * these can be called a change, only a possibly unseen one. A call whose
   * result was an error or a permission denial is left out, whichever order
   * the call and its result were observed in.
   */
  shellWrites(): ShellWrite[] {
    return this.shell.filter((w) => !this.failed.has(w.toolUseId)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  }

  /** Permission modes this build did not recognise, for the report to name. */
  unrecognisedModes(): string[] {
    return [...this.modes]
  }
}

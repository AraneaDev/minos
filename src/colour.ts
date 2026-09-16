/**
 * The colour scheme, as it applies to one line of any minos command's output.
 *
 * The colours are not decoration: they are the four things Minos reports.
 * `decided`, `auto`, `subagent` and the undone kinds each keep one colour
 * everywhere they appear, so the classification is legible before a word of it
 * is read.
 *
 * Roles rather than colours, because two renderers need the same rules: this
 * one writes ANSI to a terminal, and `scripts/terminal-svg.ts` writes `tspan`
 * fills into the cards in the README. A second copy of the rules would drift,
 * and then the screenshot would promise something the terminal does not do.
 */

/** What a run means. The renderer decides what that looks like. */
export type Role = 'body' | 'dim' | 'bone' | 'decided' | 'auto' | 'subagent' | 'undone'

/** One coloured run inside a line. */
export interface Run {
  text: string
  role: Role
}

/** What the decision needs to know about the stream it is about to write to. */
export interface ColourContext {
  isTTY: boolean
  env: Record<string, string | undefined>
}

/**
 * Decides whether to emit escapes at all.
 *
 * A pipe gets none, because the plugin renders `minos` output inside a fenced
 * code block and `minos export` is JSON that a caller parses: an escape in
 * either is corruption rather than colour. `NO_COLOR` refuses whatever its
 * value, per no-color.org, and beats `FORCE_COLOR`, since between a reader who
 * asked for none and one who asked for some, honouring the refusal is the
 * safer mistake.
 * @param context the stream's TTY flag and the environment around it
 * @returns true when colour may be written
 */
export function colourEnabled(context: ColourContext): boolean {
  if (context.env.NO_COLOR !== undefined) return false
  if (context.env.FORCE_COLOR !== undefined) return true
  if (context.env.TERM === 'dumb') return false
  return context.isTTY
}

/**
 * Splits a line into runs. `parts` is a list of [pattern, role] applied in
 * order against the whole line, so an earlier pattern wins a region a later
 * one would also match.
 * @param line the line to split
 * @param rest the role for everything no pattern claimed
 * @param parts the patterns, in precedence order
 * @returns the runs, in the order they appear in the line
 */
function split(line: string, rest: Role, parts: [RegExp, Role][]): Run[] {
  const out: Run[] = []
  let index = 0
  const marks: { start: number; end: number; role: Role }[] = []

  for (const [pattern, role] of parts) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match = re.exec(line)
    while (match !== null) {
      const start = match.index
      const end = start + match[0].length
      if (!marks.some((m) => start < m.end && end > m.start)) marks.push({ start, end, role })
      match = re.exec(line)
    }
  }

  for (const mark of marks.sort((a, b) => a.start - b.start)) {
    if (mark.start > index) out.push({ text: line.slice(index, mark.start), role: rest })
    out.push({ text: line.slice(mark.start, mark.end), role: mark.role })
    index = mark.end
  }
  if (index < line.length) out.push({ text: line.slice(index), role: rest })
  return out
}

/**
 * The runs one line of output splits into.
 *
 * Every character of the line comes back exactly once and in order: the report
 * is space-aligned text whose columns carry meaning, so a rule that dropped or
 * moved a character would move a column with it.
 * @param line one line of any minos command's output
 * @returns the runs it splits into
 */
export function runsFor(line: string): Run[] {
  // The tool's own voice: the report's section names, and the two headings
  // `minos file` prints over a single file's history.
  if (/^(MINOS|CHANGED|APPLIED WITHOUT ASKING|UNDONE|BY PROMPT)/.test(line)) {
    return split(line, 'bone', [[/\+\d+|-\d+|\d+ files?|\d+ changes?|\d+ prompts?/, 'body']])
  }
  if (/^\S.*: (\d+ of its changes|no operations|\d+ operations?)/.test(line)) {
    return split(line, 'bone', [[/^\S+(?=:)/, 'body']])
  }
  // The caveats, in both their forms: parenthetical and trailing prose.
  if (/^ {2}\(/.test(line) || /^ {2}[a-z]/.test(line) && !/^ {2}(decided|auto|subagent)\s/.test(line)) {
    return [{ text: line, role: 'dim' }]
  }
  // The three classes, wherever they are named.
  if (/^ {2}decided\s/.test(line)) return split(line, 'body', [[/decided|you were asked before it was applied/, 'decided']])
  if (/^ {2}auto\s/.test(line)) return split(line, 'body', [[/\bauto\b|acceptEdits or auto, no prompt/, 'auto']])
  if (/^ {2}subagent\s/.test(line)) return split(line, 'body', [[/subagent|applied inside a subagent, never rendered/, 'subagent']])

  return split(line, 'body', [
    [/\b(overwritten|reverted|discarded)\b/, 'undone'],
    [/\bdecided\b/, 'decided'],
    [/\bsubagent\b/, 'subagent'],
    [/\bauto\b/, 'auto'],
    [/\bundone \d+/, 'undone'],
    [/\d{2}:\d{2}(\+\d+d|-\d+d)?/, 'dim'],
    [/"[^"]*"/, 'dim'],
    [/\(unattributed\)/, 'dim'],
    [/^ {2}#\s+when.*$/, 'dim'],
  ])
}

/**
 * The palette, as 24-bit foreground escapes.
 *
 * The same seven values the cards in the README use, so a reader who has seen
 * one recognises the other. `body` is the exception: it resets to the
 * terminal's own foreground rather than painting the card's off-white, because
 * a card knows what it sits on and a terminal does not.
 */
const CODE: Record<Role, string> = {
  body: '\u001b[39m',
  dim: '\u001b[38;2;99;112;127m',
  bone: '\u001b[38;2;236;229;213m',
  decided: '\u001b[38;2;127;179;163m',
  auto: '\u001b[38;2;216;161;63m',
  subagent: '\u001b[38;2;154;143;208m',
  undone: '\u001b[38;2;207;106;99m',
}

const RESET = '\u001b[0m'

/**
 * Colours a whole command's output, or hands it back untouched.
 *
 * Every line closes with a reset, so a report interrupted half way leaves the
 * terminal as it found it.
 * @param text the output as the command wrote it
 * @param enabled whether escapes may be written, from {@link colourEnabled}
 * @returns the output, painted or exactly as it came in
 */
export function paint(text: string, enabled: boolean): string {
  if (!enabled) return text
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : runsFor(line).map((r) => CODE[r.role] + r.text).join('') + RESET))
    .join('\n')
}

/**
 * Renders a Claude Code session with the Minos pane docked beside it, as an
 * SVG card for the README, from a real session.
 *
 * The left column is the conversation as Claude Code draws it, read from the
 * session's own transcript: each prompt (`> `), each Edit and Write as
 * `⏺ Update(path)` with its diff, a subagent as `⏺ Agent(...)`, a call to the
 * Minos tool, and the agent's replies. Reads, searches and every other tool
 * are left out: they change nothing, and they can carry what is nobody's
 * business (a calendar, a shell). The right column is the pane, laid out by
 * its own `paneRows` from the same `minos ledger --json` and
 * `minos sessions --json` it reads, with one file opened as a press opens it
 * (its changes and their diffs, from `minos file --json`). The prompt box and
 * the mode line sit under both, as in the terminal.
 *
 * Usage: bun run scripts/session-svg.ts <transcript.jsonl> <session> <project> <out.svg> [file to open]
 */
import { paneRows } from '../hooks/layout'
import type { Segment } from '../hooks/layout'
import { cells, fit } from '../hooks/text'
import type { MinosEdit, MinosHistory, MinosLedger, MinosSession } from '../types'

const GROUND = '#10151d'
const BODY = '#b8c0cb'
const DIM = '#63707f'
const BONE = '#ece5d5'
const FRAME = '#3a4553'
const CLAUDE = '#d97757'
const ADDED_BG = '#1d3326'
const REMOVED_BG = '#3a1f22'
const THEME: Record<string, string> = {
  success: '#7fb3a3',
  warning: '#d8a13f',
  suggestion: '#9a8fd0',
  error: '#cf6a63',
  subtle: FRAME,
  claude: CLAUDE,
  inactive: DIM,
}

const FONT_SIZE = 13
const LINE_HEIGHT = 19
const CHAR_WIDTH = FONT_SIZE * 0.6
const PAD = 22
const FONT = 'ui-monospace, SFMono-Regular, &#34;SF Mono&#34;, Menlo, Consolas, &#34;DejaVu Sans Mono&#34;, monospace'

/** Columns: the chat, the rule between, the pane. */
const CHAT = 84
const GAP = 3
const PANE = 80
/** Rows the chat and pane share above the prompt box. */
const BODY_ROWS = 40

/** A drawn line: runs of text, and an optional background across the whole line. */
type Line = { runs: Segment[]; bg?: string }

const [transcript, session, project, out, open] = process.argv.slice(2)
if (transcript === undefined || session === undefined || project === undefined || out === undefined) {
  throw new Error('usage: session-svg.ts <transcript.jsonl> <session> <project> <out.svg>')
}

/** Runs this repository's CLI and returns what it printed. */
async function cli(args: string[]): Promise<string> {
  const run = Bun.spawn(['bun', `${import.meta.dir}/../src/cli.ts`, ...args], { stdout: 'pipe', stderr: 'pipe', cwd: project })
  const text = await new Response(run.stdout).text()
  if ((await run.exited) !== 0) throw new Error(`minos ${args.join(' ')} failed: ${await new Response(run.stderr).text()}`)
  return text
}

const shown = (path: string): string => (path.startsWith(`${project}/`) ? path.slice(project.length + 1) : path)

/** Words wrapped to `width`, the first line led by `lead` and the rest indented to match. */
function wrap(text: string, width: number, lead: Segment, rest: Omit<Segment, 'text'> = {}): Line[] {
  const room = width - cells(lead.text)
  const out: Line[] = []
  let line = ''
  const push = () => out.push({ runs: [out.length === 0 ? lead : { text: ' '.repeat(cells(lead.text)) }, { ...rest, text: line }] })
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (line === '') line = word
    else if (cells(line) + 1 + cells(word) <= room) line = `${line} ${word}`
    else {
      push()
      line = word
    }
  }
  if (line !== '') push()
  return out
}

/** One Edit or Write as Claude Code shows it: the call, a summary line, and the diff on its colours. */
function editLines(name: string, input: Record<string, unknown>): Line[] {
  const path = shown(String(input.file_path ?? ''))
  const removed = name === 'Write' ? [] : String(input.old_string ?? '').split('\n')
  const added = String((name === 'Write' ? input.content : input.new_string) ?? '').replace(/\n$/, '').split('\n')
  const diff = (sign: string, text: string, bg: string | undefined, color: string | undefined): Line => ({
    runs: [{ text: `      ${sign} `, ...(color === undefined ? { dim: true } : { color }) }, { text: fit(text, CHAT - 8) }],
    ...(bg === undefined ? {} : { bg }),
  })
  // Lines the old and new strings share at either end are context, drawn plain, as Claude Code draws them.
  let head = 0
  while (head < removed.length && head < added.length && removed[head] === added[head]) head++
  let tail = 0
  while (tail < removed.length - head && tail < added.length - head && removed[removed.length - 1 - tail] === added[added.length - 1 - tail]) tail++
  const plus = added.length - head - tail
  const minus = removed.length - head - tail
  const summary = `Updated ${path} with ${plus} ${plus === 1 ? 'addition' : 'additions'} and ${minus} ${minus === 1 ? 'removal' : 'removals'}`
  return [
    { runs: [{ text: '⏺ ', color: 'success' }, { text: `${name === 'Write' ? 'Write' : 'Update'}(`, bold: true }, { text: path }, { text: ')', bold: true }] },
    { runs: [{ text: '  ⎿  ', dim: true }, { text: summary, dim: true }] },
    ...removed.slice(0, head).map((l) => diff(' ', l, undefined, undefined)),
    ...removed.slice(head, removed.length - tail).slice(0, 6).map((l) => diff('-', l, REMOVED_BG, 'error')),
    ...added.slice(head, added.length - tail).slice(0, 6).map((l) => diff('+', l, ADDED_BG, 'success')),
    ...added.slice(added.length - tail).map((l) => diff(' ', l, undefined, undefined)),
  ]
}

const records = (await Bun.file(transcript).text())
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l) as { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    } catch {
      return null
    }
  })
  .filter((r) => r !== null)

const chat: Line[] = []
for (const r of records) {
  const content = r.message?.content
  if (r.type === 'user' && r.isMeta !== true && typeof content === 'string') {
    chat.push({ runs: [] }, ...wrap(content, CHAT, { text: '> ', dim: true }, { dim: true }), { runs: [] })
  }
  if (r.type !== 'assistant' || !Array.isArray(content)) continue
  for (const b of content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
    if (b.type === 'text' && b.text !== undefined) chat.push(...wrap(b.text.split('\n')[0] ?? '', CHAT, { text: '⏺ ' }), { runs: [] })
    if (b.type !== 'tool_use' || b.input === undefined) continue
    if (b.name === 'Edit' || b.name === 'Write') chat.push(...editLines(b.name, b.input), { runs: [] })
    if (b.name === 'Agent') {
      chat.push(
        { runs: [{ text: '⏺ ', color: 'success' }, { text: 'Agent(', bold: true }, { text: String(b.input.description ?? '') }, { text: ')', bold: true }] },
        { runs: [{ text: '  ⎿  ', dim: true }, { text: 'Done', dim: true }] },
        { runs: [] },
      )
    }
    if (b.name === 'mcp__minos__minos_ledger') {
      chat.push(
        { runs: [{ text: '⏺ ', color: 'success' }, { text: 'minos - minos_ledger', bold: true }, { text: ' (MCP)', dim: true }] },
        { runs: [{ text: '  ⎿  ', dim: true }, { text: 'MINOS  ledger  session …', dim: true }] },
        { runs: [] },
      )
    }
  }
}
// The conversation's tail, as a terminal scrolled to the bottom shows it.
const tail = chat.slice(-BODY_ROWS)

const ledger = (JSON.parse(await cli(['ledger', '--json', '--session', session, '--project', project])) as { display: MinosLedger }).display
const sessions = (JSON.parse(await cli(['sessions', '--json', '--limit', '6', '--project', project])) as { sessions: MinosSession[] }).sessions
const history: MinosHistory | null =
  open === undefined
    ? null
    : { file: open, text: '', edits: (JSON.parse(await cli(['file', open, '--json', '--session', session, '--project', project])) as { edits: MinosEdit[] }).edits }

/** A diff block as Claude Code colours one: removed and added lines on their grounds, hunk headers dim. */
const codeLines = (source: string): Line[] =>
  source.split('\n').map((l) =>
    l.startsWith('@@')
      ? { runs: [{ text: `  ${fit(l, PANE - 2)}`, dim: true }] }
      : l.startsWith('-')
        ? { runs: [{ text: '  - ', color: 'error' }, { text: fit(l.slice(1), PANE - 4) }], bg: REMOVED_BG }
        : l.startsWith('+')
          ? { runs: [{ text: '  + ', color: 'success' }, { text: fit(l.slice(1), PANE - 4) }], bg: ADDED_BG }
          : { runs: [{ text: `    ${fit(l, PANE - 4)}` }] },
  )

const pane: Line[] = paneRows(ledger, [], history, PANE, sessions)
  .flatMap((r): Line[] => (r.code === undefined ? [{ runs: r.segments }] : codeLines(r.code.source)))
  .slice(0, BODY_ROWS)

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One run's colour and weight as SVG attributes. */
function paint(s: Segment): string {
  const fill = s.color !== undefined ? (THEME[s.color] ?? BODY) : s.dim === true ? DIM : s.bold === true ? BONE : BODY
  return [`fill="${fill}"`, s.bold === true ? 'font-weight="bold"' : '', s.italic === true ? 'font-style="italic"' : ''].filter(Boolean).join(' ')
}

const width = Math.ceil((CHAT + GAP + PANE) * CHAR_WIDTH + PAD * 2)
const footerRows = 4
const height = (BODY_ROWS + footerRows) * LINE_HEIGHT + PAD * 2
const y = (row: number): number => PAD + LINE_HEIGHT * (row + 1) - 5
const x = (col: number): number => PAD + col * CHAR_WIDTH

const drawn: string[] = []
const text = (line: Line, row: number, col: number, span: number) => {
  if (line.bg !== undefined) drawn.push(`  <rect x="${x(col)}" y="${y(row) - LINE_HEIGHT + 6}" width="${span * CHAR_WIDTH}" height="${LINE_HEIGHT}" fill="${line.bg}"/>`)
  const spans = line.runs.map((s) => `<tspan ${paint(s)}>${escapeXml(s.text)}</tspan>`).join('')
  if (spans !== '') drawn.push(`  <text x="${x(col)}" y="${y(row)}" xml:space="preserve">${spans}</text>`)
}
tail.forEach((line, i) => text(line, i, 0, CHAT))
pane.forEach((line, i) => text(line, i, CHAT + GAP, PANE))

// The rule between the chat and the pane, as the terminal draws a docked pane.
const ruleX = x(CHAT + 1) + CHAR_WIDTH / 2
drawn.push(`  <line x1="${ruleX}" y1="${PAD}" x2="${ruleX}" y2="${y(BODY_ROWS - 1) + 6}" stroke="${FRAME}" stroke-width="1"/>`)

// The prompt box and the mode line under both columns.
const boxTop = y(BODY_ROWS) - LINE_HEIGHT + 10
const boxWidth = (CHAT + GAP + PANE) * CHAR_WIDTH
drawn.push(`  <rect x="${PAD}" y="${boxTop}" width="${boxWidth}" height="${LINE_HEIGHT * 2}" rx="6" fill="none" stroke="${FRAME}"/>`)
text({ runs: [{ text: '> ', dim: true }] }, BODY_ROWS + 1, 1, 2)
text({ runs: [{ text: '⏵⏵ accept edits on', color: 'suggestion' }, { text: ' (shift+tab to cycle)', dim: true }] }, BODY_ROWS + 3, 1, 60)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}">
  <rect width="${width}" height="${height}" rx="8" fill="${GROUND}"/>
${drawn.join('\n')}
</svg>
`

await Bun.write(out, svg)
console.log(`${out}  ${width}x${height}  chat ${tail.length} of ${chat.length} lines, pane ${pane.length} rows`)

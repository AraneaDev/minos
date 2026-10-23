/**
 * Renders the live pane as an SVG card for the README, from a real session.
 *
 * The rows are the pane's own: `paneRows` from hooks/layout.ts lays out the
 * same `minos ledger --json` and `minos sessions --json` the pane reads, at a
 * chosen width, and each row becomes one `<text>` with its runs as `<tspan>`s,
 * monospaced and space-preserving, in the palette the other cards use. So the
 * picture is what the pane draws, not a drawing of it.
 *
 * The undo notes a live pane collects while the session runs are left out: a
 * finished session has no hook left to raise them, and rebuilding them from
 * the undone list would only repeat the card above them.
 *
 * Usage: bun run scripts/pane-svg.ts <session> <project> <columns> <out.svg>
 */
import { paneRows } from '../hooks/layout'
import type { Segment } from '../hooks/layout'
import type { MinosLedger, MinosSession } from '../types'

const GROUND = '#10151d'
const RULE = '#26303d'
const BODY = '#b8c0cb'
const DIM = '#63707f'
const BONE = '#ece5d5'
const FRAME = '#3a4553'
const CLAUDE = '#d97757'

/** The pane's theme colours, mapped onto the README cards' palette. */
const THEME: Record<string, string> = {
  success: '#7fb3a3',
  warning: '#d8a13f',
  suggestion: '#9a8fd0',
  error: '#cf6a63',
  subtle: FRAME,
  claude: CLAUDE,
  inactive: DIM,
}

const FONT_SIZE = 14
const LINE_HEIGHT = 21
const CHAR_WIDTH = FONT_SIZE * 0.6
const PAD = 26
const FONT = 'ui-monospace, SFMono-Regular, &#34;SF Mono&#34;, Menlo, Consolas, &#34;DejaVu Sans Mono&#34;, monospace'

const [session, project, columnsArg, out] = process.argv.slice(2)
if (session === undefined || project === undefined || columnsArg === undefined || out === undefined) {
  throw new Error('usage: pane-svg.ts <session> <project> <columns> <out.svg>')
}
const columns = Number(columnsArg)

/** Runs this repository's CLI and returns what it printed. */
async function cli(args: string[]): Promise<string> {
  const run = Bun.spawn(['bun', `${import.meta.dir}/../src/cli.ts`, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(run.stdout).text()
  if ((await run.exited) !== 0) throw new Error(`minos ${args.join(' ')} failed: ${await new Response(run.stderr).text()}`)
  return text
}

const ledger = (JSON.parse(await cli(['ledger', '--json', '--session', session, '--project', project])) as { display: MinosLedger }).display
const sessions = (JSON.parse(await cli(['sessions', '--json', '--limit', '6', '--project', project])) as { sessions: MinosSession[] }).sessions
const rows = paneRows(ledger, [], null, columns, sessions)

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One run's colour and weight as SVG attributes. */
function paint(s: Segment): string {
  const fill = s.color !== undefined ? (THEME[s.color] ?? BODY) : s.dim === true ? DIM : s.bold === true ? BONE : BODY
  return [`fill="${fill}"`, s.bold === true ? 'font-weight="bold"' : '', s.italic === true ? 'font-style="italic"' : ''].filter(Boolean).join(' ')
}

const lines = [[{ text: '/minos', color: undefined } as Segment], [] as Segment[], ...rows.map((r) => r.segments)]
const width = Math.ceil(columns * CHAR_WIDTH + PAD * 2)
const height = lines.length * LINE_HEIGHT + PAD * 2 + 6

const texts = lines.map((segments, i) => {
  const y = PAD + LINE_HEIGHT * (i + 1) - 5
  const spans =
    i === 0
      ? `<tspan fill="${BONE}">/minos</tspan>`
      : segments.map((s) => `<tspan ${paint(s)}>${escapeXml(s.text)}</tspan>`).join('')
  return `  <text x="${PAD}" y="${y}" xml:space="preserve">${spans}</text>`
})

// The rule under the command line, as on the other cards: the only chrome.
const ruleY = PAD + LINE_HEIGHT + 5

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}">
  <rect width="${width}" height="${height}" rx="8" fill="${GROUND}"/>
  <line x1="${PAD}" y1="${ruleY}" x2="${width - PAD}" y2="${ruleY}" stroke="${RULE}" stroke-width="1"/>
${texts.join('\n')}
</svg>
`

await Bun.write(out, svg)
console.log(`${out}  ${width}x${height}  ${rows.length} rows`)

/**
 * Renders captured `minos` output as an SVG card for the README.
 *
 * The report is space-aligned text whose columns carry meaning, so the card
 * has to be monospaced and cannot reflow. Each line becomes one `<text>` with
 * `xml:space="preserve"`, and coloured runs inside it become `<tspan>`s, which
 * share the line's advance flow and so cannot push a column out of true.
 *
 * The colours are not decoration: they are the four things Minos reports.
 * `decided`, `auto`, `subagent` and the undone kinds each keep one colour
 * everywhere they appear, so the classification is legible from across the
 * room before a word of it is read.
 *
 * Usage: bun run scripts/terminal-svg.ts "<command>" <out.svg> < output.txt
 */
import { runsFor, type Role } from '../src/colour'

const GROUND = '#10151d'
const RULE = '#26303d'
const BODY = '#b8c0cb'
const DIM = '#63707f'
const BONE = '#ece5d5'
const DECIDED = '#7fb3a3'
const AUTO = '#d8a13f'
const SUBAGENT = '#9a8fd0'
const UNDONE = '#cf6a63'

const FONT_SIZE = 14
const LINE_HEIGHT = 21
const CHAR_WIDTH = FONT_SIZE * 0.6
const PAD = 26
const FONT = 'ui-monospace, SFMono-Regular, &#34;SF Mono&#34;, Menlo, Consolas, &#34;DejaVu Sans Mono&#34;, monospace'

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The palette. The rules that decide which role a run has live in
 * `src/colour.ts`, next to the ones the terminal paints with, so a card and a
 * session on screen cannot disagree about what a colour means.
 */
const FILL: Record<Role, string> = {
  body: BODY,
  dim: DIM,
  bone: BONE,
  decided: DECIDED,
  auto: AUTO,
  subagent: SUBAGENT,
  undone: UNDONE,
}

const command = process.argv[2] ?? 'minos report'
const out = process.argv[3]
if (out === undefined) throw new Error('usage: terminal-svg.ts "<command>" <out.svg> < output.txt')

const body = (await Bun.stdin.text()).replace(/\n+$/, '').split('\n')
const lines = [`$ ${command}`, '', ...body]
const columns = Math.max(...lines.map((l) => l.length))
const width = Math.ceil(columns * CHAR_WIDTH + PAD * 2)
const height = lines.length * LINE_HEIGHT + PAD * 2 + 6

const texts = lines.map((line, i) => {
  const y = PAD + LINE_HEIGHT * (i + 1) - 5
  const parts = i === 0
    ? [{ text: '$ ', fill: DIM }, { text: line.slice(2), fill: BONE }]
    : runsFor(line).map((r) => ({ text: r.text, fill: FILL[r.role] }))
  const spans = parts.map((r) => `<tspan fill="${r.fill}">${escapeXml(r.text)}</tspan>`).join('')
  return `  <text x="${PAD}" y="${y}" xml:space="preserve">${spans}</text>`
})

// The rule sits under the command line, separating what was typed from what
// came back. It is the card's only chrome: no title bar, no window buttons.
const ruleY = PAD + LINE_HEIGHT + 5

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}">
  <rect width="${width}" height="${height}" rx="8" fill="${GROUND}"/>
  <line x1="${PAD}" y1="${ruleY}" x2="${width - PAD}" y2="${ruleY}" stroke="${RULE}" stroke-width="1"/>
${texts.join('\n')}
</svg>
`

await Bun.write(out, svg)
console.log(`${out}  ${width}x${height}  ${lines.length} lines`)

export {}

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

/** One coloured run inside a line. */
interface Run {
  text: string
  fill: string
}

/**
 * Splits a line into coloured runs. `parts` is a list of [pattern, colour]
 * applied in order against the remaining text, so an earlier pattern wins a
 * region an later one would also match.
 */
function runs(line: string, rest: string, parts: [RegExp, string][]): Run[] {
  const out: Run[] = []
  let index = 0
  const marks: { start: number; end: number; fill: string }[] = []

  for (const [pattern, fill] of parts) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match = re.exec(line)
    while (match !== null) {
      const start = match.index
      const end = start + match[0].length
      if (!marks.some((m) => start < m.end && end > m.start)) marks.push({ start, end, fill })
      match = re.exec(line)
    }
  }

  for (const mark of marks.sort((a, b) => a.start - b.start)) {
    if (mark.start > index) out.push({ text: line.slice(index, mark.start), fill: rest })
    out.push({ text: line.slice(mark.start, mark.end), fill: mark.fill })
    index = mark.end
  }
  if (index < line.length) out.push({ text: line.slice(index), fill: rest })
  return out
}

/** The colour scheme, as it applies to one line of any minos command's output. */
function colour(line: string): Run[] {
  // The tool's own voice: the report's section names, and the two headings
  // `minos file` prints over a single file's history.
  if (/^(MINOS|CHANGED|APPLIED WITHOUT ASKING|UNDONE|BY PROMPT)/.test(line)) {
    return runs(line, BONE, [[/\+\d+|-\d+|\d+ files?|\d+ changes?|\d+ prompts?/, BODY]])
  }
  if (/^\S.*: (\d+ of its changes|no operations|\d+ operations?)/.test(line)) {
    return runs(line, BONE, [[/^\S+(?=:)/, BODY]])
  }
  // The caveats, in both their forms: parenthetical and trailing prose.
  if (/^ {2}\(/.test(line) || /^ {2}[a-z]/.test(line) && !/^ {2}(decided|auto|subagent)\s/.test(line)) {
    return [{ text: line, fill: DIM }]
  }
  // The three classes, wherever they are named.
  if (/^ {2}decided\s/.test(line)) return runs(line, BODY, [[/decided|you were asked before it was applied/, DECIDED]])
  if (/^ {2}auto\s/.test(line)) return runs(line, BODY, [[/\bauto\b|acceptEdits or auto, no prompt/, AUTO]])
  if (/^ {2}subagent\s/.test(line)) return runs(line, BODY, [[/subagent|applied inside a subagent, never rendered/, SUBAGENT]])

  return runs(line, BODY, [
    [/\b(overwritten|reverted|discarded)\b/, UNDONE],
    [/\bdecided\b/, DECIDED],
    [/\bsubagent\b/, SUBAGENT],
    [/\bauto\b/, AUTO],
    [/\bundone \d+/, UNDONE],
    [/\d{2}:\d{2}(\+\d+d|-\d+d)?/, DIM],
    [/"[^"]*"/, DIM],
    [/\(unattributed\)/, DIM],
    [/^ {2}#\s+when.*$/, DIM],
  ])
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
    : colour(line)
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

/**
 * Terminal cells: how wide a string draws, and cutting it to a width without
 * splitting a character. Pure.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** Combining marks and joiners: they draw on the cell before them. */
const MARKS_ONLY = /^\p{M}+$/u
/** East Asian wide characters and most emoji: two cells. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u
const ASCII = /^[\x20-\x7e]*$/

const split = (text: string): string[] => Array.from(graphemes.segment(text), (s) => s.segment)
const cellsOf = (g: string): number => (MARKS_ONLY.test(g) ? 0 : WIDE.test(g) ? 2 : 1)

/** How many terminal cells `text` takes. */
export const cells = (text: string): number => (ASCII.test(text) ? text.length : split(text).reduce((n, g) => n + cellsOf(g), 0))

/** `n` spaces, none for a negative `n`. */
export const spaces = (n: number): string => ' '.repeat(Math.max(0, n))

/** The leading characters of `chars` that fit in `room` cells. */
function head(chars: string[], room: number): string {
  let used = 0
  let out = ''
  for (const g of chars) {
    used += cellsOf(g)
    if (used > room) break
    out += g
  }
  return out
}

/** The trailing characters of `chars` that fit in `room` cells. */
function tail(chars: string[], room: number): string {
  let used = 0
  let out = ''
  for (const g of [...chars].reverse()) {
    used += cellsOf(g)
    if (used > room) break
    out = g + out
  }
  return out
}

/** `text` cut to `width` cells, the last an ellipsis when anything was cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return cells(text) <= width ? text : `${head(split(text), width - 1)}…`
}

/**
 * A path fitted to `width` cells as its directory and its file name, so the
 * two can be drawn in two tones. The directory is cut from the front first
 * (`…/hooks/`), never the file name; a file name wider than the whole width
 * is cut at its end.
 */
export function fitPath(path: string, width: number): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '' : path.slice(0, slash + 1)
  const name = slash < 0 ? path : path.slice(slash + 1)
  if (cells(path) <= width) return { dir, name }
  const nameCells = cells(name)
  if (nameCells >= width - 1) return { dir: '', name: fit(name, width) }
  return { dir: `…${tail(split(dir), width - nameCells - 1)}`, name }
}

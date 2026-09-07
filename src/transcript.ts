import type { UnknownRecord } from './types'

/** What a pass over a transcript saw: how many lines carried a record, and how many did not parse. */
export interface TranscriptStats {
  lines: number
  skipped: number
}

/**
 * Streams a transcript line by line. Transcripts run to tens of megabytes and
 * real ones contain lines that are not JSON, so nothing is read whole into
 * memory and a bad line is counted rather than thrown.
 */
export async function eachRecord(
  path: string,
  visit: (record: UnknownRecord) => void,
): Promise<TranscriptStats> {
  const stats: TranscriptStats = { lines: 0, skipped: 0 }
  const file = Bun.file(path)
  if (!(await file.exists())) return stats

  const decoder = new TextDecoder()
  let buffer = ''

  const handle = (line: string): void => {
    if (line.trim() === '') return
    stats.lines += 1
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        visit(parsed as UnknownRecord)
        return
      }
    } catch {}
    stats.skipped += 1
  }

  for await (const chunk of file.stream()) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      handle(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  handle(buffer)

  return stats
}

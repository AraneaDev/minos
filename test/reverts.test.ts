import { expect, test } from 'bun:test'
import { findUndone } from '../src/reverts'
import type { Operation } from '../src/types'
import type { Undone, UndoneKind } from '../src/reverts'

const op = (over: Partial<Operation>): Operation => ({
  file: '/a.ts', kind: 'edit', at: '', uuid: 'u', promptId: null, attestation: 'auto',
  oldString: null, newString: null, replaceAll: false, content: null, ...over,
})

test('an exact inverse pair is a revert', () => {
  const found: Undone[] = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', oldString: 'new', newString: 'old' }),
  ], 'old')
  expect(found).toHaveLength(1)
  expect(found[0]?.kind).toBe('reverted')
  expect(found[0]?.introduced.uuid).toBe('first')
  expect(found[0]?.undoneBy.uuid).toBe('second')
})

test('content replaced by something else is overwritten, not reverted', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', oldString: 'new', newString: 'third' }),
  ], 'old')
  const kinds: UndoneKind[] = found.map((f) => f.kind)
  expect(kinds).toEqual(['overwritten'])
})

test('a whole-file write discards everything edited before it', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', kind: 'write', content: 'a completely different file' }),
  ], 'old')
  expect(found.map((f) => f.kind)).toEqual(['discarded'])
})

test('a change still standing at the end of the session is not reported', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', oldString: 'other', newString: 'thing' }),
  ], 'old and other')
  expect(found).toEqual([])
})

test('detection still works with no base to replay from', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', oldString: 'new', newString: 'old' }),
  ], null)
  expect(found.map((f) => [f.kind, f.line])).toEqual([['reverted', null]])
})

test('a change that survives a later edit is not reported', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'false', newString: 'true' }),
    op({ uuid: 'second', oldString: 'if (isReady === true) { go() }', newString: 'if (isReady) { go() }' }),
  ], 'const enabled = false\nif (isReady === true) { go() }\n')
  expect(found).toEqual([])
})

test('a Write that still contains the added text is not reported as discarded', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'old', newString: 'new' }),
    op({ uuid: 'second', kind: 'write', content: 'still has new in it' }),
  ], 'old')
  expect(found).toEqual([])
})

// Finding 3: the confirm-guard applied to the reverted/overwritten branch was
// never applied to the discarded branch, so a Write that dropped the added
// text was reported as discarded even when a later Write in the same session
// restored it, the pure false positive named in the review: an Edit adds X, a
// Write drops it, a later Write brings it back, and the finding still says X
// did not survive.
test('an Edit-Write-Write sequence where the last Write restores the added text is not reported as discarded', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'a', newString: 'ADDED_MARKER' }),
    op({ uuid: 'second', kind: 'write', content: 'no marker here' }),
    op({ uuid: 'third', kind: 'write', content: 'still has ADDED_MARKER in it' }),
  ], 'a')
  // The Edit's own introduced text (ADDED_MARKER) survives to the final
  // content via the third Write, so no finding may name it as discarded.
  // A separate, genuine finding for the second Write's own content being
  // replaced by the third is not what this case is about and is left alone.
  expect(found.some((f) => f.introduced.uuid === 'first')).toBe(false)
})

// The guard must not swallow a genuine discard: this matters more than the
// case above, since a guard that suppresses real findings is worse than one
// that misses a rare false positive.
test('a Write that truly discards the added text with nothing restoring it is still reported', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', oldString: 'a', newString: 'ADDED_MARKER' }),
    op({ uuid: 'second', kind: 'write', content: 'no marker here' }),
    op({ uuid: 'third', kind: 'write', content: 'still no marker here either' }),
  ], 'a')
  expect(found.map((f) => f.kind)).toEqual(['discarded'])
})

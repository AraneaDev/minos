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

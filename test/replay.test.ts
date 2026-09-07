import { expect, test } from 'bun:test'
import { applyOperation, replay } from '../src/replay'
import type { Operation } from '../src/types'

const op = (over: Partial<Operation>): Operation => ({
  file: '/a.ts', kind: 'edit', at: '', uuid: 'u', promptId: null, attestation: 'auto',
  oldString: null, newString: null, replaceAll: false, content: null, ...over,
})

test('an edit replaces the first occurrence only', () => {
  const result = applyOperation('a b a', op({ oldString: 'a', newString: 'z' }))
  expect(result).toBe('z b a')
})

test('replace_all replaces every occurrence', () => {
  const result = applyOperation('a b a', op({ oldString: 'a', newString: 'z', replaceAll: true }))
  expect(result).toBe('z b z')
})

test('a write replaces the whole file, with or without a base', () => {
  expect(applyOperation('anything', op({ kind: 'write', content: 'new' }))).toBe('new')
  expect(applyOperation(null, op({ kind: 'write', content: 'new' }))).toBe('new')
})

test('an edit that does not match reports failure rather than guessing', () => {
  expect(applyOperation('a b', op({ oldString: 'zzz', newString: 'y' }))).toBe(null)
  expect(applyOperation(null, op({ oldString: 'a', newString: 'y' }))).toBe(null)
})

test('a replay stops reconstructing once an operation cannot be applied', () => {
  const steps = replay(
    [op({ oldString: 'a', newString: 'b' }), op({ oldString: 'zzz', newString: 'q' }), op({ oldString: 'b', newString: 'c' })],
    'a',
  )
  expect(steps.map((s) => s.after)).toEqual(['b', null, null])
})

test('the line an edit landed on is reported when the content is known', () => {
  const steps = replay([op({ oldString: 'third', newString: 'THIRD' })], 'first\nsecond\nthird\n')
  expect(steps[0]?.line).toBe(3)
})

test('an edit with $$ and $& in newString inserts them literally, not as special sequences', () => {
  const result = applyOperation('cost', op({ oldString: 'cost', newString: '$$price$&' }))
  expect(result).toBe('$$price$&')
})

test('replace_all with $$ and $& in newString inserts them literally, not as special sequences', () => {
  const result = applyOperation('cost cost', op({ oldString: 'cost', newString: '$$price$&', replaceAll: true }))
  expect(result).toBe('$$price$& $$price$&')
})

import { expect, test } from 'bun:test'
import { findUndone } from '../src/reverts'
import type { Operation } from '../src/types'
import type { Undone, UndoneKind } from '../src/reverts'

const op = (over: Partial<Operation>): Operation => ({
  file: '/a.ts', kind: 'edit', at: '', uuid: 'u', toolUseId: 't', permissionMode: null, promptId: null, attestation: 'auto',
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

// The under-count: an agent edits the smallest snippet that finds its place, so a
// later edit that takes a change back rarely carries the change's whole new text.

test('a later edit that removes only the changed line still undoes the change (the demo session shape)', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'receipt', oldString: '  const amount = total(items)\n  console.log(`charging`)\n  return { ok: true }', newString: '  const amount = total(items)\n  sendReceipt(email, amount)\n  return { ok: true }' }),
    op({ uuid: 'back', oldString: '  sendReceipt(email, amount)', newString: '  console.log(`charging`)' }),
  ], null)
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ kind: 'reverted', introduced: { uuid: 'receipt' }, undoneBy: { uuid: 'back' } })
})

test('an import a later edit deletes is undone, as overwritten', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'import', oldString: "import { total } from './cart'", newString: "import { total } from './cart'\nimport { sendReceipt } from './mailer'" }),
    op({ uuid: 'drop', oldString: "import { sendReceipt } from './mailer'\n", newString: '' }),
  ], null)
  expect(found.map((f) => [f.introduced.uuid, f.kind])).toEqual([['import', 'overwritten']])
})

test('a change that keeps half its added lines still survives', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'two', oldString: 'x', newString: 'alpha line\nbeta line' }),
    op({ uuid: 'half', oldString: 'alpha line', newString: '' }),
  ], null)
  expect(found).toEqual([])
})

test('a line removed and later put back is not undone', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'add', oldString: 'x', newString: 'keep this line' }),
    op({ uuid: 'take', oldString: 'keep this line', newString: '' }),
    op({ uuid: 'back', oldString: 'y', newString: 'keep this line' }),
  ], null)
  expect(found).toEqual([])
})

test('braces, blank lines and other punctuation alone do not decide whether a change survived', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'add', oldString: 'x', newString: 'if (ok) {\n  run()\n}' }),
    op({ uuid: 'trim', oldString: '}', newString: '' }),
  ], null)
  expect(found).toEqual([])
})

test('the final content, when known, still has the last word: a line present at the end survives', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'write', kind: 'write', content: 'start\n' }),
    op({ uuid: 'add', oldString: 'start', newString: 'start\nmoved line' }),
    op({ uuid: 'take', oldString: 'moved line', newString: '' }),
    op({ uuid: 'rewrite', kind: 'write', content: 'start\nmoved line\n' }),
  ], null)
  expect(found.filter((f) => f.introduced.uuid === 'add')).toEqual([])
})

test('a rewrite that keeps a shared import line still discards the file it replaced', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'first', kind: 'write', content: "import { a } from 'x'\nconst one = 1\nconst two = 2\nexport { one, two }\n" }),
    op({ uuid: 'second', kind: 'write', content: "import { a } from 'x'\nconst three = 3\nexport { three }\n" }),
  ], null)
  expect(found.map((f) => [f.introduced.uuid, f.kind])).toEqual([['first', 'discarded']])
})

test('a one-line fix to a file the session wrote does not undo the write', () => {
  const found = findUndone('/a.ts', [
    op({ uuid: 'write', kind: 'write', content: 'const one = 1\nconst two = 2\nconst three = 3\nconst four = 4\n' }),
    op({ uuid: 'fix', oldString: 'const two = 2', newString: 'const two = 22' }),
  ], null)
  expect(found.filter((f) => f.introduced.uuid === 'write')).toEqual([])
})

// A change that adds only punctuation has no line the line rule can follow,
// so the whole-text rule judges it, as before.
test('a punctuation-only change taken out by a later edit is overwritten, and one put back exactly is reverted', () => {
  const overwritten = findUndone('/a.ts', [op({ uuid: 'add', oldString: 'x', newString: '};' }), op({ uuid: 'drop', oldString: '};', newString: ')' })], null)
  expect(overwritten.map((f) => f.kind)).toEqual(['overwritten'])
  const reverted = findUndone('/a.ts', [op({ uuid: 'add', oldString: '(', newString: ')' }), op({ uuid: 'back', oldString: ')', newString: '(' })], null)
  expect(reverted.map((f) => f.kind)).toEqual(['reverted'])
})

test('a punctuation-only change a later Write drops is discarded, unless a later Write brings it back', () => {
  const dropped = findUndone('/a.ts', [op({ uuid: 'add', oldString: 'x', newString: '};' }), op({ uuid: 'w', kind: 'write', content: 'nothing\n' })], null)
  expect(dropped.filter((f) => f.introduced.uuid === 'add').map((f) => f.kind)).toEqual(['discarded'])
  const kept = findUndone('/a.ts', [
    op({ uuid: 'add', oldString: 'x', newString: '};' }),
    op({ uuid: 'w1', kind: 'write', content: 'nothing\n' }),
    op({ uuid: 'w2', kind: 'write', content: 'back };\n' }),
  ], null)
  expect(kept.filter((f) => f.introduced.uuid === 'add')).toEqual([])
  const held = findUndone('/a.ts', [op({ uuid: 'add', oldString: 'x', newString: '};' }), op({ uuid: 'w', kind: 'write', content: 'still };\n' })], null)
  expect(held.filter((f) => f.introduced.uuid === 'add')).toEqual([])
  const edited = findUndone('/a.ts', [
    op({ uuid: 'w0', kind: 'write', content: 'a };\n' }),
    op({ uuid: 'add', oldString: 'a', newString: '};' }),
    op({ uuid: 'drop', oldString: '};', newString: ':' }),
  ], null)
  expect(edited.some((f) => f.introduced.uuid === 'add')).toBe(false)
})

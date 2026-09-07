import { expect, test } from 'bun:test'
import { PromptIndex } from '../src/prompts'

const records = [
  { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'default', timestamp: '2026-09-07T19:01:00Z', message: { content: 'fix the login redirect' } },
  { type: 'assistant', uuid: 'a1', parentUuid: 'u1' },
  { type: 'user', uuid: 'r1', parentUuid: 'a1', isMeta: true, message: { content: [{ type: 'tool_result' }] } },
  { type: 'assistant', uuid: 'a2', parentUuid: 'r1' },
  { type: 'user', uuid: 'u2', parentUuid: 'a2', promptId: 'p2', permissionMode: 'acceptEdits', timestamp: '2026-09-07T20:09:00Z', message: { content: 'make the mailer use the queue' } },
  { type: 'assistant', uuid: 'a3', parentUuid: 'u2' },
]

test('a change several hops down still resolves to the prompt that caused it', () => {
  const index = new PromptIndex()
  for (const r of records) index.observe(r)
  expect(index.resolve('a2')?.id).toBe('p1')
  expect(index.resolve('a3')?.id).toBe('p2')
})

test('prompts are numbered in the order they were typed', () => {
  const index = new PromptIndex()
  for (const r of records) index.observe(r)
  expect(index.all().map((p) => [p.index, p.permissionMode])).toEqual([
    [1, 'default'],
    [2, 'acceptEdits'],
  ])
})

test('a record with no prompt above it resolves to nothing', () => {
  const index = new PromptIndex()
  index.observe({ type: 'assistant', uuid: 'orphan', parentUuid: null })
  expect(index.resolve('orphan')).toBe(null)
  expect(index.resolve('never-seen')).toBe(null)
})

test('a parent cycle in a corrupt transcript terminates', () => {
  const index = new PromptIndex()
  index.observe({ type: 'assistant', uuid: 'x', parentUuid: 'y' })
  index.observe({ type: 'assistant', uuid: 'y', parentUuid: 'x' })
  expect(index.resolve('x')).toBe(null)
})

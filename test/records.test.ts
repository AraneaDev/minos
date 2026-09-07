import { expect, test } from 'bun:test'
import { isAssistantRecord, isPromptRecord, promptText, toolUses } from '../src/records'

const prompt = {
  type: 'user',
  uuid: 'u1',
  promptId: 'p1',
  permissionMode: 'default',
  message: { role: 'user', content: 'fix the login redirect' },
}

const toolResult = {
  type: 'user',
  uuid: 'u2',
  isMeta: true,
  message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
}

// This shape occurs in a real store: isMeta + permissionMode both present.
// The isMeta guard prevents it from being counted as a prompt.
const metaPrompt = {
  type: 'user',
  uuid: 'u3',
  isMeta: true,
  permissionMode: 'default',
  message: { role: 'user', content: 'injected context, not typed by anyone' },
}

test('a typed prompt is told apart from an injected user record', () => {
  expect(isPromptRecord(prompt)).toBe(true)
  expect(isPromptRecord(toolResult)).toBe(false)
  expect(isPromptRecord(metaPrompt)).toBe(false)
})

// A <task-notification> or system reminder shares type 'user', isMeta !== true
// and a string permissionMode with a real prompt. promptSource is the only
// field that tells them apart in the corpus, so it must be checked too.
test('a system-injected record is not counted as a prompt, even though it looks like one', () => {
  expect(isPromptRecord({ ...prompt, promptSource: 'system' })).toBe(false)
})

test('a typed record is still accepted with promptSource present', () => {
  expect(isPromptRecord({ ...prompt, promptSource: 'typed' })).toBe(true)
})

test('suggestion_accepted, queued and sdk are all genuinely user-supplied', () => {
  expect(isPromptRecord({ ...prompt, promptSource: 'suggestion_accepted' })).toBe(true)
  expect(isPromptRecord({ ...prompt, promptSource: 'queued' })).toBe(true)
  expect(isPromptRecord({ ...prompt, promptSource: 'sdk' })).toBe(true)
})

// A transcript predating the promptSource field must keep working exactly as
// it does today: an absent promptSource must still count as a prompt.
test('a record with no promptSource at all is still accepted', () => {
  expect(isPromptRecord(prompt)).toBe(true)
  expect('promptSource' in prompt).toBe(false)
})

test('prompt text is read out of either content shape', () => {
  expect(promptText(prompt)).toBe('fix the login redirect')
  expect(promptText({ ...prompt, message: { content: [{ type: 'text', text: 'hello' }] } })).toBe('hello')
})

test('tool uses come back with their full input', () => {
  const record = {
    type: 'assistant',
    uuid: 'a1',
    message: {
      content: [
        { type: 'text', text: 'editing' },
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } },
      ],
    },
  }
  expect(isAssistantRecord(record)).toBe(true)
  expect(toolUses(record)).toEqual([
    { id: 't1', name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } },
  ])
  expect(toolUses(prompt)).toEqual([])
})

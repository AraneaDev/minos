import { expect, test } from 'bun:test'
import { failedToolResults, isPromptRecord, promptText, toolUses } from '../src/records'

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
  expect(toolUses(record)).toEqual([
    { id: 't1', name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } },
  ])
  expect(toolUses(prompt)).toEqual([])
})

/** A user record answering one tool call with an error whose content is `content`. */
const errorResult = (content: unknown) => ({
  type: 'user',
  uuid: 'r1',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content }] },
})

// Each of these is the opening of a result found in a real store for a Bash
// call that the harness stopped before it started.
test.each([
  'Permission to use Bash with command head -40; ls secrets has been denied.',
  'Permission for this command was denied by a built-in Claude Code safety check, not by the user.',
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: judged dangerous.',
  'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).',
  'PreToolUse:Bash hook error: context-mode: curl/wget redirected.',
  '<tool_use_error>Blocked: sleep 100 followed by: cat out. To wait for a condition, use Monitor.</tool_use_error>',
  'The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash.',
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).",
  "grep from '/repo/.env.example' was blocked by a deny rule.",
])('a result saying the call never ran is a refusal: %s', (content) => {
  expect(failedToolResults(errorResult(content))).toEqual([{ id: 't1', refused: true }])
  expect(failedToolResults(errorResult([{ type: 'text', text: content }]))).toEqual([{ id: 't1', refused: true }])
})

// The Bash tool sets is_error on any non-zero exit, so the command ran and
// may have written before it failed.
test.each([
  'Exit code 1',
  "Exit code 1\nsed: -e expression #1, char 5: unterminated `s' command",
  'Exit code 1\nrm: cannot remove a: Permission denied',
  'Exit code 2\nThe tool use was rejected',
  'Exit code 1\ncurl from x was blocked by a deny rule.',
  '[Tool call interrupted: the session ended before this call\'s result was recorded, so its outcome is unknown.]',
  'String to replace not found in file.',
])('any other error result is a failure, not a refusal: %s', (content) => {
  expect(failedToolResults(errorResult(content))).toEqual([{ id: 't1', refused: false }])
})

test('a result that is not an error is not returned', () => {
  const ok = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Permission to use Bash has been denied.' }] } }
  expect(failedToolResults(ok)).toEqual([])
})

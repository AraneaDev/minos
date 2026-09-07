import { expect, test } from 'bun:test'
import { attest, DECIDED_MODES, AUTO_MODES } from '../src/attest'

test('a subagent change beats every mode, because its diff never rendered', () => {
  expect(attest({ isSidechain: true, permissionMode: 'default' }).label).toBe('subagent')
  expect(attest({ isSidechain: true, permissionMode: 'acceptEdits' }).label).toBe('subagent')
})

test('the modes that stop and ask are decided', () => {
  expect(attest({ isSidechain: false, permissionMode: 'default' }).label).toBe('decided')
  expect(attest({ isSidechain: false, permissionMode: 'plan' }).label).toBe('decided')
})

test('the modes that do not ask are auto', () => {
  expect(attest({ isSidechain: false, permissionMode: 'acceptEdits' }).label).toBe('auto')
  expect(attest({ isSidechain: false, permissionMode: 'bypassPermissions' }).label).toBe('auto')
  expect(attest({ isSidechain: false, permissionMode: 'auto' }).label).toBe('auto')
})

test('an unrecognised mode reads as auto and says which mode it was', () => {
  // Never decided. Guessing in the flattering direction would tell the user
  // they reviewed something nobody put in front of them.
  const result = attest({ isSidechain: false, permissionMode: 'somethingNew' })
  expect(result.label).toBe('auto')
  expect(result.unrecognisedMode).toBe('somethingNew')
})

test('a missing mode is unrecognised too', () => {
  expect(attest({ isSidechain: false, permissionMode: null })).toEqual({
    label: 'auto',
    unrecognisedMode: '(none recorded)',
  })
})

test('corpus validation: every observed permissionMode is classified exactly once, and the sets do not overlap', () => {
  // Task 1 enumerated 300,000 records across 1,225 transcript files and found
  // exactly these permissionMode values in the real corpus: 'auto' (9862),
  // 'acceptEdits' (281), 'default' (29), 'plan' (9). This test pins that finding
  // into the suite: every value must be classified by exactly one set, and both
  // sets must be disjoint, so the label never depends on the order we check them.
  const corpusValues: readonly string[] = ['auto', 'acceptEdits', 'default', 'plan']

  for (const value of corpusValues) {
    const inDecided = DECIDED_MODES.has(value)
    const inAuto = AUTO_MODES.has(value)
    const classified = inDecided || inAuto
    expect(classified).toBe(true)
    expect(inDecided && inAuto).toBe(false) // must not be in both
  }

  // Also verify the sets do not overlap at all
  for (const decided of DECIDED_MODES) {
    expect(AUTO_MODES.has(decided)).toBe(false)
  }
})

import type { Attestation } from './types'

/** Permission modes under which Claude Code stops and asks before a write. */
export const DECIDED_MODES: ReadonlySet<string> = new Set(['default', 'plan'])

/** Permission modes under which a write is applied with no prompt of any kind. */
export const AUTO_MODES: ReadonlySet<string> = new Set(['acceptEdits', 'bypassPermissions', 'auto'])

/** What is known about one change at the moment it was applied. */
export interface AttestInput {
  isSidechain: boolean
  permissionMode: string | null
}

/** The label, plus the mode string when it was not one this build knows. */
export interface AttestResult {
  label: Attestation
  unrecognisedMode: string | null
}

/**
 * Labels a change. An unrecognised or absent mode reads as `auto` rather than
 * `decided`: the flattering guess would tell the reader they reviewed something
 * nobody ever put in front of them, which is the one error this tool must not
 * make. The mode is carried out so the report can name it.
 */
export function attest(input: AttestInput): AttestResult {
  if (input.isSidechain) return { label: 'subagent', unrecognisedMode: null }

  const mode = input.permissionMode
  if (mode !== null && DECIDED_MODES.has(mode)) return { label: 'decided', unrecognisedMode: null }
  if (mode !== null && AUTO_MODES.has(mode)) return { label: 'auto', unrecognisedMode: null }

  return { label: 'auto', unrecognisedMode: mode ?? '(none recorded)' }
}

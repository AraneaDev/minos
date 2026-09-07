/** How a change reached the working tree, from the user's point of view. */
export type Attestation = 'decided' | 'auto' | 'subagent'

/** The tool that produced a change. Notebook edits are carried but not replayed. */
export type OperationKind = 'write' | 'edit' | 'notebook'

/** A raw transcript record, before anything has been narrowed. */
export type UnknownRecord = Record<string, unknown>

/** One change to one file, in the order the session applied it. */
export interface Operation {
  file: string
  kind: OperationKind
  at: string
  uuid: string
  promptId: string | null
  attestation: Attestation
  oldString: string | null
  newString: string | null
  replaceAll: boolean
  content: string | null
}

/** A prompt the user typed, and the permission mode in force when they did. */
export interface Prompt {
  id: string
  index: number
  uuid: string
  text: string
  at: string
  permissionMode: string
}

/**
 * The part of `minos ledger --json` the pane draws. The CLI owns the full
 * shape (src/ledger-view.ts); the mod only reads these fields.
 */
export type LiveView = {
  sessionId: string
  startedAt: string | null
  cwd: string
  counts: { decided: number; auto: number; subagent: number; undone: number }
  unaskedFiles: { file: string; label: 'auto' | 'subagent'; changes: number; lastAt: string }[]
  failedChanges: number
  decidedNote: string
}

declare module 'claude-code' {
  interface PluginState {
    minos: {
      /** The last ledger the CLI printed for this session, or null before the first refresh. */
      view: Shaped<LiveView | null>
      /** Why the last refresh failed, or null when it did not. */
      error: Shaped<string | null>
      /** Every undo note raised this session, oldest first. */
      notes: Shaped<string[]>
    }
  }
}

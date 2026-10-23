/** One undo note, as `minos undoes` words it. */
export type MinosNote = string

/**
 * The `display` part of `minos ledger --json`: every word, number and time the
 * pane shows, already written by the CLI. The pane only lays them out.
 */
export type MinosLedger = {
  session: string
  since: string | null
  counts: { decided: number; auto: number; subagent: number; undone: number }
  units: string
  files: { file: string; shown: string; label: 'auto' | 'subagent'; changes: string }[]
  undone: { shown: string; kind: string; verb: string; at: string; prompt: string; endedAt: string }[]
  caveats: string[]
  empty: string | null
}

/** One file's history as `minos file` printed it, for the file the person opened. */
export type MinosHistory = { file: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    minos: {
      /** The last ledger the CLI printed for this session, or null before the first refresh. */
      view: Shaped<MinosLedger | null>
      /** Why the last refresh failed, or null when it did not. */
      error: Shaped<string | null>
      /** Every undo note raised this session, oldest first. */
      notes: Shaped<MinosNote[]>
      /** Whether the pane is open; nothing is refreshed while it is not. */
      isOpen: Shaped<boolean>
      /** The file whose history the pane shows, or null. */
      history: Shaped<MinosHistory | null>
    }
  }
}

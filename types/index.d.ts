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
  legend: string[]
}

/** One file's history, or another session's ledger, as the CLI printed it, for what the person opened. */
export type MinosHistory = { file: string; text: string }

/** An earlier session of this project, from `minos sessions --json`. */
export type MinosSession = { id: string; short: string; first: string; last: string; counts: { decided: number; auto: number; subagent: number; undone: number } }

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
      /** The project's latest sessions, newest last, read when the pane opens and at each turn's end. */
      project: Shaped<MinosSession[]>
      /** Whether the changed-files card lists every file, or folds them after the first ten. */
      allFiles: Shaped<boolean>
    }
  }
}

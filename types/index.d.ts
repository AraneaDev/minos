/** One undo note, as `minos undoes` words it. */
export type MinosNote = string

/** What the pane keeps of `minos ledger --json`: the CLI's own text, the lines it dims, and the files a person can open. */
export type MinosLedger = { text: string; dim: string[]; cwd: string; files: string[] }

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

/** One undo note, as `minos undoes` words it. */
export type MinosNote = string

declare module 'claude-code' {
  interface PluginState {
    minos: {
      /** The last `minos ledger` text for this session, or null before the first refresh. */
      view: Shaped<string | null>
      /** Why the last refresh failed, or null when it did not. */
      error: Shaped<string | null>
      /** Every undo note raised this session, oldest first. */
      notes: Shaped<MinosNote[]>
    }
  }
}

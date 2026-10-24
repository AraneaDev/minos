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
  prompts: { ref: string; text: string; summary: string; files: string[] }[]
}

/** One change to a file as `minos file --json` gives it: when, how, and its diff. */
export type MinosEdit = { at: string; kind: string; attestation: string; prompt: string; diff: string; numbered: boolean; cut: number }

/**
 * What the person opened in the pane: a file's changes with their diffs, a
 * prompt's files, or another session's ledger. `title` names it; `text` is
 * plain lines and `edits` the diffs, either of which may be empty.
 */
export type MinosHistory = { file: string; text: string; edits?: MinosEdit[] }

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
      /** Whether the changed-files card lists every file, or a window of them as tall as the pane allows. */
      allFiles: Shaped<boolean>
      /** Whether the prompts card lists every prompt, or a window of them as tall as the pane allows. */
      allPrompts: Shaped<boolean>
      /** The first changed file and the first prompt each card's window shows. */
      listFrom: Shaped<{ files: number; prompts: number }>
    }
  }
}

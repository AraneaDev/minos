/**
 * Caveats that more than one view prints, kept in one place so the text
 * report, the `--all` table and the JSON never disagree on the wording.
 */

/** Why `decided` is an inference: printed under any non-zero decided count, and carried in the JSON. */
export const DECIDED_NOTE =
  'decided is inferred from permission mode alone, not from a recorded approval; a standing allow rule can mean nothing was ever put on screen'

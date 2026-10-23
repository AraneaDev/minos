import type { EngineInterface, On } from 'claude-code'

import { forSession } from './minos'

/** The tool's own name; the model sees it as `mcp__minos__minos_ledger`. */
export const LEDGER_TOOL = 'minos_ledger'

const DESCRIPTION =
  'What this session actually changed, from its transcript: decided, auto and subagent counts, ' +
  'the files changed without the user being asked, the changes that did not survive, and the decided caveat. ' +
  'Call it before saying the work is done, and before writing a commit message or a PR description.'

/** Declares the tool to the model. Called at `session.start`, once the session is bound. */
export async function registerLedgerTool($: EngineInterface): Promise<void> {
  await $.tool.register({ name: LEDGER_TOOL, description: DESCRIPTION, isDeferred: false })
}

/**
 * Answers the tool with `minos ledger` for this session, as text. A run that
 * fails is answered in words rather than as an error, so the model reads why
 * Minos could not say, not a stack of tool failures.
 */
export function serveLedgerTool(on: On): void {
  on('tool.call', { tool: `mcp__minos__${LEDGER_TOOL}` }, async ($) => {
    const run = await forSession($, ['ledger'])
    const text = run.ok ? run.stdout.trimEnd() : `Minos could not read this session: ${run.error}`
    // A plugin's own tool answers with its text; the engine wraps it for the model.
    return { result: text }
  })
}

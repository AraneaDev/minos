import type { Register } from 'claude-code'

import { COMMAND, livePane, schedule } from './pane'
import { registerLedgerTool, serveLedgerTool } from './tool'
import { noteUndo } from './undo'

/**
 * The live side of Minos: hooks that read the transcript Claude Code already
 * writes, through the Minos CLI, and record nothing of their own beyond what
 * the pane shows during this session.
 *
 * One hook per tool that can change the ledger: each lets the call run, asks
 * for a pane refresh off the call's path, and for an Edit or a Write adds the
 * undo note when that call ended one of the session's earlier changes.
 */
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerLedgerTool($)
    await $.command.register({
      name: COMMAND,
      description: 'Show what this session changed, and what was never put to you, in a pane',
    })
    return started
  })
  serveLedgerTool(on)
  livePane(on)

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    schedule($)
    return noteUndo($, { kind: 'edit', file: e.file_path, old_string: e.old_string, new_string: e.new_string, replace_all: e.replace_all === true }, ran)
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    schedule($)
    return noteUndo($, { kind: 'write', file: e.file_path, content: e.content }, ran)
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    schedule($)
    return ran
  })
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    schedule($)
    return ran
  })
}

import type { Register } from 'claude-code'

import { registerLedgerTool, serveLedgerTool } from './tool'
import { watchForUndo } from './undo'

/**
 * The live side of Minos: hooks that read the transcript Claude Code already
 * writes, through the Minos CLI, and record nothing of their own beyond what
 * the pane shows during this session.
 */
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerLedgerTool($)
    return started
  })
  serveLedgerTool(on)
  watchForUndo(on)
}

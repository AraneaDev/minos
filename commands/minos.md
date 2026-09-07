---
description: Report what this session changed, and which of it was never put to you as a decision
---

Run `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" report --session "$CLAUDE_SESSION_ID"` and print
its output in a fenced code block, byte for byte.

Its columns are aligned by spaces, so reflowing it into a paragraph or a markdown table
destroys the thing being shown. Keep every line break and every run of spaces exactly as
printed, and do not recompute any number.

If the user asked about one file, run `file <path>` instead. If they asked what was undone
again, run `undone`. Both print the same way, in a fenced block, before anything you say
about them.

Never soften the counts. The `auto` and `subagent` rows are the reason this report exists,
and a summary that rolls them into the total tells the user the opposite of what the tool
measured.

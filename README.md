<div align="center">

# Minos

**A session changed 47 files. You saw six of them.**
**Minos separates the changes you were asked about from the ones that were not.**

[![Release](https://img.shields.io/github/v/release/AraneaDev/minos?label=release&include_prereleases)](https://github.com/AraneaDev/minos/releases)
[![Tool page](https://img.shields.io/badge/tool%20page-aranea--development.nl-0b7285)](https://aranea-development.nl/en/tools/minos)
[![License](https://img.shields.io/github/license/AraneaDev/minos?label=license&color=yellow)](./LICENSE)
[![Language](https://img.shields.io/github/languages/top/AraneaDev/minos)](https://github.com/AraneaDev/minos)
[![Last commit](https://img.shields.io/github/last-commit/AraneaDev/minos?label=last%20commit)](https://github.com/AraneaDev/minos/commits/main)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org/)
[![Status](https://img.shields.io/badge/status-pre--release-orange)](#status)
[![Tests](https://img.shields.io/badge/tests-101%20passing-brightgreen)](#development)

</div>

---

> Minos (Μίνως) is the king whose palace is the labyrinth at Knossos, and one of the three judges
> of the dead. The court he sits in weighs what a life actually did rather than what it says it
> did. This tool weighs something smaller: what an agent session actually changed in your
> repository, and which of it was ever put in front of you.

Minos reads the transcripts Claude Code already writes and reports what a session did to your
working tree. Every changed file is sorted into one of three classes: the ones Claude Code stopped
and asked you about, the ones applied without asking because the session was in `acceptEdits`, and
the ones applied inside a subagent whose diff never rendered in your terminal at all.

It also reports the changes that did not survive the session. A fix applied at 19:02 and
overwritten at 19:41 by a later turn working on something else is invisible in the final diff,
because the final diff only shows the last state. Minos has both, and names the prompt behind each.

No hook runs on any turn, nothing is captured while you work, and Minos answers for sessions that
happened before you installed it.

<a id="status"></a>

> **Status:** pre-release. Minos is **not yet published to npm**. Install from the source
> repository. It requires [Bun](https://bun.sh/) 1.1 or newer and a Claude Code transcript
> store at `~/.claude/projects`.

---

## What it will not tell you

Minos reports whether Claude Code **put a change to you as a decision**. It does not report
whether you read it, it cannot know that, and nothing on your machine records it. A change you
approved in half a second is still counted as one you were asked about.

That line matters more than any feature below it. A tool that implies it knows what your eyes did
is worth less than one that does less and says which is which.

## Why it exists

Every other tool in this collection checks an artefact that was already there. Knossos maps the
architecture, Chaos attacks the test suite, Momus reads what the assertions actually assert, Argos
draws a line around the database. None of them measures the session's own output, which is both the
least reviewed artefact in the workflow and the one the agent produces.

Git does not close that gap. It shows you the final state of the tree and nothing about how it got
there: not which changes you were asked about, not which arrived unannounced, and not the work that
was done and then undone before you ever saw it.

## The three classes

| Class | What it means |
|---|---|
| `decided` | The turn ran in `default` or `plan` mode, so Claude Code stopped and asked before applying it |
| `auto` | The turn ran under `acceptEdits`, `bypassPermissions`, or `auto`, the mode most real changes run under. Applied with no prompt of any kind |
| `subagent` | Applied inside a subagent. No diff reached your terminal in any form |

`subagent` wins over the other two, because even in `default` mode a subagent's edits are not
rendered to you. Nothing is counted twice.

## The changes that did not survive

Three shapes, reported by name rather than merged into one count:

- **overwritten**: content an earlier operation introduced is gone after a later one
- **reverted**: after a later operation the region matches what the file held before the first
- **discarded**: a whole-file `Write` replaced a file that earlier operations had already changed

Each one names both timestamps and both prompts, because the useful sentence is not that a line
changed twice. It is that what you asked for in prompt 4 did not survive prompt 9.

## Commands

```text
minos report [--session <id>] [--project <path>]   the default; latest session for this directory
minos file <path>                                  one file's operation history in the session
minos undone                                       the changes that did not survive, on their own
minos sessions [--limit <n>] [--project <path>]    sessions with headline counts, to pick one
minos export                                       the ledger as data, JSON
```

In Claude Code, `/minos` prints the report for the session you are in.

## What it does not do

- It does not tell you whether you read anything. It reports whether you were asked.
- It does not review the code it reports on. Momus, Chaos and Knossos do that.
- It does not touch git, stage anything, or revert anything.
- It writes nothing under `~/.claude` and nothing in your working tree.
- It makes no network request of any kind, runs no daemon, and sends no telemetry.

## Requirements

Bun 1.1.0 or newer, and a Claude Code transcript store at `~/.claude/projects`.

## Development

```bash
bun install
bun run check      # lint, lint:docs, typecheck, knip, then the full suite with coverage
bun run fp         # the attribution harness: plants a known answer, asserts Minos finds it
```

## License

MIT.

---

Built by [Aranea Development](https://aranea-development.nl).

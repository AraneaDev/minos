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
[![Tests](https://img.shields.io/badge/tests-153%20passing-brightgreen)](#development)

</div>

---

> Minos (Μίνως) is the king whose palace is the labyrinth at Knossos, and one of the three judges
> of the dead. The court he sits in weighs what a life actually did rather than what it says it
> did. This tool weighs something smaller: what an agent session actually changed in your
> repository, and which of it was ever put in front of you.

Minos reads the transcripts Claude Code already writes and reports what a session did to your
working tree. Every change is sorted into one of three classes: the ones submitted in a mode where
Claude Code stops and asks, the ones applied without asking because the session was in
`acceptEdits`, and the ones applied inside a subagent whose diff never rendered in your terminal at
all.

It also reports the changes that did not survive the session. A fix applied at 19:02 and
overwritten at 19:41 by a later turn working on something else is invisible in the final diff,
because the final diff only shows the last state. Minos has both, and names the prompt behind each
wherever the transcript lets it.

No hook runs on any turn, nothing is captured while you work, and Minos answers for sessions that
happened before you installed it, for as long as Claude Code still keeps their transcripts.

![The minos report for the session that built Minos: 57 files changed, none of them decided, 54 of
them applied inside a subagent, and 28 changes that did not survive the
session](docs/images/report.svg)

Minos reporting on the session that built it. Times are in the timezone Minos runs in rather than
the transcript's UTC, and a `+1d` marks a time that falls on the calendar day after the session
began.

<a id="status"></a>

> **Status:** pre-release. Minos is **not yet published to npm**, so it installs from this
> repository or from the aranea marketplace: see [Install](#install). It requires
> [Bun](https://bun.sh/) 1.1 or newer and a Claude Code transcript store at
> `~/.claude/projects`.

---

## What it will not tell you

Minos reports whether Claude Code **put a change to you as a decision**. It does not report
whether you read it, it cannot know that, and nothing on your machine records it. A change you
approved in half a second is still counted as one you were asked about.

It is no softer on itself. A `decided` label is read off the permission mode alone, never off a
recorded approval, so a standing allow rule can mean a `default` turn put nothing on screen at all.
The report says so under its own figures, and names the allow rules it found in force at the moment
you ran it.

That line matters more than any feature below it. A tool that implies it knows what your eyes did
is worth less than one that says plainly where its knowledge stops.

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
| `decided` | The prompt this change descends from was submitted in `default` or `plan` mode, so Claude Code would have stopped and asked. Read off the mode, never off an approval |
| `auto` | Submitted under `acceptEdits`, `bypassPermissions` or `auto`, the mode most real changes run under. A mode this build does not recognise, or one the transcript never recorded, is counted here too, rather than guessed in your favour |
| `subagent` | Applied inside a subagent. No diff reached your terminal in any form |

`subagent` wins over the other two, because even in `default` mode a subagent's edits are not
rendered to you. No change is counted twice. A file changed under more than one class is counted
under each, so those three file counts overlap on purpose, and the report repeats that where it
prints them.

What Minos can see at all is what the transcript holds, which is the `Edit`, `Write` and
`NotebookEdit` tools. A file rewritten by a shell command, by `MultiEdit` or by an MCP server of
your own leaves nothing to read and appears in none of the counts.

## The changes that did not survive

Three shapes, reported by name rather than merged into one count:

- **overwritten**: content an earlier operation introduced is gone after a later one
- **reverted**: a later edit is the exact inverse of the earlier one, putting back the text it had
  replaced
- **discarded**: a later whole-file `Write` no longer carries what an earlier operation introduced

Each one names both times, and the prompt on either side wherever the transcript allows it, because
what you want to read is that what you asked for in prompt 4 did not survive prompt 9. A change
that cannot be traced back to a prompt is marked `(unattributed)` rather than guessed at, and
subagent operations often are.

Detection works on the text of the changes themselves, so read it as a strong indication rather
than a proof. A file whose final state cannot be reconstructed can produce a finding that does not
hold, and text that turns up again elsewhere in a file can hide one that does.

![minos file src/report.ts: six changes that did not survive, above the 23 operations that touched
the file, every one of them inside a subagent](docs/images/file.svg)

`minos file` puts one file's whole history in that session in front of you. Every operation on
`src/report.ts` ran inside a subagent, so none of its 23 changes was ever rendered.

## Commands

```text
minos report        the default; the latest session for this directory
minos file <path>   one file's operation history in that session
minos undone        the changes that did not survive, on their own
minos sessions      sessions with headline counts, to pick one
minos export        the ledger as data, JSON
```

`report`, `file`, `undone` and `export` each take `--session <id>` and `--project <path>`.
`sessions` takes `--project` and `--limit <n>`.

The report is coloured when stdout is a terminal, on the same scheme the cards above use: one
colour per class, one for the undone kinds, and grey for the caveats. A pipe, a redirect,
`minos export` and any environment with `NO_COLOR` set get plain text, so what a script reads is
what the tool means.

![minos sessions: the four sessions of this repository with their decided, auto, subagent and
undone counts](docs/images/sessions.svg)

`minos sessions` gives you the headline counts per session, so you can pick the one you mean before
asking for the full report.

In Claude Code, `/minos` prints the report for the session you are in.

## What it does not do

- It does not review the code it reports on. Momus, Chaos and Knossos do that.
- It does not touch git. Nothing is staged, nothing is committed, nothing is reverted.
- It writes nothing under `~/.claude` and nothing in your working tree. It reads the transcripts,
  and the allow rules in your `settings.json` so it can name the ones that let a `default` turn
  apply a change without showing it, and nothing else.
- It makes no network request, runs no daemon, and sends no telemetry.

## Install

In Claude Code, as a plugin, which is where `/minos` comes from:

```bash
claude plugin marketplace add https://aranea-development.nl/plugins/marketplace.json
claude plugin install minos@aranea
```

On the command line, from this repository, since Minos is not on npm yet:

```bash
bun install -g github:AraneaDev/minos
minos report
```

Nothing has to be installed before the session you want to read. Minos runs against the
transcript store as it stands, so it answers for sessions that happened weeks earlier.

## Requirements

Bun 1.1.0 or newer, and a Claude Code transcript store at `~/.claude/projects`, or wherever
`CLAUDE_CONFIG_DIR` points.

## Development

```bash
bun install
bun run check      # lint, lint:docs, typecheck, knip, then the full suite with coverage
bun run fp         # the attribution harness: plants a known answer, asserts Minos finds it
```

## License

MIT.

---

Built by [Tim Schipper](https://tim-schipper.nl/en) and released as open source under
[Aranea Development](https://aranea-development.nl).

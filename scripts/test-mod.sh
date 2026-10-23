#!/usr/bin/env bash
# Runs the mod's tests (hooks/*.test.ts[x]) under `claude plugin test`.
#
# `claude plugin test <dir>` runs every *.test.ts under the plugin folder in the
# mod's own environment, which cannot import bun:test, so pointed at this
# repository it would try to load the CLI's suite too. The mod is copied into a
# throwaway folder with only what the engine loads (the manifest, hooks/ and
# types/), and the tests run there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/.claude-plugin"
cp "$ROOT/.claude-plugin/plugin.json" "$STAGE/.claude-plugin/"
cp -R "$ROOT/hooks" "$STAGE/hooks"
cp "$ROOT/README.md" "$STAGE/README.md"
[ -d "$ROOT/types" ] && cp -R "$ROOT/types" "$STAGE/types"

claude plugin validate "$STAGE"
claude plugin test "$STAGE"

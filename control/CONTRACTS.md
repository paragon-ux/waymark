# CONTRACTS — Waymark boundaries and invariants

## Product boundary

Waymark owns one active, single-writer trajectory of verified code hops. The
trajectory is an append-only NDJSON journal; `active.json` is a rebuildable
pointer, not the source of truth. A note is the durability boundary: reasoning
that was not recorded as a note cannot be recovered after compaction.

`codex-agents-compact-reload` owns SessionStart/compaction bootloading and
reloads this repository's small `AGENTS.md`. Capn-hook owns finalized memory,
QMD, and retrieval. Waymark must not read `.capn` internals, build a search
index, install another Codex hook, call a network service, or launch workers.

## Lifecycle

```text
begin → note* → check → resume → complete → publish
```

`note` appends one validated hop immediately. `check` verifies only referenced
files. `resume --compact` emits one bounded JSON packet containing only the
contiguous trusted prefix. `complete` requires a clean staged check and at least
one hop; publication failure leaves local completion durable and returns exit
code 3.

## Integrity contract

Whole-file equality or exact normalized-span equality is fresh. A unique exact
span relocation within the same file is moved and resumable. Ambiguous matches,
signature-only candidates, missing files, and bounded-scan exhaustion are stale.
Structural signatures are diagnostic and never authorize continuation. Any
branch or HEAD change is `CROSS_BRANCH` and non-resumable by default.

## Output and safety

Machine commands emit one JSON object on stdout; diagnostics go to stderr.
Events are capped at 16 KiB and resume packets at 2,048 UTF-8 bytes. Paths are
repository-relative, forward-slash normalized, and cannot traverse or escape
through symlinks. Lock ownership is never stolen automatically. A Windows
batch Capn adapter rejects percent signs, quotes, newlines, and comma-containing
file paths rather than silently altering them through `cmd.exe` or Capn's
comma-splitting `--files` parser; direct executables have no such restriction.

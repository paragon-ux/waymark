# Waymark

Waymark is a small local-first continuity ledger for one active coding investigation.
It records verified file-and-line hops, survives a Codex context compaction, and
quarantines a trajectory when a recorded hop no longer matches the repository.

Waymark is intentionally complementary to the surrounding tools:

- `codex-agents-compact-reload` reloads project instructions after a compact start.
- Waymark preserves the active, unfinished trajectory.
- Capn-hook remains the finalized-memory and QMD retrieval provider.

Waymark does not read `.capn` files, implement embeddings, or install a Codex hook.

## Project status

Waymark is a local release candidate for the continuity demonstration. The
implementation and deterministic verification suite are checked in; native
manual and automatic Codex compaction evidence is deliberately recorded only
after those events occur in a long-lived Luna task. See
[`control/STATE.md`](control/STATE.md) and
[`control/COMPACTIONS.md`](control/COMPACTIONS.md).

## Quick start

```text
npm install
npm run verify
npm run build
node dist/src/cli.js init --profile recording
node dist/src/cli.js begin "How does an inbound webhook become a durable outbox event?"
node dist/src/cli.js note <id> --path src/routes/webhook.ts --label route --start 1 --end 20 --inference "Route hands the request to the webhook service."
node dist/src/cli.js check --active --porcelain
node dist/src/cli.js resume --compact
```

Use `recording` for deterministic local development, `none` for continuity-only
runs, and `capn-cli` to publish a completed trajectory through Capn's public CLI.

All machine commands emit one JSON object on stdout. Diagnostics go to stderr.

## Provenance and boundaries

Waymark is an adaptation of the continuity problem that motivated
[`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload)
and the active-investigation use case suggested by
[`capn-hook`](https://github.com/CyrusNuevoDia/capn-hook). The reload hook owns
the Codex SessionStart/compaction bootloader. Capn owns finalized memory,
question/answer retrieval, QMD, and any hybrid search. Waymark owns only the
durable, single-writer trajectory between those boundaries. Its same-file span
scan is an integrity check for a recorded hop, not a repository search index.

The Capn integration crosses the public CLI boundary (`capn chart <question>
<answer> --files <file> --files <file> ...` and `capn ask <question>`). Waymark
never reads Capn storage internals, invokes a shell for arbitrary input, or
sends data to a network service. On Windows, when Capn resolves to a batch
script, Waymark fails closed for percent signs, quotes, and newlines because
`cmd.exe` cannot carry those values losslessly through a batch argv boundary;
it also rejects comma-containing file paths because Capn's public parser uses
comma-separated `--files` values. Use a direct executable when those values are
required.

## Repository map

- `src/` — dependency-free runtime and CLI.
- `schemas/` — strict machine-output and journal contracts.
- `test/` — Node test-runner coverage, including failure and recovery paths.
- `docs/` — continuity proof runbook.
- `control/` — live project state, ownership, contracts, test matrix, and the
  genuine-compaction ledger.
- `evidence/` — operator-supplied native compaction records only; no synthetic
  records are accepted.

## Git onboarding

Waymark requires Node.js 22 or newer. After cloning:

```text
npm ci
npm run verify
```

The repository is MIT licensed. Runtime state, build output, dependencies, and
local proof artifacts are ignored by Git. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) before making a change.

The checked-in workflow runs the same lockfile install and verification suite on
Node 22 for Linux, macOS, and Windows. `npm run public-check` is a small
dependency-free hygiene gate for common private-key, provider-secret, and local
machine-path leaks; it complements, rather than replaces, a full secret scanner.

## Continuity contract

The repository `AGENTS.md` is a deliberately small bootloader. After the existing
compact-reload hook restores it, the agent checks the active trajectory, resumes
only its verified prefix, and records each newly validated hop immediately.

An exact normalized span can be relocated within its original file, but a
signature-only candidate is never trusted. Branch or HEAD changes are reported as
`CROSS_BRANCH`. See [docs/CONTINUITY-RUN.md](docs/CONTINUITY-RUN.md) for the native
manual and automatic compaction evidence procedure.

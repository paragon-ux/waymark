# Waymark

Waymark is a small local-first continuity ledger for one active coding investigation.
It records verified file-and-line hops, survives a Codex context compaction, and
quarantines a trajectory when a recorded hop no longer matches the repository.

Waymark is intentionally complementary to the surrounding tools:

- `codex-agents-compact-reload` reloads project instructions after a compact start.
- Waymark preserves the active, unfinished trajectory.
- Capn-hook remains the finalized-memory and QMD retrieval provider.

Waymark does not read `.capn` files, implement embeddings, or install a Codex hook.

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

## Continuity contract

The repository `AGENTS.md` is a deliberately small bootloader. After the existing
compact-reload hook restores it, the agent checks the active trajectory, resumes
only its verified prefix, and records each newly validated hop immediately.

An exact normalized span can be relocated within its original file, but a
signature-only candidate is never trusted. Branch or HEAD changes are reported as
`CROSS_BRANCH`. See [docs/CONTINUITY-RUN.md](docs/CONTINUITY-RUN.md) for the native
manual and automatic compaction evidence procedure.

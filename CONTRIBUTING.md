# Contributing to Waymark

Waymark is intentionally small, local-first, and dependency-free at runtime.
Changes should preserve its narrow boundary: the reload hook bootloads, Waymark
preserves one active trajectory, and Capn publishes finalized memory.

## Development

Use Node.js 22 or newer and run:

```text
npm ci
npm run verify
```

`npm run verify` compiles the TypeScript, runs the Node test suite, validates
the JSON schemas, and checks the machine-output contracts. Do not commit
`dist/`, `node_modules/`, `.waymark/`, or runtime evidence.

Keep CLI arguments explicit and use `execFile`-style argv boundaries for
external tools. Do not add a SessionStart, PreCompact, or PostCompact hook to
Waymark. New behavior needs deterministic tests for both its success and
fail-closed paths.

## Changes and review

Use a focused branch, describe the lifecycle or contract change in the pull
request, and update `control/STATE.md`, `control/TEST-MATRIX.md`, and
`control/CHANGELOG.md` when the release state changes. Never manufacture rows
in `control/COMPACTIONS.md`; only native Codex events belong there.

Do not commit secrets, repository dumps, raw resume spans, personal machine
paths, or generated proof logs containing sensitive content.

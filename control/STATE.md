# STATE -- live project authority

Last updated: 2026-09-05.

## Current phase

**Phase 11 -- Standalone CLI lifecycle and quarantine harness, token budget assertions, and v1.7.0 release: DONE.** Added comprehensive standalone CLI lifecycle test harness in `test/standaloneHarness.test.ts`; verified full CLI lifecycle (`init` -> `begin` -> `note` -> `check` -> `resume` -> `complete`/`abandon`); verified crash resilience, dead PID detection, and forced lock recovery; verified 3-hop token budget (<250 tokens) and 15-hop bounded byte truncation (<=2048 bytes); verified `STALE` and `CROSS_BRANCH` quarantine; expanded test suite to 53 tests with zero failures; tagged v1.7.0 release.

## Phase plan

- Phase 0 -- sibling repository, parent registration, architecture, and user-level Luna profile. **DONE**
- Phase 1 -- journal, locking, active pointer, path safety, and CLI lifecycle. **DONE**
- Phase 2 -- normalized-span integrity, relocation, branch protection, and bounded resume packets. **DONE**
- Phase 3 -- strict schemas, Capn adapter profiles, recording mode, and machine-output tests. **DONE**
- Phase 4 -- self-hosting runbook, provenance documentation, and release controls. **DONE**
- Phase 5 -- independent review, native manual/automatic compaction evidence, and release verification. **DONE**
- Phase 6 -- remote publication to GitHub repository and CI verification. **DONE**
- Phase 7 -- native MCP server, Capn MCP wrapper, and zero-guesswork documentation cleanup. **DONE**
- Phase 8 -- linear audit, MCP decoupling, indexed benchmark baseline, and v1.4.0 release. **DONE**
- Phase 9 -- dynamic utility lab, ecosystem lifecycle proof, and v1.5.0 production-stable release. **DONE**
- Phase 10 -- polyglot WebAssembly AST discovery, two-phase discovery router, and v1.6.0 release. **DONE**
- Phase 11 -- Standalone CLI lifecycle and quarantine harness, token budget assertions, and v1.7.0 release. **DONE**

## Verified locally

- Waymark is an independent Git repository; this release is on `main`.
- Parent `AGENTS.md` and the compact-reload project registry recognize Waymark.
- The registered reload hook returned Waymark `AGENTS.md` and its SHA-256 in a
  direct executable smoke test.
- `npm ci`, TypeScript build, Node tests, MCP test suite, schema validation, and public hygiene checks pass locally.
- 53/53 tests pass with zero failures.
- The suite covers MCP tools/lifecycle, relocation, stale and cross-branch quarantine, torn journal
  recovery, locks, serializer bounds, path safety, hook suppression, and Capn
  argv behavior.
- Trellis and Mosaic are untouched.

## Open release gates

- [x] Review findings from independent `gpt-5.6-luna` maximum-reasoning tasks
  are triaged and resolved; see `control/REVIEW-LEDGER.md`.
- [x] Genuine post-compaction recoveries are recorded in `COMPACTIONS.md` matching Mosaic standards.
- [x] Clean-install verification is rerun and passing after all review changes.
- [x] Release hygiene, secret scan, and public state verified.
- [x] Remote Waymark repository publication and sync.
- [x] Native MCP server implemented and verified via unit/integration tests.
- [x] Standalone decoupled MCP servers, indexed benchmark, and ecosystem guides verified for v1.4.0.




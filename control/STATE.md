# STATE -- live project authority

Last updated: 2026-09-02.

## Current phase

**Phase 10 -- Polyglot WebAssembly AST discovery engine, two-phase discovery router, empirical 25-query mixed benchmark, and v1.6.0 release: DONE.** Implemented in-process WebAssembly Tree-sitter engine supporting 30+ languages for sub-second AST call-graph tracing and exact symbol line ranges; converted capn_ask into a dual-phase discovery router cascading between memory and in-process AST; validated 25-query mixed benchmark with 100% precision (25/25), 1.36s avg latency, and 0 background daemons; expanded unit/integration test suite to 39 tests with zero failures; overhauled documentation architecture with TOC and visual repository directory; tagged v1.6.0 release.

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

## Verified locally

- Waymark is an independent Git repository; this release is on `main`.
- Parent `AGENTS.md` and the compact-reload project registry recognize Waymark.
- The registered reload hook returned Waymark `AGENTS.md` and its SHA-256 in a
  direct executable smoke test.
- `npm ci`, TypeScript build, Node tests, MCP test suite, schema validation, and public hygiene checks pass locally.
- 39/39 tests pass with zero failures.
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




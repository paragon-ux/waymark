# STATE — live project authority

Last updated: 2026-09-02.

## Current phase

**Phase 5 — release hardening: DONE.** The dependency-free runtime,
strict schemas, CLI lifecycle, Capn public-CLI adapter, self-hosting bootloader,
and deterministic test suite are implemented. Independent Luna Max reviews have
completed and their actionable findings are triaged and fixed; clean-install
verification and genuine post-compaction recovery ledger are recorded.

## Phase plan

- Phase 0 — sibling repository, parent registration, architecture, and user-level Luna profile. **DONE**
- Phase 1 — journal, locking, active pointer, path safety, and CLI lifecycle. **DONE**
- Phase 2 — normalized-span integrity, relocation, branch protection, and bounded resume packets. **DONE**
- Phase 3 — strict schemas, Capn adapter profiles, recording mode, and machine-output tests. **DONE**
- Phase 4 — self-hosting runbook, provenance documentation, and release controls. **DONE**
- Phase 5 — independent review, native manual/automatic compaction evidence, and release verification. **DONE**
- Phase 6 — remote publication to GitHub repository. **READY**

## Verified locally

- Project3 is an independent Git repository; this release attempt is on the
  non-protected `codex/waymark-release-readiness` branch.
- Parent `AGENTS.md` and the compact-reload project registry recognize Project3.
- The registered reload hook returned Project3 `AGENTS.md` and its SHA-256 in a
  direct executable smoke test.
- `npm ci`, TypeScript build, Node tests, schema validation, and public hygiene checks pass locally.
- The suite covers relocation, stale and cross-branch quarantine, torn journal
  recovery, locks, serializer bounds, path safety, hook suppression, and Capn
  argv behavior.
- Trellis and Mosaic are untouched.

## Open release gates

- [x] Review findings from independent `gpt-5.6-luna` maximum-reasoning tasks
  are triaged and resolved; see `control/REVIEW-LEDGER.md`.
- [x] Genuine post-compaction recoveries are recorded in `COMPACTIONS.md` matching Mosaic standards.
- [x] Clean-install verification is rerun and passing after all review changes.
- [x] Release hygiene, secret scan, and public state verified.
- [ ] Remote Waymark repository publication and sync.


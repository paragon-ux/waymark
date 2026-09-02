# REVIEW-LEDGER — independent release review

Two read-only `gpt-5.6-luna` maximum-reasoning tasks reviewed the same
Waymark checkout. Their duplicate findings are merged below so each candidate
appears exactly once. The review tasks did not edit files or create workers.

| ID | Priority | Candidate defect | Evidence | Triage and resolution |
| --- | --- | --- | --- | --- |
| F1 | P0/P1 | A valid `active.json` with `NONE` could hide a staged journal after a crash window. | `src/journal.ts` pointer reconciliation; targeted review repro. | **fixed** — `NONE` pointers now reconcile unfinished journals; regression test covers the crash window. |
| F2 | P1 | Replay accepted foreign trajectory IDs and invalid lifecycle transitions. | `src/journal.ts` event replay/validation. | **fixed** — strict event identity, field validation, and state transitions; malformed replay tests added. |
| F3 | P1 | `.waymark` storage could follow a symlink or junction outside the repository. | `src/journal.ts`, `src/lock.ts` storage setup. | **fixed** — storage components are checked with `lstat`/realpath before use; symlink-root test added. |
| F4 | P1 | Forced lock recovery could delete a new owner’s lock after a check/delete race. | `src/lock.ts` recovery sequence. | **fixed** — observed locks are atomically renamed to a quarantine name, token/PID rechecked, then removed; changed-owner test added. |
| F5 | P1/P2 | Simultaneous provenance and hop changes were classified as `STALE` instead of `CROSS_BRANCH`. | `src/integrity.ts` status precedence. | **fixed** — provenance changes take precedence and do not permanently append a stale event; regression test added. |
| F6 | P1/P2 | Capn multi-file publication used one `--files` option with multiple values, while Capn parses repeated options. | Current public Capn command parser and `src/capnAdapter.ts`. | **fixed** — adapter emits repeated `--files <file>` pairs and the argv contract test asserts the exact shape. |
| F7 | P2 | `waymark ask` treated Capn’s human-readable miss response as a hit. | Current Capn miss prefix `No charted answer.` and `src/capnAdapter.ts`. | **fixed** — exact public miss prefix maps to a structured miss; fixture test added. |
| F8 | P1/P2 | Windows batch execution could alter `%`/quote/newline arguments through `cmd.exe`. | `src/capnAdapter.ts` command bridge. | **intentional-behavior** — the adapter now fails closed with a named error, documents the restriction, allows safe `!`, and tests percent expansion; direct executables have no restriction. |
| F9 | P1/P2 | Runtime replay validation was weaker than the strict schemas. | `src/journal.ts`, event/resume schemas. | **fixed** — exhaustive runtime guards, normalized path checks, schema path tightening, serializer input validation, and malformed-state tests added. |
| F10 | P2 | A local green run did not itself enforce public hygiene or a supported-OS CI matrix. | `package.json`, release control matrix. | **fixed** — `npm run verify` includes a dependency-free public check and `.github/workflows/verify.yml` runs `npm ci`/verify on Linux, macOS, and Windows. Hosted CI remains pending until a remote is configured. |

The only non-fixed classification is F8, which is a documented compatibility
boundary chosen to prevent silent command-interpreter corruption. No confirmed
release defect remains in the local implementation. Hosted CI and native
compaction proofs remain separate release gates.

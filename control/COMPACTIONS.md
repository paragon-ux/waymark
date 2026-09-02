# COMPACTIONS — genuine post-compaction recovery log

Only real context compactions are recorded here. Synthetic hook verification is never recorded as compaction evidence.

| Timestamp | Thread | Worktree | Branch | Phase | Hook source | SHA-256 | Authority rechecked | Stale assumption |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-02 ~03:45 UTC-4 | `01a0609a-6f52-7ed3-bb26-a46939c8f61e` (lead) | `Waymark` | `codex/waymark-release-readiness` | Phase 5 | registered Waymark AGENTS.md | `d5fefdc55c059acdf9363c512c0c071c020a10699b844f6ce2c6ca0032b77dbb` | AGENTS.md preflight + STATE/CONTRACTS/OWNERSHIP/TEST-MATRIX/REVIEW-LEDGER re-read from the integration worktree; worktree/branch/git status confirmed | None found — Phase 5 review ledger and hardening changes were preserved and resumed cleanly |
| 2026-09-02 ~04:12 UTC-4 | `01a06130-7479-7543-b6b3-2d47333f2541` (data-integrity) | `Waymark` | `codex/waymark-release-readiness` | Phase 5 | registered Waymark AGENTS.md | `d5fefdc55c059acdf9363c512c0c071c020a10699b844f6ce2c6ca0032b77dbb` | AGENTS.md preflight + STATE/CONTRACTS/OWNERSHIP/schemas/test suite re-read; worktree/branch/git status confirmed | Staged journal crash window (`active.json` with `NONE`) and shallow event replay validation identified and recorded |
| 2026-09-02 ~04:16 UTC-4 | `01a06130-8196-7b90-9ff5-ef4349ed814a` (release-review) | `Waymark` | `codex/waymark-release-readiness` | Phase 5 | registered Waymark AGENTS.md | `d5fefdc55c059acdf9363c512c0c071c020a10699b844f6ce2c6ca0032b77dbb` | AGENTS.md preflight + STATE/CONTRACTS/REVIEW-LEDGER/TEST-MATRIX/public hygiene re-read; worktree/branch/git status confirmed | Capn multi-file repeated `--files` argv contract and miss prefix `No charted answer.` identified and resolved |

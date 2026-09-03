# Waymark Architectural Rationale & Design Decisions

This document details the architectural decisions, design tradeoffs, integrity model, and operational boundaries of **Waymark**.

---

## 1. Architectural Vision: The 4-Layer Stack

Waymark exists to solve the **Context Compaction Problem** for AI coding agents without introducing monolithic bloat, external background daemons, or massive database engines:

<p align="center">
  <img src="docs/assets/architecture-flowchart2.svg" alt="Waymark 4-Layer Active Architecture" width="100%" />
</p>

### The Division of Labor Across Layers:
1. **Layer 1: On-Demand Local AST (`web-tree-sitter` in WASM):** Traverses syntax trees in-process in <50ms with ~15 MB RAM to resolve call hierarchies, caller/callee graphs, and exact symbol declarations across 30+ languages without native C++ compilation or language server daemons.
2. **Layer 2: External Deep Indexers (QMD, LSPs):** Whole-repo hybrid indexers, vector embeddings, and semantic search engines that agents consult for broad candidate retrieval.
3. **Layer 3: In-Flight Continuity Ledger (Waymark):** Tracks active, verified code-and-line evidence hops into an append-only NDJSON journal (`.waymark/`), locks anchors against Git HEAD, and generates bounded resume packets (<216 tokens) upon context compaction.
4. **Layer 4: Cross-Session Episodic Memory (Capn-Hook):** Manages long-term repository knowledge as append-only markdown entries (`.capn/entries/*.md`) with QMD SQLite indexing, enabling multi-agent knowledge sharing.

---

## 2. Why In-Flight Continuity vs. Other Approaches?

| Dimension | Cold Exploration | Retrieval-Only Indexers | Ralph-Style Loops | Waymark In-Flight Ledger |
| :--- | :--- | :--- | :--- | :--- |
| **Compaction Recovery** | Complete loss of trail; restarts from scratch. | Re-runs broad queries; loses causal steps. | Starts fresh process; rebuilds context from scratch. | **Resumes immediately from verified hop prefix.** |
| **Recovery Token Cost** | 10,000–50,000+ tokens re-reading files. | 3,000–10,000 tokens re-parsing candidates. | High startup prompt and state reconstruction overhead. | **Bounded to <820 bytes (~216 tokens).** |
| **Line Anchor Accuracy** | High hallucination risk after summary roll. | Stale if files were edited during session. | Dependent on prompt summary fidelity. | **100% precision via Git-anchored span hashes.** |
| **Code Shift Resilience** | None; fails on relocated functions. | None; requires manual re-querying. | Low; requires re-reading edited files. | **Automatic relocation scan up to 2,000 lines.** |
| **Drift Protection** | High risk of operating across dirty branches. | Unaware of Git HEAD changes. | Relies on external orchestrator checks. | **Fail-closed `CROSS_BRANCH` detection.** |

---

## 3. Integrity & Safety Guarantees

Waymark's integrity model is designed to fail closed rather than let an agent resume from inaccurate or hallucinated context:

### A. Exact & Relocated Span Verification (`FRESH` / `MOVED`)
Each recorded hop captures:
- Canonical file path;
- Line numbers (1-indexed start and end);
- Exact SHA-256 hash of the line span; and
- Structural AST signature (symbol name, parameter count, return kind).

If intervening edits shift code in the file, Waymark performs an automatic, bounded relocation scan up to 2,000 lines above and below the recorded range. If a unique matching span is found, Waymark updates line anchors, marks the hop as `MOVED`, and reports the relocated line coordinates.

### B. Fail-Closed Stale Quarantine (`STALE`)
If recorded code within a hop has been modified, deleted, or if a relocation scan produces ambiguous matches:
- Waymark immediately quarantines the trajectory as `STALE`.
- The resume packet truncates trust strictly at `verifiedThrough` (the last verified valid hop before the stale hop).
- The agent is instructed to re-verify the flagged hop rather than proceeding on invalidated assumptions.

### C. Branch & Commit Drift Protection (`CROSS_BRANCH`)
Investigations are cryptographically bound to the starting Git branch and commit:
- If a user or automated pipeline switches branches or commits changes mid-investigation, Waymark detects the Git HEAD mismatch.
- Waymark halts continuation with `CROSS_BRANCH` status, preventing an agent from applying conclusions derived on one branch to a different code revision.

### D. Crash-Proof Immutable Journal
- Stored as flat, append-only NDJSON entries in `.waymark/journal.ndjson`.
- Uses filesystem mutex locking (`.waymark/lock`) with stale-owner process reclamation.
- Employs atomic writes, directory-level protections, and `fsync` flushing to survive process abrupt kills, system restarts, or torn writes.

---

## 4. When Waymark is Worth It vs. Overkill

### High-Leverage Scenarios (Worth It):
- **Multi-Hop Investigations:** Tracing issues across 2+ files, inheritance trees, or microservice call chains.
- **Long-Horizon Tasks:** Architectural refactoring, security vulnerability tracing, or bug reproductions expected to exceed single-turn context limits (>10,000 tokens).
- **Active Worktrees:** Repositories where code shifts or parallel edits occur while the agent is investigating.
- **Audit & Forensic Trails:** Tasks requiring verifiable proof of which files, line ranges, and causal inferences led to a patch.

### Low-Leverage Scenarios (Overkill):
- **Single-File Fixes:** Isolated typos, syntax corrections, or formatting changes.
- **Disposable Prototyping:** Quick exploratory scripts where in-flight continuity is not needed.
- **Trivial Tasks:** Any assignment easily completed in 1 to 2 conversational turns.
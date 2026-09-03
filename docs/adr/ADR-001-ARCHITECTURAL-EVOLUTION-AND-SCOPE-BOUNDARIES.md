# ADR-001: Architectural Evolution, Scope Boundaries, and Next-Step Validation

## Status
**Accepted**

## Date
2026-09-03

## Context
Following the completion and synchronization of **Waymark v1.6.0** (polyglot WebAssembly AST discovery and in-flight continuity ledger) and **AGENTS.md Compact Reload v0.2.0** (universal multi-harness static governance bootloader), a secondary architectural review was conducted (recorded in `gh-copilot-conversation/thu_sep_03_2026_waymark_assessment_and_improvement_suggestions_2.md`).

The review evaluated Waymark's competitive posture, production readiness, and potential evolution vectors. We critically examined suggested future directions to establish firm scope boundaries, distinguishing high-leverage architectural refinements from destructive scope creep.

---

## Decision & Scope Boundaries

### 1. Accepted Next Steps (High-Leverage & Architecturally Aligned)

We approve the following technical initiatives for immediate and medium-term execution:

#### A. Empirical Host Acceptance across Tier 1 Harnesses
- **Decision:** Conduct live, multi-turn compaction runs against real agent hosts for **Claude Code** (`post_compact` lifecycle hook) and **Google Antigravity** (`PreInvocation.injectSteps` protocol).
- **Rationale:** The automated regression suites verify 100% of payload contracts (39/39 in Waymark, 13/13 in Compact Reload). Real-host acceptance is empirically proven on OpenAI Codex (`docs/HOST-ACCEPTANCE.md`). Proving that live Claude Code and Antigravity event loops inject both the reloaded `AGENTS.md` and the bounded `<216 token` Waymark resume packet without race conditions establishes verifiable multi-harness dominance.

#### B. Packaging & Seamless Agentic Distribution (`npx` / One-Click MCP)
- **Decision:** Provide clean npm packaging and one-command MCP execution entrypoints (`npx @paragon-ux/waymark`).
- **Rationale:** While Waymark executes in pure WebAssembly with zero native C++ build tools, requiring local TypeScript compilation (`npm run build`) adds friction. An `npx` or pre-built distribution allows agents in Claude Desktop, Cursor, Codex, and Antigravity to boot Waymark instantly without manual path configuration.

#### C. Multi-Agent Concurrency Testing across Git Worktrees with Capn
- **Decision:** Stress-test concurrent multi-agent workflows using Git worktrees and Capn episodic memory.
- **Rationale:** As documented in `docs/MULTI-AGENT-AND-CAPN.md`, Waymark's concurrency model pairs **isolated single-writer worktrees** (`.waymark/`) with **shared concurrent-reader memory** (`.capn/entries/*.md`). Validating that multiple parallel agents can read Capn memory simultaneously while keeping independent `.waymark/` journals under heavy file contention empirically verifies the architecture's concurrent-safety guarantees.

---

### 2. Explicitly Rejected Proposals (Scope Creep & Monolithic Drift)

We explicitly reject the following proposals to preserve Waymark's core architectural advantages:

#### A. Merging Waymark and AGENTS.md Compact Reload into a Single Monolith
- **Rejection:** **REJECTED.**
- **Rationale:** Modularity is an explicit design invariant.
  - `AGENTS.md Compact Reload` is the universal bootloader for **static project governance and security rules** (`AGENTS.md`).
  - `Waymark` is the engine for **dynamic in-flight code trajectory breadcrumbs** (`.waymark/`).
  Keeping them distinct allows operators and agents to upgrade, replace, or reconfigure either component independently as harness capabilities evolve, avoiding monolithic failure modes.

#### B. Embedding Heavy Vector Databases or Persistent Background Daemons
- **Rejection:** **REJECTED.**
- **Rationale:** Any suggestion to bundle persistent background LSP daemons, network socket listeners, or heavy vector embedding models contradicts Waymark's core value proposition: **instant, zero-daemon, pure WebAssembly on-device execution**.
  - Waymark resolves structural AST queries (`Who calls X?`, `Where is Y declared?`) in `<50ms` using in-process WebAssembly (`web-tree-sitter`) with `~15 MB RAM`.
  - Deep semantic retrieval belongs in external indexers (QMD, Language Servers) or Capn-hook. Waymark remains an ultra-light, portable, instant-on continuity ledger.

#### C. Centralized Multi-Agent Lock Brokers
- **Rejection:** **REJECTED.**
- **Rationale:** Centralized network socket locks or distributed consensus servers over-engineer local development. Waymark's filesystem mutexes (`.waymark/lock` with stale-process PID recovery) and Git worktree directory isolation provide robust, deterministic single-writer safety without network ports, port conflicts, or cross-machine coordination overhead.

---

## Consequences & Invariants

1. **Zero-Daemon Invariant:** Waymark shall never require a persistent background service, open TCP port, or native C++ compilation toolchain to operate.
2. **Modularity Invariant:** Static governance (`AGENTS.md`) and dynamic in-flight code tracking (`.waymark/`) remain decoupled repositories with clear division of labor.
3. **Evidence Over Assertion:** Future claims regarding multi-harness compatibility must be backed by empirical host acceptance runs and recorded audit logs.
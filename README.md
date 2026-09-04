# Waymark: In-Flight Continuity & Discovery MCP Server for AI Coding Agents

> **Empirical Continuity Benchmark:** Across multi-hop coding investigations, an agent recovering from Waymark used **96.8% fewer recovery tokens** vs. Cold Exploration (~216 tokens vs. 6,675 avg cold tokens) with **100% precision on relocated spans** and **zero redundant file re-inspections**—paying for itself immediately on the 1st compaction. (Reproduce via `npm run benchmark`).

---

## Table of Contents

- [Why Use It?](#why-use-it)
- [Cross-Repository Ecosystem](#cross-repository-ecosystem)
- [Standardized 3-Tier Harness Model](#standardized-3-tier-harness-model)
- [Quick Start & Agentic Installation](#quick-start--agentic-installation)
- [The Compaction Problem](#the-compaction-problem)
- [Waymark's Active Architecture](#waymarks-active-architecture)
- [The Proactive Agent Directive](#the-proactive-agent-directive)
- [Division of Labor with AGENTS.md Compact Reload](#division-of-labor-with-agentsmd-compact-reload)
- [Repository Directory](#repository-directory)
- [Deep-Dive Documentation](#deep-dive-documentation)
- [Build & Verify](#build--verify)

---

## Cross-Repository Ecosystem

This repository is part of an integrated, local-first multi-agent execution suite:

### Internal Suite Repositories

| Repository | Role & Responsibility | Core Invariant |
| :--- | :--- | :--- |
| **[`AGENTS.md Compact Reload`](https://github.com/paragon-ux/codex-agents-compact-reload)** | Static project governance & compaction survival. | Re-injects verified `AGENTS.md` and SHA-256 hash on context compaction. |
| **[`Waymark`](https://github.com/paragon-ux/waymark)** | In-flight continuity ledger & AST discovery MCP. | Preserves verified code hops (`.waymark/`) across compactions (<216 tokens). |
| **[`Arbiter`](https://github.com/paragon-ux/Arbiter)** | Multi-agent DAG orchestrator & worktree supervisor. | Enforces `1 Task : 1 Worktree : 1 Trajectory`; fail-closed merge quarantine. |

#### When to Use What

- **Use [`AGENTS.md Compact Reload`](https://github.com/paragon-ux/codex-agents-compact-reload)** when an agent harness compacts context and you must deterministically guarantee that static project instructions, safety guardrails, and coding conventions are restored into the active session without spending agent recovery turns.
- **Use [`Waymark`](https://github.com/paragon-ux/waymark)** when an agent is deep in a multi-file investigation or code trace and needs to preserve dynamic, verified line spans and causal breadcrumbs across compactions without repetitive, token-expensive codebase re-reads.
- **Use [`Arbiter`](https://github.com/paragon-ux/Arbiter)** when running multiple autonomous coding agents in parallel and you need ephemeral Git worktree isolation, DAG task dependencies, zero-daemon dead-worker recovery, and conflict-quarantined sequential merges.

> [!IMPORTANT]
> **The 1:1:1 Invariant Contract**:
> Every concurrent agent worker provisioned by **Arbiter** operates in exactly **one isolated Git worktree** and records exactly **one active Waymark trajectory**. Context compaction reloads static rules via **`AGENTS.md Compact Reload`** and in-flight hops via **`Waymark`** without mutating the task lease or crossing branch boundaries.

### External Specifications

| Specification | Canonical Reference | Usage in Suite |
| :--- | :--- | :--- |
| **Model Context Protocol (MCP)** | [Model Context Protocol Specification](https://github.com/modelcontextprotocol/specification) | Standardized JSON-RPC 2.0 stdio tool interface used across Waymark and Arbiter. |
| **Tree-sitter WASM** | [Tree-sitter](https://github.com/tree-sitter/tree-sitter) | Polyglot AST grammars compiled to WebAssembly for zero-dependency symbol discovery. |
| **Node.js Core Runtime** | [Node.js](https://github.com/nodejs/node) (v22+ LTS) | Native `node:sqlite`, `node:child_process`, `node:crypto`, `node:fs` (0 runtime npm dependencies). |
| **Capn Hook / Memory Protocol** | [Capn Hook](https://github.com/cyrusNuevoDia/capn-hook) | Finalized episodic memory storage, distinct from Waymark's active in-flight trajectory ledger. |

---

## Why Use It?

| Approach | Context and Token Cost | Recovery Precision | Causal Inferences Preserved? |
| :--- | :--- | :--- | :--- |
| **No Hook / Cold Exploration** | Extreme (10,000–50,000+ tokens) | Zero (starts over from scratch) | No (wiped on compaction) |
| **Retrieval Alone (Indexers/LSPs)** | Moderate (3,000–10,000 tokens) | Heuristic / approximate | No (re-derives candidate symbols) |
| **Ralph-Style Loops** | High (full prompt reconstruction) | Variable (prompt summary fidelity) | No (re-runs outer process) |
| **Waymark In-Flight Ledger** | **Bounded (<820 B / ~216 tokens)** | **100% (exact Git span hashes)** | **Yes (verified breadcrumb trail)** |

Waymark is designed to preserve causal investigation breadcrumbs across LLM context compactions, eliminate hallucinated line coordinates, and prevent repetitive, costly whole-repo re-reads. See [Rationale](Rationale.MD) for the detailed design comparison and limits.

---

## Standardized 3-Tier Harness Model

Agent harnesses provide varying levels of context-injection capability, categorized into three distinct support tiers:

| Support Tier | Mechanism | Delivery Guarantee | Target Harnesses |
| :--- | :--- | :--- | :--- |
| **Tier 1: Active Lifecycle Hook** | Out-of-context process execution on compaction boundary. | **100% deterministic.** Instructions and breadcrumbs prepended before model turn; zero tokens spent remembering to recover. | **OpenAI Codex** (`SessionStart`), **Google Antigravity** (`PreInvocation.injectSteps`), **Claude Code** (`post_compact`). |
| **Tier 2: MCP Ingestion** | In-band Model Context Protocol primitives. | **High reliability.** Standardized pull; model accesses context via subscribed URIs (`waymark://context`) or prompt commands. | **Claude Code**, **Cursor Composer**, **Windsurf**, **Cline**. |
| **Tier 3: Persistent Directives** | Sticky system instruction files (`CLAUDE.md`, `.cursor/rules/*.mdc`). | **Best-effort.** Instructs model to call `waymark_resume()` as step 1 when prior turn history is rolled. | **Cursor**, **Claude Code**, **Antigravity**. |

See [Multi-Agent Harness Compatibility Guide](docs/HARNESS-COMPATIBILITY.md) for complete harness schemas.

---

## Quick Start & Agentic Installation

For autonomous agents setting up Waymark inside a project workspace, follow this 3-step workflow:

### 1. Build and Verify
Ensure Node.js 22+ and Git are installed, then compile the on-device WebAssembly discovery engine:

```bash
npm ci
npm run verify
```

### 2. Client MCP Registration
Register Waymark in your agent's MCP configuration (`mcpServers` in Claude Desktop, Cursor, Codex, Gemini / Antigravity, or Cline):

```json
{
  "mcpServers": {
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
    }
  }
}
```
*(For modular Capn episodic memory or unified single-process mode, see [MCP Server Configuration](docs/MCP-CONFIGURATION.md)).*

### 3. Add the Proactive Agent Directive
Add this 4-rule instruction to your project's persistent rules (`CLAUDE.md`, `.cursor/rules/waymark.mdc`, or harness system prompt):

```text
1. Before searching codebase, query capn_ask to reuse charted knowledge or trace AST calls.
2. While tracing code, save verified hops via waymark_note (path, line range, inference).
3. After context compaction, call waymark_resume to pick up your exact verified breadcrumb trail.
4. When finished, seal with waymark_complete to archive findings and chart into Capn.
```

For Tier 1 automated out-of-context hook injection without spending agent turns, register [`scripts/hooks/waymark-compact-hook.mjs`](scripts/hooks/waymark-compact-hook.mjs) in your harness lifecycle configuration.

---

## The Compaction Problem

When an AI coding agent is 6 hops deep tracing a complex issue across 5 files, context compaction eventually triggers:
- **Without Waymark (Cold Exploration)**: In-flight discoveries are wiped. The agent re-reads the entire repository from scratch, wastes tens of thousands of tokens re-deriving the same files, or hallucinates line numbers.
- **Without Waymark (Retrieval alone)**: Even with structural graph or semantic indexers, the agent re-runs broad queries, re-evaluates candidate functions, and loses the specific causal inferences made before compaction.
- **With Waymark (In-Flight Continuity)**: The agent calls `waymark_resume` and immediately picks up from its verified breadcrumb trail in a single step (<820 bytes / ~216 tokens).

---

## Waymark's Active Architecture

Waymark implements a layered system design specifically for agent context preservation and code discovery:

| Architectural Layer | Engine & Implementation | Active Role in Waymark |
| :--- | :--- | :--- |
| **Layer 1: On-Demand Local AST** | **Built-in `web-tree-sitter` (WASM)** | Traverses syntax trees in-process (<50ms) to resolve call hierarchies and symbol line ranges with zero background daemons. |
| **Layer 2: Deep Indexer Interop** | **External Indexers (QMD, LSPs)** | Pairs with whole-repo semantic or graph indexers, capturing and verifying candidate snippets into durable continuity trails. |
| **Layer 3: In-Flight Continuity Ledger** | **Append-only NDJSON Journal (`.waymark/`)** | Records verified evidence hops, tracks relocated code spans (`MOVED`), and generates bounded resume packets (<216 tokens) upon compaction. |
| **Layer 4: Cross-Session Memory Gateway** | **Capn Memory Bridge (`capnAdapter.ts`)** | Routes conceptual queries to charted repository memory (`capn_ask`) and publishes sealed findings (`waymark_complete`). |

*(For the complete architectural vector flowchart and design rationale, see [Rationale](Rationale.MD)).*

---

## Division of Labor with AGENTS.md Compact Reload

In a resilient agent workflow, post-compaction continuity operates across two complementary bootloaders:

```text
               Context Compaction Occurs
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
 [ AGENTS.md Compact Reload ]      [ waymark-compact-hook ]
  Target: Root `AGENTS.md`          Target: `.waymark/active.json`
  Role: Static behavioral rules     Role: Dynamic verified breadcrumbs
  Output: Project authority & hash  Output: Hops & relocated line spans
          │                               │
          └───────────────┬───────────────┘
                          ▼
        Immediate Post-Compaction Continuation
        (Full rules + Exact code breadcrumb trail)
```

1. **Static Project Governance ([AGENTS.md Compact Reload](https://github.com/paragon-ux/codex-agents-compact-reload)):** Reloads the root `AGENTS.md` and validates its SHA-256 hash. Ensures the agent never forgets its behavioral boundaries, test requirements, or safety invariants.
2. **Dynamic In-Flight Trajectory ([`waymark-compact-hook.mjs`](scripts/hooks/waymark-compact-hook.mjs)):** Reloads the active `.waymark/` journal, verifies Git line anchors, detects relocated spans (`MOVED`), and injects the verified breadcrumb trail (<216 tokens).

---

## Repository Directory

```text
Waymark/
├── Rationale.MD               # Architectural rationale, vector diagram, & integrity model
├── src/
│   ├── astExtractor.ts        # Polyglot WebAssembly AST extractor (30+ languages)
│   ├── discoveryRouter.ts     # Two-phase discovery router (memory + WASM AST)
│   ├── capnAdapter.ts         # Capn memory adapter & execution bridge
│   ├── journal.ts             # Append-only NDJSON event journal & recovery
│   ├── integrity.ts           # Span hashing, relocation scanner, drift detection
│   ├── lock.ts                # Filesystem mutex & stale lock recovery
│   ├── resumeSerializer.ts    # Compact-resume packet generator (<2,048 bytes)
│   ├── cli.ts                 # Operator diagnostic CLI
│   └── mcp/
│       ├── waymarkIndex.ts    # Standalone continuity MCP entrypoint
│       ├── capnIndex.ts       # Standalone memory & discovery MCP entrypoint
│       ├── index.ts           # Unified dual-server MCP entrypoint
│       └── server.ts          # Standard JSON-RPC 2.0 stdio server
├── schemas/                   # JSON schemas for journals, events, resume packets
├── scripts/
│   ├── benchmark.mjs          # Continuity benchmark suite (Cold vs Indexed vs Waymark)
│   ├── hooks/                 # Out-of-context harness hooks (waymark-hook)
│   └── verify-mermaid.mjs     # Architecture diagram integrity check
├── docs/                      # Deep-dive architecture and benchmark guides
│   ├── adr/                   # Architectural Decision Records (ADR-001)
│   ├── MCP-CONFIGURATION.md   # Deployment options and full MCP toolsets reference
│   ├── CAPN-AND-DISCOVERY.md  # Capn-mcp profiles & WASM AST intent detection
│   ├── DISCOVERY-BENCHMARK.md # 25-query mixed benchmark vs graph indexers
│   ├── MULTI-AGENT-AND-CAPN.md# Multi-agent coordination & shared memory guide
│   └── HARNESS-COMPATIBILITY.md# 3-tier harness classification & hook setup
└── test/                      # 39 automated unit and integration tests
```

---

## Deep-Dive Documentation

- **[Architectural Rationale & Integrity Model](Rationale.MD)**: Complete design rationale, 4-layer vector flowchart, and safety model.
- **[ADR-001: Architectural Evolution & Scope Boundaries](docs/adr/ADR-001-ARCHITECTURAL-EVOLUTION-AND-SCOPE-BOUNDARIES.md)**: Formal evaluation of next steps, empirical host acceptance, and rejection of monolithic/daemon creep.
- **[MCP Configuration & Toolsets Guide](docs/MCP-CONFIGURATION.md)**: Deployment options (standalone, modular, unified) and full tool parameter specifications.
- **[Capn Memory & Two-Phase Discovery Guide](docs/CAPN-AND-DISCOVERY.md)**: Deep dive into `capn-mcp`, adapter profiles, and WASM AST intent detection.
- **[On-Device Discovery & Benchmark Report](docs/DISCOVERY-BENCHMARK.md)**: 25-query mixed evaluation and layered comparison against dedicated graph indexers.
- **[Multi-Agent Coordination & Capn Architecture Guide](docs/MULTI-AGENT-AND-CAPN.md)**: Shared episodic memory, worktree concurrency scoping, and scale characteristics.
- **[Multi-Agent Harness Compatibility Guide](docs/HARNESS-COMPATIBILITY.md)**: 3-tier support classification, lifecycle hooks (`waymark-hook`), and multi-harness setup for Claude Code, Cursor, Codex, and Antigravity.
- **[Audit and Optimization Report](docs/AUDIT-AND-OPTIMIZATION-REPORT.md)**: Full audit ledger and empirical continuity benchmark analysis.

---

## Build & Verify

Requires Node.js 22+:

```bash
npm ci
npm run verify
npm run benchmark
```

MIT Licensed. Pure WebAssembly on-device AST parsing with zero native C++ compilation.
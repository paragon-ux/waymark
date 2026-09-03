# Waymark: In-Flight Continuity & Discovery MCP Server for AI Coding Agents

> **Empirical Continuity Benchmark:** Across multi-hop coding investigations, an agent recovering from Waymark used **96.8% fewer recovery tokens** vs. Cold Exploration (~216 tokens vs. 6,675 avg cold tokens) with **100% precision on relocated spans** and **zero redundant file re-inspections**--paying for itself immediately on the 1st compaction. (Reproduce via `npm run benchmark`).

---

## Table of Contents

- [The Compaction Problem](#the-compaction-problem)
- [Waymark's Active Architecture](#waymarks-active-architecture)
- [The Proactive Agent Directive](#the-proactive-agent-directive)
- [MCP Server Configuration](#mcp-server-configuration)
- [Core MCP Toolsets](#core-mcp-toolsets)
- [Integrity & Safety Guarantees](#integrity--safety-guarantees)
- [When Waymark is Worth It vs. Overkill](#when-waymark-is-worth-it-vs-overkill)
- [Repository Directory](#repository-directory)
- [Deep-Dive Documentation](#deep-dive-documentation)

---

## The Compaction Problem

When an AI coding agent is 6 hops deep tracing a complex issue across 5 files, context compaction eventually triggers:
- **Without Waymark (Cold Exploration)**: In-flight discoveries are wiped. The agent re-reads the entire repository from scratch, wastes tens of thousands of tokens re-deriving the same files, or hallucinates line numbers.
- **Without Waymark (Retrieval alone)**: Even with structural graph or semantic indexers, the agent re-runs broad queries, re-evaluates candidate functions, and loses the specific causal inferences made before compaction.
- **With Waymark (In-Flight Continuity)**: The agent calls `waymark_resume` and immediately picks up from its verified breadcrumb trail in a single step (<820 bytes / ~216 tokens).

---

## Waymark's Active Architecture

Waymark implements a unified, layered system design specifically for agent context preservation and code discovery:

| Architectural Component | Engine & Implementation | Active Role in Waymark |
| :--- | :--- | :--- |
| **1. On-Demand Local AST** | **Built-in `web-tree-sitter` (WASM)** | Traverses syntax trees in-process (<50ms) to resolve call hierarchies and symbol line ranges with zero background daemons. |
| **2. In-Flight Continuity Ledger** | **Append-only NDJSON Journal (`.waymark/`)** | Records verified evidence hops, tracks relocated code spans (`MOVED`), and generates bounded resume packets (<216 tokens) upon compaction. |
| **3. Cross-Session Memory Gateway** | **Capn Memory Bridge (`capnAdapter.ts`)** | Routes conceptual queries to charted repository memory (`capn_ask`) and publishes sealed findings (`waymark_complete`). |
| **4. Deep Indexer Interoperability** | **External Indexers (QMD, Language Servers)** | Pairs with whole-repo semantic or graph indexers, capturing and verifying candidate snippets into durable continuity trails. |

<p align="center">
  <img src="docs/assets/architecture-flowchart2.svg" alt="Waymark Architecture Flowchart" width="100%" />
</p>

Waymark unifies **in-flight continuity** (`waymark_*`) and an **intelligent discovery router** (`capn_ask`) in a single runtime:
- **Local Fast Loop:** Resolves structural questions (`Who calls X?`, `Where is Y declared?`) in milliseconds via in-process WebAssembly AST parsing without port allocations or memory arena overhead.
- **Compaction Survival:** Locks verified hops against Git HEAD so that when LLM context compaction fires, the agent resumes execution in one step without re-reading the repository.
- **Ecosystem Compatibility:** Integrates transparently with external indexers when deep semantic retrieval is needed, verifying and anchoring results into immutable breadcrumbs.

---

## The Proactive Agent Directive

Waymark installs as a native MCP server and provides a single proactive 4-rule directive (available via `waymark://context` resource, `waymark_investigate` prompt, or harness rule):

```text
1. Before searching codebase, query capn_ask to reuse charted knowledge or trace AST calls.
2. While tracing code, save verified hops via waymark_note (path, line range, inference).
3. After context compaction, call waymark_resume to pick up your exact verified breadcrumb trail.
4. When finished, seal with waymark_complete to archive findings and chart into Capn.
```

That directive is the entire integration: no forced middleware, no complex scaffolding. The model reads it and decides.

---

## MCP Server Configuration

Waymark runs as a native `stdio` JSON-RPC 2.0 MCP server with pure WebAssembly on-device execution (zero native C++ build tools required).

### Option 1: Standalone In-Flight Continuity (Recommended)
Add to your client config (`mcpServers` in Claude Desktop, Cursor, Codex, Gemini, or Antigravity):

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

### Option 2: Modular Continuity + Long-Term Memory
```json
{
  "mcpServers": {
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
    },
    "capn": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/capnIndex.js"]
    }
  }
}
```

### Option 3: Unified Server (Both in One Process)
```json
{
  "mcpServers": {
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/index.js"]
    }
  }
}
```

---

## Core MCP Toolsets

### Continuity Server (`waymark`)
- **`waymark_begin`**: Start a new durable in-flight code investigation for a question.
- **`waymark_note`**: Record a verified code hop (`path`, `label`, `start_line`, `end_line`, `inference`).
- **`waymark_check`**: Verify worktree integrity against current Git HEAD and detect line relocations.
- **`waymark_resume`**: Retrieve the bounded compact-resume packet after context compaction.
- **`waymark_complete`**: Seal the active trajectory, archive the journal, and record findings.
- **`waymark_status`**: Retrieve current active trajectory status (`NONE`, `STAGED`, `STALE`).
- **`waymark_abandon`**: Discard an active trajectory cleanly.
- **`waymark_init`**: Configure repository workspace profiles.
- **Resources & Prompts**: `waymark://context`, `waymark://status`, and `waymark_investigate`.

### Memory & Discovery Server (`capn-mcp`)
- **`capn_ask`**: Intelligent two-phase discovery router:
  - Resolves structural code queries (call hierarchies, symbol locations) via in-process WebAssembly AST parsing (`provider: "wasm-ast"`).
  - Queries Capn's charted repository memory for previously answered architectural rationale (`provider: "capn-cli"`).
- **`capn_chart`**: Directly chart a question, answer, and referenced files into Capn.
- **Resources**: `capn://status`.

---

## Integrity & Safety Guarantees

1. **Exact & Relocated Span Verification (`MOVED` / `FRESH`):** Each hop records file path, line range, SHA-256 hash, and structural signature. If code shifts, Waymark automatically relocates the span up to 2,000 lines.
2. **Fail-Closed Stale Quarantine (`STALE`):** If recorded code is modified, deleted, or ambiguous, Waymark halts continuation and trusts only hops up to the first valid hop (`verifiedThrough`).
3. **Branch & Commit Drift Protection (`CROSS_BRANCH`):** If Git branch or HEAD changes mid-investigation, Waymark halts with `CROSS_BRANCH` instead of mixing evidence across versions.
4. **Crash-Proof Immutable Journal:** Append-only NDJSON event journal with filesystem locking, atomic writes, and fsync.

---

## When Waymark is Worth It vs. Overkill

- **Worth It:**
  - Multi-hop investigations spanning 2+ files or complex call chains.
  - Tasks expected to exceed single-turn context limits (>10k tokens).
  - Shared repositories or active worktrees where code shifts mid-investigation.
  - Audit trails for complex security, refactoring, or bug reproductions.
- **Overkill:**
  - Single-file edits or simple typo/syntax fixes.
  - Exploratory prototyping where in-flight continuity is disposable.
  - Tasks easily completed in a single conversational turn.

---

## Repository Directory

```text
Waymark/
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
└── test/                      # 39 automated unit and integration tests
```

---

## Deep-Dive Documentation

- **[Capn Memory & Two-Phase Discovery Guide](docs/CAPN-AND-DISCOVERY.md)**: Deep dive into `capn-mcp`, adapter profiles, and WASM AST intent detection.
- **[On-Device Discovery & Benchmark Report](docs/DISCOVERY-BENCHMARK.md)**: 25-query mixed evaluation and layered comparison against dedicated graph indexers.
- **[QMD Architecture & Retrieval Guide](docs/QMD-AND-DISCOVERY.md)**: On-device hybrid search, AST chunking, and division of labor.
- **[Multi-Agent Harness Compatibility Guide](docs/HARNESS-COMPATIBILITY.md)**: Out-of-context lifecycle hooks (`waymark-hook`) and rules for Claude Code, Cursor, Codex, and Antigravity.
- **[Audit and Optimization Report](docs/AUDIT-AND-OPTIMIZATION-REPORT.md)**: Full audit ledger and empirical continuity benchmark analysis.

---

### Build & Verify
Requires Node.js 22+:

```bash
npm ci
npm run verify
npm run benchmark
```

MIT Licensed. Pure WebAssembly on-device AST parsing with zero native C++ compilation.
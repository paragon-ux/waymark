# On-Device Discovery Architecture & Empirical Benchmark Report

## 1. Executive Summary

This report presents an empirical evaluation of codebase discovery in agentic workflows, comparing **layered architectural approaches** across structural call-graph analysis, syntax-tree parsing, and lexical memory retrieval.

Rather than treating discovery tools as mutually exclusive, modern agent workflows benefit from understanding the trade-offs across distinct functional layers:
- **Layer 1 (In-Process Lightweight AST):** Immediate on-demand syntax-tree traversal for symbols and call hierarchies (zero-daemon, low memory footprint).
- **Layer 2 (Dedicated Graph & Hybrid Indexers):** Comprehensive multi-file indexation, vector embeddings, or Cypher-like relational queries (persistent indexing, higher resource requirements).
- **Layer 3 (In-Flight Continuity):** Preserving verified evidence and causal inferences across LLM context compaction (Waymark).
- **Layer 4 (Cross-Session Memory):** Durable episodic archives of finalized decisions (Capn).

Below, we detail the 25-query mixed benchmark evaluating the in-process WebAssembly router alongside dedicated graph database architectures.

---

## 2. Benchmark Design & Methodology

The benchmark evaluated **25 representative agent queries** across five distinct discovery categories in an active repository:

1. **Lexical Memory Recall (10 queries):** Questions requiring synthesized rationale (e.g., *"How does Continuum achieve deterministic canonical JSON serialization?"*).
2. **AST Call Hierarchy Tracing (7 queries):** Relational queries tracing caller/callee edges (e.g., *"Who calls computeCurrentState?"*, *"Trace callers of canonicalJson"*).
3. **AST Symbol Definitions & Line Ranges (5 queries):** Queries locating exact declarations and 1-indexed line spans (e.g., *"Where is method verifyChain declared?"*).
4. **AST Architecture & Entrypoints (1 query):** Queries mapping repository topology and root functions.
5. **Negative Controls (2 queries):** Out-of-domain queries to verify fail-closed handling without hallucination.

---

## 3. Empirical Results

### Summary Metrics

| Metric | Measured Result | Evaluation Target |
| :--- | :---: | :---: |
| **Total Queries Evaluated** | **25 / 25** | 25 mixed queries |
| **Routing & Precision Rate** | **100.0% (25/25)** | > 90% |
| **Total Evaluation Duration** | **34.25 seconds** | Sub-60s |
| **Overall Average Latency** | **1,369 ms / query** | Sub-2-second target |
| **RAM Footprint (WASM Engine)** | **~15 MB** | Lightweight local agent footprint |
| **Active Background Daemons** | **0 (Zero)** | Zero port conflicts or daemon management |

### Category Breakdown

| Category | Queries | Avg Latency | Latency Range | Engine | Precision |
| :--- | :---: | :---: | :---: | :--- | :---: |
| **Lexical Memory Recall** | 10 | **1,434 ms** | 1,226 ms – 1,807 ms | Capn Memory (SQLite FTS5) | **100% (10/10)** |
| **AST Call Hierarchy** | 7 | **1,669 ms** | 887 ms – 5,312 ms | Tree-sitter (WASM) | **100% (7/7)** |
| **AST Symbol & Lines** | 5 | **1,023 ms** | 940 ms – 1,175 ms | Tree-sitter (WASM) | **100% (5/5)** |
| **AST Architecture / Topology** | 1 | **1,223 ms** | 1,223 ms | Tree-sitter (WASM) | **100% (1/1)** |
| **Negative Controls (Miss)** | 2 | **934 ms** | 927 ms – 940 ms | Clean Miss Handler | **100% (2/2)** |

---

## 4. Layered Comparison: In-Process WASM vs. Dedicated Graph Indexers

To help teams select the right tool for their workload, the table below compares the operational profile of an **in-process WebAssembly parser** with **dedicated graph engines** (such as `codebase-memory-mcp`):

| Characteristic | In-Process WebAssembly (`web-tree-sitter`) | Dedicated Graph Engine (`codebase-memory-mcp`) |
| :--- | :--- | :--- |
| **Primary Architectural Role** | Instant, zero-config local AST traversal for agent tool loops | Persistent, whole-repo relational database and graph queries |
| **Setup & Dependencies** | Pure WebAssembly; zero C++ toolchains, no background services | Native binary build or Docker; persistent daemon process |
| **Memory Footprint** | Dynamic in-process allocation (~15 MB – 50 MB) | Dedicated memory arena (e.g. 4,000 MB pre-allocation) |
| **Cold Start / Invocation** | Sub-second on-demand parsing (<300 ms initial repo scan) | Requires daemon startup, index construction, and port binding |
| **Query Latency** | **~50–300 ms** in-process (<1.5s via cold CLI) | **~800 ms** (warm daemon query) / 17s (cold binary launch) |
| **Query Capabilities** | Call hierarchies, caller/callee trees, symbol line ranges | Complex Cypher graph queries, cross-file relational paths |
| **Best Fit** | Local coding agents, lightweight CI, ephemeral environments | Dedicated development servers, deep semantic code-graph analysis |

---

## 5. Architectural Takeaway

Discovery and in-flight continuity solve two distinct stages of the coding cycle:
1. **Discovery (Stateless)** surfaces candidate files and relationships.
   - For fast local loops, in-process WebAssembly AST parsing provides immediate call-trees and line spans without daemon overhead.
   - For complex graph querying, dedicated graph engines provide deep indexing.
2. **Continuity (Stateful & Compact)** records the agent's verified deductions step-by-step.
   - Regardless of which discovery engine generates candidates, Waymark's append-only journal protects against context loss during LLM compaction, enabling immediate resumption in ~216 tokens.
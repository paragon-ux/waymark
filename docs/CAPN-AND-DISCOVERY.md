# Capn Long-Term Memory & Two-Phase Discovery Guide

This document explains the architecture of `capn-mcp`, how it integrates with Waymark, and how the two-phase discovery router resolves queries across charted memory and in-process WebAssembly syntax trees.

---

## 1. Overview and Division of Concerns

When an AI agent investigates a codebase, it frequently needs answers to two distinct classes of questions:
1. **Conceptual Rationale:** *"Why did we choose append-only NDJSON instead of SQLite for the journal?"* or *"How does webhook authentication verify signatures?"*
2. **Structural Relational Facts:** *"Who calls computeCurrentState?"* or *"Where is method verifyChain declared?"*

`capn-mcp` provides a unified entry point (`capn_ask`) that intelligently routes between these two domains:

```text
                             `capn_ask`
                                 │
          ┌──────────────────────┴──────────────────────┐
          ▼                                             ▼
   [ Structural Query ]                          [ Conceptual Query ]
Intent: Call-graph, symbol lines,             Intent: Rationale, decisions,
architecture entrypoints.                     history, or past conclusions.
          │                                             │
          ▼                                             ▼
 Phase 1: In-Process WASM AST                 Phase 2: Charted Memory
 (web-tree-sitter, < 50ms)                    (Capn Q&A archive)
          │                                             │
          ▼                                             ▼
  `provider: "wasm-ast"`                       `provider: "capn-cli"`
```

---

## 2. Adapter Profiles

Waymark and Capn support three adapter profiles, configured via `waymark_init` or `.waymark/config.json`:

| Profile | Description | `capn_ask` Behavior | `capn_chart` / `waymark_complete` Behavior |
| :--- | :--- | :--- | :--- |
| **`capn-cli`** | Standard production profile delegating memory to the global `capn` CLI while handling structural queries via in-process WASM. | Checks in-process AST first for structural queries; delegates conceptual queries to `capn ask`. | Automatically runs `capn chart` to publish conclusions to the repository knowledge base. |
| **`recording`** | Headless / audit profile without external dependencies. | Returns simulated or AST results; does not execute external CLI binaries. | Writes publication records into `.waymark/publications.ndjson` for audit review. |
| **`none`** | Standalone mode with Capn integration disabled. | Always returns `status: "miss"`. | Marks completion without publication attempts. |

---

## 3. The Two-Phase Discovery Router Mechanics

The discovery router (`src/discoveryRouter.ts`) evaluates queries in a deterministic cascade:

### Phase 1: Structural AST Intent Detection
The router analyzes natural language patterns to detect relational intent:
- **Call-Graph Tracing (`trace_path`):** Queries matching `"who calls <func>"`, `"callees of <func>"`, or `"call hierarchy"`.
- **Symbol & Line Resolution (`search_graph`):** Queries matching `"where is method <name>"`, `"definition of <name>"`, or bare identifier tokens (`EventStore.verifyChain`).
- **Topology & Entrypoints (`get_architecture`):** Queries asking for repo entrypoints or architecture overview.

When an AST intent is detected:
1. The router parses the repository on-demand using pre-compiled WebAssembly grammars (`tree-sitter-wasms`) for 30+ languages.
2. The syntax tree is traversed in-memory to map callers, callees, and 1-indexed line spans.
3. The result is cached in-process for 30 seconds to provide sub-millisecond responses for follow-up questions.
4. Response is returned with `provider: "wasm-ast"` and `status: "hit"`.

### Phase 2: Memory Recall & Fallback
If no structural intent is detected, or if the AST lookup yields no hits:
1. The query is forwarded to Capn's charted repository memory.
2. If charted knowledge exists, the verified answer and file references are returned with `provider: "capn-cli"` and `status: "hit"`.
3. If neither phase finds a match, a clean, structured `status: "miss"` response is returned without hallucination.

Compatibility notes (verified against capn-hook 0.2.2 on Windows):

- Windows executable resolution prefers the PATHEXT `.cmd`/`.bat`/`.exe` hit; `where.exe` lists the extensionless POSIX shim (`npm\capn`) first, and CreateProcessW cannot execute that shim.
- `capn chart` is invoked with the capn-hook ≥ 0.2 contract: the answer is passed as `--details`, not a positional.
- `capn ask` exit code 1 ("No charted answer.") is reported as `status: "miss"`, not `status: "error"` — a charted miss is a normal response.
- **Lexical recall is the standardized configuration**: run `capn init --no-embedding` (or set `.capn/config.json` to `{"embedding": false}`). With embedding enabled, `capn ask` runs the qmd embedding model — minutes on CPU-only hosts, far beyond the adapter's 15 s timeout. Lexical mode is deterministic, responds in ~1 s, and is what the test suite (`test/capnHarness.mjs`) enforces. Use embedding mode only on GPU hosts where that latency is acceptable.
- **Grammar pre-warming**: `extractAstFromRepo` loads all grammars the scanned file set needs concurrently *before* parsing. Loading a grammar while parsed trees of another language remain on the heap is pathologically slow on some hosts (observed 3–20 s per `WebAssembly.instantiate` for the python grammar after a TypeScript parse); concurrent upfront loads take ~20–50 ms total.
- Known host-level limitation (external): a one-shot Node process that ran a tree-sitter parse lingers seconds at process teardown (Emscripten atexit/pthread cleanup; 0% CPU wait) on this class of host. The long-lived MCP server amortizes this across calls; the one-shot CLI's wall clock additionally pays it. In-JS mitigations (`process.exit`, `reallyExit`, `tree.delete()`) do not bypass it — it is downstream of the JavaScript lifecycle.

---

## 4. MCP Surface and Usage

### Tools Exposed

- **`capn_ask`**:
  - `question` (string, max 240 chars): The inquiry to resolve.
  - Returns: `{ waymark: 1, kind: "ask", provider: "wasm-ast" | "capn-cli", status: "hit" | "miss", result?: ... }`
- **`capn_chart`**:
  - `question` (string): The inquiry answered.
  - `answer` (string): The verified architectural conclusion.
  - `files` (array of strings): Relevant file paths providing evidence.
  - Returns: Publication status and receipt.

### Standalone Server Configuration

To run `capn-mcp` as an isolated MCP server alongside your coding agent:

```json
{
  "mcpServers": {
    "capn": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/capnIndex.js"]
    }
  }
}
```
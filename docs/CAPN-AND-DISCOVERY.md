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
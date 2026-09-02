# CBM (Codebase Memory) and Waymark Integration Guide

This guide details how to integrate DeusData's `codebase-memory-mcp` (CBM) with Waymark for structural code intelligence and post-compaction continuity.

---

## 1. Architectural Overview

DeusData's `codebase-memory-mcp` (CBM) and `paragon-ux/waymark` operate at different layers of the agent stack:

- **CBM (The Discovery Engine):** A high-performance, native-C knowledge-graph engine. It indexes repository symbols, ASTs, and call hierarchies to answer structural queries (e.g., *"Trace all callers of `verifyWebhookSignature`"*).
- **Waymark (The Continuity Ledger):** A dependency-free, TypeScript MCP server. It records verified code hops into an append-only NDJSON event journal, validates span hashes against Git HEAD, and outputs a bounded (<2,048 byte) resume packet after context compaction.

```text
[ Developer Goal / Bug Report ]
               |
               v
  1. DISCOVERY: CBM (codebase-memory-mcp)
     - `cbm.get_architecture()`      -> Entrypoints & hotspots
     - `cbm.trace_path("A", "B")`    -> Exact call hierarchy
     - `cbm.get_code_snippet(...)`   -> Function body & qualified name
               |
               v
  2. VERIFICATION & RECORDING: Waymark
     - Agent confirms code block significance
     - `waymark_note(...)`           -> Append validated hop + SHA-256
               |
               v
  [ Context Compaction Event Triggered ]
               |
               v
  3. COMPACT RECOVERY: Waymark
     - `waymark_resume()`            -> Instant resume packet (~216 tokens)
     - Zero redundant graph re-queries or file re-reads
```

---

## 2. Capability Matrix

| Capability | CBM (`codebase-memory-mcp`) | Waymark (`waymark`) |
|:---|:---|:---|
| **Primary Domain** | Structural code discovery & graph search | In-flight continuity & tamper-resistant evidence |
| **Runtime / Packaging** | Native binary (C), vendored Tree-sitter | Node.js (TypeScript), zero runtime npm dependencies |
| **Query Modalities** | Cypher-like queries, BFS trace_path, BM25 | Keyed trajectory replay, status check, compact resume |
| **Span Integrity** | Git diff change detection (`detect_changes`) | Hashed spans, 2000-line sliding window relocation, STALE quarantine |
| **Compaction Resume** | None (agent must re-query graph) | Bounded resume packet (<2,048 B / ~216 tokens) |
| **Storage Model** | SQLite graph DB in cache directory | Append-only NDJSON event journal in `.waymark/` |

---

## 3. Dual-MCP Client Configuration

To equip an agent with both structural discovery and in-flight continuity, register both servers in your client's MCP configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, or Codex/Antigravity settings):

```json
{
  "mcpServers": {
    "cbm": {
      "command": "codebase-memory-mcp"
    },
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
    }
  }
}
```

---

## 4. End-to-End Investigation Walkthrough

### Step 1: Initialize Trajectory
```json
// Tool Call: waymark_begin
{ "question": "Why does webhook validation fail on replayed signatures?" }
```

### Step 2: Structural Discovery with CBM
Instead of scanning raw directories, the agent uses CBM to locate entry routes and trace callers:
```json
// Tool Call: cbm.trace_path
{ "from": "handleWebhookPost", "to": "verifySignature" }

// Response: Returns exact call chain across webhook.ts -> verifier.ts
```

### Step 3: Record Verified Hop with Waymark
Once the agent reviews the function in `src/auth/verifier.ts`, it locks the evidence into Waymark:
```json
// Tool Call: waymark_note
{
  "trajectory_id": "4b8f...2a",
  "path": "src/auth/verifier.ts",
  "label": "timestamp-tolerance-check",
  "start_line": 42,
  "end_line": 58,
  "inference": "Tolerance window is hardcoded to 300s but rejects older valid replays."
}
```

### Step 4: Compaction & Instant Recovery
When context compaction triggers 10 turns later, the agent does **not** re-query CBM or re-read `verifier.ts`:
```json
// Tool Call: waymark_resume
{}

// Response (<820 bytes):
{
  "waymark": 1,
  "kind": "compact-resume",
  "status": "STAGED",
  "verifiedThrough": 1,
  "hops": [
    { "index": 0, "path": "src/routes/webhook.ts", "label": "entry-route", "status": "FRESH" },
    { "index": 1, "path": "src/auth/verifier.ts", "label": "timestamp-tolerance-check", "status": "FRESH" }
  ],
  "nextAction": "continue-from-verified-hop"
}
```

---

## 5. Token Calculus (Empirical Proof)

From Waymark's empirical benchmark suite (`npm run benchmark`):

- **Naive Cold Exploration:** 40,050 tokens across 6 tasks (re-reading full files).
- **Indexed Re-querying (CBM alone without Waymark):** 8,748 tokens (re-querying graph call chains and candidate snippets post-compaction).
- **CBM + Waymark:** **1,294 tokens** total (~216 tokens per task).

**Result:** Pairing CBM with Waymark reduces post-compaction recovery token consumption by **85.2%** compared to CBM alone, while guaranteeing 100% precision on relocated code lines.

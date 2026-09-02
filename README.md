# ⛕ Waymark — In-Flight Continuity MCP Server for AI Coding Agents

> **Empirical Continuity Benchmark:** Across multi-hop coding investigations, an agent recovering from Waymark used **96.7% fewer recovery tokens** (~216 tokens vs. 8,000+ cold re-reads) with **100% precision on relocated spans** and **zero redundant file re-inspections** — paying for itself immediately on the 1st compaction. (Reproduce via `npm run benchmark`).

---

## Don't Lose Your Place When Context Compaction Hits

When an AI coding agent is 6 hops deep tracing a complex issue across 5 files, context compaction eventually triggers:
- **Without Waymark (Cold Exploration)**: In-flight discoveries are wiped. The agent re-reads the entire repository from scratch, wastes tens of thousands of tokens re-deriving the same files, or hallucinates line numbers.
- **With Waymark (In-Flight Continuity)**: The agent calls `waymark_resume` and immediately picks up from its verified breadcrumb trail in a single step (<820 bytes).

---

## The Proactive Agent Interface (Zero Guesswork)

Waymark installs as a native MCP server and provides a single proactive 3-rule directive (available via `waymark://context` resource, `waymark_investigate` prompt, or SessionStart hook):

```text
1. Before searching codebase, query capn_ask to reuse charted knowledge.
2. While tracing code, save verified hops via waymark_note (path, line range, inference).
3. After context compaction, call waymark_resume to pick up your exact verified breadcrumb trail.
4. When finished, seal with waymark_complete to archive findings and chart into Capn.
```

That directive is the entire integration — no forced middleware, no complex scaffolding. The model reads it and decides.

---

## Unified MCP Protocol Superset

Waymark is the **unified protocol superset** bridging static instructions, in-flight continuity, and long-term memory:

| Phase | Tool / Provider | What It Does |
|---|---|---|
| **1. SessionStart Context** | [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload) / `waymark://context` | Restores `AGENTS.md` and proactive investigation rules into context at SessionStart. |
| **2. In-Flight Continuity** | **Waymark MCP Server (Core)** | Preserves the active, unfinalized code hops *while you are still investigating*. |
| **3. Long-Term Memory** | [`capn-hook`](https://github.com/CyrusNuevoDia/capn-hook) / `capn_ask` / `capn_chart` | Charts permanent Q&A knowledge bases for cross-session semantic and QMD retrieval. |

---

## Hard Integrity Guarantees (Why It's Not Just a Notepad)

Waymark actively protects the agent against stale evidence and hallucinations:

1. **Exact & Relocated Span Verification (`MOVED` / `FRESH`):**
   - Each hop records the exact file path, line range, SHA-256 hash, and structural signature.
   - If other lines are added or removed in the file, Waymark automatically relocates the span and updates the range (`MOVED`).
2. **Fail-Closed Stale Quarantine (`STALE`):**
   - If code inside a recorded hop is modified, deleted, or ambiguous, Waymark marks the hop `STALE` and halts continuation.
   - The `verifiedThrough` index ensures the agent **only trusts hops up to the first valid hop**, preventing cascade errors.
3. **Branch & Commit Drift Protection (`CROSS_BRANCH`):**
   - If Git branch or HEAD changes mid-investigation (e.g., rebase or branch switch), Waymark halts with `CROSS_BRANCH` instead of mixing evidence across versions.
4. **Crash-Proof Immutable Journal:**
   - Append-only NDJSON event journal with filesystem locking, atomic writes, and fsync. Zero runtime npm dependencies.

---

## Primary Interface: Model Context Protocol (MCP)

Waymark runs as a native stdio JSON-RPC 2.0 MCP server with **zero runtime npm dependencies**.

### Client Configuration

Add Waymark to your MCP client config (`mcpServers` in Claude Desktop, Cursor, Codex, Gemini, or Antigravity):

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

Or when installed globally:
```json
{
  "mcpServers": {
    "waymark": {
      "command": "waymark"
    }
  }
}
```

### Available MCP Toolset

#### In-Flight Continuity Tools
- **`waymark_init`**: Initialize or configure the store profile (`recording`, `capn-cli`, `none`).
- **`waymark_status`**: Retrieve current active trajectory status (`NONE`, `STAGED`, `STALE`) and step count.
- **`waymark_begin`**: Start a new durable in-flight code investigation for a question.
- **`waymark_note`**: Record a verified code hop (`path`, `label`, `start_line`, `end_line`, `inference`).
- **`waymark_check`**: Verify worktree integrity against current Git HEAD and detect line relocations.
- **`waymark_resume`**: Retrieve the bounded compact-resume packet after context compaction.
- **`waymark_complete`**: Seal the active trajectory, archive the journal, and publish findings to Capn.
- **`waymark_abandon`**: Discard an active trajectory.

#### Capn Long-Term Memory Tools
- **`capn_ask`**: Query Capn's charted memory for previously answered questions.
- **`capn_chart`**: Directly chart a question, answer, and referenced files into Capn.

#### MCP Resources & Prompts
- **`waymark://context`**: Proactive 3-rule directive and live trajectory summary.
- **`waymark://status`**: Real-time status JSON.
- **`waymark_investigate`**: Structured investigation workflow prompt template.

---

## Complete MCP Agent Workflow Example

```text
[capn_ask] -> [waymark_begin] -> [waymark_note]* -> (Compaction) -> [waymark_check] -> [waymark_resume] -> [waymark_complete]
```

### 1. Check Existing Knowledge
```json
// Tool Call: capn_ask
{ "question": "How does webhook authentication verify signatures?" }

// Response:
{ "waymark": 1, "kind": "ask", "status": "miss", "matches": [] }
```

### 2. Start Active Investigation
```json
// Tool Call: waymark_begin
{ "question": "How does webhook authentication verify signatures?" }

// Response:
{ "waymark": 1, "kind": "begin", "ok": true, "id": "4b8f...2a", "question": "..." }
```

### 3. Record Evidence Hops
```json
// Tool Call: waymark_note
{
  "trajectory_id": "4b8f...2a",
  "path": "src/auth/verifier.ts",
  "label": "hmac-sha256-check",
  "start_line": 24,
  "end_line": 42,
  "inference": "Verifies HMAC-SHA256 signature using timing-safe comparison against secret header."
}
```

### 4. Post-Compaction Recovery
When context compaction triggers, recover the verified trail without re-reading the codebase:
```json
// Tool Call: waymark_resume
{}

// Response:
{
  "waymark": 1,
  "kind": "compact-resume",
  "status": "STAGED",
  "trajectoryId": "4b8f...2a",
  "verifiedThrough": 2,
  "totalSteps": 3,
  "hops": [
    { "index": 0, "path": "src/routes/webhook.ts", "label": "entry-route", "status": "FRESH" },
    { "index": 1, "path": "src/auth/verifier.ts", "label": "hmac-sha256-check", "status": "FRESH" }
  ],
  "nextAction": "continue-from-verified-hop"
}
```

### 5. Seal & Chart to Long-Term Memory
When finished, seal the trajectory. Waymark archives the journal and automatically charts findings into Capn:
```json
// Tool Call: waymark_complete
{
  "trajectory_id": "4b8f...2a",
  "answer": "Webhooks verify SHA-256 HMAC signatures via timing-safe buffer comparison in verifier.ts."
}
```

---

## Explicit Note Discipline (A Feature, Not a Bug)

Waymark requires calling `waymark_note` for every meaningful hop:
- **Noise Filtering**: Automated scratchpads capture exploratory dead ends. Forcing explicit hops guarantees that only verified, reasoned code discoveries survive compaction.
- **Strict Size Bounds**: Labels are capped at 120 characters and inferences at 160 characters to keep resume packets under 2,048 UTF-8 bytes.

---

## Repository Map & Onboarding

- `src/mcp/` — stdio JSON-RPC MCP server, tool handlers, resources, and prompts.
- `src/` — dependency-free event journal, integrity scanner, and lock primitives.
- `test/` — 29 automated unit and integration tests.
- `scripts/benchmark.mjs` — reproducible empirical continuity benchmark suite.
- `schemas/` — strict machine-output contracts.
- `control/` — project state, ownership, and genuine compaction evidence ledger.

### Build & Verify
Requires Node.js 22+:

```bash
npm ci
npm run verify
npm run benchmark
```

The repository is MIT licensed with zero runtime npm dependencies.

---

## Internal / Operator Diagnostics (CLI)

The CLI (`dist/src/cli.js` / `waymark-operator`) is an internal diagnostic tool for test runners, lock recovery, and CI verification. All agent workflows should use the MCP server.

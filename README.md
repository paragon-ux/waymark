# Waymark ? In-Flight Continuity MCP Server for AI Coding Agents

**Don't lose your place when context compaction hits.**

When an AI coding agent is 6 hops deep tracing a complex issue across 5 files, context compaction eventually triggers.
- **Without Waymark**: In-flight progress is erased. The agent re-reads the entire repository from scratch, wastes thousands of tokens re-deriving the same discoveries, or hallucinates obsolete line numbers.
- **With Waymark**: The agent calls `waymark_resume` and immediately picks up from its verified breadcrumb trail?with zero repository re-reading.

---

## Where Waymark Fits in the Agent Ecosystem

Waymark bridges the critical gap between static project instructions and finalized long-term memory:

| Layer | Tool | What It Does |
|---|---|---|
| **1. Static Instructions** | [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload) | Reloads `AGENTS.md` and project rules into context at SessionStart after compaction. |
| **2. In-Flight Continuity** | **Waymark (This Tool)** | Preserves the active, unfinalized code hops *while you are still investigating*. |
| **3. Finalized Long-Term Memory** | [`capn-hook`](https://github.com/CyrusNuevoDia/capn-hook) | Charts permanent Q&A knowledge bases for cross-session semantic/QMD retrieval. |

---

## Hard Integrity Guarantees (Why It's Not Just a Notepad)

Waymark is not a passive memo pad?it actively protects the agent against stale evidence and hallucinations:

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

Waymark runs as a native stdio JSON-RPC 2.0 MCP server.

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

Or when installed globally / on PATH:
```json
{
  "mcpServers": {
    "waymark": {
      "command": "waymark"
    }
  }
}
```

---

## Complete MCP Agent Workflow Example

```text
[capn_ask] -> [waymark_begin] -> [waymark_note]* -> (Compaction) -> [waymark_check] -> [waymark_resume] -> [waymark_complete]
```

### 1. Check Existing Knowledge
Before spending tokens investigating, check if an answer was already charted in Capn:
```json
// Tool Call: capn_ask
{ "question": "How does webhook authentication verify signatures?" }

// Response:
{ "waymark": 1, "kind": "ask", "status": "miss", "matches": [] }
```

### 2. Start Active Investigation
Allocate a durable trajectory:
```json
// Tool Call: waymark_begin
{ "question": "How does webhook authentication verify signatures?" }

// Response:
{ "waymark": 1, "kind": "begin", "ok": true, "id": "4b8f...2a", "question": "..." }
```

### 3. Record Evidence Hops
After inspecting each relevant code block, record a verified hop immediately:
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
When the investigation is conclusive, seal the trajectory. Waymark archives the journal and automatically charts the finding into Capn:
```json
// Tool Call: waymark_complete
{
  "trajectory_id": "4b8f...2a",
  "answer": "Webhooks verify SHA-256 HMAC signatures via timing-safe buffer comparison in verifier.ts."
}
```

---

## Explicit Note Discipline (A Feature, Not a Bug)

Waymark requires calling `waymark_note` for every meaningful hop. Why?
- **Noise Filtering**: LLM exploration involves exploratory dead ends. By recording only verified hops, the compacted resume packet contains high-signal evidence rather than noisy trial-and-error transcripts.
- **Strict Boundaries**: Labels are capped at 120 characters and inferences at 160 characters to keep post-compaction resume packets under 2,048 UTF-8 bytes.

---

## Repository Map & Onboarding

- `src/mcp/` ? stdio JSON-RPC MCP server and tool implementations.
- `src/` ? dependency-free event journal, integrity scanner, and lock primitives.
- `test/` ? 29 automated unit and integration tests.
- `schemas/` ? strict machine-output contracts.
- `control/` ? project state, ownership, and genuine compaction evidence ledger.

### Build & Verify
Requires Node.js 22+:

```bash
npm ci
npm run verify
npm run build
```

The repository is MIT licensed with zero runtime npm dependencies.

---

## Operator Plumbing (CLI)

The CLI (`dist/src/cli.js` / `waymark-operator`) is an internal diagnostic tool for test runners, lock recovery, and CI verification. All agent workflows should use the MCP server.

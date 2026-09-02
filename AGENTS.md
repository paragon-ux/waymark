# Waymark Continuity Lab

Waymark preserves in-flight code investigations across LLM context compactions, delegating finalized memory to Capn.

## Agent Workflow Protocol

Follow this exact sequence for code investigations:

### 1. Query Existing Knowledge (Capn Memory)
Check if an answer is already charted before exploring:
- **CLI**: `waymark ask "<question>"`
- **MCP**: `capn_ask({ question: "..." })`
- If `status: "hit"`, reuse the charted answer without redundant exploration.

### 2. Begin Active Trajectory
If unassisted exploration is needed, start tracking:
- **CLI**: `waymark begin "<question>"`
- **MCP**: `waymark_begin({ question: "..." })`
- Capture the returned `id` (or inspect via `waymark status --porcelain` / `waymark_status`).

### 3. Record Evidence Hops
After inspecting each relevant code block, record a verified hop immediately:
- **CLI**: `waymark note <id> --path <file> --label <label> --start <line> --end <line> --inference "<inference>"`
- **MCP**: `waymark_note({ trajectory_id: "<id>", path: "<file>", label: "<label>", start_line: 1, end_line: 20, inference: "..." })`

### 4. Post-Compaction Recovery & Integrity Checks
At startup, after context compaction, or before taking decisions:
- **CLI**: `waymark check --active --porcelain` followed by `waymark resume --compact`
- **MCP**: `waymark_check()` followed by `waymark_resume()`
- Rely **only** on the verified prefix (`verifiedThrough`).
- Treat `STALE` and `CROSS_BRANCH` as non-resumable (reverify the broken hop or abandon and restart).
- Do not broadly reread the entire repository to reconstruct lost context.

### 5. Complete & Chart to Capn
When the investigation is conclusive, seal the trajectory:
- **CLI**: `waymark complete <id> "<synthesized-answer>"`
- **MCP**: `waymark_complete({ trajectory_id: "<id>", answer: "..." })`
- This seals the active journal, archives the trajectory, and automatically publishes the question, answer, and referenced files into Capn.

---

## Tooling Interfaces

- **Native MCP Tools**: Run `node dist/src/mcp/index.js` or `waymark mcp` to expose `waymark_*` and `capn_*` JSON-RPC tools.
- **CLI**: Run `node dist/src/cli.js <command>` or `waymark <command>`.
- **Compaction Hook**: The `codex-agents-compact-reload` hook automatically reloads this file on post-compaction session start.

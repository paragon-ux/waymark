# Waymark Continuity Lab

Waymark is an MCP server that preserves in-flight code investigations across LLM context compactions, delegating finalized memory to Capn.

## Primary Interface: MCP Tool Protocol

Agents interact with Waymark directly through its native MCP tools:

### 0. Initialization (`waymark_init`)
If the repository store is not yet initialized:
- Call `waymark_init({ profile: "recording" })` (or `profile: "capn-cli"`).

### 1. Check Existing Knowledge (`capn_ask`)
Query Capn's charted memory before starting a new investigation:
- Call `capn_ask({ question: "<question>" })`.
- If `status: "hit"`, reuse the charted answer without redundant exploration.

### 2. Begin Active Trajectory (`waymark_begin`)
Start tracking a new in-flight investigation:
- Call `waymark_begin({ question: "<question>" })` (max 240 chars).
- Note the returned `id` (or inspect via `waymark_status()`).

### 3. Record Evidence Hops (`waymark_note`)
After inspecting each relevant code block, record a verified hop immediately:
- Call `waymark_note({ trajectory_id: "<id>", path: "<file>", label: "<label>", start_line: <start>, end_line: <end>, inference: "<inference>" })`.
- Limits: `label` $\le 120$ chars, `inference` $\le 160$ chars.

### 4. Post-Compaction Recovery (`waymark_check` & `waymark_resume`)
At startup, after context compaction, or before making conclusions:
- Call `waymark_check()` to verify worktree integrity against current Git HEAD.
- Call `waymark_resume()` to retrieve the bounded resume packet.
- Rely **only** on the verified prefix (`verifiedThrough`).
- Treat `STALE` and `CROSS_BRANCH` as non-resumable (reverify the broken hop or abandon and restart).
- Do not broadly reread the entire repository to reconstruct lost context.

### 5. Complete & Chart to Capn (`waymark_complete`)
When the investigation is conclusive, seal the trajectory:
- Call `waymark_complete({ trajectory_id: "<id>", answer: "<synthesized-answer>" })`.
- This seals the journal, archives the trajectory, and automatically publishes the findings to Capn.

---

## Secondary / Operator Tooling

The CLI (`node dist/src/cli.js` / `waymark-operator`) is internal plumbing for operator maintenance, test suites, and scripting. All agent interactions should use the MCP server (`waymark` / `node dist/src/mcp/index.js`).


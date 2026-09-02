# Waymark ? Local-First Continuity MCP Server

Waymark is a local-first Model Context Protocol (MCP) server that preserves in-flight coding investigations across LLM context compactions. It records verified file-and-line evidence hops, survives context compaction in agent loops, and quarantines a trajectory when recorded code anchors diverge or cross Git branches.

Waymark is intentionally complementary to the surrounding agent ecosystem:
- `codex-agents-compact-reload` reloads project instructions into context on post-compaction SessionStart.
- **Waymark MCP Server** preserves the active, in-flight code investigation and integrity bounds.
- `capn-hook` provides long-term repository knowledge charting and QMD hybrid search.

## Primary Interface: Model Context Protocol (MCP)

Waymark runs as a native stdio JSON-RPC 2.0 MCP server with **zero runtime npm dependencies**.

### Client Configuration

Add Waymark to your agent's MCP configuration (`mcpServers` in Claude Desktop, Cursor, Codex, Gemini, or Antigravity):

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

### Available MCP Tools

#### In-Flight Continuity Lifecycle
- **`waymark_init`**: Initialize or configure the store profile (`recording`, `capn-cli`, `none`).
- **`waymark_status`**: Retrieve current active trajectory status (`NONE`, `STAGED`, `STALE`) and step count.
- **`waymark_begin`**: Start a new durable in-flight code investigation for a question.
- **`waymark_note`**: Record a verified code hop (`path`, `label`, `start_line`, `end_line`, `inference`).
- **`waymark_check`**: Verify worktree integrity against current Git HEAD and detect line relocations.
- **`waymark_resume`**: Retrieve the bounded compact-resume packet after context compaction.
- **`waymark_complete`**: Seal the active trajectory, archive the journal, and publish findings to Capn.
- **`waymark_abandon`**: Discard an active trajectory.

#### Capn Long-Term Memory
- **`capn_ask`**: Query Capn's charted memory for previously answered questions.
- **`capn_chart`**: Directly chart a question, answer, and referenced files into Capn.

## Agent Lifecycle Flow

```text
[capn_ask] -> [waymark_begin] -> [waymark_note]* -> (Compaction) -> [waymark_check] -> [waymark_resume] -> [waymark_complete]
```

1. **Query Memory**: Check if an answer is already known via `capn_ask`.
2. **Begin Trajectory**: Start tracking via `waymark_begin`.
3. **Record Notes**: Record hops with exact line numbers and inferences via `waymark_note`.
4. **Resume after Compaction**: Call `waymark_check` and `waymark_resume` to recover the trusted prefix without re-reading the entire repo.
5. **Complete & Publish**: Seal via `waymark_complete` to archive the journal and chart to Capn.

## Provenance and Boundaries

Waymark is an adaptation of the continuity problem that motivated [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload) and the active-investigation use case suggested by [`capn-hook`](https://github.com/CyrusNuevoDia/capn-hook). The reload hook owns the Codex SessionStart/compaction bootloader. Capn owns finalized memory, question/answer retrieval, QMD, and hybrid search. Waymark owns only the durable, single-writer trajectory between those boundaries.

The Capn integration crosses the public CLI boundary (`capn chart <question> <answer> --files <file> ...` and `capn ask <question>`). Waymark never reads Capn storage internals, invokes a shell for arbitrary input, or sends data to a network service. On Windows, when Capn resolves to a batch script, Waymark fails closed for percent signs, quotes, and newlines because `cmd.exe` cannot carry those values losslessly through a batch argv boundary; it also rejects comma-containing file paths because Capn's public parser uses comma-separated `--files` values.

## Repository Map

- `src/mcp/` ? primary stdio JSON-RPC MCP server and tool handlers.
- `src/` ? dependency-free journal, integrity scanner, and lock primitives.
- `schemas/` ? strict machine-output and journal contracts.
- `test/` ? Node test-runner coverage for MCP and core subsystems.
- `docs/` ? continuity proof runbook.
- `control/` ? live project state, ownership, contracts, test matrix, and compaction ledger.

## Git Onboarding & Verification

Waymark requires Node.js 22 or newer. After cloning:

```text
npm ci
npm run verify
```

The repository is MIT licensed. `npm run public-check` validates zero secret leaks or local path exposure. GitHub Actions runs verification on Node 22 for Linux, macOS, and Windows.

## Internal / Operator Diagnostics

The CLI (`node dist/src/cli.js` / `waymark-operator`) is an internal utility for test suites, CI checks, and operator inspection. Machine commands emit JSON on stdout; diagnostics go to stderr.

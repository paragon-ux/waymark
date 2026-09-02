# Multi-Agent Harness Compatibility Guide

This guide details how to configure Waymark across different AI coding agent harnesses (OpenAI Codex, Claude Code, Cursor, Gemini/Antigravity, and Cline) to ensure automated post-compaction recovery.

---

## 1. The Compaction Continuity Problem

Waymark itself intentionally installs no background system daemons or proprietary lifecycle hooks. It is an on-demand MCP server.

However, different agent harnesses handle context compaction differently:
- Some harnesses (like Codex) support native lifecycle hooks that re-inject prompt instructions post-compaction.
- Other harnesses (like Claude Code or Cursor) compress or roll context without automatically polling MCP resources.

Because passive MCP resources (`waymark://context`) are not automatically polled by LLMs after a compaction, **each harness requires a small prompt or rule directive** so the agent knows to call `waymark_resume`.

---

## 2. Harness-by-Harness Configuration

### A. OpenAI Codex CLI

- **MCP Configuration:** Add to Codex MCP server list.
- **Hook Integration:** Uses [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload).
- **Post-Compaction Behavior:** When Codex triggers a compact event, `codex-agents-compact-reload` automatically reloads `AGENTS.md` into the fresh context window.
- **Directives:** The reloaded `AGENTS.md` contains the directive:
  ```markdown
  ### Post-Compaction Recovery
  Call `waymark_check()` and `waymark_resume()` to retrieve the bounded resume packet.
  Rely only on the verified prefix (`verifiedThrough`).
  ```

---

### B. Claude Code (CC)

- **MCP Registration:**
  Run the command line registration:
  ```bash
  claude mcp add waymark -- node <path-to-waymark>/dist/src/mcp/waymarkIndex.js
  ```
  Or if using Capn alongside Waymark:
  ```bash
  claude mcp add capn -- node <path-to-waymark>/dist/src/mcp/capnIndex.js
  ```
- **Context Compaction Lifecycle:** Claude Code runs `/compact` automatically when reaching context limits or upon user request. Compaction summarizes the dialogue history.
- **Required Configuration in `CLAUDE.md`:**
  Add this section to your project root `CLAUDE.md`:
  ```markdown
  ## In-Flight Code Continuity (Waymark)
  - While investigating code across multiple files, record verified hops using `waymark_note`.
  - Immediately after a `/compact` event or context reset, call `waymark_resume()` before re-reading files or searching.
  - Rely on the `verifiedThrough` prefix returned by `waymark_resume` rather than re-scanning repository files.
  ```

---

### C. Cursor / Cursor Composer

- **MCP Registration:**
  Add to `.cursor/mcp.json`:
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
- **Context Lifecycle:** Cursor uses a rolling context window and summarizes older turns without explicit compaction hooks.
- **Required Configuration in `.cursorrules` or `.cursor/rules/waymark.mdc`:**
  ```markdown
  ---
  description: Waymark in-flight investigation continuity
  globs: *
  ---
  # Waymark Continuity Directive
  1. When tracing bugs or architecture across 2+ files, record verified findings with `waymark_note`.
  2. If previous conversation context has been rolled or truncated, call `waymark_resume` to restore active hops.
  3. When an investigation concludes, seal with `waymark_complete`.
  ```

---

### D. Google Antigravity / Gemini

- **MCP Registration:** Configured in `mcpServers` section of the workspace settings.
- **Lifecycle:** System rules and workspace rules (e.g. `<RULE>` blocks) persist across turns.
- **Directives:** Workspace rules instruct the agent to query `capn_ask` prior to discovery and restore active breadcrumbs with `waymark_resume` upon session resumption.

---

### E. Cline / Roo Code

- **MCP Registration:** Configured via the MCP Servers tab in Cline UI.
- **Required Configuration in `.clinerules`:**
  ```markdown
  ## Waymark Continuity Rules
  - Before beginning codebase searches, check `capn_ask` if available.
  - Record code discoveries via `waymark_note({ trajectory_id, path, start_line, end_line, inference })`.
  - When context is trimmed or after task resumption, run `waymark_resume()` to inspect your verified trail.
  ```

---

## 3. Summary of Compatibility Requirements

| Harness | MCP Config Location | Compaction Recovery Mechanism | Action Required by Developer |
|:---|:---|:---|:---|
| **Codex** | CLI config / stdio | Automated via `codex-agents-compact-reload` | Install reload hook; `AGENTS.md` provided |
| **Claude Code** | `claude mcp add` | Prompt directive on compaction summary | Add 4-line rule to `CLAUDE.md` |
| **Cursor** | `.cursor/mcp.json` | Rule-based check on context loss | Add rule to `.cursorrules` or `.mdc` |
| **Antigravity** | Workspace settings | System prompt / Workspace rule retention | Add `AGENTS.md` to workspace rules |
| **Cline** | Extension UI | System prompt rules | Add rule to `.clinerules` |

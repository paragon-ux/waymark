# Multi-Agent Harness Compatibility & Lifecycle Hooks Guide

This guide details how to configure Waymark across different AI coding agent harnesses (OpenAI Codex, Claude Code, Cursor, Gemini/Antigravity, and Cline), explaining the mechanics of active lifecycle hooks versus prompt-based directives.

---

## 1. The Prompt Compaction Paradox

A critical failure mode in long-running agent workflows is the **Prompt Compaction Paradox**:

> **The Paradox:** If an agent relies exclusively on prompts or conversation history to remember that it should call `waymark_resume`, what happens when the LLM context window compacts?  
> The conversation history is summarized, the prior turns are pruned, and the agent loses the very instruction reminding it to recover its breadcrumbs!

```text
[ Turn 1: Agent reads CLAUDE.md ]
               |
[ Turns 2-15: Deep multi-file code investigation (10,000+ tokens) ]
               |
[ Context Limit Exceeded -> HARNESS COMPACTS CONTEXT ]
               |
      +--------+--------+
      |                 |
      v                 v
[ PASSIVE PROMPT ]     [ ACTIVE LIFECYCLE HOOK ]
Context is summarized.  Harness executes hook script OUTSIDE LLM context.
Agent forgets to check  Hook runs `waymark-compact-hook.mjs` and injects
staged breadcrumbs.     the exact bounded resume packet (<2,048 B)
Result: Cold re-read!   Result: Instant 100% verified continuation!
```

To achieve true, unbreakable continuity across severe compactions, Waymark provides **both** passive MCP resources/prompts and **executable lifecycle hooks** (`scripts/hooks/waymark-compact-hook.mjs`).

---

## 2. Standardized 3-Tier Harness Support Model

Agent harnesses provide varying levels of context-injection capability, categorized into three distinct support tiers:

| Support Tier | Mechanism | Delivery Guarantee | Target Harnesses |
| :--- | :--- | :--- | :--- |
| **Tier 1: Active Lifecycle Hook Injection** | Out-of-context process execution on compaction/session boundary. | **100% deterministic.** Context injected before model invocation without spending tokens or turns. | **OpenAI Codex** (`SessionStart` with `source: compact`), **Google Antigravity** (`PreInvocation.injectSteps`), **Claude Code** (`post_compact`). |
| **Tier 2: MCP Resource & Prompt Ingestion** | In-band Model Context Protocol primitives (`resources/read`, `prompts/get`). | **High reliability.** Standardized pull; model accesses context via subscribed URIs or prompt commands. | **Claude Code**, **Cursor Composer**, **Windsurf**, **Cline**. |
| **Tier 3: Persistent Prompt Directives** | Sticky system framing files surviving context window compactions. | **Best-effort.** Instructs model to call `waymark_resume()` as step 1 when prior turn history is rolled. | **Cursor** (`.cursor/rules/*.mdc`), **Claude Code** (`CLAUDE.md`), **Antigravity** (`<RULE>` system blocks). |

---

## 3. Division of Labor: Static Rules vs. Dynamic Breadcrumbs

In a resilient agent workflow, post-compaction continuity operates across two complementary bootloaders:

```text
               Context Compaction Occurs
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
 [ AGENTS.md Compact Reload ]      [ waymark-compact-hook ]
  Target: Root `AGENTS.md`          Target: `.waymark/active.json`
  Role: Static behavioral rules     Role: Dynamic verified breadcrumbs
  Output: Project authority & hash  Output: Hops & relocated line spans
          │                               │
          └───────────────┬───────────────┘
                          ▼
        Immediate Post-Compaction Continuation
        (Full rules + Exact code breadcrumb trail)
```

1. **Static Project Governance ([AGENTS.md Compact Reload](https://github.com/paragon-ux/codex-agents-compact-reload)):** Reloads the root `AGENTS.md` and validates its SHA-256 hash. Ensures the agent never forgets its behavioral boundaries, test requirements, or safety invariants.
2. **Dynamic In-Flight Trajectory ([`waymark-compact-hook.mjs`](../scripts/hooks/waymark-compact-hook.mjs)):** Reloads the active `.waymark/` journal, verifies Git line anchors, detects relocated spans (`MOVED`), and injects the verified breadcrumb trail (<216 tokens).

For harnesses that accept a single lifecycle command (such as Codex `SessionStart`), both can be chained sequentially in a shell wrapper or registered together.

---

## 4. Universal Executable Hook: `waymark-compact-hook.mjs`

Waymark includes a standalone, dependency-free lifecycle hook:
[`scripts/hooks/waymark-compact-hook.mjs`](../scripts/hooks/waymark-compact-hook.mjs)

When invoked, the hook:
1. Validates the repository worktree and reads `.waymark/active.json`.
2. If no active trajectory exists, exits silently with code 0 (zero overhead).
3. If an active trajectory exists, validates recorded line anchors against current Git HEAD, checks for moved spans, and verifies integrity.
4. Outputs the bounded resume packet directly to stdout formatted for model consumption (Markdown or JSON).

```bash
# Output formatted Markdown block for context injection:
node <path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs --format=markdown

# Output structured JSON:
node <path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs --format=json
```

---

## 5. Harness-by-Harness Hook Configuration

### A. OpenAI Codex CLI

Codex supports native lifecycle hooks in `~/.codex/hooks.json`. Codex emits `SessionStart` with source `compact` whenever context compaction triggers, providing an `additionalContext` channel.

#### `hooks.json` Registration:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "command": ["node", "<path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs", "--format=markdown"]
      }
    ]
  }
}
```

When Codex compacts, it automatically executes the hook and prepends the verified breadcrumb trail to the immediate continuation.

---

### B. Claude Code (CC)

Claude Code supports project configuration via `.claude/config.json` and lifecycle hooks.

#### Option 1: Executable Hook in `.claude/config.json`
```json
{
  "mcpServers": {
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
    }
  },
  "hooks": {
    "post_compact": "node <path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs --format=markdown"
  }
}
```

#### Option 2: Persistent Instruction Rule (`CLAUDE.md`)
Add this persistent rule block to the project root `CLAUDE.md`:
```markdown
## In-Flight Code Continuity (Waymark)
- When investigating code across 2+ files, record verified hops using `waymark_note`.
- If context is compacted or rolled, immediately call `waymark_resume()` to restore verified code hops before re-reading files or searching.
- Trust the `verifiedThrough` prefix returned by `waymark_resume`.
```

---

### C. Cursor / Cursor Composer

Cursor uses a rolling context window and processes project rules in `.cursor/rules/`:

#### `.cursor/rules/waymark.mdc`:
```markdown
---
description: Waymark in-flight continuity ledger rules
globs: *
alwaysApply: true
---
# Waymark Investigation Continuity
1. During multi-file debugging or architecture tracing, record verified steps via `waymark_note`.
2. When starting a turn where prior conversational context is lost or compacted, call `waymark_resume()` immediately.
3. If `waymark_resume()` returns status `MOVED`, adopt the relocated line ranges; if `STALE`, re-verify the flagged hop.
```

---

### D. Google Antigravity / Gemini

Configure in `.gemini/antigravity/` workspace configuration:
- Add `waymark` to the `mcpServers` registry.
- Register `AGENTS.md` in workspace system instructions (`<RULE>` block).
- Antigravity automatically maintains system prompt rules across context compactions, ensuring the agent retains the instruction to check `waymark_resume`.

---

### E. Custom Autonomous Agent Loops (Python / Node.js)

If you are orchestrating LLM agents with LangGraph, AutoGen, CrewAI, or bespoke loops, bind Waymark directly to your compaction/pruning middleware:

```python
# Python Example: Post-Compaction Middleware
import subprocess
import json

def on_context_compaction(workspace_path: str) -> str:
    """Executes Waymark hook and returns context to inject into fresh prompt."""
    result = subprocess.run(
        ["node", "scripts/hooks/waymark-compact-hook.mjs", "--format=markdown", f"--root={workspace_path}"],
        capture_output=True,
        text=True,
        check=True
    )
    return result.stdout
```

---

## 4. Summary Matrix

| Harness | Hook Mechanism | Execution Boundary | Resilience to Compaction |
|:---|:---|:---|:---|
| **Codex** | Native `SessionStart` (`matcher: compact`) | External process hook | **Absolute (100% out-of-context)** |
| **Claude Code** | `post_compact` hook + `CLAUDE.md` | Process hook + prompt rule | **High (Hook runs on compaction)** |
| **Cursor** | `.cursor/rules/` (`alwaysApply: true`) | Pre-turn rule injection | **High (Rules re-injected every turn)** |
| **Antigravity** | Workspace `<RULE>` block | Persistent system prompt | **High (System prompt survives compaction)** |
| **Custom Loops** | Middleware callback | Application orchestrator | **Absolute (Programmatic injection)** |

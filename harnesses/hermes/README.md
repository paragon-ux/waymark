# Hermes Agent Integration (Tier 1 & Tier 2)

This directory documents the [Hermes Agent](https://github.com/NousResearch/hermes-agent) integration for **Waymark**.

---

## 1. Overview

Hermes Agent is Nous Research's open-source agent framework (CLI, TUI, desktop app, messaging gateway). It supports:

- **MCP servers** natively via `mcp_servers` in `~/.hermes/config.yaml` (Tier 2 — the primary Waymark surface).
- **Shell hooks** via the `hooks:` section of `config.yaml` — the `pre_llm_call` event runs a subprocess with a JSON payload on stdin after turn-start compaction and injects a `{"context": "..."}` stdout response into the active turn (Tier 1).
- **Context files** — `AGENTS.md` is loaded into the system prompt at session start (Tier 3 baseline).

---

## 2. Tier 2: MCP Server Configuration (primary)

Add the Waymark MCP server to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  waymark:
    command: "node"
    args: ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
```

Restart Hermes. The `waymark_init`, `waymark_begin`, `waymark_note`, `waymark_check`, `waymark_resume`, and `waymark_complete` tools appear alongside built-in tools; the agent calls them like any other tool. Per-server tool filtering is available via `mcp_servers.waymark.tools.include` if you want to prune the surface.

This is the recommended integration: the agent pulls verified resume packets on demand, exactly as in Codex/Cursor/Claude Code.

---

## 3. Tier 1: Compaction-Gated Shell Hook

### What it does

`scripts/hooks/waymark-compact-hook.mjs` detects Hermes' `pre_llm_call` shell-hook payload and — **on the first turn whose conversation history contains a compaction handoff (live user message included; Hermes compacts at turn start, so the immediate post-compaction turn normally carries one)** — emits the bounded resume packet as the hook's context injection. A per-session dedupe (`session_id` + summary identity, state in `.waymark/hermes-compact-hook-state.json`, 12 h TTL) keeps the persisting summary row from re-triggering later turns.

Hermes marks the post-compaction boundary with a metadata flag and byte-pinned summary prefixes in a `role="user"` row (`[CONTEXT COMPACTION — REFERENCE ONLY]…`, the no-user-turn continuation marker, the `## Historical Task Snapshot` deterministic fallback, or a merged summary after `[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]`). The hook prefers Hermes' in-process `_compressed_summary` row metadata (content-independent, survives the hook payload) and falls back to these byte-pinned markers only when metadata was stripped in transit; ordinary turns without any compaction handoff answer with a `{}` no-op JSON line. Once a given summary has been delivered once for a session, the dedupe answers later turns with the same no-op.

### Registration

Add to the `hooks:` section of `~/.hermes/config.yaml` (the Waymark hook has no installer; merge this entry manually):

```yaml
hooks:
  pre_llm_call:
    - command: "node" "<path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs"
      timeout: 15
```

### First-use consent

Hermes prompts once per `(event, command)` pair on a TTY and records the approval in `~/.hermes/shell-hooks-allowlist.json`. Non-interactive runs need `hermes --accept-hooks`, `HERMES_ACCEPT_HOOKS=1`, or `hooks_auto_accept: true` in `config.yaml`.

### Payload contract (stdin)

Hermes serializes the payload as:

```json
{
  "hook_event_name": "pre_llm_call",
  "session_id": "…",
  "cwd": "…",
  "profile": "default",
  "extra": {
    "user_message": "",
    "conversation_history": [{"role": "user", "content": "[CONTEXT COMPACTION — REFERENCE ONLY] …"}],
    "is_first_turn": false,
    "model": "…",
    "platform": "cli"
  }
}
```

The hook resolves the repository from `cwd` (falling back to `--root`), so no per-project registration is needed.

### Response contract (stdout)

Shell-hook invocations always answer with a single JSON line. On a compaction-gated turn with an active Waymark trajectory, the hook prints `{"context": "<markdown breadcrumb block>"}` — the same bounded markdown it emits for the `markdown` format (question, status, verified hop trail, next action), carried as the `context` string Hermes parses from hook stdout (`agent/shell_hooks.py` `_parse_response` / `_parse_context`). Do not expect raw markdown on this path; the context string is not truncated — Hermes spills oversized context to disk itself, bounded by `hooks.output_spill.max_chars` (default 10,000 chars). On every non-injection path — ordinary turns without a compaction handoff, deduped repeats, no active trajectory, no pointer, or repository-resolution errors — the hook prints `{}` instead of nothing, so Hermes always receives valid no-op JSON and contributes no context. The hook fails open: errors log to stderr and never block the agent loop.

Raw markdown is printed only when the format is forced for humans/CLI (no compaction gate, no shell-hook stdin payload):

```sh
node scripts/hooks/waymark-compact-hook.mjs --format=hermes --root=<REPO_ROOT>
```

### Notes

- Shell hooks register at process start; restart Hermes after editing `config.yaml`. Verify with `hermes hooks list` and `hermes hooks test pre_llm_call`.
- Hermes spills hook context beyond `hooks.output_spill.max_chars` (default 10,000 chars) to disk; Waymark's resume packet is bounded well below that.
- Hermes already rebuilds its system prompt at the compaction commit boundary (re-reading context files from disk); the shell hook adds the *dynamic* verified-breadcrumb layer, which static context files cannot carry.
- Division of labor is unchanged: this hook resumes the in-flight trajectory; [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload) reloads static `AGENTS.md` governance (it ships its own Hermes installer: `node scripts/install.mjs --target hermes`).

# MCP Server Configuration & Toolset Reference

This guide details how to configure and deploy Waymark as a native Model Context Protocol (MCP) server across AI agent environments (Claude Desktop, Cursor, Codex, Gemini / Antigravity, and Cline).

---

## 1. Deployment Architectures

Waymark runs as a native `stdio` JSON-RPC 2.0 MCP server with pure WebAssembly on-device execution (zero native C++ build tools required).

### Option 1: Standalone In-Flight Continuity (Recommended)
Add to your client configuration (`mcpServers` in Claude Desktop, Cursor, Codex, Gemini, or Antigravity):

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

### Option 2: Modular Continuity + Long-Term Memory
Run independent servers for in-flight continuity (`waymark`) and episodic memory (`capn-mcp`):

```json
{
  "mcpServers": {
    "waymark": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
    },
    "capn": {
      "command": "node",
      "args": ["<path-to-waymark>/dist/src/mcp/capnIndex.js"]
    }
  }
}
```

### Option 3: Unified Server (Both in One Process)
Run both continuity tools and Capn discovery tools in a single combined process:

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

---

## 2. Core MCP Toolsets & Protocols

### Continuity Server (`waymark`)

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| **`waymark_begin`** | `question: string` | Start a new durable in-flight code investigation trajectory for a specific task or question. |
| **`waymark_note`** | `path: string`, `label: string`, `start_line: number`, `end_line: number`, `inference: string` | Record a verified code evidence hop with Git line anchors, SHA-256 hash, and structural signature. |
| **`waymark_check`** | *(none)* | Verify worktree integrity against current Git HEAD and detect relocated code spans (`MOVED`). |
| **`waymark_resume`** | *(none)* | Retrieve the bounded compact-resume packet (<216 tokens) immediately after context compaction. |
| **`waymark_complete`** | `answer: string` | Seal the active trajectory, archive the journal, and chart final findings into Capn. |
| **`waymark_status`** | *(none)* | Retrieve current trajectory status (`NONE`, `STAGED`, `MOVED`, `STALE`, `CROSS_BRANCH`). |
| **`waymark_abandon`** | `reason: string` | Discard an active trajectory cleanly without publishing findings. |
| **`waymark_init`** | `profile: string` | Configure repository workspace profiles. |

#### MCP Resources & Prompts:
- **`waymark://context`**: Exposes the active trajectory status and verified breadcrumb trail as a readable resource.
- **`waymark://status`**: Real-time status inspection of the in-flight ledger.
- **`waymark_investigate`**: Prompt template priming the agent with the 4-step Proactive Directive.

---

### Memory & Discovery Server (`capn-mcp`)

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| **`capn_ask`** | `question: string` | Intelligent two-phase discovery router: <br>1. Traverses call hierarchies and symbol locations via in-process WebAssembly AST parsing (`provider: "wasm-ast"`). <br>2. Queries Capn repository memory for architectural rationale (`provider: "capn-cli"`). |
| **`capn_chart`** | `question: string`, `answer: string`, `files: string[]` | Directly chart an architectural insight into `.capn/entries/*.md`. |

#### MCP Resources:
- **`capn://status`**: Returns health and entry counts for charted repository memory.
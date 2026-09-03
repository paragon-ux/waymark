# OpenAI Codex Integration (Tier 1 & Tier 2)

## 1. Tier 1: SessionStart Hook
Register in `~/.codex/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "command": ["node", "<path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs"]
      }
    ]
  }
}
```

## 2. Tier 2: MCP Server Configuration
Add to `~/.codex/config.toml` or `mcpServers`:
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
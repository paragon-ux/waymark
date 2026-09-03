# Cursor Integration (Tier 2 & Tier 3)

## 1. Tier 2: MCP Server Configuration
Add to `mcpServers` in Cursor Settings:
```json
{
  "waymark": {
    "command": "node",
    "args": ["<path-to-waymark>/dist/src/mcp/waymarkIndex.js"]
  }
}
```

## 2. Tier 3: Persistent Rule (.cursor/rules/waymark.mdc)
Copy `.cursor/rules/waymark.mdc` into your project's `.cursor/rules/` directory.
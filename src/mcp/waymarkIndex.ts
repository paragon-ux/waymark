#!/usr/bin/env node
import { McpServer, WAYMARK_PROMPTS, WAYMARK_RESOURCES } from "./server.js";
import { WAYMARK_TOOLS } from "./waymarkTools.js";

const server = new McpServer({
  name: "waymark-mcp",
  version: "1.3.0",
  tools: WAYMARK_TOOLS,
  resources: WAYMARK_RESOURCES,
  prompts: WAYMARK_PROMPTS,
});

server.runStdio().catch((error) => {
  process.stderr.write(`Waymark MCP server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

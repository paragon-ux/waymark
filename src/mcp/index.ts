#!/usr/bin/env node
import { McpServer } from "./server.js";

const server = new McpServer();
server.runStdio().catch((error) => {
  process.stderr.write(`Waymark MCP server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

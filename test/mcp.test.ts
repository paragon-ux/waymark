import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { McpServer } from "../src/mcp/server.js";
import { WAYMARK_TOOLS } from "../src/mcp/waymarkTools.js";
import { CAPN_TOOLS } from "../src/mcp/capnTools.js";

function setupTempRepo(): string {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-mcp-test-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Waymark Test"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  fs.writeFileSync(path.join(tempDir, "sample.ts"), "export const value = 42;\nexport function hello() {\n  return 'world';\n}\n", "utf8");
  execFileSync("git", ["add", "sample.ts"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  return tempDir;
}

function cleanupTempRepo(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on Windows
  }
}

test("MCP server implements initialize, ping, and tools/list", async () => {
  const server = new McpServer();

  // 1. initialize
  const initRes = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  }));
  assert.ok(initRes, "Expected response for initialize");
  const initParsed = JSON.parse(initRes);
  assert.equal(initParsed.jsonrpc, "2.0");
  assert.equal(initParsed.id, 1);
  assert.equal(initParsed.result.protocolVersion, "2024-11-05");
  assert.equal(initParsed.result.serverInfo.name, "waymark-mcp");

  // 2. ping
  const pingRes = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "ping",
  }));
  assert.ok(pingRes, "Expected response for ping");
  const pingParsed = JSON.parse(pingRes);
  assert.equal(pingParsed.id, 2);
  assert.deepEqual(pingParsed.result, {});

  // 3. tools/list
  const listRes = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  }));
  assert.ok(listRes, "Expected response for tools/list");
  const listParsed = JSON.parse(listRes);
  assert.equal(listParsed.id, 3);
  assert.ok(Array.isArray(listParsed.result.tools));
  assert.equal(listParsed.result.tools.length, WAYMARK_TOOLS.length + CAPN_TOOLS.length);

  const toolNames = listParsed.result.tools.map((t: { name: string }) => t.name);
  assert.ok(toolNames.includes("waymark_init"));
  assert.ok(toolNames.includes("waymark_status"));
  assert.ok(toolNames.includes("waymark_begin"));
  assert.ok(toolNames.includes("waymark_note"));
  assert.ok(toolNames.includes("waymark_check"));
  assert.ok(toolNames.includes("waymark_resume"));
  assert.ok(toolNames.includes("waymark_complete"));
  assert.ok(toolNames.includes("waymark_abandon"));
  assert.ok(toolNames.includes("capn_ask"));
  assert.ok(toolNames.includes("capn_chart"));
});

test("MCP server executes complete Waymark lifecycle tools", async () => {
  const repo = setupTempRepo();
  try {
    const server = new McpServer();

    // 1. waymark_init
    const initRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "waymark_init",
        arguments: { root: repo, profile: "recording" },
      },
    }));
    assert.ok(initRes);
    const initParsed = JSON.parse(initRes);
    assert.equal(initParsed.id, 10);
    const initData = JSON.parse(initParsed.result.content[0].text);
    assert.equal(initData.ok, true);
    assert.equal(initData.profile, "recording");

    // 2. waymark_status (initial: NONE)
    const statusRes1 = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "waymark_status",
        arguments: { root: repo },
      },
    }));
    assert.ok(statusRes1);
    const status1Data = JSON.parse(JSON.parse(statusRes1).result.content[0].text);
    assert.equal(status1Data.status, "NONE");

    // 3. waymark_begin
    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "How does sample.ts define value?" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes).result.content[0].text);
    assert.equal(beginData.ok, true);
    assert.ok(beginData.id);
    const trajectoryId = beginData.id;

    // 4. waymark_note
    const noteRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "waymark_note",
        arguments: {
          root: repo,
          trajectory_id: trajectoryId,
          path: "sample.ts",
          label: "value-export",
          start_line: 1,
          end_line: 2,
          inference: "Value is exported as constant 42",
        },
      },
    }));
    assert.ok(noteRes);
    const noteData = JSON.parse(JSON.parse(noteRes).result.content[0].text);
    assert.equal(noteData.ok, true);
    assert.equal(noteData.hopIndex, 0);

    // 5. waymark_check
    const checkRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "waymark_check",
        arguments: { root: repo, trajectory_id: trajectoryId },
      },
    }));
    assert.ok(checkRes);
    const checkData = JSON.parse(JSON.parse(checkRes).result.content[0].text);
    assert.equal(checkData.status, "STAGED");
    assert.equal(checkData.verifiedThrough, 0);
    assert.equal(checkData.hops[0].status, "FRESH");

    // 6. waymark_resume
    const resumeRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "waymark_resume",
        arguments: { root: repo },
      },
    }));
    assert.ok(resumeRes);
    const resumeData = JSON.parse(JSON.parse(resumeRes).result.content[0].text);
    assert.equal(resumeData.status, "STAGED");
    assert.equal(resumeData.trajectoryId, trajectoryId);
    assert.equal(resumeData.hops.length, 1);
    assert.equal(resumeData.nextAction, "continue-from-verified-hop");

    // 7. waymark_complete
    const completeRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "waymark_complete",
        arguments: {
          root: repo,
          trajectory_id: trajectoryId,
          answer: "sample.ts exports value 42 and hello function.",
        },
      },
    }));
    assert.ok(completeRes);
    const completeData = JSON.parse(JSON.parse(completeRes).result.content[0].text);
    assert.equal(completeData.ok, true);
    assert.equal(completeData.published, true);

    // 8. waymark_status (after complete: NONE)
    const statusRes2 = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "waymark_status",
        arguments: { root: repo },
      },
    }));
    assert.ok(statusRes2);
    const status2Data = JSON.parse(JSON.parse(statusRes2).result.content[0].text);
    assert.equal(status2Data.status, "NONE");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("MCP server error handling returns standard JSON-RPC codes", async () => {
  const server = new McpServer();

  // Invalid JSON
  const errRes1 = await server.handleMessage("invalid json");
  assert.ok(errRes1);
  const err1 = JSON.parse(errRes1);
  assert.equal(err1.error.code, -32700);

  // Method not found
  const errRes2 = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 99,
    method: "non_existent_method",
  }));
  assert.ok(errRes2);
  const err2 = JSON.parse(errRes2);
  assert.equal(err2.error.code, -32601);

  // Tool not found
  const errRes3 = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 100,
    method: "tools/call",
    params: {
      name: "unknown_tool",
      arguments: {},
    },
  }));
  assert.ok(errRes3);
  const err3 = JSON.parse(errRes3);
  assert.equal(err3.error.code, -32601);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CAPN_RESOURCES, McpServer, WAYMARK_PROMPTS, WAYMARK_RESOURCES } from "../src/mcp/server.js";
import { WAYMARK_TOOLS } from "../src/mcp/waymarkTools.js";
import { CAPN_TOOLS } from "../src/mcp/capnTools.js";
import { initWorkspace, writeConfig } from "../src/journal.js";

// The REAL capn CLI surface for MCP adapter tests: test/capnHarness.mjs runs
// actual capn-hook code with lexical recall standardized (embedding: false).
const CAPN_HARNESS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  /^(dist|build)[\\/]/u.test(path.relative(path.resolve(process.cwd()), path.dirname(fileURLToPath(import.meta.url)))) ? "../../test" : "",
  "capnHarness.mjs",
);

// Windows wrapper .cmd exercising the adapter's cmd.exe path; POSIX .sh otherwise.
function capnExecutableFor(root: string): string {
  if (process.platform === "win32") {
    const cmdPath = path.join(root, "capn.cmd");
    fs.writeFileSync(
      cmdPath,
      ["@echo off", `"${process.execPath}" "${CAPN_HARNESS}" %*`, ""].join("\r\n"),
      "utf8",
    );
    return cmdPath;
  }
  const shPath = path.join(root, "capn.sh");
  fs.writeFileSync(shPath, `#!/bin/sh\nexec "${process.execPath}" "${CAPN_HARNESS}" "$@"\n`, "utf8");
  fs.chmodSync(shPath, 0o755);
  return shPath;
}

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

test("MCP server implements initialize, ping, tools/list, resources/list, and prompts/list", async () => {
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
  assert.ok(initParsed.result.capabilities.tools);
  assert.ok(initParsed.result.capabilities.resources);
  assert.ok(initParsed.result.capabilities.prompts);

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

  // 4. resources/list and resources/read
  const resList = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/list",
  }));
  assert.ok(resList);
  const resListParsed = JSON.parse(resList);
  assert.equal(resListParsed.result.resources.length, 2);
  assert.equal(resListParsed.result.resources[0].uri, "waymark://context");

  const resRead = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: { uri: "waymark://context" },
  }));
  assert.ok(resRead);
  const resReadParsed = JSON.parse(resRead);
  assert.ok(resReadParsed.result.contents[0].text.includes("Waymark Proactive Agent Directive"));

  // 5. prompts/list and prompts/get
  const pList = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 6,
    method: "prompts/list",
  }));
  assert.ok(pList);
  const pListParsed = JSON.parse(pList);
  assert.equal(pListParsed.result.prompts[0].name, "waymark_investigate");

  const pGet = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "prompts/get",
    params: { name: "waymark_investigate", arguments: { question: "How does lock acquisition work?" } },
  }));
  assert.ok(pGet);
  const pGetParsed = JSON.parse(pGet);
  assert.ok(pGetParsed.result.messages[0].content.text.includes("How does lock acquisition work?"));
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

test("Standalone Waymark MCP server isolates waymark tools and resources", async () => {
  const server = new McpServer({
    name: "waymark-mcp",
    tools: WAYMARK_TOOLS,
    resources: WAYMARK_RESOURCES,
    prompts: WAYMARK_PROMPTS,
  });

  const toolsRes = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  }));
  assert.ok(toolsRes);
  const toolsParsed = JSON.parse(toolsRes);
  assert.equal(toolsParsed.result.tools.length, WAYMARK_TOOLS.length);
  for (const tool of toolsParsed.result.tools) {
    assert.match(tool.name, /^waymark_/);
  }

  const resRes = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
  }));
  assert.ok(resRes);
  const resParsed = JSON.parse(resRes);
  assert.equal(resParsed.result.resources.length, 2);
  assert.equal(resParsed.result.resources[0].uri, "waymark://context");
  assert.equal(resParsed.result.resources[1].uri, "waymark://status");
});

test("Standalone Capn MCP server isolates capn tools and resources", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const server = new McpServer({
      name: "capn-mcp",
      tools: CAPN_TOOLS,
      resources: CAPN_RESOURCES,
      prompts: [],
    });

    const toolsRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }));
    assert.ok(toolsRes);
    const toolsParsed = JSON.parse(toolsRes);
    assert.equal(toolsParsed.result.tools.length, CAPN_TOOLS.length);
    assert.equal(toolsParsed.result.tools[0].name, "capn_ask");
    assert.equal(toolsParsed.result.tools[1].name, "capn_chart");

    const resRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
    }));
    assert.ok(resRes);
    const resParsed = JSON.parse(resRes);
    assert.equal(resParsed.result.resources.length, 1);
    assert.equal(resParsed.result.resources[0].uri, "capn://status");

    const readRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "capn://status" },
    }));
    assert.ok(readRes);
    const readParsed = JSON.parse(readRes);
    const statusData = JSON.parse(readParsed.result.contents[0].text);
    assert.equal(statusData.kind, "capn-status");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Capn ask MCP tool forwards charted hit payload and miss matches", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const server = new McpServer({
      name: "capn-mcp",
      tools: CAPN_TOOLS,
      resources: CAPN_RESOURCES,
      prompts: [],
    });

    // 1. Initial ask on empty recording repo -> miss with matches array
    const missRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "capn_ask",
        arguments: { root: repo, question: "How does authentication work?" },
      },
    }));
    assert.ok(missRes);
    const missParsed = JSON.parse(missRes);
    const missData = JSON.parse(missParsed.result.content[0].text);
    assert.equal(missData.status, "miss");
    assert.deepEqual(missData.matches, []);

    // 2. Ask through the REAL capn CLI surface (capnHarness: actual capn-hook
    //    code with lexical recall). Seed a chart via capn chart, then ask.
    const capn = (...args: string[]) =>
      execFileSync(process.execPath, [CAPN_HARNESS, ...args], {
        cwd: repo, encoding: "utf8", windowsHide: true, timeout: 60_000,
      });

    capn("chart", "How does authentication work?", "--files", "sample.ts", "--details", "JWT bearer tokens verified in auth middleware.");

    writeConfig(repo, { waymark: 1, profile: "capn-cli", capnExecutable: "capn", maxRelocationWindows: 2000 });
    const hitRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "capn_ask",
        arguments: {
          root: repo,
          question: "How does authentication work?",
          capn_executable: capnExecutableFor(repo),
        },
      },
    }));
    assert.ok(hitRes);
    const hitParsed = JSON.parse(hitRes);
    const hitData = JSON.parse(hitParsed.result.content[0].text);
    assert.equal(hitData.provider, "capn-cli");
    assert.equal(hitData.status, "hit");
    assert.ok(hitData.result, "Expected result field in hit response");
    assert.match(JSON.stringify(hitData.result), /How does authentication work/u);
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Capn chart MCP tool records publication in recording profile", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const server = new McpServer({
      name: "capn-mcp",
      tools: CAPN_TOOLS,
      resources: CAPN_RESOURCES,
      prompts: [],
    });

    const chartRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "capn_chart",
        arguments: {
          root: repo,
          question: "How does caching work?",
          answer: "Caching uses in-memory LRU with 5 minute TTL.",
          files: ["sample.ts"],
        },
      },
    }));
    assert.ok(chartRes);
    const chartParsed = JSON.parse(chartRes);
    const chartData = JSON.parse(chartParsed.result.content[0].text);
    assert.equal(chartData.kind, "chart");
    assert.equal(chartData.published, true);
    assert.equal(chartData.adapter, "recording");
    assert.match(chartData.output, /^recorded:/);
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Waymark abandon tool cancels active trajectory cleanly", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const server = new McpServer({
      name: "waymark-mcp",
      tools: WAYMARK_TOOLS,
      resources: WAYMARK_RESOURCES,
      prompts: WAYMARK_PROMPTS,
    });

    // 1. Begin trajectory
    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "Temporary investigation" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes).result.content[0].text);
    assert.ok(beginData.id);

    // 2. Abandon trajectory
    const abandonRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "waymark_abandon",
        arguments: { root: repo, trajectory_id: beginData.id, reason: "superseded" },
      },
    }));
    assert.ok(abandonRes);
    const abandonData = JSON.parse(JSON.parse(abandonRes).result.content[0].text);
    assert.equal(abandonData.kind, "abandon");
    assert.equal(abandonData.ok, true);
    assert.equal(abandonData.id, beginData.id);

    // 3. Status should now be NONE
    const statusRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "waymark_status",
        arguments: { root: repo },
      },
    }));
    assert.ok(statusRes);
    const statusData = JSON.parse(JSON.parse(statusRes).result.content[0].text);
    assert.equal(statusData.status, "NONE");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Universal post-compaction lifecycle hook script generates valid Markdown and JSON injection blocks", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const hookScript = path.resolve(process.cwd(), "scripts", "hooks", "waymark-compact-hook.mjs");

    // 1. Hook with no active trajectory exits cleanly
    const emptyOutput = execFileSync(process.execPath, [hookScript, `--root=${repo}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(emptyOutput.trim(), "");

    // 2. Start trajectory and add note
    const server = new McpServer({
      name: "waymark-mcp",
      tools: WAYMARK_TOOLS,
      resources: WAYMARK_RESOURCES,
      prompts: WAYMARK_PROMPTS,
    });
    const sampleFile = path.join(repo, "auth.ts");
    fs.writeFileSync(sampleFile, "export function verifySignature() {\n  return true;\n}\n");
    execFileSync("git", ["add", "auth.ts"], { cwd: repo, windowsHide: true });
    execFileSync("git", ["commit", "-m", "add auth.ts"], { cwd: repo, windowsHide: true });

    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "Verify webhook flow" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes).result.content[0].text);

    await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "waymark_note",
        arguments: {
          root: repo,
          trajectory_id: String(beginData.id),
          path: "auth.ts",
          label: "signature-verifier",
          start_line: 1,
          end_line: 3,
          inference: "Verifies HMAC signature safely",
        },
      },
    }));

    // 3. Test hook with markdown format
    const mdOutput = execFileSync(process.execPath, [hookScript, `--root=${repo}`, "--format=markdown"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.match(mdOutput, /### \[Waymark\] Active Investigation Resumed Post-Compaction/);
    assert.match(mdOutput, /Verify webhook flow/);
    assert.match(mdOutput, /signature-verifier/);

    // 4. Test hook with JSON format
    const jsonOutput = execFileSync(process.execPath, [hookScript, `--root=${repo}`, "--format=json"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const parsed = JSON.parse(jsonOutput);
    assert.equal(parsed.kind, "compact-resume");
    assert.equal(parsed.status, "STAGED");
    assert.equal(parsed.verifiedThrough, 0);
    assert.equal(parsed.hops.length, 1);
    assert.equal(parsed.hops[0].path, "auth.ts");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Test A: Lifecycle hook injects SessionStart additionalContext for Codex and injectSteps for Antigravity", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const hookScript = path.resolve(process.cwd(), "scripts", "hooks", "waymark-compact-hook.mjs");
    const server = new McpServer({
      name: "waymark-mcp",
      tools: WAYMARK_TOOLS,
      resources: WAYMARK_RESOURCES,
      prompts: WAYMARK_PROMPTS,
    });
    const sampleFile = path.join(repo, "auth.ts");
    fs.writeFileSync(sampleFile, "export function verifySignature() {\n  return true;\n}\n");
    execFileSync("git", ["add", "auth.ts"], { cwd: repo, windowsHide: true });
    execFileSync("git", ["commit", "-m", "add auth.ts"], { cwd: repo, windowsHide: true });

    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "Test A Manual Compaction Verification" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes as string).result.content[0].text);

    await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "waymark_note",
        arguments: {
          root: repo,
          trajectory_id: String(beginData.id),
          path: "auth.ts",
          label: "marker-hop",
          start_line: 1,
          end_line: 3,
          inference: "Verifies marker-hop in Test A",
        },
      },
    }));

    // 1. Codex SessionStart with compact source
    const codexPayload = JSON.stringify({
      hook_event_name: "SessionStart",
      source: "compact",
      cwd: repo,
    });
    const codexOut = execFileSync(process.execPath, [hookScript], {
      input: codexPayload,
      encoding: "utf8",
      windowsHide: true,
    });
    const parsedCodex = JSON.parse(codexOut.trim());
    assert.equal(parsedCodex.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsedCodex.hookSpecificOutput.additionalContext, /Test A Manual Compaction Verification/);
    assert.match(parsedCodex.hookSpecificOutput.additionalContext, /marker-hop/);

    // 2. Google Antigravity PreInvocation with workspacePaths
    const agyPayload = JSON.stringify({
      workspacePaths: [repo],
      invocationNum: 2,
    });
    const agyOut = execFileSync(process.execPath, [hookScript], {
      input: agyPayload,
      encoding: "utf8",
      windowsHide: true,
    });
    const parsedAgy = JSON.parse(agyOut.trim());
    assert.ok(Array.isArray(parsedAgy.injectSteps));
    assert.match(parsedAgy.injectSteps[0].ephemeralMessage, /Test A Manual Compaction Verification/);
    assert.match(parsedAgy.injectSteps[0].ephemeralMessage, /marker-hop/);
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Test B: Lifecycle hook filters non-compact events to prevent duplicate replay", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const hookScript = path.resolve(process.cwd(), "scripts", "hooks", "waymark-compact-hook.mjs");

    // 1. Non-compact Codex SessionStart (e.g. startup/ordinary turn)
    const normalSessionPayload = JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: repo,
    });
    const normalOut = execFileSync(process.execPath, [hookScript], {
      input: normalSessionPayload,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(normalOut.trim(), "{}");

    // 2. Unregistered or empty repo returns no-op
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), "outside-repo-"));
    try {
      const outsidePayload = JSON.stringify({
        hook_event_name: "SessionStart",
        source: "compact",
        cwd: outsideRepo,
      });
      const outsideOut = execFileSync(process.execPath, [hookScript], {
        input: outsidePayload,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(outsideOut.trim(), "{}");
    } finally {
      fs.rmSync(outsideRepo, { recursive: true, force: true });
    }
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Hermes pre_llm_call shell hook injects the resume packet only on compaction handoffs", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const hookScript = path.resolve(process.cwd(), "scripts", "hooks", "waymark-compact-hook.mjs");
    const server = new McpServer({
      name: "waymark-mcp",
      tools: WAYMARK_TOOLS,
      resources: WAYMARK_RESOURCES,
      prompts: WAYMARK_PROMPTS,
    });
    const sampleFile = path.join(repo, "auth.ts");
    fs.writeFileSync(sampleFile, "export function verifySignature() {\n  return true;\n}\n");
    execFileSync("git", ["add", "auth.ts"], { cwd: repo, windowsHide: true });
    execFileSync("git", ["commit", "-m", "add auth.ts"], { cwd: repo, windowsHide: true });

    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "Hermes compaction continuity" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes).result.content[0].text);

    await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: {
        name: "waymark_note",
        arguments: {
          root: repo,
          trajectory_id: String(beginData.id),
          path: "auth.ts",
          label: "hermes-hop",
          start_line: 1,
          end_line: 3,
          inference: "Verifies hermes-hop after compaction",
        },
      },
    }));

    const hermesPayload = (sessionId: string, userMessage: string, lastUserContent: string, metadata = false) => JSON.stringify({
      hook_event_name: "pre_llm_call",
      session_id: sessionId,
      cwd: repo,
      extra: {
        user_message: userMessage,
        conversation_history: [
          { role: "user", content: "earlier turn" },
          { role: "assistant", content: "answer" },
          metadata
            ? { role: "user", content: lastUserContent, _compressed_summary: true }
            : { role: "user", content: lastUserContent },
        ],
        is_first_turn: false,
        model: "test-model",
        platform: "cli",
      },
    });

    const summaryPrefix = "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below.";

    // 1. Metadata-flagged compaction row + live user message -> injects the breadcrumb block
    //    as a {"context": ...} JSON line (Hermes compacts at turn start, so the immediate
    //    post-compaction turn carries one)
    const compactOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-1", "continue the work", "summary row", true),
      encoding: "utf8",
      windowsHide: true,
    });
    const compactPayload = JSON.parse(compactOut) as { context: string };
    assert.match(compactPayload.context, /\[Waymark\] Active Investigation Resumed Post-Compaction/);
    assert.match(compactPayload.context, /Hermes compaction continuity/);
    assert.match(compactPayload.context, /hermes-hop/);

    // 2. Same session, SAME summary again -> deduped {} no-op JSON line
    const dedupeOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-1", "next turn", "summary row", true),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(dedupeOut.trim(), "{}");

    // 2b. Same session, DIFFERENT summary content (still metadata-flagged) ->
    //    fires again: the dedupe identity is the summary-text hash, not a
    //    constant, so two distinct compactions in one session never swallow
    //    each other within the TTL
    const secondCompactOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-1", "continue again", "a NEW compaction summary", true),
      encoding: "utf8",
      windowsHide: true,
    });
    const secondCompactPayload = JSON.parse(secondCompactOut) as { context: string };
    assert.match(secondCompactPayload.context, /hermes-hop/);

    // 2c. Failed-injection retry: the dedupe commit only happens after a
    //    successful injection, so a transient post-gate failure must NOT
    //    consume the 12h retry window. Prove it with a real failure on a FRESH
    //    session (so only the crash, not an earlier mark, is in play): delete
    //    .waymark/config.json so the hook errors after the gate (the crash
    //    path answers {}), then restore it and retry — the retry must inject,
    //    proving the failed run never marked the boundary fired.
    const crashRepoConfig = path.join(repo, ".waymark", "config.json");
    fs.rmSync(crashRepoConfig, { force: true });
    const failedOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-retry", "retry turn", "summary row", true),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(failedOut.trim(), "{}");
    fs.writeFileSync(crashRepoConfig, JSON.stringify({ waymark: 1, profile: "recording", capnExecutable: "capn", maxRelocationWindows: 2000 }), "utf8");
    const retryOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-retry", "retry turn", "summary row", true),
      encoding: "utf8",
      windowsHide: true,
    });
    const retryPayload = JSON.parse(retryOut) as { context: string };
    assert.match(retryPayload.context, /hermes-hop/);

    // 3. Different session id -> fires again
    const secondSessOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-2", "continue the work", "summary row", true),
      encoding: "utf8",
      windowsHide: true,
    });
    const secondSessPayload = JSON.parse(secondSessOut) as { context: string };
    assert.match(secondSessPayload.context, /hermes-hop/);

    // 4. Ordinary turn without compaction signals -> {} no-op JSON line
    const ordinaryOut = execFileSync(process.execPath, [hookScript], {
      input: hermesPayload("hermes-sess-3", "hello", "a normal question"),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(ordinaryOut.trim(), "{}");

    // 5. Content-marker fallbacks (for rows that lost "_" metadata in transit): summary prefix,
    //    continuation marker, fallback heading, merged carrier -> all inject as JSON context
    const contentCases = [
      summaryPrefix,
      "Continue from the compressed conversation context above. This marker exists because no human user turn was available.",
      "## Historical Task Snapshot\nUser asked: 'demo'",
      "kept task text\n\n[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]\n[CONTEXT COMPACTION — REFERENCE ONLY] summary body",
    ];
    let sessCounter = 10;
    for (const content of contentCases) {
      const out = execFileSync(process.execPath, [hookScript], {
        input: hermesPayload(`hermes-sess-${sessCounter++}`, "continue", content),
        encoding: "utf8",
        windowsHide: true,
      });
      const payload = JSON.parse(out) as { context: string };
      assert.match(payload.context, /hermes-hop/, `content-marker fallback should fire for: ${content.slice(0, 40)}`);
    }

    // 6. Forced CLI format emits the raw markdown block without a stdin gate
    //    (CLI/human mode, unlike the gated shell-hook JSON path above)
    const cliOut = execFileSync(process.execPath, [hookScript, "--format=hermes", `--root=${repo}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.match(cliOut, /\[Waymark\] Active Investigation Resumed Post-Compaction/);

    // 7. Byte cap: the markdown block honors the 2048-byte resume contract —
    //    seed 14 maximum-size hops (plus the pre-existing hermes-hop = 15
    //    total) on untracked module files (no new commit, so the existing hop
    //    provenance stays FRESH); the block must stay within
    //    MAX_RESUME_BYTES (2048) with older hops dropped, not inject an
    //    uncapped context.
    for (let i = 0; i < 14; i += 1) {
      fs.writeFileSync(path.join(repo, `module-${i}.ts`), `// module ${i}\n` + "filler\n".repeat(i + 2), "utf8");
      const hopRes = await server.handleMessage(JSON.stringify({
        jsonrpc: "2.0",
        id: 70 + i,
        method: "tools/call",
        params: {
          name: "waymark_note",
          arguments: {
            root: repo,
            trajectory_id: String(beginData.id),
            path: `module-${i}.ts`,
            label: `L${i}-${"x".repeat(108)}`,
            start_line: 1 + i,
            end_line: 2 + i,
            inference: `Verifies hop ${i} ${"y".repeat(140)}`,
          },
        },
      }));
      assert.ok(hopRes);
      const hopData = JSON.parse(JSON.parse(String(hopRes)).result.content[0].text);
      assert.equal(hopData.ok, true, `note ${i} must be accepted: ${JSON.stringify(hopData)}`);
    }

    const cappedOut = execFileSync(process.execPath, [hookScript, "--format=hermes", `--root=${repo}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.ok(cappedOut.length <= 2048, `markdown block must honor the 2048-byte cap, got ${cappedOut.length}`);
    assert.match(cappedOut, /omitted to keep this packet bounded/);
    assert.match(cappedOut, /L13-/u, "newest hops must survive the cap; oldest dropped first");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Hermes shell hook answers one JSON line even on internal failure", async () => {
  const repo = setupTempRepo();
  try {
    initWorkspace(repo, "recording");
    const hookScript = path.resolve(process.cwd(), "scripts", "hooks", "waymark-compact-hook.mjs");
    const server = new McpServer({
      name: "waymark-mcp",
      tools: WAYMARK_TOOLS,
      resources: WAYMARK_RESOURCES,
      prompts: WAYMARK_PROMPTS,
    });
    const sampleFile = path.join(repo, "auth.ts");
    fs.writeFileSync(sampleFile, "export function verifySignature() {\n  return true;\n}\n");
    execFileSync("git", ["add", "auth.ts"], { cwd: repo, windowsHide: true });
    execFileSync("git", ["commit", "-m", "add auth.ts"], { cwd: repo, windowsHide: true });

    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 60,
      method: "tools/call",
      params: {
        name: "waymark_begin",
        arguments: { root: repo, question: "Crash path contract" },
      },
    }));
    assert.ok(beginRes);
    const beginData = JSON.parse(JSON.parse(beginRes).result.content[0].text);
    await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: {
        name: "waymark_note",
        arguments: {
          root: repo,
          trajectory_id: String(beginData.id),
          path: "auth.ts",
          label: "crash-hop",
          start_line: 1,
          end_line: 3,
          inference: "Seeds a real active trajectory before the failure",
        },
      },
    }));

    const crashPayload = (lastUserContent: string) => JSON.stringify({
      hook_event_name: "pre_llm_call",
      session_id: "hermes-crash-sess-1",
      cwd: repo,
      extra: {
        user_message: "continue the work",
        conversation_history: [
          { role: "user", content: "earlier turn" },
          { role: "user", content: lastUserContent, _compressed_summary: true },
        ],
        is_first_turn: false,
        model: "test-model",
        platform: "cli",
      },
    });

    // Real internal failure: .waymark/config.json is deleted AFTER a live
    // waymark_begin seeded an active trajectory, so readActivePointer succeeds
    // and loadActiveTrajectory's replay reaches readConfig -> NOT_INITIALIZED
    // escapes runHook into the top-level catch.
    const configPath = path.join(repo, ".waymark", "config.json");
    fs.rmSync(configPath, { force: true });

    const crash = spawnSync(process.execPath, [hookScript], {
      input: crashPayload("summary row"),
      encoding: "utf8",
      windowsHide: true,
    });
    // Exit stays 0 (fail-open), stdout is exactly one JSON line, and the
    // NOT_INITIALIZED diagnostic went to stderr — proving the throw actually
    // traversed the top-level catch rather than a silent no-op return.
    assert.equal(crash.status, 0);
    const parsedCrash = JSON.parse(crash.stdout) as { context?: string };
    assert.equal(parsedCrash.context, undefined);
    assert.match(crash.stdout.trim(), /^\{\}$/);
    assert.match(crash.stderr, /NOT_INITIALIZED|Run waymark init before using the project/i);
  } finally {
    cleanupTempRepo(repo);
  }
});

test("MCP server executes waymark_recover_lock inspection and forced reclaim", async () => {
  const repo = setupTempRepo();
  try {
    const server = new McpServer();
    await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "waymark_init", arguments: { profile: "recording", root: repo } },
    }));

    // 1. When no lock exists
    const noLockRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "waymark_recover_lock", arguments: { force: false, root: repo } },
    }));
    assert.ok(noLockRes);
    const noLockParsed = JSON.parse(JSON.parse(noLockRes).result.content[0].text);
    assert.equal(noLockParsed.ok, true);
    assert.equal(noLockParsed.recovered, false);
    assert.equal(noLockParsed.locked, false);

    // 2. Simulate an orphaned lock left by dead process
    const lockDir = path.join(repo, ".waymark", "locks", "active");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "metadata.json"),
      JSON.stringify({ pid: 99999999, nodeVersion: "v22.0.0", startTime: new Date().toISOString(), cwd: repo, token: "dead-token" }) + "\n",
      "utf8",
    );

    // 3. Normal begin fails with BUSY
    const busyRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "waymark_begin", arguments: { question: "Attempt while busy", root: repo } },
    }));
    assert.ok(busyRes);
    const busyParsed = JSON.parse(JSON.parse(busyRes).result.content[0].text);
    assert.equal(busyParsed.ok, false);
    assert.equal(busyParsed.code, "BUSY");

    // 4. Inspection shows lock is held by dead PID
    const inspectRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "waymark_recover_lock", arguments: { force: false, root: repo } },
    }));
    assert.ok(inspectRes);
    const inspectParsed = JSON.parse(JSON.parse(inspectRes).result.content[0].text);
    assert.equal(inspectParsed.ok, true);
    assert.equal(inspectParsed.recovered, false);
    assert.equal(inspectParsed.locked, true);
    assert.equal(inspectParsed.active, false);
    assert.equal(inspectParsed.owner.pid, 99999999);

    // 5. Force recovery reclaims the orphaned lock
    const recoverRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "waymark_recover_lock", arguments: { force: true, root: repo } },
    }));
    assert.ok(recoverRes);
    const recoverParsed = JSON.parse(JSON.parse(recoverRes).result.content[0].text);
    assert.equal(recoverParsed.ok, true);
    assert.equal(recoverParsed.recovered, true);
    assert.equal(recoverParsed.previous.pid, 99999999);

    // 6. Now waymark_begin succeeds cleanly
    const beginRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "waymark_begin", arguments: { question: "After recovery", root: repo } },
    }));
    assert.ok(beginRes);
    const beginParsed = JSON.parse(JSON.parse(beginRes).result.content[0].text);
    assert.equal(beginParsed.ok, true);
    assert.ok(beginParsed.id);

    // 7. No lock remaining after completion
    const livePidRes = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "waymark_recover_lock", arguments: { force: true, root: repo } },
    }));
    assert.ok(livePidRes);
    const afterBeginRecover = JSON.parse(JSON.parse(livePidRes).result.content[0].text);
    assert.equal(afterBeginRecover.ok, true);
    assert.equal(afterBeginRecover.recovered, false);
  } finally {
    cleanupTempRepo(repo);
  }
});





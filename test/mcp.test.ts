import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { CAPN_RESOURCES, McpServer, WAYMARK_PROMPTS, WAYMARK_RESOURCES } from "../src/mcp/server.js";
import { WAYMARK_TOOLS } from "../src/mcp/waymarkTools.js";
import { CAPN_TOOLS } from "../src/mcp/capnTools.js";
import { initWorkspace, writeConfig } from "../src/journal.js";

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

    // 2. Ask with a simulated hit via fake-capn script
    const fakeScript = process.platform === "win32"
      ? path.resolve(process.cwd(), "test", "fake-capn.cmd")
      : path.resolve(process.cwd(), "test", "fake-capn-miss.mjs");

    if (process.platform === "win32") {
      writeConfig(repo, { waymark: 1, profile: "capn-cli", capnExecutable: fakeScript, maxRelocationWindows: 2000 });
      const hitRes = await server.handleMessage(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "capn_ask",
          arguments: {
            root: repo,
            question: "How does authentication work?",
            capn_executable: fakeScript,
          },
        },
      }));
      assert.ok(hitRes);
      const hitParsed = JSON.parse(hitRes);
      const hitData = JSON.parse(hitParsed.result.content[0].text);
      assert.equal(hitData.status, "hit");
      assert.ok(hitData.result, "Expected result field in hit response");
      assert.ok(String(hitData.result).includes("How does authentication work"));
    }
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




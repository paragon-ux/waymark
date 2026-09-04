import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { acquireLock } from "../src/lock.js";
import {
  initWorkspace,
  loadActiveTrajectory,
  readActivePointer,
  readJournalEvents,
} from "../src/journal.js";
import { McpServer } from "../src/mcp/server.js";
import { repoRoot } from "../src/paths.js";

interface WorktreeFixture {
  mainRepo: string;
  wtA: string;
  wtB: string;
  cleanup: () => void;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function setupWorktreeFixture(): WorktreeFixture {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "waymark-wt-test-"));
  const mainRepo = path.join(baseDir, "main-repo");
  fs.mkdirSync(mainRepo, { recursive: true });

  git(mainRepo, ["init", "-b", "main"]);
  git(mainRepo, ["config", "user.email", "multiagent-test@example.com"]);
  git(mainRepo, ["config", "user.name", "Waymark MultiAgent Test"]);

  // Add initial tracked files and .gitignore
  fs.writeFileSync(path.join(mainRepo, ".gitignore"), ".waymark/\n", "utf8");
  const initialCode = [
    "export function calculateTotal(items: number[]): number {",
    "  let sum = 0;",
    "  for (const item of items) {",
    "    sum += item;",
    "  }",
    "  return sum;",
    "}",
    "",
    "export function formatCurrency(value: number): string {",
    "  return `$${value.toFixed(2)}`;",
    "}",
  ].join("\n");
  fs.writeFileSync(path.join(mainRepo, "service.ts"), initialCode, "utf8");

  git(mainRepo, ["add", "."]);
  git(mainRepo, ["commit", "-qm", "Initial repository setup"]);

  // Create two isolated git worktrees
  const wtA = path.join(baseDir, "agent-a-worktree");
  const wtB = path.join(baseDir, "agent-b-worktree");
  git(mainRepo, ["worktree", "add", "-b", "feature-agent-a", wtA]);
  git(mainRepo, ["worktree", "add", "-b", "feature-agent-b", wtB]);

  return {
    mainRepo,
    wtA,
    wtB,
    cleanup: () => {
      try {
        git(mainRepo, ["worktree", "remove", "--force", wtA]);
      } catch {}
      try {
        git(mainRepo, ["worktree", "remove", "--force", wtB]);
      } catch {}
      try {
        fs.rmSync(baseDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

async function rpc(server: McpServer, method: string, params?: Record<string, unknown>, id = 1): Promise<Record<string, unknown>> {
  const response = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params ? { params } : {}),
  }));
  assert.ok(response, `Expected response for ${method}`);
  return JSON.parse(response) as Record<string, unknown>;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>, id = 1): Promise<Record<string, unknown>> {
  const res = await rpc(server, "tools/call", { name, arguments: args }, id);
  const result = res.result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
  assert.ok(result?.content?.[0]?.text, `Missing content in result for tool ${name}`);
  const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
  return { ...payload, _isError: Boolean(result.isError) };
}

test("repoRoot resolves to distinct top-level directories in separate git worktrees", () => {
  const { mainRepo, wtA, wtB, cleanup } = setupWorktreeFixture();
  try {
    const rootMain = repoRoot(mainRepo);
    const rootA = repoRoot(wtA);
    const rootB = repoRoot(wtB);

    assert.notEqual(rootA, rootB, "Worktree A and Worktree B must have distinct repo roots");
    assert.notEqual(rootA, rootMain, "Worktree A must differ from main repo root");
    assert.notEqual(rootB, rootMain, "Worktree B must differ from main repo root");

    assert.equal(rootA, fs.realpathSync.native(wtA));
    assert.equal(rootB, fs.realpathSync.native(wtB));
  } finally {
    cleanup();
  }
});

test("lock isolation: concurrent agents in separate worktrees acquire locks without collision", () => {
  const { wtA, wtB, cleanup } = setupWorktreeFixture();
  try {
    initWorkspace(wtA, "recording");
    initWorkspace(wtB, "recording");

    // Both agents acquire their active locks simultaneously
    const lockA = acquireLock(wtA);
    const lockB = acquireLock(wtB);

    assert.ok(lockA.metadata.token, "Agent A acquired lock");
    assert.ok(lockB.metadata.token, "Agent B acquired lock");
    assert.notEqual(lockA.metadata.token, lockB.metadata.token);

    // Verifying same-worktree concurrency still fails closed
    assert.throws(() => acquireLock(wtA), /lock/iu, "Second lock in Worktree A must be rejected as BUSY");
    assert.throws(() => acquireLock(wtB), /lock/iu, "Second lock in Worktree B must be rejected as BUSY");

    lockA.release();
    lockB.release();

    // After release, new locks can be acquired cleanly
    const reacquireA = acquireLock(wtA);
    reacquireA.release();
  } finally {
    cleanup();
  }
});

test("multi-agent trajectory independence: isolated investigations have zero cross-talk", async () => {
  const { wtA, wtB, cleanup } = setupWorktreeFixture();
  try {
    const serverA = new McpServer();
    const serverB = new McpServer();

    // 1. Initialize workspaces
    const initA = await callTool(serverA, "waymark_init", { profile: "recording", root: wtA });
    assert.equal(initA.ok, true);
    const initB = await callTool(serverB, "waymark_init", { profile: "recording", root: wtB });
    assert.equal(initB.ok, true);

    // 2. Begin separate active trajectories
    const beginA = await callTool(serverA, "waymark_begin", { question: "Agent A: Trace calculation loop", root: wtA });
    assert.equal(beginA.ok, true);
    const idA = String(beginA.id);

    const beginB = await callTool(serverB, "waymark_begin", { question: "Agent B: Trace currency formatting", root: wtB });
    assert.equal(beginB.ok, true);
    const idB = String(beginB.id);

    assert.notEqual(idA, idB, "Trajectories must have unique IDs");

    // 3. Status checks confirm strict scoping
    const statusA = await callTool(serverA, "waymark_status", { root: wtA });
    assert.equal(statusA.status, "STAGED");
    assert.equal(statusA.trajectoryId, idA);

    const statusB = await callTool(serverB, "waymark_status", { root: wtB });
    assert.equal(statusB.status, "STAGED");
    assert.equal(statusB.trajectoryId, idB);

    // 4. Agent A records hops in Worktree A; Agent B records hops in Worktree B
    const noteA1 = await callTool(serverA, "waymark_note", {
      trajectory_id: idA,
      path: "service.ts",
      label: "loop",
      start_line: 1,
      end_line: 6,
      inference: "Items are summed sequentially in a loop",
      root: wtA,
    });
    assert.equal(noteA1.ok, true);

    const noteA2 = await callTool(serverA, "waymark_note", {
      trajectory_id: idA,
      path: "service.ts",
      label: "return",
      start_line: 6,
      end_line: 7,
      inference: "Final computed sum is returned to caller",
      root: wtA,
    });
    assert.equal(noteA2.ok, true);

    const noteB1 = await callTool(serverB, "waymark_note", {
      trajectory_id: idB,
      path: "service.ts",
      label: "formatter",
      start_line: 9,
      end_line: 11,
      inference: "Currency formatted as standard dollar string",
      root: wtB,
    });
    assert.equal(noteB1.ok, true);

    // 5. Check & Resume on each worktree verify independent breadcrumb sets
    const resumeA = await callTool(serverA, "waymark_resume", { root: wtA });
    assert.equal(resumeA.status, "STAGED");
    assert.equal(resumeA.trajectoryId, idA);
    assert.equal(resumeA.totalSteps, 2);
    const hopsA = resumeA.hops as Array<Record<string, unknown>>;
    assert.equal(hopsA.length, 2);
    assert.equal(hopsA[0]?.label, "loop");
    assert.equal(hopsA[1]?.label, "return");

    const resumeB = await callTool(serverB, "waymark_resume", { root: wtB });
    assert.equal(resumeB.status, "STAGED");
    assert.equal(resumeB.trajectoryId, idB);
    assert.equal(resumeB.totalSteps, 1);
    const hopsB = resumeB.hops as Array<Record<string, unknown>>;
    assert.equal(hopsB.length, 1);
    assert.equal(hopsB[0]?.label, "formatter");

    // 6. Verify underlying journal files on disk exist only in their respective worktree
    const filesA = fs.readdirSync(path.join(wtA, ".waymark", "trajectories"));
    assert.deepEqual(filesA, [`${idA}.ndjson`]);

    const filesB = fs.readdirSync(path.join(wtB, ".waymark", "trajectories"));
    assert.deepEqual(filesB, [`${idB}.ndjson`]);
  } finally {
    cleanup();
  }
});

test("file mutation isolation: code changes in Worktree A do not corrupt or stale Worktree B hops", async () => {
  const { wtA, wtB, cleanup } = setupWorktreeFixture();
  try {
    const serverA = new McpServer();
    const serverB = new McpServer();

    await callTool(serverA, "waymark_init", { profile: "recording", root: wtA });
    await callTool(serverB, "waymark_init", { profile: "recording", root: wtB });

    const beginA = await callTool(serverA, "waymark_begin", { question: "Agent A: calculation", root: wtA });
    const idA = String(beginA.id);
    await callTool(serverA, "waymark_note", {
      trajectory_id: idA,
      path: "service.ts",
      label: "calc",
      start_line: 1,
      end_line: 6,
      inference: "calculate loop",
      root: wtA,
    });

    const beginB = await callTool(serverB, "waymark_begin", { question: "Agent B: formatting", root: wtB });
    const idB = String(beginB.id);
    await callTool(serverB, "waymark_note", {
      trajectory_id: idB,
      path: "service.ts",
      label: "fmt",
      start_line: 9,
      end_line: 11,
      inference: "format currency",
      root: wtB,
    });

    // Mutate service.ts inside Worktree A in a destructive way (breaking hop 1)
    fs.writeFileSync(path.join(wtA, "service.ts"), "export function broken() { return 0; }\n", "utf8");

    // Check Worktree A: must detect STALE
    const checkA = await callTool(serverA, "waymark_check", { root: wtA });
    assert.equal(checkA.status, "STALE", "Worktree A must detect that service.ts was altered");

    // Check Worktree B: service.ts in Worktree B was NOT modified; must remain STAGED and FRESH
    const checkB = await callTool(serverB, "waymark_check", { root: wtB });
    assert.equal(checkB.status, "STAGED", "Worktree B must remain unaffected by Worktree A edits");
    const hopsB = checkB.hops as Array<Record<string, unknown>>;
    assert.equal(hopsB[0]?.status, "FRESH");

    const resumeB = await callTool(serverB, "waymark_resume", { root: wtB });
    assert.equal(resumeB.status, "STAGED");
    assert.equal(resumeB.totalSteps, 1);
  } finally {
    cleanup();
  }
});

test("lifecycle independence: completion in Worktree A leaves Worktree B active trajectory intact", async () => {
  const { wtA, wtB, cleanup } = setupWorktreeFixture();
  try {
    const serverA = new McpServer();
    const serverB = new McpServer();

    await callTool(serverA, "waymark_init", { profile: "recording", root: wtA });
    await callTool(serverB, "waymark_init", { profile: "recording", root: wtB });

    const beginA = await callTool(serverA, "waymark_begin", { question: "Task A", root: wtA });
    const idA = String(beginA.id);
    await callTool(serverA, "waymark_note", {
      trajectory_id: idA,
      path: "service.ts",
      label: "noteA",
      start_line: 1,
      end_line: 6,
      inference: "A's finding",
      root: wtA,
    });

    const beginB = await callTool(serverB, "waymark_begin", { question: "Task B", root: wtB });
    const idB = String(beginB.id);
    await callTool(serverB, "waymark_note", {
      trajectory_id: idB,
      path: "service.ts",
      label: "noteB",
      start_line: 9,
      end_line: 11,
      inference: "B's finding",
      root: wtB,
    });

    // Agent A completes its trajectory
    const completeA = await callTool(serverA, "waymark_complete", {
      trajectory_id: idA,
      answer: "Agent A conclusively mapped calculation mechanics.",
      root: wtA,
    });
    assert.equal(completeA.ok, true);
    assert.equal(completeA.published, true);

    // Verify Worktree A is now NONE
    const statusA = await callTool(serverA, "waymark_status", { root: wtA });
    assert.equal(statusA.status, "NONE");
    assert.equal(statusA.trajectoryId, null);

    // Verify Worktree B is STILL STAGED with Agent B's active trajectory intact
    const statusB = await callTool(serverB, "waymark_status", { root: wtB });
    assert.equal(statusB.status, "STAGED");
    assert.equal(statusB.trajectoryId, idB);
    assert.equal(statusB.totalSteps, 1);

    // Agent B can continue recording hops in Worktree B
    const noteB2 = await callTool(serverB, "waymark_note", {
      trajectory_id: idB,
      path: "service.ts",
      label: "noteB2",
      start_line: 9,
      end_line: 9,
      inference: "Another finding by Agent B",
      root: wtB,
    });
    assert.equal(noteB2.ok, true);

    // Now Agent B abandons its trajectory
    const abandonB = await callTool(serverB, "waymark_abandon", {
      trajectory_id: idB,
      reason: "Agent B completed manual exploration",
      root: wtB,
    });
    assert.equal(abandonB.ok, true);

    const finalStatusB = await callTool(serverB, "waymark_status", { root: wtB });
    assert.equal(finalStatusB.status, "NONE");
  } finally {
    cleanup();
  }
});

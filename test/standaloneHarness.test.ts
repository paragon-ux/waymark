import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

interface CliResult {
  code: number;
  stdout: string;
  value: Record<string, unknown>;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "waymark-standalone-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "standalone-harness@example.com"]);
  git(root, ["config", "user.name", "Standalone Test Harness"]);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

function runCli(root: string, args: readonly string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      code: 0,
      stdout: stdout.trim(),
      value: JSON.parse(stdout.trim()) as Record<string, unknown>,
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    const stdout = failure.stdout?.trim() ?? "";
    let value: Record<string, unknown> = {};
    try {
      value = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      value = { rawError: stdout || failure.stderr || "Unknown failure" };
    }
    return {
      code: Number(failure.status ?? 1),
      stdout,
      value,
    };
  }
}

test("standalone CLI complete lifecycle: init -> begin -> notes -> check -> resume -> complete", () => {
  const root = makeRepo({
    "src/pipeline.ts": [
      "export function stepOne(): string {",
      "  return 'initialized';",
      "}",
      "",
      "export function stepTwo(input: string): string {",
      "  return input.toUpperCase();",
      "}",
      "",
    ].join("\n"),
    "src/utils.ts": [
      "export function sanitize(val: string): string {",
      "  return val.trim();",
      "}",
      "",
    ].join("\n"),
  });

  // 1. Init with standalone 'none' profile (zero external integrations)
  const initRes = runCli(root, ["init", "--profile", "none"]);
  assert.equal(initRes.code, 0);
  assert.equal(initRes.value.ok, true);
  assert.equal(initRes.value.profile, "none");

  // 2. Begin trajectory
  const beginRes = runCli(root, ["begin", "Verify standalone pipeline execution flow"]);
  assert.equal(beginRes.code, 0);
  assert.equal(beginRes.value.ok, true);
  const trajId = String(beginRes.value.id);
  assert.ok(trajId.length > 0);

  // 3. Status during active staged state
  const statusMid = runCli(root, ["status"]);
  assert.equal(statusMid.code, 0);
  assert.equal(statusMid.value.status, "STAGED");
  assert.equal(statusMid.value.trajectoryId, trajId);
  assert.equal(statusMid.value.totalSteps, 0);

  // 4. Record hops
  const note1 = runCli(root, [
    "note",
    trajId,
    "--path",
    "src/pipeline.ts",
    "--label",
    "stepOne-init",
    "--start",
    "1",
    "--end",
    "3",
    "--inference",
    "Initializes the pipeline pipeline context.",
  ]);
  assert.equal(note1.code, 0);
  assert.equal(note1.value.ok, true);
  assert.equal(note1.value.hopIndex, 0);

  const note2 = runCli(root, [
    "note",
    trajId,
    "--path",
    "src/pipeline.ts",
    "--label",
    "stepTwo-transform",
    "--start",
    "5",
    "--end",
    "7",
    "--inference",
    "Applies uppercase string transformation.",
  ]);
  assert.equal(note2.code, 0);
  assert.equal(note2.value.ok, true);
  assert.equal(note2.value.hopIndex, 1);

  const note3 = runCli(root, [
    "note",
    trajId,
    "--path",
    "src/utils.ts",
    "--label",
    "sanitize-helper",
    "--start",
    "1",
    "--end",
    "3",
    "--inference",
    "Sanitizes input strings by trimming whitespace.",
  ]);
  assert.equal(note3.code, 0);
  assert.equal(note3.value.ok, true);
  assert.equal(note3.value.hopIndex, 2);

  // 5. Check integrity
  const checkRes = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(checkRes.code, 0);
  assert.equal(checkRes.value.status, "STAGED");
  assert.equal(checkRes.value.verifiedThrough, 2);
  assert.equal(checkRes.value.totalSteps, 3);
  const hops = checkRes.value.hops as Array<Record<string, unknown>>;
  assert.equal(hops.length, 3);
  assert.equal(hops[0]?.status, "FRESH");
  assert.equal(hops[1]?.status, "FRESH");
  assert.equal(hops[2]?.status, "FRESH");

  // 6. Resume compact
  const resumeRes = runCli(root, ["resume", "--compact"]);
  assert.equal(resumeRes.code, 0);
  assert.equal(resumeRes.value.status, "STAGED");
  assert.equal(resumeRes.value.trajectoryId, trajId);
  assert.equal(resumeRes.value.verifiedThrough, 2);
  assert.equal(resumeRes.value.totalSteps, 3);
  assert.equal(resumeRes.value.nextAction, "continue-from-verified-hop");
  const resumeHops = resumeRes.value.hops as Array<Record<string, unknown>>;
  assert.equal(resumeHops.length, 3);

  // 7. Complete trajectory
  const completeRes = runCli(root, ["complete", trajId, "All three steps validated and verified standalone."]);
  assert.equal(completeRes.code, 0);
  assert.equal(completeRes.value.ok, true);
  assert.equal(completeRes.value.id, trajId);
  assert.equal(completeRes.value.adapter, "none");
  assert.equal(completeRes.value.published, false);

  // 8. Post-completion status should be NONE
  const statusAfter = runCli(root, ["status"]);
  assert.equal(statusAfter.code, 0);
  assert.equal(statusAfter.value.status, "NONE");
  assert.equal(statusAfter.value.trajectoryId, null);

  // 9. Post-completion resume should emit NONE packet
  const resumeAfter = runCli(root, ["resume", "--compact"]);
  assert.equal(resumeAfter.code, 0);
  assert.equal(resumeAfter.value.status, "NONE");
  assert.equal(resumeAfter.value.trajectoryId, "");
  assert.equal(resumeAfter.value.nextAction, "begin-trajectory");
});

test("standalone CLI abandonment lifecycle: init -> begin -> note -> abandon", () => {
  const root = makeRepo({
    "src/abandonMe.ts": "export const placeholder = true;\n",
  });
  runCli(root, ["init", "--profile", "none"]);
  const beginRes = runCli(root, ["begin", "Experimental dead-end investigation"]);
  assert.equal(beginRes.code, 0);
  const trajId = String(beginRes.value.id);

  const noteRes = runCli(root, [
    "note",
    trajId,
    "--path",
    "src/abandonMe.ts",
    "--label",
    "placeholder",
    "--start",
    "1",
    "--end",
    "1",
    "--inference",
    "Found to be unused or irrelevant.",
  ]);
  assert.equal(noteRes.code, 0);

  const abandonRes = runCli(root, ["abandon", trajId]);
  assert.equal(abandonRes.code, 0);
  assert.equal(abandonRes.value.ok, true);
  assert.equal(abandonRes.value.id, trajId);

  const statusRes = runCli(root, ["status"]);
  assert.equal(statusRes.code, 0);
  assert.equal(statusRes.value.status, "NONE");
  assert.equal(statusRes.value.trajectoryId, null);
});

test("crash resilience & lock recovery: dead owner detection and forced lock reclamation", () => {
  const root = makeRepo({
    "src/index.ts": "console.log('main');\n",
  });
  runCli(root, ["init", "--profile", "none"]);

  // Manually construct a dead lock directory to simulate an ungraceful crash (SIGKILL / power loss)
  const lockDir = path.join(root, ".waymark", "locks", "active");
  fs.mkdirSync(lockDir, { recursive: true });
  // Choose a PID that cannot be running (large number)
  const deadMetadata = {
    pid: 9999999,
    nodeVersion: process.version,
    startTime: new Date().toISOString(),
    cwd: root,
    token: "crashed-worker-token-0000",
  };
  fs.writeFileSync(path.join(lockDir, "metadata.json"), JSON.stringify(deadMetadata), "utf8");

  // Attempting to begin while lock exists fails with BUSY
  const busyAttempt = runCli(root, ["begin", "This should fail because lock is held"]);
  assert.notEqual(busyAttempt.code, 0);
  assert.equal(busyAttempt.value.code, "BUSY");

  // Non-forced recover-lock refuses to clear the lock
  const unforcedRecovery = runCli(root, ["recover-lock"]);
  assert.notEqual(unforcedRecovery.code, 0);
  assert.equal(unforcedRecovery.value.code, "LOCK_RECOVERY_REQUIRED");

  // Forced recover-lock inspects dead owner, reclaims lock safely
  const forcedRecovery = runCli(root, ["recover-lock", "--force"]);
  assert.equal(forcedRecovery.code, 0);
  assert.equal(forcedRecovery.value.ok, true);
  assert.equal(forcedRecovery.value.recovered, true);
  const prevOwner = forcedRecovery.value.previous as Record<string, unknown>;
  assert.equal(prevOwner.pid, 9999999);

  // Lock directory should now be cleared
  assert.equal(fs.existsSync(lockDir), false);

  // Subsequent CLI command acquires lock smoothly
  const succeedAttempt = runCli(root, ["begin", "Recovered from crash cleanly"]);
  assert.equal(succeedAttempt.code, 0);
  assert.equal(succeedAttempt.value.ok, true);
});

test("compact resume packet strictly respects 2048-byte budget and bounded tokens", () => {
  const lines: string[] = [];
  for (let i = 1; i <= 25; i += 1) {
    lines.push(`export const item${i} = ${i};`);
  }
  const root = makeRepo({
    "src/items.ts": lines.join("\n") + "\n",
  });
  runCli(root, ["init", "--profile", "none"]);
  const beginRes = runCli(root, ["begin", "Deep investigation with many progressive hops across item modules"]);
  const trajId = String(beginRes.value.id);

  // Record 15 hops to trigger packet truncation
  for (let i = 1; i <= 15; i += 1) {
    const res = runCli(root, [
      "note",
      trajId,
      "--path",
      "src/items.ts",
      "--label",
      `item-step-${i}`,
      "--start",
      String(i),
      "--end",
      String(i),
      "--inference",
      `Progressive hop ${i} tracing structural dependency through module chain.`,
    ]);
    assert.equal(res.code, 0);
  }

  const resumeRes = runCli(root, ["resume", "--compact"]);
  assert.equal(resumeRes.code, 0);
  assert.equal(resumeRes.value.status, "STAGED");
  assert.equal(resumeRes.value.totalSteps, 15);
  assert.equal(resumeRes.value.verifiedThrough, 14);

  // Verify byte length budget: <= 2048 bytes (strict Waymark architectural contract)
  const byteLength = Buffer.byteLength(resumeRes.stdout, "utf8");
  assert.ok(byteLength <= 2048, `Truncated resume packet bytes (${byteLength}) must be <= 2048`);

  // Verify truncation flag and retention of latest verified hop
  assert.equal(resumeRes.value.truncated, true);
  const hops = resumeRes.value.hops as Array<Record<string, unknown>>;
  assert.ok(hops.length <= 8, `Truncated hops length (${hops.length}) must be <= 8`);
  assert.equal(hops.at(-1)?.index, 14, "Newest verified hop index must be preserved");

  // Verify token ceiling for full 8-hop packet
  const approxTokens = Math.ceil(resumeRes.stdout.length / 3.8);
  assert.ok(approxTokens <= 550, `8-hop packet tokens (${approxTokens}) must be <= 550`);

  // Now verify standard 3-hop trajectory token budget is strictly < 250 tokens
  const standardRoot = makeRepo({
    "src/standard.ts": "const a = 1;\nconst b = 2;\nconst c = 3;\n",
  });
  runCli(standardRoot, ["init", "--profile", "none"]);
  const stdBegin = runCli(standardRoot, ["begin", "Standard active trajectory investigation"]);
  const stdId = String(stdBegin.value.id);
  runCli(standardRoot, ["note", stdId, "--path", "src/standard.ts", "--label", "hop1", "--start", "1", "--end", "1", "--inference", "Hop 1"]);
  runCli(standardRoot, ["note", stdId, "--path", "src/standard.ts", "--label", "hop2", "--start", "2", "--end", "2", "--inference", "Hop 2"]);
  runCli(standardRoot, ["note", stdId, "--path", "src/standard.ts", "--label", "hop3", "--start", "3", "--end", "3", "--inference", "Hop 3"]);
  const stdResume = runCli(standardRoot, ["resume", "--compact"]);
  assert.equal(stdResume.code, 0);
  const stdTokens = Math.ceil(stdResume.stdout.length / 3.8);
  assert.ok(stdTokens < 250, `Standard trajectory tokens (${stdTokens}) must be < 250`);
});

test("tamper and drift detection: span modification quarantines trajectory to STALE", () => {
  const root = makeRepo({
    "src/service.ts": [
      "export function calculate() {",
      "  return 42;",
      "}",
    ].join("\n") + "\n",
  });
  runCli(root, ["init", "--profile", "none"]);
  const beginRes = runCli(root, ["begin", "Investigating calculate method"]);
  const trajId = String(beginRes.value.id);

  runCli(root, [
    "note",
    trajId,
    "--path",
    "src/service.ts",
    "--label",
    "calc",
    "--start",
    "1",
    "--end",
    "3",
    "--inference",
    "Return value was 42.",
  ]);

  // Tamper with the code directly inside the recorded span
  fs.writeFileSync(path.join(root, "src/service.ts"), "export function calculate() {\n  return 999;\n}\n", "utf8");

  // check should return exit code 2 and STALE status
  const checkRes = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(checkRes.code, 2);
  assert.equal(checkRes.value.status, "STALE");

  // resume should return exit code 2, status STALE, and nextAction reverify
  const resumeRes = runCli(root, ["resume", "--compact"]);
  assert.equal(resumeRes.code, 2);
  assert.equal(resumeRes.value.status, "STALE");
  assert.equal(resumeRes.value.nextAction, "reverify-stale-hop");
});

test("cross-branch provenance detection: git checkout quarantines trajectory to CROSS_BRANCH", () => {
  const root = makeRepo({
    "src/feature.ts": "export const flag = true;\n",
  });
  runCli(root, ["init", "--profile", "none"]);
  const beginRes = runCli(root, ["begin", "Branch provenance check"]);
  const trajId = String(beginRes.value.id);

  runCli(root, [
    "note",
    trajId,
    "--path",
    "src/feature.ts",
    "--label",
    "flag",
    "--start",
    "1",
    "--end",
    "1",
    "--inference",
    "Recorded on main branch.",
  ]);

  // Switch git branch to a new unmerged branch
  git(root, ["checkout", "-b", "feature-diverged"]);

  // check should detect provenance change and exit code 2
  const checkRes = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(checkRes.code, 2);
  assert.equal(checkRes.value.status, "CROSS_BRANCH");
  assert.equal(checkRes.value.provenanceChanged, true);

  // resume should return exit code 2 and CROSS_BRANCH status
  const resumeRes = runCli(root, ["resume", "--compact"]);
  assert.equal(resumeRes.code, 2);
  assert.equal(resumeRes.value.status, "CROSS_BRANCH");
  assert.equal(resumeRes.value.nextAction, "confirm-branch-or-restart");
});

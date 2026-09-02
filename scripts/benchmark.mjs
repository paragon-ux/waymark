import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  initWorkspace,
  loadActiveTrajectory,
  createStartedEvent,
  createHopEvent,
  appendEvent,
  readConfig,
  replayTrajectory,
  writePointerForState,
} from "../dist/src/journal.js";
import { anchorForRange, normalizeRelativePath, repositoryProvenance, repoRoot } from "../dist/src/paths.js";
import { checkTrajectory } from "../dist/src/integrity.js";
import { serializeResume } from "../dist/src/resumeSerializer.js";

function setupBenchmarkRepo() {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-benchmark-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Benchmark Agent"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "benchmark@example.com"], { cwd: tempDir, windowsHide: true, stdio: "ignore" });
  return tempDir;
}

function cleanupRepo(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

const BENCHMARK_TASKS = [
  {
    question: "How does Waymark verify file-and-line spans and handle relocated code?",
    files: [
      { path: "src/paths.ts", start: 130, end: 171, label: "normalize-span", inference: "Normalizes line endings and trims whitespace to compute stable span hashes." },
      { path: "src/integrity.ts", start: 68, end: 110, label: "relocation-scan", inference: "Performs sliding window scan to detect exact relocated code blocks." },
      { path: "src/integrity.ts", start: 112, end: 144, label: "branch-drift", inference: "Compares current Git provenance to block cross-branch contamination." },
    ],
  },
  {
    question: "How does Waymark implement crash-safe atomic journal logging and locking?",
    files: [
      { path: "src/lock.ts", start: 46, end: 92, label: "acquire-lock", inference: "Uses atomic mkdir and owner metadata file for mutual exclusion." },
      { path: "src/lock.ts", start: 94, end: 142, label: "recover-lock", inference: "Verifies PID liveness before forced lock reclamation." },
      { path: "src/journal.ts", start: 359, end: 374, label: "append-event", inference: "Appends validated NDJSON events with fsync and directory sync." },
    ],
  },
  {
    question: "How does the MCP server handle tool routing, errors, and JSON-RPC dispatch?",
    files: [
      { path: "src/mcp/types.ts", start: 1, end: 45, label: "json-rpc-types", inference: "Defines standard JSON-RPC 2.0 and MCP tool definition schemas." },
      { path: "src/mcp/server.ts", start: 30, end: 120, label: "dispatch-loop", inference: "Routes initialize, tools/list, and tools/call over stdio transport." },
      { path: "src/mcp/waymarkTools.ts", start: 70, end: 180, label: "tool-handlers", inference: "Wraps core journal and integrity checks into structured MCP tool calls." },
    ],
  },
  {
    question: "How does the Capn adapter format positional arguments and batch escaping on Windows?",
    files: [
      { path: "src/capnAdapter.ts", start: 27, end: 43, label: "batch-escaping", inference: "Quotes batch arguments and rejects percent signs on cmd.exe." },
      { path: "src/capnAdapter.ts", start: 65, end: 77, label: "chart-args", inference: "Constructs positional chart question and answer args with unique files." },
      { path: "src/capnAdapter.ts", start: 100, end: 145, label: "ask-query", inference: "Executes capn ask subprocess and parses hit/miss responses." },
    ],
  },
  {
    question: "How does the resume serializer enforce the 2,048-byte limit across compactions?",
    files: [
      { path: "src/resumeSerializer.ts", start: 28, end: 55, label: "truncate-utf8", inference: "Safely truncates strings on UTF-8 character boundaries." },
      { path: "src/resumeSerializer.ts", start: 105, end: 135, label: "serialize-resume", inference: "Prunes oldest hops until the entire packet fits under 2,048 bytes." },
      { path: "src/stableStringify.ts", start: 1, end: 40, label: "stable-json", inference: "Ensures deterministic key order for canonical resume output." },
    ],
  },
  {
    question: "How does path validation reject directory traversal and symlink escapes?",
    files: [
      { path: "src/paths.ts", start: 30, end: 52, label: "normalize-path", inference: "Rejects absolute paths and backslash escapes to keep paths repository-relative." },
      { path: "src/paths.ts", start: 85, end: 115, label: "safe-store", inference: "Ensures .waymark storage is inside the repository root and not symlinked." },
      { path: "src/journal.ts", start: 27, end: 40, label: "not-symlink", inference: "Validates lstat to reject symlinked trajectory and active pointer files." },
    ],
  },
];

function runBenchmark() {
  const realRepo = repoRoot(process.cwd());
  const results = [];

  for (let i = 0; i < BENCHMARK_TASKS.length; i++) {
    const task = BENCHMARK_TASKS[i];
    const repo = setupBenchmarkRepo();
    try {
      // Copy needed files into benchmark repo
      for (const item of task.files) {
        const fullSource = path.join(realRepo, item.path);
        const fullDest = path.join(repo, item.path);
        fs.mkdirSync(path.dirname(fullDest), { recursive: true });
        fs.copyFileSync(fullSource, fullDest);
        execFileSync("git", ["add", item.path], { cwd: repo, windowsHide: true, stdio: "ignore" });
      }
      execFileSync("git", ["commit", "-m", `Add files for task ${i}`], { cwd: repo, windowsHide: true, stdio: "ignore" });

      // 1. Arm A: Cold Exploration Cost (reading full files to re-discover hops)
      let coldBytes = 0;
      for (const item of task.files) {
        const fileContent = fs.readFileSync(path.join(repo, item.path), "utf8");
        coldBytes += Buffer.byteLength(fileContent, "utf8");
      }
      // Estimated tokens: 1 token approx 3.8 bytes of code
      const coldTokens = Math.ceil(coldBytes / 3.8);

      // 2. Arm C: Indexed / Graph Retrieval Cost (re-querying CBM/QMD for candidate snippets)
      let indexedBytes = 0;
      for (const item of task.files) {
        const fileContent = fs.readFileSync(path.join(repo, item.path), "utf8");
        const lines = fileContent.split(/\r?\n/);
        const snippet = lines.slice(Math.max(0, item.start - 1), item.end).join("\n");
        // AST snippet chunk + JSON-RPC envelope and symbol metadata (~280 bytes overhead per hop)
        indexedBytes += Buffer.byteLength(snippet, "utf8") + 280;
      }
      const indexedTokens = Math.ceil(indexedBytes / 3.8);

      // 3. Arm B: Waymark In-Flight Continuity
      const config = initWorkspace(repo, "recording");
      const id = crypto.randomUUID();
      const provenance = repositoryProvenance(repo);
      const startEv = createStartedEvent(id, config.profile, task.question, provenance);
      appendEvent(repo, startEv);

      let hopIndex = 0;
      for (const item of task.files) {
        const state = replayTrajectory(repo, id);
        const range = { start: item.start, end: item.end };
        const anchor = anchorForRange(repo, item.path, range);
        const hop = {
          index: hopIndex++,
          path: item.path,
          label: item.label,
          inference: item.inference,
          range,
          fileSha256: anchor.fileSha256,
          normalizedSpanHash: anchor.normalizedSpanHash,
          normalizedSpanLen: anchor.normalizedSpanLen,
          spanLineCount: anchor.spanLineCount,
          structuralSignature: anchor.structuralSignature,
        };
        const hopEv = createHopEvent(state, hop);
        appendEvent(repo, hopEv);
      }
      const finalState = replayTrajectory(repo, id);
      writePointerForState(repo, finalState);

      // Simulate Context Compaction -> Resume Call
      const checked = checkTrajectory(repo, finalState, config.maxRelocationWindows);
      const resume = serializeResume({
        trajectoryId: id,
        status: checked.status,
        question: task.question,
        verifiedThrough: checked.verifiedThrough,
        totalSteps: checked.totalSteps,
        hops: checked.hops.map((h) => {
          const stored = finalState.hops.find((c) => c.index === h.index);
          return { index: stored.index, path: stored.path, label: stored.label, inference: stored.inference, status: h.status === "MOVED" ? "MOVED" : "FRESH" };
        }),
        nextAction: "continue-from-verified-hop",
        staleReasons: checked.staleReasons,
      });

      const waymarkBytes = resume.bytes;
      const waymarkTokens = Math.ceil(waymarkBytes / 3.8);
      const coldSavingsPct = Number((((coldTokens - waymarkTokens) / coldTokens) * 100).toFixed(1));
      const indexedSavingsPct = Number((((indexedTokens - waymarkTokens) / indexedTokens) * 100).toFixed(1));
      const accuracy = checked.verifiedThrough === task.files.length - 1 ? 100 : 0;

      results.push({
        task: task.question,
        hops: task.files.length,
        coldBytes,
        coldTokens,
        indexedBytes,
        indexedTokens,
        waymarkBytes,
        waymarkTokens,
        coldSavingsPct,
        indexedSavingsPct,
        accuracy,
      });
    } finally {
      cleanupRepo(repo);
    }
  }

  const totalColdTokens = results.reduce((sum, r) => sum + r.coldTokens, 0);
  const totalIndexedTokens = results.reduce((sum, r) => sum + r.indexedTokens, 0);
  const totalWaymarkTokens = results.reduce((sum, r) => sum + r.waymarkTokens, 0);
  const avgColdSavingsPct = Number((((totalColdTokens - totalWaymarkTokens) / totalColdTokens) * 100).toFixed(1));
  const avgIndexedSavingsPct = Number((((totalIndexedTokens - totalWaymarkTokens) / totalIndexedTokens) * 100).toFixed(1));
  const avgWaymarkBytes = Math.round(results.reduce((sum, r) => sum + r.waymarkBytes, 0) / results.length);
  const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length;

  const benchmarkReport = {
    waymark: 1,
    kind: "benchmark-report",
    totalTasks: results.length,
    totalColdTokens,
    totalIndexedTokens,
    totalWaymarkTokens,
    avgColdSavingsPct,
    avgIndexedSavingsPct,
    avgWaymarkBytes,
    avgAccuracy,
    tasks: results,
  };

  console.log(JSON.stringify(benchmarkReport, null, 2));
}

runBenchmark();

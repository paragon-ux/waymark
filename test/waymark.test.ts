import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Ajv as AjvClass } from "ajv";
import addFormatsPlugin from "ajv-formats";
import { acquireLock, recoverLock } from "../src/lock.js";
import { initWorkspace, loadActiveTrajectory, readJournalEvents, replayTrajectory, trajectoryPath } from "../src/journal.js";
import { serializeResume } from "../src/resumeSerializer.js";
import { stableStringify } from "../src/stableStringify.js";
import { ask as capnAsk, capnChartArgs, publish as capnPublish } from "../src/capnAdapter.js";
import { checkTrajectory } from "../src/integrity.js";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
const addFormats = addFormatsPlugin as unknown as (ajv: AjvClass) => AjvClass;

interface CliResult {
  code: number;
  value: Record<string, unknown>;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "waymark-test-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Waymark Tests"]);
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
    const stdout = execFileSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8", windowsHide: true });
    return { code: 0, value: JSON.parse(stdout.trim()) as Record<string, unknown> };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { code: Number(failure.status ?? 1), value: JSON.parse((failure.stdout ?? "{}").trim()) as Record<string, unknown> };
  }
}

function initialize(root: string): void {
  assert.equal(runCli(root, ["init", "--profile", "recording"]).code, 0);
}

function begin(root: string, question = "How does this fixture flow?"): string {
  const result = runCli(root, ["begin", question]);
  assert.equal(result.code, 0);
  assert.equal(result.value.ok, true);
  assert.equal(typeof result.value.id, "string");
  return String(result.value.id);
}

function note(root: string, id: string, start: number, end: number): CliResult {
  return runCli(root, [
    "note",
    id,
    "--path",
    "src/flow.ts",
    "--label",
    "flow",
    "--start",
    String(start),
    "--end",
    String(end),
    "--inference",
    "This hop connects the active flow to the next layer.",
  ]);
}

test("stable stringify is deterministic, ordered, and rejects unsupported values", () => {
  const value = { z: 1, a: { status: "FRESH", index: 0 }, hops: [{ status: "FRESH", index: 0 }] };
  assert.equal(stableStringify(value, { top: ["hops", "a", "z"], arrayObject: ["index", "status"] }), '{"hops":[{"index":0,"status":"FRESH"}],"a":{"index":0,"status":"FRESH"},"z":1}');
  assert.throws(() => stableStringify({ bad: undefined }), /unsupported value/);
  assert.throws(() => stableStringify({ bad: BigInt(1) }), /unsupported value/);
});

test("resume serializer rejects noncanonical active input instead of emitting invalid JSON", () => {
  assert.throws(() => serializeResume({
    trajectoryId: crypto.randomUUID(),
    status: "STAGED",
    question: "",
    verifiedThrough: -1,
    totalSteps: 0,
    hops: [],
    nextAction: "record-first-hop",
    staleReasons: [],
  }), /question/iu);
});

test("Capn publication uses the public positional question/answer argv contract", () => {
  assert.deepEqual(capnChartArgs("question", "answer", ["src/z.ts", "src/a.ts", "src/a.ts"]), ["chart", "question", "answer", "--files", "src/a.ts", "--files", "src/z.ts"]);
  assert.throws(() => capnChartArgs("question", "answer", ["src/a,b.ts"]), /comma/iu);
});

test("Capn ask recognizes the public miss response", async () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const executable = process.platform === "win32"
    ? path.join(projectRoot, "test", "fake-capn-miss.cmd")
    : path.join(root, "fake-capn-miss.mjs");
  if (process.platform !== "win32") {
    fs.copyFileSync(path.join(projectRoot, "test", "fake-capn-miss.mjs"), executable);
    fs.chmodSync(executable, 0o755);
  }
  const result = await capnAsk(root, "capn-cli", executable, "question");
  assert.equal(result.status, "miss");
});

test("capn-cli adapter executes an available command without shell interpolation", { skip: process.platform !== "win32" }, async () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = await capnPublish(root, "capn-cli", path.join(projectRoot, "test", "fake-capn.cmd"), "question", "answer", ["src/flow.ts"], "trajectory-test");
  assert.equal(result.published, true, result.error);
  assert.match(result.output, /chart question answer --files src\/flow\.ts/u);
});

test("Windows batch Capn publication fails closed for command-interpreter percent expansion", { skip: process.platform !== "win32" }, async () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = await capnPublish(root, "capn-cli", path.join(projectRoot, "test", "fake-capn.cmd"), "100%PATH%", "answer", ["src/flow.ts"], "trajectory-test");
  assert.equal(result.published, false);
  assert.match(result.error ?? "", /CAPN_UNSAFE_ARGUMENT/iu);
});

test("resume serialization preserves the newest verified hop and the caller input", () => {
  const hops = Array.from({ length: 20 }, (_, index) => ({
    index,
    path: `src/layer-${index}.ts`,
    label: `Layer ${index}`,
    inference: "A verified architectural relationship discovered during the investigation.",
    status: "FRESH" as const,
  }));
  const input = {
    trajectoryId: crypto.randomUUID(),
    status: "STAGED" as const,
    question: "Q".repeat(240),
    verifiedThrough: 19,
    totalSteps: 20,
    hops,
    nextAction: "continue-from-verified-hop",
    staleReasons: [],
  };
  const before = JSON.parse(JSON.stringify(input)) as typeof input;
  const result = serializeResume(input);
  assert.ok(result.bytes <= 2048);
  assert.equal(result.packet.hops.length <= 8, true);
  assert.equal(result.packet.hops.at(-1)?.index, 19);
  assert.equal(result.packet.truncated, true);
  assert.deepEqual(input, before);
  assert.deepEqual(JSON.parse(result.json), result.packet);
});

test("resume serializer emits a valid bounded NONE packet", () => {
  const result = serializeResume({
    trajectoryId: "",
    status: "NONE",
    question: "",
    verifiedThrough: -1,
    totalSteps: 0,
    hops: [],
    nextAction: "begin-trajectory",
    staleReasons: [],
  });
  assert.equal(result.bytes <= 2048, true);
  assert.equal(result.packet.status, "NONE");
  assert.equal(result.packet.trajectoryId, "");
});

test("an empty staged trajectory can resume with a first-hop action", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root, "Start a new investigation");
  const result = runCli(root, ["resume", "--compact"]);
  assert.equal(result.code, 0);
  assert.equal(result.value.status, "STAGED");
  assert.equal(result.value.trajectoryId, id);
  assert.equal(result.value.verifiedThrough, -1);
  assert.equal(result.value.totalSteps, 0);
  assert.equal(result.value.nextAction, "record-first-hop");
});

test("CLI records a trajectory and detects a uniquely relocated span", () => {
  const root = makeRepo({ "src/flow.ts": "export function route() {\n  return service();\n}\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 3).code, 0);
  const initial = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(initial.code, 0);
  assert.equal(initial.value.status, "STAGED");
  fs.writeFileSync(path.join(root, "src/flow.ts"), "// inserted above the hop\nexport function route() {\n  return service();\n}\n", "utf8");
  const moved = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(moved.code, 0);
  const hops = moved.value.hops as Array<Record<string, unknown>>;
  assert.equal(hops[0]?.status, "MOVED");
  const packet = runCli(root, ["resume", "--compact"]);
  assert.equal(packet.code, 0);
  assert.equal(packet.value.status, "STAGED");
  assert.equal((packet.value.hops as Array<Record<string, unknown>>)[0]?.status, "MOVED");
});

test("unrelated edits remain fresh while edits inside a span quarantine the trajectory", () => {
  const root = makeRepo({ "src/flow.ts": "export function route() {\n  return service();\n}\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 3).code, 0);
  fs.appendFileSync(path.join(root, "src/flow.ts"), "\n// unrelated trailing note\n", "utf8");
  const unrelated = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(unrelated.code, 0);
  assert.equal((unrelated.value.hops as Array<Record<string, unknown>>)[0]?.status, "FRESH");

  const root2 = makeRepo({ "src/flow.ts": "export function route() {\n  return service();\n}\n" });
  initialize(root2);
  const id2 = begin(root2);
  assert.equal(note(root2, id2, 1, 3).code, 0);
  fs.writeFileSync(path.join(root2, "src/flow.ts"), "export function route() {\n  return changed();\n}\n", "utf8");
  const stale = runCli(root2, ["check", "--active", "--porcelain"]);
  assert.equal(stale.code, 2);
  assert.equal(stale.value.status, "STALE");
  const resume = runCli(root2, ["resume", "--compact"]);
  assert.equal(resume.code, 2);
  assert.equal(resume.value.status, "STALE");
  assert.deepEqual(resume.value.hops, []);
});

test("a stale trajectory resume retains only its verified prefix", () => {
  const root = makeRepo({ "src/flow.ts": "first();\nstable();\nsecond();\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 1).code, 0);
  assert.equal(note(root, id, 3, 3).code, 0);
  fs.writeFileSync(path.join(root, "src/flow.ts"), "first();\nstable();\nchanged();\n", "utf8");
  const check = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(check.code, 2);
  assert.equal(check.value.status, "STALE");
  const packet = runCli(root, ["resume", "--compact"]);
  assert.equal(packet.code, 2);
  assert.equal(packet.value.status, "STALE");
  assert.deepEqual(packet.value.hops, [{ index: 0, path: "src/flow.ts", label: "flow", inference: "This hop connects the active flow to the next layer.", status: "FRESH" }]);
  assert.equal(packet.value.verifiedThrough, 0);
});

test("a valid NONE pointer is reconciled from an unfinished journal", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  fs.writeFileSync(path.join(root, ".waymark", "active.json"), `${JSON.stringify({ waymark: 1, status: "NONE", updatedAt: new Date().toISOString() })}\n`, "utf8");
  const status = runCli(root, ["status", "--porcelain"]);
  assert.equal(status.code, 0);
  assert.equal(status.value.status, "STAGED");
  assert.equal(status.value.trajectoryId, id);
});

test("a bounded relocation scan never claims uniqueness from a partial sample", () => {
  const root = makeRepo({ "src/flow.ts": "target();\nother();\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 1).code, 0);
  fs.writeFileSync(path.join(root, "src/flow.ts"), "other();\ntarget();\n", "utf8");
  const state = loadActiveTrajectory(root);
  assert.ok(state);
  const report = checkTrajectory(root, state, 1);
  assert.equal(report.status, "STALE");
  assert.match(report.staleReasons.join(" "), /scan limited/iu);
});

test("branch changes are reported as CROSS_BRANCH even when anchors remain exact", () => {
  const root = makeRepo({ "src/flow.ts": "export function route() {\n  return service();\n}\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 3).code, 0);
  git(root, ["switch", "-c", "alternate", "--quiet"]);
  const result = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(result.code, 2);
  assert.equal(result.value.status, "CROSS_BRANCH");
  assert.equal(runCli(root, ["resume", "--compact"]).code, 2);
});

test("cross-branch provenance takes precedence over a simultaneous stale hop", () => {
  const root = makeRepo({ "src/flow.ts": "first();\nsecond();\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 1).code, 0);
  fs.writeFileSync(path.join(root, "src/flow.ts"), "changed();\nsecond();\n", "utf8");
  git(root, ["switch", "-c", "alternate", "--quiet"]);
  const result = runCli(root, ["check", "--active", "--porcelain"]);
  assert.equal(result.code, 2);
  assert.equal(result.value.status, "CROSS_BRANCH");
  const hops = result.value.hops as Array<Record<string, unknown>>;
  assert.equal(hops[0]?.status, "STALE");
  const events = runCli(root, ["dump-trajectory", id]);
  const eventTypes = (events.value.events as Array<Record<string, unknown>>).map((event) => event.type);
  assert.equal(eventTypes.includes("trajectory.stale"), false);
});

test("path traversal is rejected before a hop is written", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  const result = runCli(root, ["note", id, "--path", "../secret.ts", "--label", "x", "--start", "1", "--end", "1", "--inference", "bad"]);
  assert.equal(result.code, 1);
  assert.equal(result.value.code, "INVALID_PATH");
});

test("Waymark refuses a symlinked storage root", (t) => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "waymark-outside-"));
  const storage = path.join(root, ".waymark");
  try {
    fs.symlinkSync(outside, storage, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      t.skip("symlink creation is unavailable on this host");
      return;
    }
    throw error;
  }
  assert.throws(() => initWorkspace(root, "recording"), /storage/iu);
});

test("hook suppression is a no-write, machine-readable no-op", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  const result = execFileSync(process.execPath, [cliPath, "begin", "must not begin"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, WAYMARK_HOOK_DISABLED: "1" },
  });
  const parsed = JSON.parse(result.trim()) as Record<string, unknown>;
  assert.equal(parsed.kind, "suppressed");
  assert.equal(fs.existsSync(path.join(root, ".waymark")), false);
});

test("journal recovery truncates a torn final line and preserves forensic bytes", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  fs.appendFileSync(trajectoryPath(root, id), "{\"torn\":", "utf8");
  const lock = acquireLock(root);
  try {
    const events = readJournalEvents(root, id);
    assert.equal(events.length, 1);
  } finally {
    lock.release();
  }
  const forensic = fs.readdirSync(path.join(root, ".waymark", "trajectories")).filter((name) => name.includes(".torn-"));
  assert.equal(forensic.length, 1);
  assert.equal(fs.readFileSync(trajectoryPath(root, id), "utf8").endsWith("\n"), true);
});

test("mkdir locking returns BUSY and force recovery reclaims a dead owner", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initWorkspace(root, "recording");
  const lock = acquireLock(root);
  assert.throws(() => acquireLock(root), /lock/iu);
  lock.release();
  const lockDir = path.join(root, ".waymark", "locks", "active");
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, "metadata.json"), JSON.stringify({ pid: 99999999, nodeVersion: "test", startTime: new Date().toISOString(), cwd: root, token: "dead" }));
  const recovered = recoverLock(root, true);
  assert.equal(recovered.recovered, true);
});

test("forced lock recovery leaves a changed lock owner untouched", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initWorkspace(root, "recording");
  const lockDir = path.join(root, ".waymark", "locks", "active");
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, "metadata.json"), JSON.stringify({ pid: 99999999, nodeVersion: "test", startTime: new Date().toISOString(), cwd: root, token: "old-token" }));
  const renamed = path.join(root, ".waymark", "locks", "active.reclaim-test");
  fs.renameSync(lockDir, renamed);
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, "metadata.json"), JSON.stringify({ pid: process.pid, nodeVersion: "test", startTime: new Date().toISOString(), cwd: root, token: "new-token" }));
  fs.renameSync(renamed, path.join(root, ".waymark", "locks", "active.reclaim-old"));
  assert.throws(() => recoverLock(root, true), /still running|changed/iu);
  assert.equal(fs.existsSync(path.join(lockDir, "metadata.json")), true);
});

test("emitted resume packets conform to the corrected schema", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "resume.schema.json"), "utf8")) as object;
  const ajv = new AjvClass({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const result = serializeResume({
    trajectoryId: crypto.randomUUID(),
    status: "STALE",
    question: "A stale trajectory",
    verifiedThrough: 0,
    totalSteps: 2,
    hops: [{ index: 0, path: "src/flow.ts", label: "flow", inference: "verified", status: "FRESH" }],
    nextAction: "reverify-stale-hop",
    staleReasons: ["src/flow.ts: changed"],
  });
  assert.equal(validate(result.packet), true, JSON.stringify(validate.errors));
});

test("journal events conform to the corrected flat event schema", () => {
  const fixtureRoot = makeRepo({ "src/flow.ts": "export function route() {\n  return service();\n}\n" });
  initialize(fixtureRoot);
  const id = begin(fixtureRoot);
  assert.equal(note(fixtureRoot, id, 1, 3).code, 0);
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const schema = JSON.parse(fs.readFileSync(path.join(projectRoot, "schemas", "events.schema.json"), "utf8")) as object;
  const ajv = new AjvClass({ allErrors: true, strict: true });
  const addFormats = addFormatsPlugin as unknown as (instance: AjvClass) => AjvClass;
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const events = readJournalEvents(fixtureRoot, id);
  for (const event of events) {
    assert.equal(validate(event), true, JSON.stringify(validate.errors));
  }
  const hopEvent = events.find((event) => event.type === "hop.added");
  assert.ok(hopEvent && hopEvent.type === "hop.added");
  assert.equal(validate({ ...hopEvent, hop: { ...hopEvent.hop, path: "..\\secret" } }), false);
});

test("journal replay rejects unknown event fields and cross-trajectory IDs", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  const journal = trajectoryPath(root, id);
  const [line] = fs.readFileSync(journal, "utf8").trimEnd().split("\n");
  assert.ok(line);
  const started = JSON.parse(line) as Record<string, unknown>;
  started.unexpected = true;
  fs.writeFileSync(journal, `${JSON.stringify(started)}\n`, "utf8");
  assert.throws(() => readJournalEvents(root, id), /unknown field/iu);

  const secondRoot = makeRepo({ "src/flow.ts": "line\n" });
  initialize(secondRoot);
  const secondId = begin(secondRoot);
  const secondJournal = trajectoryPath(secondRoot, secondId);
  const secondLine = fs.readFileSync(secondJournal, "utf8").trimEnd();
  const secondStarted = JSON.parse(secondLine) as Record<string, unknown>;
  secondStarted.trajectoryId = crypto.randomUUID();
  fs.writeFileSync(secondJournal, `${JSON.stringify(secondStarted)}\n`, "utf8");
  assert.throws(() => readJournalEvents(secondRoot, secondId), /common fields/iu);
});

test("journal replay rejects a commit after abandonment", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  assert.equal(note(root, id, 1, 1).code, 0);
  const journal = trajectoryPath(root, id);
  const abandoned = { waymark: 1, type: "trajectory.abandoned", trajectoryId: id, sequence: 2, at: new Date().toISOString(), reason: "operator test" };
  const committed = { waymark: 1, type: "trajectory.committed", trajectoryId: id, sequence: 3, at: new Date().toISOString(), answer: "invalid" };
  fs.appendFileSync(journal, `${JSON.stringify(abandoned)}\n${JSON.stringify(committed)}\n`, "utf8");
  assert.throws(() => replayTrajectory(root, id), /staged trajectory|state transition/iu);
});

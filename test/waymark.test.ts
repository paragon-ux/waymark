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
import { initWorkspace, readJournalEvents, trajectoryPath } from "../src/journal.js";
import { serializeResume } from "../src/resumeSerializer.js";
import { stableStringify } from "../src/stableStringify.js";

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
  git(root, ["config", "user.email", "waymark@example.invalid"]);
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

test("path traversal is rejected before a hop is written", () => {
  const root = makeRepo({ "src/flow.ts": "line\n" });
  initialize(root);
  const id = begin(root);
  const result = runCli(root, ["note", id, "--path", "../secret.ts", "--label", "x", "--start", "1", "--end", "1", "--inference", "bad"]);
  assert.equal(result.code, 1);
  assert.equal(result.value.code, "INVALID_PATH");
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
  for (const event of readJournalEvents(fixtureRoot, id)) {
    assert.equal(validate(event), true, JSON.stringify(validate.errors));
  }
});

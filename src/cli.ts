#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  AdapterProfile,
  CheckReport,
  ResumeHop,
  ResumeStatus,
  TrajectoryState,
  WaymarkConfig,
  WaymarkError,
  WaymarkEvent,
} from "./types.js";
import { acquireLock, recoverLock } from "./lock.js";
import {
  appendEvent,
  atomicWriteFile,
  createHopEvent,
  createStartedEvent,
  initWorkspace,
  loadActiveTrajectory,
  makeEventBase,
  readConfig,
  readJournalEvents,
  replayTrajectory,
  trajectoryPath,
  writeConfig,
  writePointerForState,
} from "./journal.js";
import { anchorForRange, normalizeRelativePath, nowIso, repoRoot, repositoryProvenance } from "./paths.js";
import { checkTrajectory } from "./integrity.js";
import { serializeResume } from "./resumeSerializer.js";
import { ask as capnAsk, publish } from "./capnAdapter.js";

interface ParsedArgs {
  positionals: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

interface CommandResult {
  value: unknown;
  exitCode?: number;
}

const VALUE_FLAGS = new Set(["profile", "path", "label", "start", "end", "inference", "capn-executable"]);
const BOOLEAN_FLAGS = new Set(["active", "porcelain", "compact", "force", "apply"]);

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current?.startsWith("--")) {
      if (current !== undefined) positionals.push(current);
      continue;
    }
    const flag = current.slice(2);
    if (BOOLEAN_FLAGS.has(flag)) {
      flags.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new WaymarkError("UNKNOWN_OPTION", `Unknown option --${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new WaymarkError("MISSING_OPTION_VALUE", `Option --${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  return { positionals, values, flags };
}

function requiredValue(parsed: ParsedArgs, name: string): string {
  const value = parsed.values.get(name);
  if (!value) throw new WaymarkError("MISSING_ARGUMENT", `Missing --${name}`);
  return value;
}

function boundedText(value: string, maximum: number, label: string, allowEmpty = false): string {
  if ((!allowEmpty && value.length === 0) || Array.from(value).length > maximum) {
    throw new WaymarkError("TEXT_LIMIT", `${label} must contain ${allowEmpty ? "at most" : "1 to"} ${maximum} characters`);
  }
  return value;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorOutput(error: unknown): CommandResult {
  if (error instanceof WaymarkError) {
    return { value: { waymark: 1, kind: "error", ok: false, code: error.code, message: error.message }, exitCode: error.exitCode };
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return { value: { waymark: 1, kind: "error", ok: false, code: "UNEXPECTED_ERROR", message }, exitCode: 1 };
}

async function withLock<T>(root: string, callback: () => Promise<T> | T): Promise<T> {
  const lock = acquireLock(root);
  try {
    return await callback();
  } finally {
    lock.release();
  }
}

function noActiveReport(): CheckReport {
  return {
    waymark: 1,
    kind: "check",
    status: "NONE",
    trajectoryId: null,
    provenanceChanged: false,
    recordedRepository: null,
    currentRepository: null,
    verifiedThrough: -1,
    totalSteps: 0,
    hops: [],
    staleReasons: [],
  };
}

function applyStaleEvent(root: string, state: TrajectoryState, report: CheckReport): TrajectoryState {
  if (report.status !== "STALE" || state.status === "STALE") return state;
  const reason = report.staleReasons.join("; ").slice(0, 512) || "trajectory integrity check failed";
  const event: WaymarkEvent = { ...makeEventBase("trajectory.stale", state.id, state.events.length), type: "trajectory.stale", reason };
  appendEvent(root, event);
  const updated = replayTrajectory(root, state.id);
  writePointerForState(root, updated);
  return updated;
}

function checkedActive(root: string, config: WaymarkConfig): { state: TrajectoryState | null; report: CheckReport } {
  const state = loadActiveTrajectory(root);
  if (!state) return { state: null, report: noActiveReport() };
  const report = checkTrajectory(root, state, config.maxRelocationWindows);
  const updated = applyStaleEvent(root, state, report);
  if (updated.status === "STALE" && report.status !== "STALE") {
    return { state: updated, report: { ...report, status: "STALE", verifiedThrough: -1, hops: [], staleReasons: updated.staleReasons } };
  }
  if (updated !== state) return { state: updated, report };
  return { state, report };
}

function resumeFor(state: TrajectoryState | null, report: CheckReport): ReturnType<typeof serializeResume> {
  if (!state || report.status === "NONE") {
    return serializeResume({
      trajectoryId: "",
      status: "NONE",
      question: "",
      verifiedThrough: -1,
      totalSteps: 0,
      hops: [],
      nextAction: "begin-trajectory",
      staleReasons: [],
    });
  }
  const trusted: ResumeHop[] = report.hops
    .filter((hop) => hop.index <= report.verifiedThrough && (hop.status === "FRESH" || hop.status === "MOVED"))
    .map((hop) => {
      const stored = state.hops.find((candidate) => candidate.index === hop.index);
      if (!stored) throw new WaymarkError("STATE_MISMATCH", `Missing stored hop ${hop.index}`);
      return { index: stored.index, path: stored.path, label: stored.label, inference: stored.inference, status: hop.status === "MOVED" ? "MOVED" : "FRESH" };
    });
  const nextAction = report.status === "STALE" ? "reverify-stale-hop" : report.status === "CROSS_BRANCH" ? "confirm-branch-or-restart" : report.totalSteps === 0 ? "record-first-hop" : "continue-from-verified-hop";
  return serializeResume({
    trajectoryId: state.id,
    status: report.status,
    question: state.question,
    verifiedThrough: report.verifiedThrough,
    totalSteps: report.totalSteps,
    hops: trusted,
    nextAction,
    staleReasons: report.staleReasons,
  });
}

function statusCode(status: ResumeStatus): number {
  return status === "STALE" || status === "CROSS_BRANCH" ? 2 : 0;
}

function filesFor(state: TrajectoryState): string[] {
  return [...new Set(state.hops.map((hop) => hop.path))];
}

async function runCommand(command: string, rawArgs: readonly string[]): Promise<CommandResult> {
  const suppression = process.env.WAYMARK_HOOK_DISABLED === "1"
    ? "WAYMARK_HOOK_DISABLED"
    : process.env.WAYMARK_HOOK_DEPTH === "1"
      ? "WAYMARK_HOOK_DEPTH"
      : undefined;
  if (suppression) return { value: { waymark: 1, kind: "suppressed", ok: true, reason: suppression } };
  const parsed = parseArgs(rawArgs);
  const root = repoRoot();

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write([
      "Waymark continuity ledger",
      "  init --profile recording|capn-cli|none",
      "  begin <question>",
      "  note <id> --path <file> --label <label> --start <line> --end <line> --inference <text>",
      "  check --active --porcelain",
      "  resume --compact",
      "  context | ask <question> | complete <id> <answer>",
      "  abandon <id> | status --porcelain | recover-lock --force",
      "  dump-trajectory <id> | prune [--apply]",
    ].join("\n") + "\n");
    return { value: null };
  }

  if (command === "init") {
    const profile = (parsed.values.get("profile") ?? "recording") as AdapterProfile;
    if (!["recording", "capn-cli", "none"].includes(profile)) throw new WaymarkError("INVALID_PROFILE", `Unknown profile ${profile}`);
    const config = initWorkspace(root, profile);
    const configured: WaymarkConfig = {
      ...config,
      profile,
      capnExecutable: parsed.values.get("capn-executable") ?? config.capnExecutable,
    };
    writeConfig(root, configured);
    return { value: { waymark: 1, kind: "init", ok: true, profile: configured.profile, maxRelocationWindows: configured.maxRelocationWindows } };
  }

  if (command === "recover-lock") {
    const result = recoverLock(root, parsed.flags.has("force"));
    return { value: { waymark: 1, kind: "recover-lock", ok: true, ...result } };
  }

  const config = readConfig(root);

  if (command === "begin") {
    const question = boundedText(parsed.positionals.join(" "), 240, "question");
    return { value: await withLock(root, () => {
      if (loadActiveTrajectory(root)) throw new WaymarkError("ACTIVE_EXISTS", "An active trajectory already exists");
      const id = crypto.randomUUID();
      appendEvent(root, createStartedEvent(id, config.profile, question, repositoryProvenance(root)));
      const state = replayTrajectory(root, id);
      writePointerForState(root, state);
      return { waymark: 1, kind: "begin", ok: true, id, question, profile: config.profile };
    }) };
  }

  if (command === "note") {
    const id = parsed.positionals[0];
    if (!id) throw new WaymarkError("MISSING_ARGUMENT", "note requires a trajectory ID");
    const storedPath = normalizeRelativePath(requiredValue(parsed, "path"));
    const label = boundedText(requiredValue(parsed, "label"), 120, "label", true);
    const inference = boundedText(requiredValue(parsed, "inference"), 160, "inference");
    const start = Number(requiredValue(parsed, "start"));
    const end = Number(requiredValue(parsed, "end"));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new WaymarkError("INVALID_RANGE", "start/end must be a valid 1-based range");
    return { value: await withLock(root, () => {
      const state = loadActiveTrajectory(root);
      if (!state || state.id !== id) throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
      if (state.status !== "STAGED") throw new WaymarkError("TRAJECTORY_NOT_STAGED", "Only a staged trajectory can accept notes", 2);
      const current = repositoryProvenance(root);
      if (current.branch !== state.repository.branch || current.head !== state.repository.head) throw new WaymarkError("CROSS_BRANCH", "Repository provenance changed; start a new trajectory", 2);
      const anchor = anchorForRange(root, storedPath, { start, end });
      const hop = { index: state.hops.length, path: storedPath, label, inference, range: { start, end }, ...anchor };
      appendEvent(root, createHopEvent(state, hop));
      const updated = replayTrajectory(root, id);
      writePointerForState(root, updated);
      return { waymark: 1, kind: "note", ok: true, id, hopIndex: hop.index, path: storedPath };
    }) };
  }

  if (command === "check") {
    if (!parsed.flags.has("active")) throw new WaymarkError("MISSING_FLAG", "check requires --active");
    const report = await withLock(root, () => {
      const { report } = checkedActive(root, config);
      return report;
    });
    return { value: report, exitCode: statusCode(report.status) };
  }

  if (command === "resume" || command === "context") {
    if (command === "resume" && !parsed.flags.has("compact")) throw new WaymarkError("MISSING_FLAG", "resume requires --compact");
    const result = await withLock(root, () => {
      const checked = checkedActive(root, config);
      const result = resumeFor(checked.state, checked.report);
      if (command === "context") return { waymark: 1, kind: "context", packet: result.packet };
      return result.packet;
    });
    const packet = command === "context" ? (result as { packet: { status: ResumeStatus } }).packet : result as { status: ResumeStatus };
    return { value: result, exitCode: statusCode(packet.status) };
  }

  if (command === "status") {
    return { value: await withLock(root, () => {
      const state = loadActiveTrajectory(root);
      return state
        ? { waymark: 1, kind: "status", status: state.status, trajectoryId: state.id, question: state.question, totalSteps: state.hops.length, profile: state.profile, staleReasons: state.staleReasons }
        : { waymark: 1, kind: "status", status: "NONE", trajectoryId: null, totalSteps: 0 };
    }) };
  }

  if (command === "ask") {
    const question = boundedText(parsed.positionals.join(" "), 240, "question");
    return { value: await capnAsk(root, config.profile, config.capnExecutable, question) };
  }

  if (command === "complete") {
    const id = parsed.positionals[0];
    const answer = parsed.positionals.slice(1).join(" ");
    if (!id || !answer) throw new WaymarkError("MISSING_ARGUMENT", "complete requires an ID and answer");
    boundedText(answer, 4000, "answer");
    const completeResult = await withLock(root, async () => {
      let state = loadActiveTrajectory(root);
      if (!state || state.id !== id) throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
      const checked = checkedActive(root, config);
      state = checked.state;
      if (!state || checked.report.status !== "STAGED") throw new WaymarkError("NOT_SAFE_TO_COMPLETE", "Trajectory is stale or crosses repository provenance", 2);
      if (state.hops.length === 0) throw new WaymarkError("NO_HOPS", "Complete requires at least one recorded hop");
      appendEvent(root, { ...makeEventBase("trajectory.committed", id, state.events.length), type: "trajectory.committed", answer });
      state = replayTrajectory(root, id);
      writePointerForState(root, state);
      if (config.profile === "none") return { waymark: 1, kind: "complete", ok: true, id, published: false, adapter: "none" };
      appendEvent(root, { ...makeEventBase("publication.pending", id, state.events.length), type: "publication.pending", adapter: config.profile });
      const result = await publish(root, config.profile, config.capnExecutable, state.question, answer, filesFor(state), id);
      state = replayTrajectory(root, id);
      if (result.published) {
        appendEvent(root, { ...makeEventBase("publication.succeeded", id, state.events.length), type: "publication.succeeded", adapter: config.profile, adapterOutput: result.output.slice(0, 2000) });
        return { waymark: 1, kind: "complete", ok: true, id, published: true, adapter: config.profile, output: result.output };
      }
      appendEvent(root, { ...makeEventBase("publication.failed", id, state.events.length), type: "publication.failed", adapter: config.profile, reason: (result.error ?? "publication failed").slice(0, 2000) });
      return { waymark: 1, kind: "complete", ok: true, id, published: false, adapter: config.profile, publicationError: result.error ?? "publication failed" };
    });
    return { value: completeResult, exitCode: completeResult.published === false && config.profile === "capn-cli" ? 3 : 0 };
  }

  if (command === "abandon") {
    const id = parsed.positionals[0];
    if (!id) throw new WaymarkError("MISSING_ARGUMENT", "abandon requires a trajectory ID");
    return { value: await withLock(root, () => {
      const state = loadActiveTrajectory(root);
      if (!state || state.id !== id) throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
      appendEvent(root, { ...makeEventBase("trajectory.abandoned", id, state.events.length), type: "trajectory.abandoned", reason: "operator abandoned trajectory" });
      const updated = replayTrajectory(root, id);
      writePointerForState(root, updated);
      return { waymark: 1, kind: "abandon", ok: true, id };
    }) };
  }

  if (command === "dump-trajectory") {
    const id = parsed.positionals[0];
    if (!id) throw new WaymarkError("MISSING_ARGUMENT", "dump-trajectory requires an ID");
    return { value: await withLock(root, () => ({ waymark: 1, kind: "dump-trajectory", id, events: readJournalEvents(root, id) })) };
  }

  if (command === "prune") {
    return { value: await withLock(root, () => {
      const directory = path.join(root, ".waymark", "trajectories");
      const active = loadActiveTrajectory(root);
      const closed: string[] = [];
      if (fs.existsSync(directory)) {
        for (const file of fs.readdirSync(directory).filter((candidate) => candidate.endsWith(".ndjson"))) {
          const id = file.slice(0, -7);
          const state = replayTrajectory(root, id);
          if (state.status === "COMMITTED" || state.status === "ABANDONED") {
            if (!active || active.id !== id) closed.push(id);
          }
        }
      }
      const moved: string[] = [];
      if (parsed.flags.has("apply")) {
        const archive = path.join(root, ".waymark", "archive");
        fs.mkdirSync(archive, { recursive: true });
        for (const id of closed) {
          fs.renameSync(trajectoryPath(root, id), path.join(archive, `${id}.ndjson`));
          moved.push(id);
        }
      }
      return { waymark: 1, kind: "prune", ok: true, dryRun: !parsed.flags.has("apply"), candidates: closed, moved };
    }) };
  }

  throw new WaymarkError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const args = process.argv.slice(3);
  try {
    const result = await runCommand(command, args);
    if (result.value !== null) output(result.value);
    process.exitCode = result.exitCode ?? 0;
  } catch (error) {
    const result = errorOutput(error);
    output(result.value);
    process.exitCode = result.exitCode ?? 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

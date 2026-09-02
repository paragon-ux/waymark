import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import {
  ActivePointer,
  AdapterProfile,
  HopAddedEvent,
  HopRecord,
  RepositoryProvenance,
  TrajectoryState,
  WaymarkConfig,
  WaymarkError,
  WaymarkEvent,
} from "./types.js";
import { nowIso } from "./paths.js";

export const MAX_EVENT_BYTES = 16 * 1024;

const decoder = new TextDecoder("utf-8", { fatal: true });

function storePath(root: string): string {
  return path.join(root, ".waymark");
}

export function trajectoryPath(root: string, id: string): string {
  if (!/^[a-z0-9-]{8,80}$/u.test(id)) throw new WaymarkError("INVALID_ID", "Invalid trajectory ID");
  return path.join(storePath(root), "trajectories", `${id}.ndjson`);
}

function activePath(root: string): string {
  return path.join(storePath(root), "active.json");
}

function configPath(root: string): string {
  return path.join(storePath(root), "config.json");
}

function writeAll(fd: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    offset += fs.writeSync(fd, data, offset, data.length - offset);
  }
}

function syncDirectory(directory: string): void {
  try {
    const fd = fs.openSync(directory, process.platform === "win32" ? "r" : "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Windows does not consistently expose directory fsync. File fsync still applies.
  }
}

export function atomicWriteFile(target: string, data: string | Buffer): void {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx");
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EEXIST")) throw error;
      // NTFS may reject replacement of an existing file. The journal remains authoritative.
      const fallback = fs.openSync(target, "w");
      try {
        writeAll(fallback, bytes);
        fs.fsyncSync(fallback);
      } finally {
        fs.closeSync(fallback);
      }
      fs.unlinkSync(temporary);
    }
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function initWorkspace(root: string, profile: AdapterProfile): WaymarkConfig {
  const directory = storePath(root);
  for (const child of ["trajectories", "locks", "recordings", "archive"]) {
    fs.mkdirSync(path.join(directory, child), { recursive: true });
  }
  const config: WaymarkConfig = {
    waymark: 1,
    profile,
    capnExecutable: "capn",
    maxRelocationWindows: 2000,
  };
  if (!fs.existsSync(configPath(root))) atomicWriteFile(configPath(root), `${JSON.stringify(config)}\n`);
  if (!fs.existsSync(activePath(root))) atomicWriteFile(activePath(root), `${JSON.stringify({ waymark: 1, status: "NONE", updatedAt: nowIso() })}\n`);
  return readConfig(root);
}

export function readConfig(root: string): WaymarkConfig {
  try {
    const value = JSON.parse(fs.readFileSync(configPath(root), "utf8")) as Partial<WaymarkConfig>;
    if (value.waymark !== 1 || !["recording", "capn-cli", "none"].includes(value.profile ?? "")) throw new Error("invalid config");
    const capnExecutable = typeof value.capnExecutable === "string" && value.capnExecutable.length > 0 ? value.capnExecutable : "capn";
    const maxRelocationWindows = Number.isInteger(value.maxRelocationWindows) && (value.maxRelocationWindows ?? 0) > 0 ? (value.maxRelocationWindows as number) : 2000;
    return { waymark: 1, profile: value.profile as AdapterProfile, capnExecutable, maxRelocationWindows };
  } catch {
    throw new WaymarkError("NOT_INITIALIZED", "Run waymark init before using the project");
  }
}

export function writeConfig(root: string, config: WaymarkConfig): void {
  atomicWriteFile(configPath(root), `${JSON.stringify(config)}\n`);
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new WaymarkError("MALFORMED_EVENT", `Event field ${field} is invalid`);
  return value;
}

function validateEvent(value: unknown): WaymarkEvent {
  if (!isRecord(value) || value.waymark !== 1 || typeof value.type !== "string" || typeof value.trajectoryId !== "string" || !Number.isInteger(value.sequence) || typeof value.at !== "string") {
    throw new WaymarkError("MALFORMED_EVENT", "Event has invalid common fields");
  }
  const base = value as { type: string; trajectoryId: string; sequence: number; at: string };
  if (!/^\d{4}-\d\d-\d\dT/iu.test(base.at)) throw new WaymarkError("MALFORMED_EVENT", "Event timestamp is invalid");
  switch (base.type) {
    case "trajectory.started": {
      if (!isRecord(value.repository) || typeof value.question !== "string" || !["recording", "capn-cli", "none"].includes(value.profile as string)) throw new WaymarkError("MALFORMED_EVENT", "Invalid trajectory.started event");
      break;
    }
    case "hop.added": {
      if (!isRecord(value.hop) || !Number.isInteger(value.hop.index) || typeof value.hop.path !== "string") throw new WaymarkError("MALFORMED_EVENT", "Invalid hop.added event");
      break;
    }
    case "trajectory.stale":
    case "trajectory.abandoned":
      requiredString(value.reason, "reason");
      break;
    case "trajectory.committed":
      requiredString(value.answer, "answer");
      break;
    case "publication.pending":
      if (!["recording", "capn-cli", "none"].includes(value.adapter as string)) throw new WaymarkError("MALFORMED_EVENT", "Invalid publication adapter");
      break;
    case "publication.succeeded":
      if (!["recording", "capn-cli", "none"].includes(value.adapter as string) || typeof value.adapterOutput !== "string") throw new WaymarkError("MALFORMED_EVENT", "Invalid publication.succeeded event");
      break;
    case "publication.failed":
      if (!["recording", "capn-cli", "none"].includes(value.adapter as string) || typeof value.reason !== "string") throw new WaymarkError("MALFORMED_EVENT", "Invalid publication.failed event");
      break;
    default:
      throw new WaymarkError("MALFORMED_EVENT", `Unknown event type: ${base.type}`);
  }
  return value as unknown as WaymarkEvent;
}

function preserveTornBytes(root: string, id: string, bytes: Buffer): void {
  if (bytes.length === 0) return;
  const name = `torn-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.log`;
  const target = path.join(storePath(root), "trajectories", `${id}.${name}`);
  atomicWriteFile(target, bytes.subarray(0, MAX_EVENT_BYTES));
}

export function readJournalEvents(root: string, id: string): WaymarkEvent[] {
  const file = trajectoryPath(root, id);
  if (!fs.existsSync(file)) throw new WaymarkError("TRAJECTORY_MISSING", `Trajectory ${id} is missing`);
  const bytes = fs.readFileSync(file);
  const lastNewline = bytes.lastIndexOf(0x0a);
  const completeLength = lastNewline + 1;
  const trailing = bytes.subarray(completeLength);
  if (trailing.length > 0) {
    preserveTornBytes(root, id, trailing);
    fs.truncateSync(file, completeLength);
  }
  let text: string;
  try {
    text = decoder.decode(bytes.subarray(0, completeLength));
  } catch {
    throw new WaymarkError("TORN_JOURNAL", "Journal contains invalid UTF-8");
  }
  const events: WaymarkEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new WaymarkError("MALFORMED_EVENT", "Journal contains invalid JSON before its final boundary");
    }
    events.push(validateEvent(parsed));
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || event.sequence !== index) throw new WaymarkError("SEQUENCE_GAP", "Journal sequence is not contiguous");
  }
  return events;
}

function applyEvent(state: TrajectoryState | undefined, event: WaymarkEvent): TrajectoryState | undefined {
  switch (event.type) {
    case "trajectory.started":
      if (state) throw new WaymarkError("DUPLICATE_START", "Trajectory has multiple start events");
      return {
        id: event.trajectoryId,
        profile: event.profile,
        question: event.question,
        repository: event.repository,
        hops: [],
        status: "STAGED",
        staleReasons: [],
        events: [event],
      };
    case "hop.added":
      if (!state || state.status !== "STAGED" || event.hop.index !== state.hops.length) throw new WaymarkError("INVALID_HOP_SEQUENCE", "Hop does not extend the active trajectory");
      state.hops.push(event.hop);
      state.events.push(event);
      return state;
    case "trajectory.stale":
      if (!state) throw new WaymarkError("ORPHAN_EVENT", "Stale event has no trajectory");
      state.status = "STALE";
      if (!state.staleReasons.includes(event.reason)) state.staleReasons.push(event.reason);
      state.events.push(event);
      return state;
    case "trajectory.committed":
      if (!state) throw new WaymarkError("ORPHAN_EVENT", "Commit event has no trajectory");
      state.status = "COMMITTED";
      state.answer = event.answer;
      state.events.push(event);
      return state;
    case "trajectory.abandoned":
      if (!state) throw new WaymarkError("ORPHAN_EVENT", "Abandon event has no trajectory");
      state.status = "ABANDONED";
      state.events.push(event);
      return state;
    case "publication.pending":
    case "publication.succeeded":
    case "publication.failed":
      if (!state) throw new WaymarkError("ORPHAN_EVENT", "Publication event has no trajectory");
      state.events.push(event);
      return state;
  }
}

export function replayTrajectory(root: string, id: string): TrajectoryState {
  let state: TrajectoryState | undefined;
  for (const event of readJournalEvents(root, id)) state = applyEvent(state, event);
  if (!state) throw new WaymarkError("EMPTY_TRAJECTORY", `Trajectory ${id} has no start event`);
  return state;
}

export function appendEvent(root: string, event: WaymarkEvent): void {
  const line = `${JSON.stringify(event)}\n`;
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length > MAX_EVENT_BYTES) throw new WaymarkError("EVENT_TOO_LARGE", "Event exceeds the 16 KiB limit");
  const target = trajectoryPath(root, event.trajectoryId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, "a");
  try {
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(path.dirname(target));
}

export function makeEventBase(type: string, trajectoryId: string, sequence: number): { waymark: 1; type: string; trajectoryId: string; sequence: number; at: string } {
  return { waymark: 1, type, trajectoryId, sequence, at: nowIso() };
}

function pointerForState(root: string, state: TrajectoryState): ActivePointer {
  if (state.status === "COMMITTED" || state.status === "ABANDONED") return { waymark: 1, status: "NONE", updatedAt: nowIso() };
  return {
    waymark: 1,
    status: state.status,
    trajectoryId: state.id,
    journal: path.relative(storePath(root), trajectoryPath(root, state.id)).replaceAll("\\", "/"),
    updatedAt: nowIso(),
  };
}

export function writePointerForState(root: string, state: TrajectoryState): void {
  atomicWriteFile(activePath(root), `${JSON.stringify(pointerForState(root, state))}\n`);
}

function validPointer(value: unknown): value is ActivePointer {
  if (!isRecord(value) || value.waymark !== 1 || typeof value.status !== "string" || typeof value.updatedAt !== "string") return false;
  if (value.status === "NONE") return true;
  return (value.status === "STAGED" || value.status === "STALE") && typeof value.trajectoryId === "string" && typeof value.journal === "string";
}

function discoverActive(root: string): ActivePointer {
  const directory = path.join(storePath(root), "trajectories");
  const candidates: TrajectoryState[] = [];
  if (fs.existsSync(directory)) {
    for (const file of fs.readdirSync(directory)) {
      if (!file.endsWith(".ndjson")) continue;
      const id = file.slice(0, -7);
      try {
        const state = replayTrajectory(root, id);
        if (state.status === "STAGED" || state.status === "STALE") candidates.push(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "journal replay failed";
        throw new WaymarkError("ACTIVE_DISCOVERY_FAILED", `Unable to discover active trajectory ${id}: ${message}`);
      }
    }
  }
  if (candidates.length > 1) throw new WaymarkError("MULTIPLE_ACTIVE", "More than one unfinished trajectory exists");
  if (candidates.length === 0) return { waymark: 1, status: "NONE", updatedAt: nowIso() };
  return pointerForState(root, candidates[0]!);
}

export function readActivePointer(root: string): ActivePointer {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(activePath(root), "utf8"));
    if (!validPointer(parsed)) throw new Error("invalid pointer");
    if (parsed.status !== "NONE") {
      try {
        replayTrajectory(root, parsed.trajectoryId);
      } catch {
        return discoverActive(root);
      }
    }
    return parsed;
  } catch {
    return discoverActive(root);
  }
}

export function loadActiveTrajectory(root: string): TrajectoryState | null {
  const pointer = readActivePointer(root);
  if (pointer.status === "NONE") return null;
  return replayTrajectory(root, pointer.trajectoryId);
}

export function createStartedEvent(id: string, profile: AdapterProfile, question: string, repository: RepositoryProvenance): WaymarkEvent {
  return { ...makeEventBase("trajectory.started", id, 0), type: "trajectory.started", profile, question, repository };
}

export function createHopEvent(state: TrajectoryState, hop: HopRecord): HopAddedEvent {
  return { ...makeEventBase("hop.added", state.id, state.events.length), type: "hop.added", hop };
}

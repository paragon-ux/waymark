import { ResumeInput, ResumeHop, ResumePacket, ResumeStatus, WaymarkError } from "./types.js";
import { stableStringify } from "./stableStringify.js";

export const MAX_RESUME_BYTES = 2048;
const MAX_HOPS = 8;

const TOP_ORDER = [
  "waymark",
  "kind",
  "status",
  "trajectoryId",
  "question",
  "verifiedThrough",
  "totalSteps",
  "hops",
  "nextAction",
  "staleReasons",
  "omittedBefore",
  "truncated",
] as const;

const HOP_ORDER = ["index", "path", "label", "inference", "status"] as const;

function utf8Size(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Size(value) <= maxBytes) return value;
  let result = "";
  for (const character of value) {
    if (utf8Size(result + character) > maxBytes) break;
    result += character;
  }
  return result;
}

function bounded(value: string, maxChars: number, maxBytes = Number.MAX_SAFE_INTEGER): string {
  const characters = Array.from(value).slice(0, maxChars).join("");
  return truncateUtf8(characters, maxBytes);
}

function cloneHop(hop: ResumeHop, compact = false): ResumeHop {
  return {
    index: hop.index,
    path: bounded(hop.path, 200, compact ? 160 : 200),
    label: bounded(hop.label, 120, compact ? 60 : 120),
    inference: bounded(hop.inference, 160, compact ? 80 : 160),
    status: hop.status,
  };
}

function packetJson(packet: ResumePacket): string {
  return stableStringify(packet, { top: TOP_ORDER, arrayObject: HOP_ORDER });
}

function packetSize(packet: ResumePacket): number {
  return utf8Size(packetJson(packet));
}

function validateInput(input: ResumeInput): void {
  if (!Number.isInteger(input.totalSteps) || input.totalSteps < 0) throw new WaymarkError("INVALID_RESUME", "totalSteps must be a nonnegative integer");
  if (!Number.isInteger(input.verifiedThrough) || input.verifiedThrough < -1) throw new WaymarkError("INVALID_RESUME", "verifiedThrough is outside the trajectory");
  if (input.totalSteps === 0 && input.verifiedThrough !== -1) throw new WaymarkError("INVALID_RESUME", "An empty trajectory has no verified hop");
  if (input.totalSteps > 0 && input.verifiedThrough >= input.totalSteps) throw new WaymarkError("INVALID_RESUME", "verifiedThrough is outside the trajectory");
  if (input.status === "NONE") return;
  if (input.trajectoryId.length === 0) throw new WaymarkError("INVALID_RESUME", "active resume packets require a trajectory");
  if (input.hops.some((hop) => !Number.isInteger(hop.index) || hop.index < 0 || hop.index > input.verifiedThrough || !["FRESH", "MOVED"].includes(hop.status))) {
    throw new WaymarkError("INVALID_RESUME", "resume hops must be verified and within the trusted prefix");
  }
}

function basePacket(input: ResumeInput, hops: ResumeHop[], truncated: boolean, compact = false): ResumePacket {
  const isNone = input.status === "NONE";
  return {
    waymark: 1,
    kind: "compact-resume",
    status: input.status,
    trajectoryId: isNone ? "" : bounded(input.trajectoryId, 80),
    question: isNone ? "" : bounded(input.question, 240, compact ? 160 : 240),
    verifiedThrough: isNone ? -1 : input.verifiedThrough,
    totalSteps: isNone ? 0 : input.totalSteps,
    hops: isNone ? [] : hops.map((hop) => cloneHop(hop, compact)),
    nextAction: isNone ? "begin-trajectory" : bounded(input.nextAction, 160, compact ? 80 : 160),
    staleReasons: isNone ? [] : input.staleReasons.slice(0, compact ? 1 : 3).map((reason) => bounded(reason, 200, compact ? 100 : 200)),
    omittedBefore: isNone ? 0 : Math.max(0, input.verifiedThrough + 1 - hops.length),
    truncated,
  };
}

export interface SerializedResume {
  packet: ResumePacket;
  json: string;
  bytes: number;
}

export function serializeResume(input: ResumeInput): SerializedResume {
  validateInput(input);
  if (input.status === "NONE") {
    const packet = basePacket(input, [], false);
    const json = packetJson(packet);
    return { packet, json, bytes: utf8Size(json) };
  }

  const trusted = [...input.hops]
    .filter((hop) => hop.index <= input.verifiedThrough)
    .sort((left, right) => left.index - right.index);
  const contiguous: ResumeHop[] = [];
  for (const hop of trusted) {
    if (hop.index !== contiguous.length) break;
    contiguous.push(hop);
  }
  let candidate = contiguous.slice(Math.max(0, contiguous.length - MAX_HOPS));
  let packet = basePacket(input, candidate, candidate.length < contiguous.length);
  while (packetSize(packet) > MAX_RESUME_BYTES && candidate.length > 1) {
    candidate = candidate.slice(1);
    packet = basePacket(input, candidate, true);
  }
  if (packetSize(packet) > MAX_RESUME_BYTES) {
    packet = basePacket(input, candidate, true, true);
  }
  const json = packetJson(packet);
  const bytes = utf8Size(json);
  if (bytes > MAX_RESUME_BYTES) throw new WaymarkError("RESUME_TOO_LARGE", `Resume packet is ${bytes} bytes; limit is ${MAX_RESUME_BYTES}`);
  return { packet, json, bytes };
}

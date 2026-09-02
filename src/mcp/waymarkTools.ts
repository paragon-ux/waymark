import crypto from "node:crypto";
import {
  ActivePointer,
  AdapterProfile,
  CheckReport,
  HopRecord,
  ResumeHop,
  TrajectoryState,
  WaymarkConfig,
  WaymarkError,
  WaymarkEvent,
} from "../types.js";
import { acquireLock } from "../lock.js";
import {
  appendEvent,
  createHopEvent,
  createStartedEvent,
  initWorkspace,
  loadActiveTrajectory,
  makeEventBase,
  readActivePointer,
  readConfig,
  replayTrajectory,
  writeConfig,
  writePointerForState,
} from "../journal.js";
import { anchorForRange, normalizeRelativePath, repoRoot, repositoryProvenance } from "../paths.js";
import { checkTrajectory } from "../integrity.js";
import { serializeResume } from "../resumeSerializer.js";
import { publish } from "../capnAdapter.js";
import { McpToolCallResult, McpToolHandler } from "./types.js";

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

function filesFor(state: TrajectoryState): string[] {
  return [...new Set(state.hops.map((hop) => hop.path))];
}

function jsonResult(value: unknown, isError = false): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

function errorResult(error: unknown): McpToolCallResult {
  if (error instanceof WaymarkError) {
    return jsonResult({ waymark: 1, kind: "error", ok: false, code: error.code, message: error.message }, true);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonResult({ waymark: 1, kind: "error", ok: false, code: "UNEXPECTED_ERROR", message }, true);
}

function resolveRoot(args: Record<string, unknown>): string {
  const custom = typeof args.root === "string" && args.root.trim() ? args.root.trim() : process.cwd();
  return repoRoot(custom);
}

export const waymarkInitTool: McpToolHandler = {
  definition: {
    name: "waymark_init",
    description: "Initialize or configure the Waymark continuity store in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          description: "Adapter profile for finalized trajectory publication.",
          enum: ["recording", "capn-cli", "none"],
        },
        capn_executable: {
          type: "string",
          description: "Custom path or name of the Capn executable when using capn-cli profile.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const profile = (typeof args.profile === "string" ? args.profile : "recording") as AdapterProfile;
      const capnExecutable = typeof args.capn_executable === "string" ? args.capn_executable : undefined;
      const config = await withLock(root, () => {
        const conf = initWorkspace(root, profile);
        if (capnExecutable && capnExecutable.trim().length > 0) {
          conf.capnExecutable = capnExecutable.trim();
          writeConfig(root, conf);
        }
        return conf;
      });
      return jsonResult({
        waymark: 1,
        kind: "init",
        ok: true,
        profile: config.profile,
        maxRelocationWindows: config.maxRelocationWindows,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkStatusTool: McpToolHandler = {
  definition: {
    name: "waymark_status",
    description: "Get the current active trajectory state, trajectory ID, and step count.",
    inputSchema: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      return await withLock(root, () => {
        const pointer = readActivePointer(root);
        if (pointer.status === "NONE") {
          return jsonResult({
            waymark: 1,
            kind: "status",
            status: "NONE",
            trajectoryId: null,
            totalSteps: 0,
          });
        }
        const state = loadActiveTrajectory(root);
        return jsonResult({
          waymark: 1,
          kind: "status",
          status: pointer.status,
          trajectoryId: pointer.trajectoryId,
          totalSteps: state ? state.hops.length : 0,
        });
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkBeginTool: McpToolHandler = {
  definition: {
    name: "waymark_begin",
    description: "Start a new durable in-flight code investigation for a question.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The coding investigation question or goal.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["question"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const question = typeof args.question === "string" ? args.question.trim() : "";
      if (!question) throw new WaymarkError("MISSING_ARGUMENT", "Question is required");

      return await withLock(root, () => {
        const config = readConfig(root);
        const existing = loadActiveTrajectory(root);
        if (existing && existing.status === "STAGED") {
          throw new WaymarkError("ACTIVE_TRAJECTORY_EXISTS", "An active trajectory is already staged. Complete or abandon it before beginning a new one.");
        }
        const id = crypto.randomUUID();
        const provenance = repositoryProvenance(root);
        const event = createStartedEvent(id, config.profile, question, provenance);
        appendEvent(root, event);
        const state = replayTrajectory(root, id);
        writePointerForState(root, state);
        return jsonResult({
          waymark: 1,
          kind: "begin",
          ok: true,
          id,
          question,
          profile: config.profile,
        });
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkNoteTool: McpToolHandler = {
  definition: {
    name: "waymark_note",
    description: "Record a verified code hop (file path, line range, label, and inference) into the active trajectory.",
    inputSchema: {
      type: "object",
      properties: {
        trajectory_id: {
          type: "string",
          description: "Active trajectory ID returned by waymark_begin or waymark_status.",
        },
        path: {
          type: "string",
          description: "Repository-relative path of the investigated file.",
        },
        label: {
          type: "string",
          description: "Short label describing this code hop (e.g., 'route-handler', 'auth-check').",
        },
        start_line: {
          type: "number",
          description: "Starting line number (1-indexed, inclusive).",
        },
        end_line: {
          type: "number",
          description: "Ending line number (1-indexed, inclusive).",
        },
        inference: {
          type: "string",
          description: "Key takeaway, observation, or deduction learned from this code hop.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["trajectory_id", "path", "label", "start_line", "end_line", "inference"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const trajectoryId = typeof args.trajectory_id === "string" ? args.trajectory_id.trim() : "";
      const rawPath = typeof args.path === "string" ? args.path.trim() : "";
      const label = typeof args.label === "string" ? args.label.trim() : "";
      const startLine = typeof args.start_line === "number" ? Math.floor(args.start_line) : 1;
      const endLine = typeof args.end_line === "number" ? Math.floor(args.end_line) : startLine;
      const inference = typeof args.inference === "string" ? args.inference.trim() : "";

      if (!trajectoryId) throw new WaymarkError("MISSING_ARGUMENT", "trajectory_id is required");
      if (!rawPath) throw new WaymarkError("MISSING_ARGUMENT", "path is required");
      if (!label) throw new WaymarkError("MISSING_ARGUMENT", "label is required");
      if (!inference) throw new WaymarkError("MISSING_ARGUMENT", "inference is required");

      const storedPath = normalizeRelativePath(rawPath);
      const range = { start: startLine, end: endLine };
      const anchor = anchorForRange(root, storedPath, range);

      return await withLock(root, () => {
        const state = loadActiveTrajectory(root);
        if (!state || state.id !== trajectoryId) {
          throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
        }
        if (state.status !== "STAGED") {
          throw new WaymarkError("TRAJECTORY_CLOSED", "Cannot add notes to a closed trajectory");
        }
        const hopIndex = state.hops.length;
        const hop: HopRecord = {
          index: hopIndex,
          path: storedPath,
          label,
          inference,
          range,
          fileSha256: anchor.fileSha256,
          normalizedSpanHash: anchor.normalizedSpanHash,
          normalizedSpanLen: anchor.normalizedSpanLen,
          spanLineCount: anchor.spanLineCount,
          structuralSignature: anchor.structuralSignature,
        };
        const event = createHopEvent(state, hop);
        appendEvent(root, event);
        const updated = replayTrajectory(root, trajectoryId);
        writePointerForState(root, updated);
        return jsonResult({
          waymark: 1,
          kind: "note",
          ok: true,
          id: trajectoryId,
          hopIndex,
          path: storedPath,
        });
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkCheckTool: McpToolHandler = {
  definition: {
    name: "waymark_check",
    description: "Check the integrity of the active trajectory against the current Git worktree and detect line relocations or branch drift.",
    inputSchema: {
      type: "object",
      properties: {
        trajectory_id: {
          type: "string",
          description: "Optional trajectory ID to check. If omitted, checks the current active trajectory.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      return await withLock(root, () => {
        const config = readConfig(root);
        const pointer = readActivePointer(root);
        const targetId = typeof args.trajectory_id === "string" && args.trajectory_id.trim()
          ? args.trajectory_id.trim()
          : pointer.status !== "NONE"
            ? pointer.trajectoryId
            : null;
        if (!targetId) {
          return jsonResult(noActiveReport());
        }
        const state = replayTrajectory(root, targetId);
        const report = checkTrajectory(root, state, config.maxRelocationWindows);
        applyStaleEvent(root, state, report);
        return jsonResult(report);
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkResumeTool: McpToolHandler = {
  definition: {
    name: "waymark_resume",
    description: "Retrieve the bounded compact-resume packet for the active trajectory after a context compaction.",
    inputSchema: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      return await withLock(root, () => {
        const config = readConfig(root);
        const checked = checkedActive(root, config);
        const serialized = resumeFor(checked.state, checked.report);
        return jsonResult(serialized.packet);
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkCompleteTool: McpToolHandler = {
  definition: {
    name: "waymark_complete",
    description: "Complete and seal the active trajectory, record the answer, archive the journal, and publish to Capn.",
    inputSchema: {
      type: "object",
      properties: {
        trajectory_id: {
          type: "string",
          description: "Active trajectory ID to complete.",
        },
        answer: {
          type: "string",
          description: "The conclusive charted answer synthesizing the investigation findings.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["trajectory_id", "answer"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const trajectoryId = typeof args.trajectory_id === "string" ? args.trajectory_id.trim() : "";
      const answer = typeof args.answer === "string" ? args.answer.trim() : "";
      if (!trajectoryId) throw new WaymarkError("MISSING_ARGUMENT", "trajectory_id is required");
      if (!answer) throw new WaymarkError("MISSING_ARGUMENT", "answer is required");

      const config = readConfig(root);
      return await withLock(root, async () => {
        let state = loadActiveTrajectory(root);
        if (!state || state.id !== trajectoryId) {
          throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
        }
        const checked = checkedActive(root, config);
        state = checked.state;
        if (!state || checked.report.status !== "STAGED") {
          throw new WaymarkError("NOT_SAFE_TO_COMPLETE", "Trajectory is stale or crosses repository provenance", 2);
        }
        if (state.hops.length === 0) {
          throw new WaymarkError("NO_HOPS", "Complete requires at least one recorded hop");
        }

        appendEvent(root, { ...makeEventBase("trajectory.committed", trajectoryId, state.events.length), type: "trajectory.committed", answer });
        state = replayTrajectory(root, trajectoryId);
        writePointerForState(root, state);

        if (config.profile === "none") {
          return jsonResult({ waymark: 1, kind: "complete", ok: true, id: trajectoryId, published: false, adapter: "none" });
        }

        appendEvent(root, { ...makeEventBase("publication.pending", trajectoryId, state.events.length), type: "publication.pending", adapter: config.profile });
        const result = await publish(root, config.profile, config.capnExecutable, state.question, answer, filesFor(state), trajectoryId);
        state = replayTrajectory(root, trajectoryId);

        if (result.published) {
          appendEvent(root, { ...makeEventBase("publication.succeeded", trajectoryId, state.events.length), type: "publication.succeeded", adapter: config.profile, adapterOutput: result.output.slice(0, 2000) });
          return jsonResult({ waymark: 1, kind: "complete", ok: true, id: trajectoryId, published: true, adapter: config.profile, output: result.output });
        }

        appendEvent(root, { ...makeEventBase("publication.failed", trajectoryId, state.events.length), type: "publication.failed", adapter: config.profile, reason: (result.error ?? "publication failed").slice(0, 2000) });
        return jsonResult({ waymark: 1, kind: "complete", ok: true, id: trajectoryId, published: false, adapter: config.profile, publicationError: result.error ?? "publication failed" });
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const waymarkAbandonTool: McpToolHandler = {
  definition: {
    name: "waymark_abandon",
    description: "Abandon the active trajectory, marking it discarded in the journal.",
    inputSchema: {
      type: "object",
      properties: {
        trajectory_id: {
          type: "string",
          description: "Active trajectory ID to abandon.",
        },
        reason: {
          type: "string",
          description: "Optional reason for abandoning the trajectory.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["trajectory_id"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const trajectoryId = typeof args.trajectory_id === "string" ? args.trajectory_id.trim() : "";
      const reason = typeof args.reason === "string" ? args.reason.trim() : "operator abandoned trajectory";
      if (!trajectoryId) throw new WaymarkError("MISSING_ARGUMENT", "trajectory_id is required");

      return await withLock(root, () => {
        const state = loadActiveTrajectory(root);
        if (!state || state.id !== trajectoryId) {
          throw new WaymarkError("NO_ACTIVE_TRAJECTORY", "The requested trajectory is not active");
        }
        appendEvent(root, { ...makeEventBase("trajectory.abandoned", trajectoryId, state.events.length), type: "trajectory.abandoned", reason });
        const updated = replayTrajectory(root, trajectoryId);
        writePointerForState(root, updated);
        return jsonResult({
          waymark: 1,
          kind: "abandon",
          ok: true,
          id: trajectoryId,
          reason,
        });
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const WAYMARK_TOOLS: McpToolHandler[] = [
  waymarkInitTool,
  waymarkStatusTool,
  waymarkBeginTool,
  waymarkNoteTool,
  waymarkCheckTool,
  waymarkResumeTool,
  waymarkCompleteTool,
  waymarkAbandonTool,
];

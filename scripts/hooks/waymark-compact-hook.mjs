#!/usr/bin/env node

/**
 * Universal Post-Compaction Lifecycle Hook for AI Coding Agents
 *
 * This executable script supports multiple agent harnesses:
 * - OpenAI Codex: Handles SessionStart (compact) JSON-RPC stdin/stdout contracts.
 * - Antigravity (Agy): Handles PreInvocation injectSteps protocol.
 * - Hermes Agent: Handles pre_llm_call shell-hook payloads (fires on the
 *   first turn whose history contains a compaction handoff, live user turn
 *   included; deduped per session_id + summary identity) and answers with
 *   JSON {"context": ...} stdout lines on that gated path.
 * - Claude Code & CLI: Emits clean Markdown or structured JSON.
 *
 * Usage:
 *   node scripts/hooks/waymark-compact-hook.mjs [--format=markdown|json|codex|agy|hermes] [--root=<path>]
 */

import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import { readConfig, loadActiveTrajectory, readActivePointer } from "../../dist/src/journal.js";
import { repoRoot } from "../../dist/src/paths.js";
import { checkTrajectory } from "../../dist/src/integrity.js";
import { serializeResume } from "../../dist/src/resumeSerializer.js";

// Hermes compaction markers (agent/context_compressor.py). The summary handoff is a
// role="user" row starting with one of these prefixes; content markers are byte-pinned
// upstream ("NEVER edit/reorder entries"). Matched exactly so ordinary turns never fire.
const HERMES_SUMMARY_PREFIXES = [
  "[CONTEXT COMPACTION",
  "[CONTEXT SUMMARY]:",
];
const HERMES_MERGED_SUMMARY_DELIMITER = "[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]";
const HERMES_CONTINUATION_MARKERS = [
  "Continue from the compressed conversation context above. This marker exists because no human user turn was available.",
  "Continue from the compressed conversation context above. This marker exists because the compacted transcript contained no preserved user turn.",
];
const HERMES_SUMMARY_HEADING = "## Historical Task Snapshot";

function parseFlags(argv) {
  let format = null;
  let customRoot = process.cwd();
  for (const arg of argv) {
    if (arg.startsWith("--format=")) format = arg.split("=")[1];
    if (arg.startsWith("--root=")) customRoot = arg.split("=")[1];
  }
  return { format, customRoot };
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  // for-await drains stdin reliably under parallel load: the payload arrives
  // before 'end' by construction, so no timer can race its first byte into an
  // empty read (a bare no-data fallback timer did exactly that under full-suite
  // load). If a writer dies without closing the pipe, Hermes' own hook timeout
  // bounds the hang — same contract as the reload repo's reference hook.
  let data = "";
  process.stdin.setEncoding("utf8");
  return (async () => {
    for await (const chunk of process.stdin) {
      data += chunk;
    }
    return data.trim();
  })();
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hermesHistoryText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

// Compaction boundary detection for Hermes pre_llm_call payloads.
//
// Hermes compacts at TURN START: the immediate post-compaction turn usually
// carries a live user message AFTER the summary row, so a live user message
// does NOT mean the summary is stale. Fire on the first turn whose history
// contains a compaction handoff, then dedupe on session_id + summary identity
// so the persisting summary row does not re-trigger every turn.
function isHermesCompaction(payload) {
  if (!payload || typeof payload !== "object" || payload.hook_event_name !== "pre_llm_call") {
    return null;
  }
  const history = Array.isArray(payload.extra?.conversation_history) ? payload.extra.conversation_history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    // Primary signal: the in-process summary flag (agent/context_compressor.py
    // stamps `_compressed_summary` on the handoff row unconditionally at the
    // compaction boundary; content-independent, survives hook stdin
    // serialization). Verified against Hermes 0.21.2.
    if (message._compressed_summary) {
      return { summaryRow: message };
    }
    // Fallback signal: byte-pinned content markers, for rows that passed through a
    // wire sanitizer or session-store round-trip that drops "_"-prefixed metadata.
    if (message.role !== "user") {
      continue;
    }
    const text = hermesHistoryText(message.content);
    if (HERMES_SUMMARY_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      return { summaryRow: message };
    }
    if (text.includes(HERMES_MERGED_SUMMARY_DELIMITER)) {
      const after = text.split(HERMES_MERGED_SUMMARY_DELIMITER, 2)[1] || "";
      if (HERMES_SUMMARY_PREFIXES.some((prefix) => after.trimStart().startsWith(prefix))) {
        return { summaryRow: message };
      }
    }
    if (HERMES_CONTINUATION_MARKERS.some((marker) => text.startsWith(marker))) {
      return { summaryRow: message };
    }
    if (text.startsWith(HERMES_SUMMARY_HEADING)) {
      return { summaryRow: message };
    }
  }
  return null;
}

function summaryRowIdentity(summaryRow) {
  // Hash the row text for EVERY detected row. The `_compressed_summary` flag is
  // stamped unconditionally at the boundary (content-independent), so a constant
  // identity for flagged rows would dedupe two DIFFERENT compactions in one
  // session against each other and swallow the second boundary within the TTL.
  return crypto.createHash("sha256").update(hermesHistoryText(summaryRow.content)).digest("hex").slice(0, 16);
}

// Dedupe state lives next to the trajectory (.waymark/) so it is repo-scoped and
// already covered by the worktree-integrity story. Best-effort: a failed state
// write only means a possible duplicate injection, never a missed one.
const DEDUPE_FILENAME = "hermes-compact-hook-state.json";

function hermesStatePath(root) {
  return path.join(root, ".waymark", DEDUPE_FILENAME);
}

function shouldFireForCompaction(payload, summaryRow, root) {
  const sessionId = typeof payload.session_id === "string" && payload.session_id
    ? payload.session_id
    : null;
  if (!sessionId) {
    return true; // nothing to dedupe against; still a verified compaction turn
  }
  const statePath = hermesStatePath(root);
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!state || typeof state !== "object") state = {};
  } catch {
    state = {};
  }
  const key = `${sessionId}:${summaryRowIdentity(summaryRow)}`;
  const fired = typeof state[key] === "number" ? state[key] : 0;
  if (fired && Date.now() - fired < 12 * 60 * 60 * 1000) {
    return false;
  }
  state[key] = Date.now();
  // Prune entries older than 7 days so the file cannot grow unbounded.
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === "number" && Date.now() - v > 7 * 24 * 60 * 60 * 1000) {
      delete state[k];
    }
  }
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // best-effort
  }
  return true;
}

async function runHook() {
  const { format: explicitFormat, customRoot } = parseFlags(process.argv.slice(2));
  const rawStdin = explicitFormat ? "" : await readStdin();
  const stdinPayload = parseJsonSafe(rawStdin);

  // Auto-detect format if not explicitly forced
  let effectiveFormat = explicitFormat;
  let resolvedRoot = customRoot;

  if (!effectiveFormat && stdinPayload) {
    if (stdinPayload.hook_event_name === "SessionStart") {
      effectiveFormat = "codex";
      if (stdinPayload.cwd) resolvedRoot = stdinPayload.cwd;
    } else if (stdinPayload.hook_event_name === "pre_llm_call") {
      // Hermes shell hook: fire on the first turn that sees this compaction
      // handoff (live user message included), dedupe via session+summary state.
      const detected = isHermesCompaction(stdinPayload);
      const rootForGate = stdinPayload.cwd || customRoot;
      let rootCandidate = null;
      try {
        rootCandidate = repoRoot(rootForGate);
      } catch {
        rootCandidate = null;
      }
      if (detected && shouldFireForCompaction(stdinPayload, detected.summaryRow, rootCandidate || rootForGate)) {
        effectiveFormat = "hermes-shell";
        if (stdinPayload.cwd) resolvedRoot = stdinPayload.cwd;
      } else {
        // Hermes shell hooks must answer with valid JSON or Hermes logs an
        // invalid-stdout warning; "{}" parses as a no-op context response.
        process.stdout.write("{}\n");
        return;
      }
    } else if (stdinPayload.workspacePaths || stdinPayload.invocationNum !== undefined) {
      effectiveFormat = "agy";
      if (Array.isArray(stdinPayload.workspacePaths) && stdinPayload.workspacePaths[0]) {
        resolvedRoot = stdinPayload.workspacePaths[0];
      }
    }
  }

  if (effectiveFormat === "hermes") {
    // Forced --format=hermes (CLI mode): no compaction gate.
    effectiveFormat = "hermes-markdown";
  }

  if (!effectiveFormat) effectiveFormat = "markdown";

  // For Codex: if event is not compact and not forced, return no-op
  if (effectiveFormat === "codex" && stdinPayload && stdinPayload.source && stdinPayload.source !== "compact") {
    process.stdout.write("{}\n");
    return;
  }

  let root;
  try {
    root = repoRoot(resolvedRoot);
  } catch {
    if (effectiveFormat === "codex" || effectiveFormat === "agy" || effectiveFormat === "hermes-shell") {
      process.stdout.write("{}\n");
    }
    return;
  }

  let pointer;
  try {
    pointer = readActivePointer(root);
  } catch {
    if (effectiveFormat === "codex" || effectiveFormat === "agy" || effectiveFormat === "hermes-shell") {
      process.stdout.write("{}\n");
    }
    return;
  }

  if (!pointer || pointer.status === "NONE") {
    if (effectiveFormat === "codex" || effectiveFormat === "agy" || effectiveFormat === "hermes-shell") {
      process.stdout.write("{}\n");
    }
    return;
  }

  const state = loadActiveTrajectory(root);
  if (!state) {
    if (effectiveFormat === "codex" || effectiveFormat === "agy" || effectiveFormat === "hermes-shell") {
      process.stdout.write("{}\n");
    }
    return;
  }

  const config = readConfig(root);
  const report = checkTrajectory(root, state, config.maxRelocationWindows);

  const trusted = report.hops
    .filter((hop) => hop.index <= report.verifiedThrough && (hop.status === "FRESH" || hop.status === "MOVED"))
    .map((hop) => {
      const stored = state.hops.find((c) => c.index === hop.index);
      return {
        index: stored.index,
        path: stored.path,
        label: stored.label,
        inference: stored.inference,
        status: hop.status === "MOVED" ? "MOVED" : "FRESH",
      };
    });

  const nextAction = report.status === "STALE"
    ? "reverify-stale-hop"
    : report.status === "CROSS_BRANCH"
      ? "confirm-branch-or-restart"
      : report.totalSteps === 0
        ? "record-first-hop"
        : "continue-from-verified-hop";

  const resume = serializeResume({
    trajectoryId: state.id,
    status: report.status,
    question: state.question,
    verifiedThrough: report.verifiedThrough,
    totalSteps: report.totalSteps,
    hops: trusted,
    nextAction,
    staleReasons: report.staleReasons,
  });

  if (effectiveFormat === "json") {
    process.stdout.write(`${JSON.stringify(resume.packet, null, 2)}\n`);
    return;
  }

  // Build markdown breadcrumb context
  const lines = [
    "### [Waymark] Active Investigation Resumed Post-Compaction",
    `**Question:** ${state.question}`,
    `**Status:** \`${report.status}\` | **Verified Through Hop:** ${report.verifiedThrough} / ${report.totalSteps - 1}`,
    `**Next Recommended Action:** \`${nextAction}\``,
    "",
    "#### Verified Breadcrumb Trail:",
  ];

  if (trusted.length === 0) {
    lines.push("- (No verified hops recorded yet)");
  } else {
    for (const hop of trusted) {
      const movedNotice = hop.status === "MOVED" ? " *(Relocated in file)*" : "";
      lines.push(`- **Hop ${hop.index}** [${hop.label}] [\`${hop.path}\`${movedNotice}]: ${hop.inference}`);
    }
  }

  if (report.staleReasons.length > 0) {
    lines.push("");
    lines.push(`**Integrity Warning:** ${report.staleReasons.join("; ")}`);
  }

  lines.push("");
  lines.push("*(Continue investigation from the verified hop above using `waymark_note`)*");
  lines.push("");

  const markdownBlock = lines.join("\n");

  if (effectiveFormat === "codex") {
    const codexOutput = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: markdownBlock,
      },
    };
    process.stdout.write(`${JSON.stringify(codexOutput)}\n`);
    return;
  }

  if (effectiveFormat === "agy") {
    const agyOutput = {
      injectSteps: [
        {
          ephemeralMessage: markdownBlock,
        },
      ],
    };
    process.stdout.write(`${JSON.stringify(agyOutput)}\n`);
    return;
  }

  if (effectiveFormat === "hermes-shell") {
    // Hermes shell-hook path: Hermes parses hook stdout as JSON and accepts
    // only {"context": "<string>"} (agent/shell_hooks.py _parse_response /
    // _parse_context). Do not truncate: Hermes spills oversized context to
    // disk itself (hooks.output_spill.max_chars, default 10000).
    process.stdout.write(`${JSON.stringify({ context: markdownBlock })}\n`);
    return;
  }

  process.stdout.write(`${markdownBlock}\n`);
}

try {
  await runHook();
  process.exit(0);
} catch (err) {
  // Hooks should fail open without blocking host agent loops. Hermes parses
  // hook stdout as JSON, so even the crash path must answer one JSON line —
  // empty stdout is logged as "shell hook stdout was not valid JSON".
  process.stderr.write(`[waymark-compact-hook] Error: ${err.message}\n`);
  process.stdout.write("{}\n");
  process.exit(0);
}

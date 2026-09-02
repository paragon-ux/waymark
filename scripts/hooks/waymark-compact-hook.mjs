#!/usr/bin/env node

/**
 * Universal Post-Compaction Lifecycle Hook for AI Coding Agents
 *
 * This executable script supports multiple agent harnesses:
 * - OpenAI Codex: Handles SessionStart (compact) JSON-RPC stdin/stdout contracts.
 * - Antigravity (Agy): Handles PreInvocation injectSteps protocol.
 * - Claude Code & CLI: Emits clean Markdown or structured JSON.
 *
 * Usage:
 *   node scripts/hooks/waymark-compact-hook.mjs [--format=markdown|json|codex|agy] [--root=<path>]
 */

import path from "node:path";
import process from "node:process";
import { readConfig, loadActiveTrajectory, readActivePointer } from "../../dist/src/journal.js";
import { repoRoot } from "../../dist/src/paths.js";
import { checkTrajectory } from "../../dist/src/integrity.js";
import { serializeResume } from "../../dist/src/resumeSerializer.js";

function parseFlags(argv) {
  let format = null;
  let customRoot = process.cwd();
  for (const arg of argv) {
    if (arg.startsWith("--format=")) format = arg.split("=")[1];
    if (arg.startsWith("--root=")) customRoot = arg.split("=")[1];
  }
  return { format, customRoot };
}

function readStdin(timeoutMs = 100) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    let timer = setTimeout(() => {
      cleanup();
      resolve(data.trim());
    }, timeoutMs);

    function onData(chunk) {
      data += chunk;
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        resolve(data.trim());
      }, 50);
    }

    function onEnd() {
      cleanup();
      resolve(data.trim());
    }

    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      try {
        process.stdin.pause();
      } catch {}
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
    } else if (stdinPayload.workspacePaths || stdinPayload.invocationNum !== undefined) {
      effectiveFormat = "agy";
      if (Array.isArray(stdinPayload.workspacePaths) && stdinPayload.workspacePaths[0]) {
        resolvedRoot = stdinPayload.workspacePaths[0];
      }
    }
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
    if (effectiveFormat === "codex" || effectiveFormat === "agy") {
      process.stdout.write("{}\n");
    }
    return;
  }

  let pointer;
  try {
    pointer = readActivePointer(root);
  } catch {
    if (effectiveFormat === "codex" || effectiveFormat === "agy") {
      process.stdout.write("{}\n");
    }
    return;
  }

  if (!pointer || pointer.status === "NONE") {
    if (effectiveFormat === "codex" || effectiveFormat === "agy") {
      process.stdout.write("{}\n");
    }
    return;
  }

  const state = loadActiveTrajectory(root);
  if (!state) {
    if (effectiveFormat === "codex" || effectiveFormat === "agy") {
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

  process.stdout.write(`${markdownBlock}\n`);
}

try {
  await runHook();
  process.exit(0);
} catch (err) {
  // Hooks should fail open without blocking host agent loops
  process.stderr.write(`[waymark-compact-hook] Error: ${err.message}\n`);
  process.exit(0);
}

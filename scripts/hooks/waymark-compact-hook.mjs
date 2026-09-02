#!/usr/bin/env node

/**
 * Universal Post-Compaction Lifecycle Hook for AI Coding Agents
 *
 * This executable script can be registered in any agent harness (Codex, Claude Code,
 * Cursor, custom agent loops) to run immediately after context compaction.
 *
 * It reads the active Waymark trajectory, validates line relocations against Git HEAD,
 * and outputs the bounded resume block (<2,048 bytes) directly to stdout for injection
 * into the agent's fresh context window.
 *
 * Usage:
 *   node scripts/hooks/waymark-compact-hook.mjs [--format=markdown|json] [--root=<path>]
 */

import path from "node:path";
import process from "node:process";
import { readConfig, loadActiveTrajectory, readActivePointer } from "../../dist/src/journal.js";
import { repoRoot } from "../../dist/src/paths.js";
import { checkTrajectory } from "../../dist/src/integrity.js";
import { serializeResume } from "../../dist/src/resumeSerializer.js";

function parseFlags(argv) {
  let format = "markdown";
  let customRoot = process.cwd();
  for (const arg of argv) {
    if (arg.startsWith("--format=")) format = arg.split("=")[1];
    if (arg.startsWith("--root=")) customRoot = arg.split("=")[1];
  }
  return { format, customRoot };
}

function runHook() {
  const { format, customRoot } = parseFlags(process.argv.slice(2));
  const root = repoRoot(customRoot);

  const pointer = readActivePointer(root);
  if (pointer.status === "NONE") {
    // No active trajectory to restore
    return;
  }

  const state = loadActiveTrajectory(root);
  if (!state) return;

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

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(resume.packet, null, 2)}\n`);
    return;
  }

  // Markdown injection block for agent context
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

  process.stdout.write(`${lines.join("\n")}\n`);
}

try {
  runHook();
} catch (err) {
  // Hooks should fail open or output diagnostic on stderr without breaking agent startup
  process.stderr.write(`[waymark-compact-hook] Error: ${err.message}\n`);
  process.exit(0);
}

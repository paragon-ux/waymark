#!/usr/bin/env node

/**
 * Dynamic Utility Experiment: Full-Scale Automated Stress Harness
 *
 * Runs a complete end-to-end multi-hop investigation across real files,
 * subjects the active trajectory to 4 harsh workspace mutations,
 * and measures real utility metrics (token savings, relocation precision,
 * fault isolation, and fail-closed safety).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { setupExperimentRepo } from "./setup-scenario.mjs";
import { mutateWorkspace } from "./mutate-workspace.mjs";

import { initWorkspace, loadActiveTrajectory, replayTrajectory, writePointerForState, appendEvent, createStartedEvent, createHopEvent } from "../../dist/src/journal.js";
import { repositoryProvenance, anchorForRange } from "../../dist/src/paths.js";
import { checkTrajectory } from "../../dist/src/integrity.js";
import { serializeResume } from "../../dist/src/resumeSerializer.js";

const TARGET_DIR = path.resolve(process.cwd(), ".tmp-dynamic-utility-lab");

async function runUtilityLab() {
  console.log("=== STARTING WAYMARK DYNAMIC UTILITY STRESS LAB ===");
  console.log(`Setting up mock enterprise workspace in: ${TARGET_DIR}`);
  setupExperimentRepo(TARGET_DIR);

  // Initialize Waymark
  initWorkspace(TARGET_DIR, "recording");
  const prov = repositoryProvenance(TARGET_DIR);

  const question = "When an inbound Stripe webhook arrives, how does signature verification occur and where is the transaction committed?";
  const trajectoryId = "dyn-lab-" + Date.now();

  console.log(`\n1. Active Multi-Hop Investigation: "${question}"`);
  appendEvent(TARGET_DIR, createStartedEvent(trajectoryId, "recording", question, prov));
  let state = replayTrajectory(TARGET_DIR, trajectoryId);
  writePointerForState(TARGET_DIR, state);

  // 5 Canonical Hops
  const hops = [
    {
      path: "gateway/router.ts",
      label: "webhook-endpoint",
      start: 13,
      end: 33,
      inference: "Receives raw webhook body, triggers HMAC auth, calls billing service",
    },
    {
      path: "services/authService.ts",
      label: "hmac-verifier",
      start: 12,
      end: 30,
      inference: "Calculates SHA256 HMAC with tenant secret and runs timingSafeEqual",
    },
    {
      path: "services/billingService.ts",
      label: "billing-orchestrator",
      start: 4,
      end: 23,
      inference: "Acquires isolated DB connection and initiates transaction commit",
    },
    {
      path: "database/connectionPool.ts",
      label: "db-pool-lease",
      start: 10,
      end: 24,
      inference: "Leases database connection from pool with concurrency safeguards",
    },
    {
      path: "models/transaction.ts",
      label: "ledger-commit",
      start: 11,
      end: 25,
      inference: "Executes SQL INSERT into ledger_transactions with conflict protection",
    },
  ];

  for (let i = 0; i < hops.length; i++) {
    const hopDef = hops[i];
    const anchor = anchorForRange(TARGET_DIR, hopDef.path, { start: hopDef.start, end: hopDef.end });
    const hop = {
      index: i,
      path: hopDef.path,
      label: hopDef.label,
      inference: hopDef.inference,
      range: { start: hopDef.start, end: hopDef.end },
      ...anchor,
    };
    appendEvent(TARGET_DIR, createHopEvent(state, hop));
    state = replayTrajectory(TARGET_DIR, trajectoryId);
    writePointerForState(TARGET_DIR, state);
    console.log(`  + Recorded Hop ${i} [${hopDef.label}] in ${hopDef.path} (lines ${hopDef.start}-${hopDef.end})`);
  }

  // Baseline Verification
  let report = checkTrajectory(TARGET_DIR, state, 2000);
  console.log(`\nBaseline Check: Status=${report.status}, VerifiedThrough Hop=${report.verifiedThrough}/4`);
  if (report.status !== "STAGED" || report.verifiedThrough !== 4 || !report.hops.every((h) => h.status === "FRESH")) {
    throw new Error(`Baseline check failed: expected STAGED with all FRESH hops, got ${report.status}`);
  }

  // Measure Tokens
  const coldFiles = ["gateway/router.ts", "services/authService.ts", "services/billingService.ts", "database/connectionPool.ts", "models/transaction.ts"];
  let coldBytes = 0;
  for (const f of coldFiles) {
    coldBytes += fs.statSync(path.join(TARGET_DIR, f)).size;
  }
  const coldTokens = Math.round(coldBytes / 3.6);

  const trusted = report.hops.map((h) => ({
    index: h.index,
    path: h.path,
    label: state.hops[h.index].label,
    inference: state.hops[h.index].inference,
    status: h.status,
  }));
  const resume = serializeResume({
    trajectoryId: state.id,
    status: report.status,
    question: state.question,
    verifiedThrough: report.verifiedThrough,
    totalSteps: report.totalSteps,
    hops: trusted,
    nextAction: "continue-from-verified-hop",
    staleReasons: [],
  });
  const resumeBytes = Buffer.byteLength(resume.json, "utf8");
  const resumeTokens = Math.round(resumeBytes / 3.6);
  const tokenSavingsPct = (((coldTokens - resumeTokens) / coldTokens) * 100).toFixed(1);

  console.log(`\n--- TOKEN CONTINUITY METRIC ---`);
  console.log(`Cold Exploration: ${coldBytes} bytes (~${coldTokens} tokens)`);
  console.log(`Waymark Resume:   ${resumeBytes} bytes (~${resumeTokens} tokens)`);
  console.log(`Compaction Token Savings: ${tokenSavingsPct}%`);

  const metrics = {
    tokenSavingsPct: Number(tokenSavingsPct),
    driftRelocated: false,
    ambiguityQuarantined: false,
    brokenBridgeIsolated: false,
    crossBranchGuarded: false,
  };

  // ==========================================
  // STRESS TEST 1: Span Drift (Relocation)
  // ==========================================
  console.log("\n--- STRESS TEST 1: SPAN DRIFT (Line Shift Mutation) ---");
  mutateWorkspace(TARGET_DIR, "drift");
  report = checkTrajectory(TARGET_DIR, state, 2000);
  const hop1Status = report.hops[1]?.status;
  console.log(`Observed Hop 1 Status after 45-line insertion: ${hop1Status}`);
  if (hop1Status === "MOVED") {
    metrics.driftRelocated = true;
    console.log("PASS: Span relocation detected accurately (status=MOVED). Line numbers auto-corrected.");
  } else {
    console.log(`FAIL: Expected MOVED, got ${hop1Status}`);
  }

  // ==========================================
  // STRESS TEST 2: Ambiguous Collision (Collision Trap)
  // ==========================================
  console.log("\n--- STRESS TEST 2: AMBIGUOUS COLLISION (Duplicate Code Trap) ---");
  mutateWorkspace(TARGET_DIR, "revert");
  mutateWorkspace(TARGET_DIR, "ambiguity");
  report = checkTrajectory(TARGET_DIR, state, 2000);
  console.log(`Observed Trajectory Status after duplicate injection: ${report.status}`);
  console.log(`Stale Reasons: ${report.staleReasons.join("; ")}`);
  if (report.status === "STALE" && report.staleReasons.some((r) => r.includes("ambiguous"))) {
    metrics.ambiguityQuarantined = true;
    console.log("PASS: Fail-closed safety held. Ambiguous span triggered STALE quarantine.");
  } else {
    console.log(`FAIL: Ambiguous span was not quarantined properly.`);
  }

  // ==========================================
  // STRESS TEST 3: Broken Bridge (Mid-Chain Fault Isolation)
  // ==========================================
  console.log("\n--- STRESS TEST 3: BROKEN BRIDGE (Mid-Chain Hop 2 Deletion) ---");
  mutateWorkspace(TARGET_DIR, "revert");
  mutateWorkspace(TARGET_DIR, "break-chain"); // Deletes Hop 2 in services/billingService.ts
  report = checkTrajectory(TARGET_DIR, state, 2000);
  console.log(`Observed Status: ${report.status}, VerifiedThrough Hop: ${report.verifiedThrough}`);
  console.log(`Hops status: ${report.hops.map((h) => `Hop ${h.index}:${h.status}`).join(", ")}`);
  if (report.status === "STALE" && report.verifiedThrough === 1) {
    metrics.brokenBridgeIsolated = true;
    console.log("PASS: Fault isolation verified. Hops 0 & 1 remain trusted prefix; broken Hop 2 halted continuation.");
  } else {
    console.log(`FAIL: Expected verifiedThrough=1, got ${report.verifiedThrough}`);
  }

  // ==========================================
  // STRESS TEST 4: Cross-Branch Drift (Provenance Mismatch)
  // ==========================================
  console.log("\n--- STRESS TEST 4: CROSS-BRANCH PROVENANCE GUARD ---");
  mutateWorkspace(TARGET_DIR, "revert");
  mutateWorkspace(TARGET_DIR, "cross-branch");
  report = checkTrajectory(TARGET_DIR, state, 2000);
  console.log(`Observed Status on branch switch: ${report.status}`);
  console.log(`Provenance Changed: ${report.provenanceChanged}`);
  if (report.status === "CROSS_BRANCH" && report.provenanceChanged) {
    metrics.crossBranchGuarded = true;
    console.log("PASS: Provenance boundary enforced. Cross-branch execution halted.");
  } else {
    console.log(`FAIL: Expected CROSS_BRANCH, got ${report.status}`);
  }

  // Revert and cleanup
  mutateWorkspace(TARGET_DIR, "revert");
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });

  // Calculate Overall Utility Score
  const checksPassed = [
    metrics.tokenSavingsPct > 70,
    metrics.driftRelocated,
    metrics.ambiguityQuarantined,
    metrics.brokenBridgeIsolated,
    metrics.crossBranchGuarded,
  ].filter(Boolean).length;
  const utilityScorePct = (checksPassed / 5) * 100;

  console.log("\n=======================================================");
  console.log(`FINAL UTILITY BENCHMARK SCORE: ${utilityScorePct}% (${checksPassed}/5 checks passed)`);
  console.log("=======================================================");

  const summary = {
    ok: utilityScorePct === 100,
    utilityScorePct,
    metrics,
  };

  return summary;
}

runUtilityLab()
  .then((result) => {
    process.stdout.write(`\nLAB_RESULT: ${JSON.stringify(result)}\n`);
    process.exit(result.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error("FATAL ERROR IN LAB:", err);
    process.exit(1);
  });

#!/usr/bin/env node

/**
 * Dynamic Utility Experiment: Workspace Mutator
 *
 * Injects controlled, real-world mutations to test Waymark's utility weak points:
 * 1. Span Drift: Inserts code above target to shift line numbers (MOVED).
 * 2. Ambiguity Collision: Duplicates span to test fail-closed deduplication (STALE).
 * 3. Broken Bridge: Deletes a mid-chain hop to test prefix isolation.
 * 4. Cross Branch: Switches branches to test provenance boundary.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

export function mutateWorkspace(targetDir, mutationType) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory ${targetDir} does not exist`);
  }

  if (mutationType === "drift") {
    // Insert 45 lines of mock imports and comments in services/authService.ts
    const authPath = path.join(targetDir, "services", "authService.ts");
    const original = fs.readFileSync(authPath, "utf8");
    const padding = Array.from({ length: 45 }, (_, i) => `// Padding line ${i + 1} added by refactoring`).join("\n") + "\n\n";
    fs.writeFileSync(authPath, padding + original);
    return { ok: true, mutation: "drift", file: "services/authService.ts", shiftedLines: 46 };
  }

  if (mutationType === "ambiguity") {
    // Replace original range with padding, then insert TWO identical copies lower down
    const authPath = path.join(targetDir, "services", "authService.ts");
    const duplicateSpan = `export async function verifyWebhookHmac(signature: string, payload: any): Promise<boolean> {
  const secret = SECRETS_CACHE.get(payload.tenantId ?? "tenant_default");
  if (!secret) return false;

  // Hop 2 Anchor: HMAC signature calculation
  const computedHash = crypto
    .createHmac("sha256", secret.secretKey)
    .update(JSON.stringify(payload))
    .digest("hex");

  const expectedBuffer = Buffer.from(computedHash, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}`;

    const content = `import crypto from "node:crypto";

export interface TenantSecret {
  secretKey: string;
  rotatedAt?: number;
}

const SECRETS_CACHE = new Map<string, TenantSecret>([
  ["tenant_default", { secretKey: "sk_live_test_secret_9988" }],
]);

// Original range replaced with new refactored stub
export const REFACTORED_PLACEHOLDER = true;

// Candidate 1:
${duplicateSpan}

// Intermediate padding lines
// Candidate 2:
${duplicateSpan}
`;
    fs.writeFileSync(authPath, content);
    return { ok: true, mutation: "ambiguity", file: "services/authService.ts" };
  }

  if (mutationType === "break-chain") {
    // Delete the billing service processing function (Hop 3)
    const billingPath = path.join(targetDir, "services", "billingService.ts");
    const replacement = `// Function processWebhookBilling has been deprecated and removed.
export async function processWebhookBillingV2() {
  throw new Error("Deprecated endpoint");
}
`;
    fs.writeFileSync(billingPath, replacement);
    return { ok: true, mutation: "break-chain", file: "services/billingService.ts" };
  }

  if (mutationType === "cross-branch") {
    // Create and switch to an alternate branch
    execFileSync("git", ["checkout", "-b", "feature/refactored-webhooks"], { cwd: targetDir, windowsHide: true });
    return { ok: true, mutation: "cross-branch", branch: "feature/refactored-webhooks" };
  }

  if (mutationType === "revert") {
    execFileSync("git", ["checkout", "main"], { cwd: targetDir, windowsHide: true });
    execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: targetDir, windowsHide: true });
    execFileSync("git", ["clean", "-fd"], { cwd: targetDir, windowsHide: true });
    return { ok: true, mutation: "reverted" };
  }

  throw new Error(`Unknown mutation type: ${mutationType}`);
}

if (process.argv[1] && process.argv[1].endsWith("mutate-workspace.mjs")) {
  const targetDir = process.argv[2] || path.resolve(process.cwd(), ".tmp-utility-experiment");
  const mutationType = process.argv[3] || "drift";
  const result = mutateWorkspace(targetDir, mutationType);
  console.log(JSON.stringify(result));
}

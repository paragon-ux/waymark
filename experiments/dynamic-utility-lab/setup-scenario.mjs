#!/usr/bin/env node

/**
 * Dynamic Utility Experiment: Scenario Generator
 *
 * Builds a realistic multi-file repository with realistic call-chains,
 * realistic line offsets, and git tracking to benchmark agentic continuity.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

export function setupExperimentRepo(targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Init git repo
  execFileSync("git", ["init", "-b", "main"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Experiment Runner"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner@example.com"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });

  // Create directories
  fs.mkdirSync(path.join(targetDir, "gateway"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "services"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "database"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "models"), { recursive: true });

  // File 1: gateway/router.ts
  const routerCode = `import { Request, Response } from "express";
import { verifyWebhookHmac } from "../services/authService.js";
import { processWebhookBilling } from "../services/billingService.js";

export interface WebhookPayload {
  eventId: string;
  tenantId: string;
  amount: number;
  currency: string;
  signature: string;
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const eventHeader = req.headers["x-stripe-signature"] as string;
  const rawBody = req.body;

  if (!eventHeader) {
    return res.status(401).json({ error: "Missing signature header" });
  }

  // Hop 1 Anchor: Webhook validation & routing
  const isValid = await verifyWebhookHmac(eventHeader, rawBody);
  if (!isValid) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  try {
    const result = await processWebhookBilling(rawBody);
    return res.status(200).json({ status: "processed", transactionId: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Internal processing error" });
  }
}
`;
  fs.writeFileSync(path.join(targetDir, "gateway", "router.ts"), routerCode);

  // File 2: services/authService.ts
  const authCode = `import crypto from "node:crypto";

export interface TenantSecret {
  secretKey: string;
  rotatedAt?: number;
}

const SECRETS_CACHE = new Map<string, TenantSecret>([
  ["tenant_default", { secretKey: "sk_live_test_secret_9988" }],
]);

export async function verifyWebhookHmac(signature: string, payload: any): Promise<boolean> {
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
}
`;
  fs.writeFileSync(path.join(targetDir, "services", "authService.ts"), authCode);

  // File 3: services/billingService.ts
  const billingCode = `import { acquireTransactionConnection } from "../database/connectionPool.js";
import { commitTransactionRecord } from "../models/transaction.js";

export async function processWebhookBilling(event: any) {
  if (!event.eventId || !event.amount) {
    throw new Error("Malformed webhook billing payload");
  }

  // Hop 3 Anchor: Idempotency check & DB connection acquisition
  const dbHandle = await acquireTransactionConnection();
  try {
    const record = await commitTransactionRecord(dbHandle, {
      id: event.eventId,
      tenantId: event.tenantId ?? "tenant_default",
      amount: event.amount,
      currency: event.currency ?? "USD",
      status: "COMMITTED",
    });
    return record;
  } finally {
    dbHandle.release();
  }
}
`;
  fs.writeFileSync(path.join(targetDir, "services", "billingService.ts"), billingCode);

  // File 4: database/connectionPool.ts
  const dbCode = `export interface DbConnection {
  id: string;
  query(sql: string, params: any[]): Promise<any>;
  release(): void;
}

let activePoolConnections = 0;
const MAX_POOL_SIZE = 10;

export async function acquireTransactionConnection(): Promise<DbConnection> {
  // Hop 4 Anchor: Database connection lease & transaction lock
  if (activePoolConnections >= MAX_POOL_SIZE) {
    throw new Error("Database connection pool exhausted");
  }
  activePoolConnections += 1;

  return {
    id: \`conn_\${Date.now()}_\${Math.random().toString(36).slice(2, 6)}\`,
    query: async (sql, params) => ({ rowCount: 1, rows: [{ id: params[0] }] }),
    release: () => {
      activePoolConnections = Math.max(0, activePoolConnections - 1);
    },
  };
}
`;
  fs.writeFileSync(path.join(targetDir, "database", "connectionPool.ts"), dbCode);

  // File 5: models/transaction.ts
  const modelCode = `import { DbConnection } from "../database/connectionPool.js";

export interface TransactionModel {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: "PENDING" | "COMMITTED" | "REJECTED";
}

export async function commitTransactionRecord(
  conn: DbConnection,
  data: TransactionModel
): Promise<TransactionModel> {
  // Hop 5 Anchor: Final ledger commit
  const sql = \`
    INSERT INTO ledger_transactions (id, tenant_id, amount, currency, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
    RETURNING *;
  \`;

  await conn.query(sql, [data.id, data.tenantId, data.amount, data.currency, data.status]);
  return data;
}
`;
  fs.writeFileSync(path.join(targetDir, "models", "transaction.ts"), modelCode);

  // Commit initial baseline
  execFileSync("git", ["add", "."], { cwd: targetDir, windowsHide: true });
  execFileSync("git", ["commit", "-m", "Initial commit of webhook infrastructure"], { cwd: targetDir, windowsHide: true });

  return targetDir;
}

if (process.argv[1] && process.argv[1].endsWith("setup-scenario.mjs")) {
  const target = process.argv[2] || path.resolve(process.cwd(), ".tmp-utility-experiment");
  setupExperimentRepo(target);
  console.log(JSON.stringify({ ok: true, target }));
}

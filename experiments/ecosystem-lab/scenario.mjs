#!/usr/bin/env node

/**
 * Ecosystem Experiment Lab: Enterprise Payment Scenario
 *
 * Creates a realistic microservices repository with realistic call-chains,
 * line offsets, and git tracking for the 5-stage ecosystem lifecycle.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

export function setupEcosystemScenario(targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Git repo initialization
  execFileSync("git", ["init", "-b", "main"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Ecosystem Experimenter"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "experimenter@example.com"], { cwd: targetDir, windowsHide: true, stdio: "ignore" });

  fs.mkdirSync(path.join(targetDir, "gateway"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "auth"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "services"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "persistence"), { recursive: true });

  // 1. gateway/api.ts
  const apiCode = `import { Request, Response } from "express";
import { verifyJwtAuthToken } from "../auth/jwtVerifier.js";
import { processPaymentTransaction } from "../services/paymentOrchestrator.js";

export async function handlePaymentIngress(req: Request, res: Response) {
  const authHeader = req.headers["authorization"] as string;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer authorization token" });
  }

  // Hop 0: Ingress token validation & payment dispatch
  const token = authHeader.slice(7);
  const authClaims = await verifyJwtAuthToken(token);
  if (!authClaims || !authClaims.tenantId) {
    return res.status(403).json({ error: "Invalid credentials or tenant permissions" });
  }

  try {
    const payment = await processPaymentTransaction({
      tenantId: authClaims.tenantId,
      amount: req.body.amount,
      currency: req.body.currency,
      idempotencyKey: req.headers["idempotency-key"] as string,
    });
    return res.status(200).json({ status: "success", paymentId: payment.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Payment processing failed" });
  }
}
`;
  fs.writeFileSync(path.join(targetDir, "gateway", "api.ts"), apiCode);

  // 2. auth/jwtVerifier.ts
  const authCode = `import crypto from "node:crypto";

export interface AuthClaims {
  tenantId: string;
  scope: string[];
  issuedAt: number;
}

const PUBLIC_KEY_STORE = new Map<string, string>([
  ["v1", "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdef..."],
]);

export async function verifyJwtAuthToken(token: string): Promise<AuthClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  // Hop 1: Cryptographic JWT signature verification
  const [headerB64, payloadB64, signatureB64] = parts;
  const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  const claims = JSON.parse(payloadJson) as AuthClaims;

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(\`\${headerB64}.\${payloadB64}\`);
  const publicKey = PUBLIC_KEY_STORE.get("v1");
  if (!publicKey) return null;

  // Validate timing and scope
  if (claims.issuedAt < Date.now() - 3600000) return null;
  return claims;
}
`;
  fs.writeFileSync(path.join(targetDir, "auth", "jwtVerifier.ts"), authCode);

  // 3. services/paymentOrchestrator.ts
  const serviceCode = `import { acquireDbConnection } from "../persistence/pool.js";
import { insertPaymentLedgerRecord } from "../persistence/ledger.js";

export interface PaymentRequest {
  tenantId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export async function processPaymentTransaction(req: PaymentRequest) {
  if (!req.amount || req.amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  // Hop 2: Idempotency boundary and DB connection acquisition
  const conn = await acquireDbConnection();
  try {
    const paymentId = \`pay_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`;
    const record = await insertPaymentLedgerRecord(conn, {
      id: paymentId,
      tenantId: req.tenantId,
      amount: req.amount,
      currency: req.currency,
      status: "COMPLETED",
    });
    return record;
  } finally {
    conn.release();
  }
}
`;
  fs.writeFileSync(path.join(targetDir, "services", "paymentOrchestrator.ts"), serviceCode);

  // 4. persistence/pool.ts
  const poolCode = `export interface PooledClient {
  id: string;
  query(sql: string, params: any[]): Promise<any>;
  release(): void;
}

let activeConnections = 0;
const POOL_CAPACITY = 20;

export async function acquireDbConnection(): Promise<PooledClient> {
  // Hop 3: Concurrency-bounded connection leasing
  if (activeConnections >= POOL_CAPACITY) {
    throw new Error("Persistence pool saturated");
  }
  activeConnections += 1;

  return {
    id: \`client_\${activeConnections}\`,
    query: async (sql, params) => ({ rowCount: 1, rows: [{ id: params[0], status: params[4] }] }),
    release: () => {
      activeConnections = Math.max(0, activeConnections - 1);
    },
  };
}
`;
  fs.writeFileSync(path.join(targetDir, "persistence", "pool.ts"), poolCode);

  // 5. persistence/ledger.ts
  const ledgerCode = `import { PooledClient } from "./pool.js";

export interface LedgerEntry {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
}

export async function insertPaymentLedgerRecord(
  conn: PooledClient,
  entry: LedgerEntry
): Promise<LedgerEntry> {
  // Hop 4: Immutable ledger insertion with idempotency conflict guard
  const query = \`
    INSERT INTO payments_ledger (id, tenant_id, amount, currency, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
    RETURNING *;
  \`;
  await conn.query(query, [entry.id, entry.tenantId, entry.amount, entry.currency, entry.status]);
  return entry;
}
`;
  fs.writeFileSync(path.join(targetDir, "persistence", "ledger.ts"), ledgerCode);

  // Commit baseline
  execFileSync("git", ["add", "."], { cwd: targetDir, windowsHide: true });
  execFileSync("git", ["commit", "-m", "Initial commit of payment processing microservice"], { cwd: targetDir, windowsHide: true });

  return targetDir;
}

if (process.argv[1] && process.argv[1].endsWith("scenario.mjs")) {
  const target = process.argv[2] || path.resolve(process.cwd(), ".tmp-ecosystem-scenario");
  setupEcosystemScenario(target);
  console.log(JSON.stringify({ ok: true, target }));
}

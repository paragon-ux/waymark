import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WaymarkError } from "./types.js";

export interface LockMetadata {
  pid: number;
  nodeVersion: string;
  startTime: string;
  cwd: string;
  token: string;
}

export interface LockHandle {
  metadata: LockMetadata;
  release(): void;
}

function lockDirectory(root: string): string {
  return path.join(root, ".waymark", "locks", "active");
}

function metadataPath(root: string): string {
  return path.join(lockDirectory(root), "metadata.json");
}

export function acquireLock(root: string): LockHandle {
  const parent = path.dirname(lockDirectory(root));
  fs.mkdirSync(parent, { recursive: true });
  const metadata: LockMetadata = {
    pid: process.pid,
    nodeVersion: process.version,
    startTime: new Date().toISOString(),
    cwd: process.cwd(),
    token: crypto.randomUUID(),
  };
  try {
    fs.mkdirSync(lockDirectory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new WaymarkError("BUSY", "Another Waymark process owns the active trajectory lock", 1);
    }
    throw error;
  }
  try {
    fs.writeFileSync(metadataPath(root), `${JSON.stringify(metadata)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    fs.rmSync(lockDirectory(root), { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    metadata,
    release(): void {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(fs.readFileSync(metadataPath(root), "utf8")) as Partial<LockMetadata>;
        if (current.token !== metadata.token) throw new WaymarkError("LOCK_OWNERSHIP", "Lock ownership changed unexpectedly");
        fs.unlinkSync(metadataPath(root));
        fs.rmdirSync(lockDirectory(root));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    },
  };
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function recoverLock(root: string, force: boolean): { recovered: boolean; previous?: LockMetadata } {
  const directory = lockDirectory(root);
  if (!fs.existsSync(directory)) return { recovered: false };
  if (!force) throw new WaymarkError("LOCK_RECOVERY_REQUIRED", "Use recover-lock --force to inspect and reclaim a lock");
  let previous: LockMetadata;
  try {
    previous = JSON.parse(fs.readFileSync(metadataPath(root), "utf8")) as LockMetadata;
  } catch {
    throw new WaymarkError("LOCK_METADATA_INVALID", "Lock metadata is unavailable; refusing to reclaim it");
  }
  if (processIsRunning(previous.pid)) {
    throw new WaymarkError("BUSY", `Lock owner PID ${previous.pid} is still running`, 1);
  }
  fs.rmSync(directory, { recursive: true, force: true });
  return { recovered: true, previous };
}

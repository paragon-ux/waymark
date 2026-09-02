import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WaymarkError } from "./types.js";
import { assertSafeWaymarkStore } from "./paths.js";

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

function assertLockDirectorySafe(root: string): void {
  const target = lockDirectory(root);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new WaymarkError("WAYMARK_STORAGE_UNSAFE", "Waymark active lock path is not a real directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function assertMetadataSafe(root: string): void {
  try {
    if (fs.lstatSync(metadataPath(root)).isSymbolicLink()) throw new WaymarkError("WAYMARK_STORAGE_UNSAFE", "Waymark lock metadata is a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function acquireLock(root: string): LockHandle {
  assertSafeWaymarkStore(root);
  assertLockDirectorySafe(root);
  const parent = path.dirname(lockDirectory(root));
  fs.mkdirSync(parent, { recursive: true });
  assertSafeWaymarkStore(root);
  assertLockDirectorySafe(root);
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
        assertMetadataSafe(root);
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
  assertSafeWaymarkStore(root);
  assertLockDirectorySafe(root);
  const directory = lockDirectory(root);
  if (!fs.existsSync(directory)) return { recovered: false };
  if (!force) throw new WaymarkError("LOCK_RECOVERY_REQUIRED", "Use recover-lock --force to inspect and reclaim a lock");
  assertMetadataSafe(root);
  let previous: LockMetadata;
  try {
    previous = JSON.parse(fs.readFileSync(metadataPath(root), "utf8")) as LockMetadata;
  } catch {
    throw new WaymarkError("LOCK_METADATA_INVALID", "Lock metadata is unavailable; refusing to reclaim it");
  }
  if (processIsRunning(previous.pid)) {
    throw new WaymarkError("BUSY", `Lock owner PID ${previous.pid} is still running`, 1);
  }
  // Rename the exact observed lock directory before removing it. If a new
  // owner wins the mkdir race, the rename fails instead of deleting its lock.
  const quarantine = `${directory}.reclaim-${crypto.randomUUID()}`;
  try {
    fs.renameSync(directory, quarantine);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT" || code === "EPERM") throw new WaymarkError("BUSY", "Lock changed while recovery was in progress", 1);
    throw error;
  }
  try {
    const current = JSON.parse(fs.readFileSync(path.join(quarantine, "metadata.json"), "utf8")) as Partial<LockMetadata>;
    if (current.token !== previous.token || processIsRunning(Number(current.pid))) throw new WaymarkError("BUSY", "Lock changed while recovery was in progress", 1);
    fs.rmSync(quarantine, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(quarantine) && !fs.existsSync(directory)) {
      try { fs.renameSync(quarantine, directory); } catch { /* preserve quarantine for operator inspection */ }
    }
    throw error;
  }
  return { recovered: true, previous };
}

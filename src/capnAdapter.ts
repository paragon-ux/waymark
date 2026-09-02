import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdapterProfile, PublicationResult, WaymarkError } from "./types.js";
import { atomicWriteFile } from "./journal.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 2000;

function digestOutput(value: string): string {
  return value.length <= MAX_OUTPUT ? value : `${value.slice(0, MAX_OUTPUT)}…`;
}

function uniqueFiles(files: readonly string[]): string[] {
  return [...new Set(files)].sort();
}

export function capnChartArgs(question: string, answer: string, files: readonly string[]): string[] {
  return ["chart", question, answer, "--files", ...uniqueFiles(files)];
}

export async function publish(
  root: string,
  profile: AdapterProfile,
  executable: string,
  question: string,
  answer: string,
  files: readonly string[],
  trajectoryId: string,
): Promise<PublicationResult> {
  const selectedFiles = uniqueFiles(files);
  if (profile === "none") return { published: false, adapter: profile, output: "publication disabled" };

  if (profile === "recording") {
    const record = {
      waymark: 1,
      adapter: profile,
      trajectoryId,
      question,
      answer,
      files: selectedFiles,
    };
    const name = `${crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex")}.json`;
    const target = path.join(root, ".waymark", "recordings", name);
    atomicWriteFile(target, `${JSON.stringify(record)}\n`);
    return { published: true, adapter: profile, output: `recorded:${name}` };
  }

  if (!executable || executable.includes("\0")) throw new WaymarkError("CAPN_CONFIG_INVALID", "Capn executable is invalid");
  const args = capnChartArgs(question, answer, selectedFiles);
  try {
    const result = await execFileAsync(executable, args, {
      cwd: root,
      windowsHide: true,
      shell: false,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    return { published: true, adapter: profile, output: digestOutput(result.stdout || result.stderr || "capn chart completed") };
  } catch (error) {
    const candidate = error as { message?: string; stdout?: string; stderr?: string; code?: string | number };
    const detail = candidate.stderr || candidate.stdout || candidate.message || "Capn publication failed";
    return {
      published: false,
      adapter: profile,
      output: "",
      error: digestOutput(`${candidate.code ?? "CAPN_ERROR"}: ${detail}`),
    };
  }
}

export async function ask(
  root: string,
  profile: AdapterProfile,
  executable: string,
  question: string,
): Promise<Record<string, unknown>> {
  if (profile === "none") return { waymark: 1, kind: "ask", provider: "none", status: "miss", matches: [] };
  if (profile === "recording") return { waymark: 1, kind: "ask", provider: "recording", status: "miss", matches: [] };
  try {
    const result = await execFileAsync(executable, ["ask", question], {
      cwd: root,
      windowsHide: true,
      shell: false,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    const stdout = (result.stdout || "").trim();
    if (!stdout) return { waymark: 1, kind: "ask", provider: "capn-cli", status: "miss", matches: [] };
    try {
      const parsed: unknown = JSON.parse(stdout);
      return { waymark: 1, kind: "ask", provider: "capn-cli", status: "hit", result: parsed };
    } catch {
      return { waymark: 1, kind: "ask", provider: "capn-cli", status: "hit", result: digestOutput(stdout) };
    }
  } catch (error) {
    const candidate = error as { message?: string; stderr?: string; code?: string | number };
    return {
      waymark: 1,
      kind: "ask",
      provider: "capn-cli",
      status: "error",
      error: digestOutput(`${candidate.code ?? "CAPN_ERROR"}: ${candidate.stderr || candidate.message || "Capn ask failed"}`),
    };
  }
}

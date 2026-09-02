import path from "node:path";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { AdapterProfile, PublicationResult, WaymarkError } from "./types.js";
import { atomicWriteFile } from "./journal.js";
import { assertSafeWaymarkStore } from "./paths.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 2000;

interface CommandSpec {
  file: string;
  args: string[];
}

function digestOutput(value: string): string {
  return value.length <= MAX_OUTPUT ? value : `${value.slice(0, MAX_OUTPUT)}…`;
}

function uniqueFiles(files: readonly string[]): string[] {
  const selected = [...new Set(files)].sort();
  if (selected.some((file) => file.includes(","))) throw new WaymarkError("CAPN_UNSAFE_PATH", "Capn's public CLI cannot encode a file path containing a comma");
  return selected;
}

function quoteCmdArgument(value: string): string {
  if (value.length === 0) return '""';
  if (/[\r\n%"]/u.test(value)) throw new WaymarkError("CAPN_UNSAFE_ARGUMENT", "Capn batch adapters reject percent signs, quotes, and newlines; use a direct executable for those values");
  if (/^[A-Za-z0-9_./\\:@+=,-]+$/u.test(value)) return value;
  return `"${value.replace(/["^&|<>]/gu, "^$&")}"`;
}

function resolveWindowsCommand(executable: string): string {
  if (path.extname(executable).toLowerCase() === ".cmd" || path.extname(executable).toLowerCase() === ".bat") return executable;
  try {
    const output = execFileSync("where.exe", [executable], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    const first = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    return first ?? executable;
  } catch {
    return executable;
  }
}

function commandSpec(executable: string, args: readonly string[]): CommandSpec {
  if (process.platform !== "win32") return { file: executable, args: [...args] };
  const resolved = resolveWindowsCommand(executable);
  const extension = path.extname(resolved).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") return { file: resolved, args: [...args] };
  const commandLine = [resolved, ...args].map(quoteCmdArgument).join(" ");
  return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/v:off", "/s", "/c", commandLine] };
}

async function execute(root: string, executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const spec = commandSpec(executable, args);
  return await execFileAsync(spec.file, spec.args, {
    cwd: root,
    windowsHide: true,
    shell: false,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
}

export function capnChartArgs(question: string, answer: string, files: readonly string[]): string[] {
  return ["chart", question, answer, ...uniqueFiles(files).flatMap((file) => ["--files", file])];
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
    assertSafeWaymarkStore(root);
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
    const result = await execute(root, executable, args);
    return { published: true, adapter: profile, output: digestOutput(result.stdout || result.stderr || "capn chart completed") };
  } catch (error) {
    if (error instanceof WaymarkError) {
      return { published: false, adapter: profile, output: "", error: `${error.code}: ${error.message}` };
    }
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
    const result = await execute(root, executable, ["ask", question]);
    const stdout = (result.stdout || "").trim();
    if (!stdout) return { waymark: 1, kind: "ask", provider: "capn-cli", status: "miss", matches: [] };
    if (stdout.startsWith("No charted answer.")) return { waymark: 1, kind: "ask", provider: "capn-cli", status: "miss", matches: [] };
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

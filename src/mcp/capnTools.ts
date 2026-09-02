import { repoRoot } from "../paths.js";
import { ask, publish } from "../capnAdapter.js";
import { readConfig } from "../journal.js";
import { AdapterProfile, WaymarkError } from "../types.js";
import { McpToolCallResult, McpToolHandler } from "./types.js";

function jsonResult(value: unknown, isError = false): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

function errorResult(error: unknown): McpToolCallResult {
  if (error instanceof WaymarkError) {
    return jsonResult({ waymark: 1, kind: "error", ok: false, code: error.code, message: error.message }, true);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonResult({ waymark: 1, kind: "error", ok: false, code: "UNEXPECTED_ERROR", message }, true);
}

function resolveRoot(args: Record<string, unknown>): string {
  const custom = typeof args.root === "string" && args.root.trim() ? args.root.trim() : process.cwd();
  return repoRoot(custom);
}

export const capnAskTool: McpToolHandler = {
  definition: {
    name: "capn_ask",
    description: "Query Capn's charted repository memory to check if an answer to the question already exists.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to look up in Capn's charted memory.",
        },
        capn_executable: {
          type: "string",
          description: "Optional custom path to the Capn executable.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["question"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const question = typeof args.question === "string" ? args.question.trim() : "";
      if (!question) throw new WaymarkError("MISSING_ARGUMENT", "question is required");

      const config = readConfig(root);
      const executable = (typeof args.capn_executable === "string" && args.capn_executable.trim()) || config.capnExecutable || "capn";
      const result = await ask(root, config.profile, executable, question);
      const payload: Record<string, unknown> = {
        waymark: 1,
        kind: "ask",
        provider: result.provider,
        status: result.status,
      };
      if (result.status === "hit") {
        payload.result = result.result;
      } else if (result.status === "error") {
        payload.error = result.error;
      } else {
        payload.matches = result.matches ?? [];
      }
      return jsonResult(payload);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const capnChartTool: McpToolHandler = {
  definition: {
    name: "capn_chart",
    description: "Directly chart a question, answer, and associated file references into Capn's long-term memory.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question or topic charted.",
        },
        answer: {
          type: "string",
          description: "The conclusive charted answer.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Array of repository-relative file paths referenced in the answer.",
        },
        capn_executable: {
          type: "string",
          description: "Optional custom path to the Capn executable.",
        },
        root: {
          type: "string",
          description: "Optional repository root path. Defaults to current working directory.",
        },
      },
      required: ["question", "answer"],
    },
  },
  handler: async (args) => {
    try {
      const root = resolveRoot(args);
      const question = typeof args.question === "string" ? args.question.trim() : "";
      const answer = typeof args.answer === "string" ? args.answer.trim() : "";
      const files = Array.isArray(args.files) ? args.files.filter((f): f is string => typeof f === "string") : [];
      if (!question) throw new WaymarkError("MISSING_ARGUMENT", "question is required");
      if (!answer) throw new WaymarkError("MISSING_ARGUMENT", "answer is required");

      const config = readConfig(root);
      const profile = (typeof args.profile === "string" && ["recording", "capn-cli", "none"].includes(args.profile) ? args.profile : config.profile) as AdapterProfile;
      const executable = (typeof args.capn_executable === "string" && args.capn_executable.trim()) || config.capnExecutable || "capn";
      const result = await publish(root, profile, executable, question, answer, files, "manual-mcp-chart");
      const payload: Record<string, unknown> = {
        waymark: 1,
        kind: "chart",
        published: result.published,
        adapter: result.adapter,
        output: result.output,
      };
      if (!result.published && result.error) {
        payload.error = result.error;
      }
      return jsonResult(payload);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const CAPN_TOOLS: McpToolHandler[] = [capnAskTool, capnChartTool];

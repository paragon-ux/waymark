import { WAYMARK_TOOLS } from "./waymarkTools.js";
import { CAPN_TOOLS } from "./capnTools.js";
import {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolHandler,
} from "./types.js";
import { repoRoot } from "../paths.js";
import { loadActiveTrajectory, readActivePointer, readConfig } from "../journal.js";

export const WAYMARK_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "waymark://context",
    name: "Waymark Proactive Agent Context",
    description: "The 3-rule proactive directive for in-flight code continuity and active trajectory state",
    mimeType: "text/plain",
  },
  {
    uri: "waymark://status",
    name: "Waymark Active Status",
    description: "Current active trajectory status and step count",
    mimeType: "application/json",
  },
];

export const CAPN_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "capn://status",
    name: "Capn Memory Status",
    description: "Current Capn adapter profile and executable configuration",
    mimeType: "application/json",
  },
];

export const WAYMARK_PROMPTS: McpPromptDefinition[] = [
  {
    name: "waymark_investigate",
    description: "Initiate a proactive code investigation adhering to Waymark in-flight continuity",
    arguments: [
      {
        name: "question",
        description: "The code question or debugging goal to investigate",
        required: true,
      },
    ],
  },
];

export interface McpServerOptions {
  name?: string;
  version?: string;
  tools?: McpToolHandler[];
  resources?: McpResourceDefinition[];
  prompts?: McpPromptDefinition[];
}

export class McpServer {
  private readonly toolMap: Map<string, McpToolHandler> = new Map();
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly resources: McpResourceDefinition[];
  private readonly prompts: McpPromptDefinition[];

  constructor(optionsOrHandlers: McpServerOptions | McpToolHandler[] = [...WAYMARK_TOOLS, ...CAPN_TOOLS]) {
    if (Array.isArray(optionsOrHandlers)) {
      this.serverName = "waymark-mcp";
      this.serverVersion = "1.3.0";
      this.resources = WAYMARK_RESOURCES;
      this.prompts = WAYMARK_PROMPTS;
      for (const item of optionsOrHandlers) {
        this.toolMap.set(item.definition.name, item);
      }
    } else {
      this.serverName = optionsOrHandlers.name ?? "waymark-mcp";
      this.serverVersion = optionsOrHandlers.version ?? "1.3.0";
      const tools = optionsOrHandlers.tools ?? [...WAYMARK_TOOLS, ...CAPN_TOOLS];
      this.resources = optionsOrHandlers.resources ?? WAYMARK_RESOURCES;
      this.prompts = optionsOrHandlers.prompts ?? WAYMARK_PROMPTS;
      for (const item of tools) {
        this.toolMap.set(item.definition.name, item);
      }
    }
  }

  public getToolDefinitions() {
    return Array.from(this.toolMap.values()).map((h) => h.definition);
  }

  public async handleMessage(rawMessage: string): Promise<string | null> {
    const trimmed = rawMessage.trim();
    if (!trimmed) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }

    if (!parsed || typeof parsed !== "object") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }

    const message = parsed as Record<string, unknown>;
    const isNotification = message.id === undefined || message.id === null;

    if (isNotification) {
      await this.handleNotification(message as unknown as JsonRpcNotification);
      return null;
    }

    const response = await this.handleRequest(message as unknown as JsonRpcRequest);
    return JSON.stringify(response);
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    if (notification.method === "notifications/initialized") {
      return;
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: this.serverName,
            version: this.serverVersion,
          },
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      };
    }

    if (method === "ping") {
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: this.getToolDefinitions(),
        },
      };
    }

    if (method === "tools/call") {
      const toolName = typeof params?.name === "string" ? params.name : "";
      const toolArgs = (params?.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;

      const handler = this.toolMap.get(toolName);
      if (!handler) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${toolName}`,
          },
        };
      }

      try {
        const result = await handler.handler(toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ error: message }) }],
            isError: true,
          },
        };
      }
    }

    if (method === "resources/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: this.resources,
        },
      };
    }

    if (method === "resources/read") {
      const uri = typeof params?.uri === "string" ? params.uri : "";
      const root = repoRoot(process.cwd());

      if (uri === "waymark://context") {
        let activeState = null;
        try {
          const pointer = readActivePointer(root);
          if (pointer.status !== "NONE") {
            activeState = loadActiveTrajectory(root);
          }
        } catch {}

        const activeLine = activeState
          ? `Active Trajectory ID: ${activeState.id}\nQuestion: "${activeState.question}"\nRecorded Hops: ${activeState.hops.length}\nStatus: ${activeState.status}`
          : "Active Trajectory: None staged";

        const text = [
          "# Waymark Proactive Agent Directive",
          "",
          "1. Before searching codebase, query `capn_ask` to reuse charted knowledge.",
          "2. While tracing code, save verified hops via `waymark_note` (path, line range, inference).",
          "3. After context compaction, call `waymark_resume` to pick up your exact verified breadcrumb trail.",
          "4. When finished, seal with `waymark_complete` to archive the journal and chart findings into Capn.",
          "",
          "---",
          activeLine,
        ].join("\n");

        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text,
              },
            ],
          },
        };
      }

      if (uri === "waymark://status") {
        let statusObj: { waymark: number; kind: string; status: string; trajectoryId: string | null; totalSteps: number } = {
          waymark: 1,
          kind: "status",
          status: "NONE",
          trajectoryId: null,
          totalSteps: 0,
        };
        try {
          const pointer = readActivePointer(root);
          if (pointer.status !== "NONE") {
            const state = loadActiveTrajectory(root);
            statusObj = {
              waymark: 1,
              kind: "status",
              status: pointer.status,
              trajectoryId: pointer.trajectoryId,
              totalSteps: state ? state.hops.length : 0,
            };
          }
        } catch {}

        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(statusObj, null, 2),
              },
            ],
          },
        };
      }

      if (uri === "capn://status") {
        let capnObj = {
          waymark: 1,
          kind: "capn-status",
          profile: "recording",
          capnExecutable: "capn",
        };
        try {
          const config = readConfig(root);
          capnObj = {
            waymark: 1,
            kind: "capn-status",
            profile: config.profile,
            capnExecutable: config.capnExecutable || "capn",
          };
        } catch {}

        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(capnObj, null, 2),
              },
            ],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Resource not found: ${uri}`,
        },
      };
    }

    if (method === "prompts/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: this.prompts,
        },
      };
    }

    if (method === "prompts/get") {
      const name = typeof params?.name === "string" ? params.name : "";
      if (name === "waymark_investigate") {
        const question = (params?.arguments && typeof params.arguments === "object" && typeof (params.arguments as Record<string, unknown>).question === "string")
          ? (params.arguments as Record<string, unknown>).question as string
          : "Investigate code question";

        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "Proactive investigation workflow prompt",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Please investigate: "${question}"\n\nFollow the Waymark continuity protocol:\n1. Call capn_ask to check for existing charted answers.\n2. If not found, call waymark_begin to start tracking.\n3. Record verified hops via waymark_note.\n4. Call waymark_complete when finished to chart your findings.`,
                },
              },
            ],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Prompt not found: ${name}`,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  public async runStdio(): Promise<void> {
    process.stdin.setEncoding("utf8");
    let buffer = "";

    process.stdin.on("data", async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const response = await this.handleMessage(line);
        if (response) {
          process.stdout.write(`${response}\n`);
        }
      }
    });

    process.stdin.on("end", async () => {
      if (buffer.trim()) {
        const response = await this.handleMessage(buffer);
        if (response) {
          process.stdout.write(`${response}\n`);
        }
      }
    });
  }
}

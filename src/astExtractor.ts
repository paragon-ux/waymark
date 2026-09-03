import Parser from "web-tree-sitter";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SymbolDefinition {
  name: string;
  qualifiedName: string;
  kind: "Class" | "Method" | "Function" | "Interface" | "Type";
  file: string;
  startLine: number;
  endLine: number;
}

export interface CallRelationship {
  caller: string;
  callee: string;
  file: string;
  line: number;
}

export interface AstExtractionResult {
  symbols: SymbolDefinition[];
  calls: CallRelationship[];
  callersMap: Map<string, string[]>;
  calleesMap: Map<string, string[]>;
  filesParsed: number;
  parseDurationMs: number;
}

const EXT_TO_WASM: Record<string, string> = {
  // TypeScript & JavaScript
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  // Python
  ".py": "tree-sitter-python.wasm",
  // Go
  ".go": "tree-sitter-go.wasm",
  // Rust
  ".rs": "tree-sitter-rust.wasm",
  // Java & JVM
  ".java": "tree-sitter-java.wasm",
  ".kt": "tree-sitter-kotlin.wasm",
  ".kts": "tree-sitter-kotlin.wasm",
  ".scala": "tree-sitter-scala.wasm",
  // C, C++, Objective-C
  ".c": "tree-sitter-c.wasm",
  ".h": "tree-sitter-c.wasm",
  ".cpp": "tree-sitter-cpp.wasm",
  ".hpp": "tree-sitter-cpp.wasm",
  ".cc": "tree-sitter-cpp.wasm",
  ".cxx": "tree-sitter-cpp.wasm",
  ".m": "tree-sitter-objc.wasm",
  // C#
  ".cs": "tree-sitter-c_sharp.wasm",
  // Ruby & PHP
  ".rb": "tree-sitter-ruby.wasm",
  ".php": "tree-sitter-php.wasm",
  // Swift
  ".swift": "tree-sitter-swift.wasm",
  // Shell scripts
  ".sh": "tree-sitter-bash.wasm",
  ".bash": "tree-sitter-bash.wasm",
  // Lua
  ".lua": "tree-sitter-lua.wasm",
  // Systems / Functional / Smart Contracts
  ".zig": "tree-sitter-zig.wasm",
  ".dart": "tree-sitter-dart.wasm",
  ".el": "tree-sitter-elisp.wasm",
  ".ex": "tree-sitter-elixir.wasm",
  ".exs": "tree-sitter-elixir.wasm",
  ".elm": "tree-sitter-elm.wasm",
  ".ml": "tree-sitter-ocaml.wasm",
  ".mli": "tree-sitter-ocaml.wasm",
  ".res": "tree-sitter-rescript.wasm",
  ".sol": "tree-sitter-solidity.wasm",
};

let parserInitialized = false;
const loadedLanguages: Map<string, unknown> = new Map();

export async function initParser(): Promise<void> {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }
}

function resolveWasmPath(wasmName: string, customDir?: string): string | null {
  if (customDir) {
    const candidate = path.join(customDir, wasmName);
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const pkgPath = require.resolve("tree-sitter-wasms/package.json");
    const outDir = path.join(path.dirname(pkgPath), "out");
    const candidate = path.join(outDir, wasmName);
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // fallback to relative search
  }
  const fallback = path.resolve(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmName);
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

export async function getLanguageForExtension(ext: string, customDir?: string): Promise<unknown> {
  await initParser();
  const wasmName = EXT_TO_WASM[ext.toLowerCase()];
  if (!wasmName) return null;

  if (loadedLanguages.has(wasmName)) {
    return loadedLanguages.get(wasmName);
  }

  const wasmPath = resolveWasmPath(wasmName, customDir);
  if (!wasmPath) return null;

  const Lang = await Parser.Language.load(wasmPath);
  loadedLanguages.set(wasmName, Lang);
  return Lang;
}

export async function extractAstFromRepo(
  repoRoot: string,
  includeDirs: string[] = ["src"]
): Promise<AstExtractionResult> {
  const t0 = performance.now();
  await initParser();
  const parser = new Parser();

  const symbols: SymbolDefinition[] = [];
  const calls: CallRelationship[] = [];
  const callersMap: Map<string, string[]> = new Map();
  const calleesMap: Map<string, string[]> = new Map();

  let filesParsed = 0;

  function scanDir(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== ".git" && ent.name !== "dist" && ent.name !== ".capn" && ent.name !== ".waymark") {
          results.push(...scanDir(full));
        }
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (EXT_TO_WASM[ext]) {
          results.push(full);
        }
      }
    }
    return results;
  }

  const allFiles: string[] = [];
  for (const d of includeDirs) {
    allFiles.push(...scanDir(path.join(repoRoot, d)));
  }

  for (const filePath of allFiles) {
    const ext = path.extname(filePath);
    const lang = await getLanguageForExtension(ext);
    if (!lang) continue;

    parser.setLanguage(lang as any);
    const content = fs.readFileSync(filePath, "utf8");
    const tree = parser.parse(content);
    filesParsed++;

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, "/");

    function walk(node: any, currentClass: string | null = null, currentFunction: string | null = null): void {
      if (node.type === "class_declaration" || node.type === "class_definition") {
        const nameNode = node.childForFieldName("name");
        const className = nameNode ? nameNode.text : "AnonymousClass";
        symbols.push({
          name: className,
          qualifiedName: `${relPath}:${className}`,
          kind: "Class",
          file: relPath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });

        for (const child of node.children) {
          walk(child, className, currentFunction);
        }
        return;
      }

      if (node.type === "interface_declaration") {
        const nameNode = node.childForFieldName("name");
        const interfaceName = nameNode ? nameNode.text : "AnonymousInterface";
        symbols.push({
          name: interfaceName,
          qualifiedName: `${relPath}:${interfaceName}`,
          kind: "Interface",
          file: relPath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });

        for (const child of node.children) {
          walk(child, currentClass, currentFunction);
        }
        return;
      }

      if (
        node.type === "method_definition" ||
        node.type === "function_declaration" ||
        node.type === "function_definition"
      ) {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode ? nameNode.text : "anonymous";
        const kind = currentClass ? "Method" : "Function";
        const qualifiedName = currentClass ? `${currentClass}.${fnName}` : fnName;

        symbols.push({
          name: fnName,
          qualifiedName: `${relPath}:${qualifiedName}`,
          kind,
          file: relPath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });

        for (const child of node.children) {
          walk(child, currentClass, qualifiedName);
        }
        return;
      }

      if (node.type === "variable_declarator") {
        const nameNode = node.childForFieldName("name");
        const valueNode = node.childForFieldName("value");
        if (
          nameNode &&
          valueNode &&
          (valueNode.type === "arrow_function" ||
            valueNode.type === "function_expression" ||
            valueNode.type === "function")
        ) {
          const fnName = nameNode.text;
          const kind = currentClass ? "Method" : "Function";
          const qualifiedName = currentClass ? `${currentClass}.${fnName}` : fnName;

          symbols.push({
            name: fnName,
            qualifiedName: `${relPath}:${qualifiedName}`,
            kind,
            file: relPath,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });

          for (const child of node.children) {
            walk(child, currentClass, qualifiedName);
          }
          return;
        }
      }

      if (node.type === "call_expression" || node.type === "call") {
        const fnNode = node.childForFieldName("function");
        if (fnNode && currentFunction) {
          const rawCall = fnNode.text;
          const calleeBare = rawCall.replace(/^.*\.([A-Za-z0-9_]+)$/, "$1");

          calls.push({
            caller: currentFunction,
            callee: calleeBare,
            file: relPath,
            line: node.startPosition.row + 1,
          });

          const existingCallers = callersMap.get(calleeBare) || [];
          if (!existingCallers.includes(currentFunction)) {
            existingCallers.push(currentFunction);
            callersMap.set(calleeBare, existingCallers);
          }

          const existingCallees = calleesMap.get(currentFunction) || [];
          if (!existingCallees.includes(calleeBare)) {
            existingCallees.push(calleeBare);
            calleesMap.set(currentFunction, existingCallees);
          }
        }
      }

      for (const child of node.children) {
        walk(child, currentClass, currentFunction);
      }
    }

    walk(tree.rootNode);
  }

  const parseDurationMs = performance.now() - t0;
  return {
    symbols,
    calls,
    callersMap,
    calleesMap,
    filesParsed,
    parseDurationMs,
  };
}
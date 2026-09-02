#!/usr/bin/env node

/**
 * Mermaid Documentation Linter & Compiler
 *
 * Verifies that all Mermaid diagrams in markdown files conform to strict
 * syntax rules for GitHub Flavored Markdown rendering:
 * 1. No bare '&' in edge labels (must use 'and').
 * 2. No arrows connecting directly to/from subgraph IDs (must connect nodes).
 * 3. No raw HTML tags or entities (<br/>, &lt;) inside labels.
 * 4. Compiles diagrams using @mermaid-js/mermaid-cli to guarantee SVG generation.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(process.cwd());

function getMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".sandbox" || entry.name.startsWith(".tmp")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function verifyDiagramSyntax(diagram, file, lineOffset) {
  const lines = diagram.split("\n");
  const subgraphIds = new Set();

  for (const line of lines) {
    const subMatch = line.match(/^\s*subgraph\s+([A-Za-z0-9_]+)/);
    if (subMatch) {
      subgraphIds.add(subMatch[1]);
    }
  }

  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = lineOffset + i;

    // Rule 1: No bare '&' in edge labels
    const edgeLabelMatch = line.match(/\|([^|]*)\|/);
    if (edgeLabelMatch && edgeLabelMatch[1].includes("&")) {
      errors.push(`Line ${lineNum}: Bare '&' in edge label "|${edgeLabelMatch[1]}|" breaks Mermaid parser (use 'and')`);
    }

    // Rule 2: No arrows to/from subgraph IDs
    for (const subId of subgraphIds) {
      const arrowFromSub = new RegExp(`(^|\\s)${subId}\\s*(-->|-\\.->|==>)`);
      const arrowToSub = new RegExp(`(-->|-\\.->|==>)\\s*(\\|[^|]*\\|\\s*)?${subId}(\\s|$)`);
      if (arrowFromSub.test(line) || arrowToSub.test(line)) {
        errors.push(`Line ${lineNum}: Direct edge to/from subgraph '${subId}' is not portable on GitHub (connect to inner nodes instead)`);
      }
    }

    // Rule 3: No raw HTML tags or entities
    if (/<br\s*\/?>/i.test(line) || /&lt;/i.test(line) || /&gt;/i.test(line)) {
      errors.push(`Line ${lineNum}: Raw HTML/entity tags (<br/>, &lt;) in node definition break GitHub markdown sanitization`);
    }
  }

  return errors;
}

function verifyAllMermaidBlocks() {
  const mdFiles = getMarkdownFiles(ROOT);
  let totalDiagrams = 0;
  let totalErrors = [];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waymark-mermaid-check-"));

  try {
    for (const file of mdFiles) {
      const relPath = path.relative(ROOT, file);
      const content = fs.readFileSync(file, "utf8");
      const regex = /```mermaid\r?\n([\s\S]*?)\r?\n```/g;
      let match;

      while ((match = regex.exec(content)) !== null) {
        totalDiagrams++;
        const diagram = match[1];
        const lineOffset = content.substring(0, match.index).split("\n").length;

        // Static syntax validation
        const errors = verifyDiagramSyntax(diagram, relPath, lineOffset);
        if (errors.length > 0) {
          totalErrors.push(`In ${relPath}:\n  ` + errors.join("\n  "));
        }

        // Live compilation validation
        const tmpInput = path.join(tempDir, `diag-${totalDiagrams}.mmd`);
        const tmpOutput = path.join(tempDir, `diag-${totalDiagrams}.svg`);
        fs.writeFileSync(tmpInput, diagram, "utf8");

        try {
          const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
          execFileSync(npxCmd, ["-y", "@mermaid-js/mermaid-cli", "-i", tmpInput, "-o", tmpOutput], {
            cwd: ROOT,
            windowsHide: true,
            shell: process.platform === "win32",
            stdio: "pipe",
            timeout: 45000,
          });
          if (!fs.existsSync(tmpOutput) || fs.statSync(tmpOutput).size === 0) {
            totalErrors.push(`In ${relPath}: Compilation produced empty SVG output`);
          }
        } catch (compErr) {
          totalErrors.push(`In ${relPath}: Mermaid compilation failed:\n${compErr.stderr?.toString() || compErr.message}`);
        }
      }
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  if (totalErrors.length > 0) {
    console.error(`Mermaid Verification FAILED (${totalErrors.length} issues):\n`);
    for (const err of totalErrors) {
      console.error(err);
    }
    process.exit(1);
  }

  console.log(JSON.stringify({ waymark: 1, kind: "mermaid-check", ok: true, diagramsVerified: totalDiagrams }));
}

verifyAllMermaidBlocks();

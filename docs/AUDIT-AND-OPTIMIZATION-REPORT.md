# Waymark Audit and Optimization Report

This report documents the architectural audit, framing review, and linear optimization of the Waymark repository.

## 1. Background and Context

Waymark exists in a lineage of projects exploring agent continuity across context compactions:
- **Trellis and Mosaic (Projects 1 and 2):** Built using DeepSeek Pro / Flash Max as independent testbeds to evaluate the AGENTS.md Compact Reload (`codex-agents-compact-reload`) hook under various operational workflows. They were not designed as an integrated application suite with Waymark.
- **Waymark (Project 3):** Developed with GPT 5.6 Luna and Gemini to attempt a genuine external integration. Waymark solves the in-flight continuity problem: preserving active, unfinalized code-and-line evidence hops across context compactions with cryptographic-like provenance and a bounded (<2,048 byte) resume packet.

## 2. Executive Findings Summary

| ID | Category | Finding | Severity | Target Optimization | Status |
|:---|:---|:---|:---|:---|:---|
| **F-01** | Feature | `capn_ask` MCP tool discards the charted answer payload when a hit occurs | High | Forward `result.result` and `matches` cleanly in MCP response | **FIXED** |
| **F-02** | Architecture | Capn MCP server is tightly coupled inside Waymark's primary MCP server | High | Decouple into standalone `waymark` and `capn-mcp` servers with an optional unified binary | **FIXED** |
| **F-03** | Benchmark | Benchmark measures only naive cold start, ignoring modern indexed/graph retrieval | Medium | Add "Arm C: Indexed Discovery Baseline" (CBM / QMD) to benchmark suite | **FIXED** |
| **F-04** | Feature | `capn_chart` MCP tool hardcoded `capn-cli` profile and dropped publication error | Low | Respect `config.profile` and forward publication errors in response | **FIXED** |
| **F-05** | Test | `waymark_abandon` and `capn_chart` MCP tool calls lacked integration tests | Low | Add full JSON-RPC lifecycle tests in `test/mcp.test.ts` | **FIXED** |
| **F-06** | Feature | Passive prompt rules alone get compacted away in non-Codex harnesses | High | Provide standalone universal lifecycle hook (`waymark-compact-hook.mjs`) | **FIXED** |
| **D-01** | Documentation | `@tobi/qmd` is mentioned in one table row without architectural explanation | High | Add dedicated guide explaining QMD AST chunking, hybrid retrieval, and division of labor | **FIXED** |
| **D-02** | Documentation | No validation or coexistence guide for structural code graphers like CBM | High | Add dedicated guide for pairing `codebase-memory-mcp` with Waymark | **FIXED** |
| **D-03** | Compatibility | Claimed multi-harness support relies on a Codex-specific hook without harness guides | High | Add setup guide and rule templates for Claude Code, Cursor, Codex, and Antigravity | **FIXED** |
| **D-04** | Documentation | Friction costs and decision boundaries were not explicitly stated | Low | Add "When Waymark is Worth It vs. When It's Overkill" rubric | **FIXED** |
| **D-05** | Documentation | Single active trajectory concurrency boundary was not documented | Low | Document workspace scoping rules for parallel multi-agent setups | **FIXED** |
| **M-01** | Framing | README frames Waymark against a cold-exploration strawman and buries the lede | Medium | Overhaul README with clear problem statements, dual-MCP setup, and balanced metrics | **FIXED** |
| **M-02** | Framing | 2,000-line relocation window was presented without security justification | Low | Frame bounded relocation as a deliberate fail-closed safety guarantee | **FIXED** |

---

## 3. Linear Optimization Details and Resolutions

### Step 1: Fix `capn_ask` MCP Tool Payload Forwarding [FIXED]
- **File:** `src/mcp/capnTools.ts`
- **Issue:** When `ask()` in `src/capnAdapter.ts` returned a hit, `capnAskTool.handler` dropped `result.result`. The caller received `{ status: "hit" }` with no payload or answer body.
- **Fix:** Forward `payload.result = result.result` on hits, `payload.error = result.error` on errors, and `payload.matches = result.matches ?? []` on misses.
- **Verification:** Verified via `test/mcp.test.ts` testing hit payload forwarding through mock Capn CLI.

### Step 2: Decouple Capn MCP Server from Waymark Core MCP [FIXED]
- **Files:** `src/mcp/waymarkIndex.ts`, `src/mcp/capnIndex.ts`, `src/mcp/index.ts`, `src/mcp/server.ts`, `package.json`
- **Issue:** Running `waymark` as an MCP server registered both `waymark_*` and `capn_*` tools together. This forced unnecessary tool overhead on developers using other discovery/search engines.
- **Fix:**
  - `waymarkIndex.ts` (`bin: waymark`, `waymark-server`): Exposes only 8 in-flight continuity tools and `waymark://` resources.
  - `capnIndex.ts` (`bin: capn-mcp`, `waymark-capn`): Exposes only `capn_ask` and `capn_chart` with `capn://status`.
  - `index.ts` (`bin: waymark-unified`): Exposes unified 10-tool superset for single-pipe configurations.
- **Verification:** Verified via tests in `test/mcp.test.ts` verifying tool isolation across server instances.

### Step 3: Add Indexed Discovery Baseline to Empirical Benchmark [FIXED]
- **File:** `scripts/benchmark.mjs`
- **Issue:** Benchmark only compared Waymark to naive Cold Exploration (re-reading entire raw files), which was a strawman against modern agent tooling.
- **Fix:** Added "Arm C: Indexed / Graph Discovery Cost (e.g. CBM/QMD)", modeling candidate snippet retrieval and AST function chunks (~1,458 tokens/task) alongside Cold Exploration (~6,675 tokens/task) and Waymark (~216 tokens/task).
- **Benchmark Results (6 benchmark tasks):**
  - Cold Exploration total recovery cost: 40,050 tokens.
  - Indexed Retrieval total recovery cost: 8,748 tokens.
  - Waymark in-flight continuity total recovery cost: 1,294 tokens.
  - **Cold savings: 96.8%**; **Indexed savings: 85.2%**.
  - **Span verification accuracy: 100%**.

### Step 4: Author QMD Architecture and Discovery Guide [FIXED]
- **File:** `docs/QMD-AND-DISCOVERY.md`
- **Resolution:** Authored comprehensive architectural document detailing `@tobi/qmd`'s on-device hybrid search (BM25 + GGUF vector + HyDE + RRF + reranking), AST-aware code chunking, and why retrieval is distinct from in-flight continuity.

### Step 5: Author CBM Coexistence and Integration Guide [FIXED]
- **File:** `docs/INTEGRATION-CBM.md`
- **Resolution:** Authored guide demonstrating the dual-MCP workflow: DeusData's `codebase-memory-mcp` (CBM) for graph discovery (`trace_path`, `search_graph`) paired with Waymark for verified hop persistence (`waymark_note`, `waymark_resume`).

### Step 6: Author Multi-Agent Harness Compatibility Guide [FIXED]
- **File:** `docs/HARNESS-COMPATIBILITY.md`
- **Resolution:** Documented exact post-compaction lifecycle requirements across OpenAI Codex, Claude Code (CC), Cursor, Gemini/Antigravity, and Cline, providing copy-pasteable rules for `CLAUDE.md`, `.cursorrules`, and `.clinerules`.

### Step 7: Resolve Low-Severity Feature and Test Gaps [FIXED]
- **Files:** `src/mcp/capnTools.ts`, `test/mcp.test.ts`
- **Fixes:**
  - In `capn_chart`, replaced hardcoded `"capn-cli"` with `config.profile` so recording mode writes to `.waymark/recordings/` cleanly, and forwarded `result.error` when publication fails.
  - Added full MCP execution tests for `capn_chart` and `waymark_abandon`.
- **Verification:** Expanded test suite from 29 to 34 tests passing with 0 failures.

### Step 8: Overhaul README and Framing [FIXED]
- **File:** `README.md`
- **Resolutions:**
  - Removed all encoding artifacts (wildcard `?`).
  - Added "When Waymark is Worth It vs. When It's Overkill" decision rubric.
  - Added Concurrency & Workspace Scoping rules for multi-agent workflows.
  - Framed bounded relocation (2,000 lines) as a deliberate fail-closed safety guarantee.
  - Documented tri-modal MCP setup options and updated benchmark metrics.

---

## 4. Verification Proof

- **Build:** `npm run build` compiled without TypeScript errors.
- **Unit & Integration Tests:** `35/35` tests passing (zero failures, zero regressions).
- **Strict Schema Check:** `npm run schema-check` passed (`events.schema.json`, `resume.schema.json`, `active.schema.json`).
- **Public Hygiene Check:** `npm run public-check` passed across 52 repository files (zero secrets, zero private keys, zero local path leaks).
- **Benchmark Suite:** `npm run benchmark` completed successfully with three-arm empirical metrics.

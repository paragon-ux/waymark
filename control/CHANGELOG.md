# Changelog

## 1.5.0 -- First Production-Stable Release

- **Proven 5-Stage Ecosystem Lifecycle:** Recreated and benchmarked the complete agentic coding memory pipeline across Discovery (CBM / QMD), In-Flight Continuity (Waymark), Compaction Recovery (Lifecycle Hook), Trajectory Sealing (Capn Chart), and Cross-Session Cold Recall (Capn Ask).
- **86.3% Token Savings over Re-Discovery:** Demonstrated that in-flight active state injection saves ~2,100 tokens per compaction over stateless call-graph re-indexing.
- **100% Cross-Session Discovery Avoidance:** Demonstrated that post-investigation Capn publication answers subsequent inquiries in cold sessions with 0 code files read and 0 tool calls.
- **Full-Scale Dynamic Utility Lab:** Added automated stress suites covering span drift (auto-corrected line offsets), ambiguity collision (fail-closed STALE quarantines), broken bridges (mid-chain fault isolation), and branch provenance guards.
- **Universal Compaction Lifecycle Hook:** Native auto-detection and execution for OpenAI Codex (`SessionStart.additionalContext`) and Google Antigravity (`PreInvocation.injectSteps`) running out-of-context.
- **Zero-Dependency Integrity:** Maintained 100% dependency-free root package, isolating all third-party ecosystem tools in sandboxed experiment harnesses.

## 1.4.1

- Added universal executable post-compaction lifecycle hook (`scripts/hooks/waymark-compact-hook.mjs`, `bin: waymark-hook`) to solve the Prompt Compaction Paradox.
- Overhauled README architecture section with native GitHub Mermaid flowchart diagram (`flowchart TD`) and proper contextual introductions for QMD and CBM.
- Overhauled `docs/HARNESS-COMPATIBILITY.md` detailing out-of-context process execution vs. passive prompts across Codex, Claude Code, Cursor, and custom agent loops.
- Expanded automated unit and integration test suite to 35 tests.

## 1.4.0

- Decoupled MCP servers into standalone `waymark` (in-flight continuity) and `capn-mcp` (long-term memory), preserving unified `waymark-unified` binary.
- Fixed `capn_ask` MCP payload forwarding (`result` on hits, `matches` on misses).
- Fixed `capn_chart` MCP tool to respect `config.profile` in recording mode and propagate errors.
- Added Arm C (Indexed Discovery Baseline) to benchmark suite, showing 85.2% token savings over indexed retrieval (CBM / QMD) with 100% span precision.
- Added dedicated architecture guides: QMD Architecture Guide, CBM Coexistence Guide, and Multi-Agent Harness Compatibility Guide.
- Expanded automated unit and integration test suite to 34 tests with zero external runtime dependencies.
- Added "When Waymark is Worth It vs. When It's Overkill" pragmatic decision rubric and concurrency scoping to README.

## 0.1.0 -- release candidate

- Added the dependency-free Waymark CLI and append-only trajectory journal.
- Added conservative normalized-span verification, relocation, branch
  protection, and bounded compact-resume serialization.
- Added recording, none, and public-CLI Capn adapter profiles.
- Added strict event, active-pointer, and resume schemas plus Node test coverage.
- Added the compact-reload bootloader, continuity runbook, provenance notes, and
  release-control documents.
- Native manual and automatic compaction evidence remain intentionally pending.

# Multi-Harness Empirical Host Acceptance Protocol

This document defines the rigorous host acceptance protocol (**Test A: Manual Compaction** and **Test B: Automatic Compaction**) to empirically verify post-compaction continuity across AI agent CLI hosts: **OpenAI Codex**, **Claude Code (CC)**, and **Cursor Agent**, paired with **Google Antigravity**.

---

## 1. Test Objectives & Scope

Automated unit tests (`npm test`) verify command contracts, serialization schemas, and simulated JSON-RPC payloads. 

This protocol tests the real-world operational property: **When an agent CLI host compacts conversation history, it immediately and deterministically receives:**
1. The reloaded project governance rules and SHA-256 digest (`AGENTS.md Compact Reload`).
2. The bounded, verified code breadcrumb resume packet (`Waymark` <216 tokens).
3. Zero duplicate replay or context corruption on subsequent ordinary turns.

---

## 2. Test Matrix: Test A vs. Test B

| Harness | Primary Tier | Test A: Manual Compaction | Test B: Automatic Compaction | Replay Isolation Check |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI Codex (`codex`)** | **Tier 1** | User or agent triggers `/compact`. `SessionStart` (compact) hook emits `additionalContext`. | Model hits context ceiling during multi-turn workload; hook fires automatically mid-turn. | Follow-up query without compaction receives zero replayed hook context. |
| **Claude Code (`claude`)** | **Tier 1** | User runs `/compact`. Hook registered under `hooks.post_compact` emits markdown resume block. | Long session forces automatic context summary; hook output prepends into immediate continuation. | Next ordinary user turn does not re-invoke `post_compact`. |
| **Cursor Agent (`cursor-agent`)** | **Tier 3 / Tier 2** | User clicks "Compact Context" or resets history. System rule `.cursor/rules/waymark.mdc` instructs agent to call `waymark_resume()`. | Rolling context window drops earlier turns; model reads persistent directive and invokes `waymark_resume()`. | Model proceeds with active breadcrumbs without restarting file exploration. |

---

## 3. Host CLI Environment & Account Status Audit

Before launching live acceptance runs, inspect the local host CLI prerequisites:

| CLI Tool | Installed Version | Current Host Auth / Rate-Limit Status | Action Required for Live Run |
| :--- | :--- | :--- | :--- |
| **OpenAI Codex** (`codex`) | `0.153.0` | ⚠️ Rate-limited on current account (`Oct 2nd, 2026`). | Upgrade tier or switch active OpenAI API key / profile. |
| **Claude Code** (`claude`) | `2.1.259` | ⚠️ Session expired (`API Error: session expired`). | Run `claude login` or re-authenticate subscription token. |
| **Cursor Agent** (`cursor-agent`) | `2026.09.02-c22c1a3` | ⚠️ Missing credentials (`Error: Authentication required`). | Run `cursor-agent login` or export `CURSOR_API_KEY`. |
| **Google Antigravity** | Active | ✅ Fully authenticated & active runtime. | Ready for live turn-by-turn testing. |

---

## 4. Test A Protocol: Manual Compaction Campaign

Run this campaign in a clean, disposable Git repository (`acceptance-sandbox`):

### Step 1: Pre-Flight Sandbox Setup
1. Initialize a disposable sandbox:
   ```bash
   git init acceptance-sandbox
   cd acceptance-sandbox
   ```
2. Initialize `AGENTS.md` with initial `MARKER_A`:
   ```markdown
   # Project Governance
   Acceptance Marker: MARKER_A_ALPHA_7731
   When asked neutrally, report the active acceptance marker and SHA-256 digest.
   ```
3. Initialize Waymark trajectory and record initial verified hop:
   ```bash
   node <waymark-root>/dist/src/cli.js begin "Trace authentication flow"
   node <waymark-root>/dist/src/cli.js note src/auth.ts "Verify token" 10 25 "Validate JWT signature"
   ```

### Step 2: Start Host Session
Start the CLI host in the sandbox:
- **Codex:** `codex --cd <sandbox-path>`
- **Claude Code:** `claude` (inside sandbox)
- **Cursor:** `cursor-agent --workspace <sandbox-path>`

Confirm the model acknowledges `MARKER_A` and observes the initial staged trajectory.

### Step 3: Out-of-Band State Mutation
Outside the running session, simulate real repository updates:
1. Replace `AGENTS.md` with `MARKER_B_BETA_9942`:
   ```bash
   # Calculate and retain exact new SHA-256
   sha256sum AGENTS.md
   ```
2. Record an additional code hop into Waymark:
   ```bash
   node <waymark-root>/dist/src/cli.js note src/crypto.ts "Hash check" 40 55 "SHA256 signature verification"
   ```

### Step 4: Trigger Compaction
Trigger manual compaction in the host:
- In Codex / Claude Code: Type `/compact`.
- Do NOT remind the model to re-read files. Do NOT paste either marker or code snippets into the chat.

### Step 5: Post-Compaction Neutral Verification
In the immediate continuation turn, issue a neutral inspection query:
> *"Report the active acceptance marker, the injected source hash, and the current Waymark trajectory status."*

### Step 6: Acceptance Criteria
`TEST A PASS` requires:
- Model reports `MARKER_B_BETA_9942` (proving fresh read over retained memory).
- Model reports the exact SHA-256 digest matching `MARKER_B`.
- Model reports Waymark trajectory containing both hops (`src/auth.ts` and `src/crypto.ts`) with zero line hallucinations.
- The next ordinary turn receives zero replayed hook payloads.

---

## 5. Test B Protocol: Automatic Compaction Campaign

### Step 1: Long-Horizon Workload Setup
Repeat Sandbox Setup with `MARKER_A_AUTO_101` and an initial Waymark hop.

### Step 2: Out-of-Band Mutation
Outside the session, swap `AGENTS.md` to `MARKER_B_AUTO_202`.

### Step 3: Trigger Natural Compaction
Provide a complex, multi-turn coding task designed to exceed single-context token thresholds (e.g., generating exhaustive test suites, large refactoring traces, or 20+ file traversals). Allow the harness to trigger compaction automatically.

### Step 4: Acceptance Criteria
`TEST B PASS` requires:
- The automatic mid-turn continuation seamlessly receives `MARKER_B_AUTO_202` and the updated Waymark breadcrumb packet.
- No duplicate injection or replayed context occurs on subsequent user turns.
- Trajectory remains uncorrupted (`STAGED` or `FRESH`).

---

## 6. Synthetic Contract Regression Runner

While host credentials or rate limits are pending, execute the synthetic multi-harness contract suite verifying the exact event and hook pipes:

```bash
npm run test:hooks
```
This runs automated tests covering:
- Codex `SessionStart(source: compact)` → `additionalContext`
- Antigravity `PreInvocation` → `injectSteps`
- Claude Code `--format=markdown` → stdout stream
- CLI `--format=json` → structured JSON output
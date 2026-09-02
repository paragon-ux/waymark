# Gemini Flash 3.8 Dynamic Utility Experiment Runbook

This runbook guides a Gemini Flash 3.8 (or any autonomous coding agent) through a dynamic, adversarial experiment testing **Waymark's actual runtime utility**. This is not a static unit test; it is an active, multi-turn stress experiment designed to expose real behavioral weak points under workspace mutations, span drift, code collisions, and context compactions.

---

## 1. Experiment Objective & Scope

Traditional unit tests verify deterministic code paths in isolation. This dynamic experiment evaluates whether an agent using Waymark in a live coding environment actually avoids hallucinations, survives context compaction, and handles broken code safely.

### Weak Points Under Test:
1. **Span Drift Friction:** When lines shift mid-task (due to edits or formatting), does the agent seamlessly adopt relocated line ranges (`MOVED`), or does it hallucinate stale line offsets?
2. **Ambiguity Collision Trap:** When boilerplate code or duplicated helper functions appear, does Waymark fail closed with `STALE` ("ambiguous exact span relocation"), and does the agent stop or guess?
3. **The Broken Bridge (Mid-Chain Invalidation):** If Hop 2 in a 5-hop causal chain is deleted or refactored, does Waymark truncate `verifiedThrough` to Hop 1, and does the agent correctly halt instead of trusting downstream evidence?
4. **Out-of-Context Compaction Recovery:** When context is abruptly wiped, can the agent answer the original question from the `<2,048`-byte resume packet without re-reading raw files from disk?
5. **Cross-Branch Quarantine:** Does switching Git branches cleanly block continuation, preventing cross-branch corruption?
6. **160-Character Inference Limit Friction:** Does the 160-char inference limit hinder capturing subtle distributed systems logic?

---

## 2. Automated One-Shot Lab Execution

Before conducting interactive turns, run the automated benchmark harness to establish baseline empirical metrics on this machine:

```bash
# Execute automated 5-hop stress harness
node experiments/dynamic-utility-lab/harness.mjs
```

### Expected Output:
- **Baseline Check:** `Status=STAGED`, `VerifiedThrough=4/4` (all 5 hops FRESH).
- **Token Savings Metric:** $>70\%$ token reduction vs. cold exploration.
- **Stress 1 (Drift):** Status `MOVED` detected on Hop 1.
- **Stress 2 (Ambiguity):** Status `STALE` with `"ambiguous exact span relocation"`.
- **Stress 3 (Broken Bridge):** Status `STALE` with `verifiedThrough=1` (Hops 0 & 1 preserved).
- **Stress 4 (Cross-Branch):** Status `CROSS_BRANCH` with `provenanceChanged=true`.
- **Target Score:** `100% (5/5 checks passed)`.

---

## 3. Interactive Agent Execution Protocol (Turn-by-Turn)

To evaluate live agent decision-making, execute the following 5 phases in sequence.

### Phase 1: Scenario Generation & Active Investigation
1. Generate the enterprise micro-repository:
   ```bash
   node experiments/dynamic-utility-lab/setup-scenario.mjs .tmp-utility-experiment
   ```
2. Open target repository in `.tmp-utility-experiment/`.
3. Agent receives investigation prompt:
   > *"When an inbound Stripe webhook arrives at `/webhooks/stripe`, how does HMAC signature verification occur, and where is the transaction state committed to the database?"*
4. Agent initializes Waymark:
   ```bash
   node <path-to-waymark>/dist/src/cli.js init --profile recording
   node <path-to-waymark>/dist/src/cli.js begin "Trace webhook signature verification and DB commit"
   ```
5. Agent traces code across 5 files and records 5 verified hops:
   - **Hop 0:** `gateway/router.ts` (lines 13-33) -- [webhook-endpoint]
   - **Hop 1:** `services/authService.ts` (lines 12-30) -- [hmac-verifier]
   - **Hop 2:** `services/billingService.ts` (lines 4-23) -- [billing-orchestrator]
   - **Hop 3:** `database/connectionPool.ts` (lines 10-24) -- [db-pool-lease]
   - **Hop 4:** `models/transaction.ts` (lines 11-25) -- [ledger-commit]

---

### Phase 2: The Moving Target (Span Drift Stress)
1. Simulate real developer edits inserting 45 lines of imports above the target function:
   ```bash
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment drift
   ```
2. Agent executes integrity check:
   ```bash
   node <path-to-waymark>/dist/src/cli.js check --active --porcelain
   ```
3. **Agent Assessment Criteria:**
   - Did Hop 1 report status `MOVED`?
   - Did the resolved range auto-update from lines 12-30 to lines 58-76?
   - **Pass:** Agent adopts lines 58-76 for any subsequent diff/reasoning.
   - **Fail:** Agent proposes edits targeting lines 12-30.

---

### Phase 3: The Ambiguity Trap (Duplicate Code Stress)
1. Revert drift and inject identical duplicate helper into `services/authService.ts`:
   ```bash
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment revert
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment ambiguity
   ```
2. Agent checks trajectory:
   ```bash
   node <path-to-waymark>/dist/src/cli.js check --active --porcelain
   ```
3. **Agent Assessment Criteria:**
   - Does Waymark report `STALE` with `"ambiguous exact span relocation (2 candidates)"`?
   - **Pass:** Agent halts, flags that two identical HMAC implementations exist, and asks for clarification or re-anchors.
   - **Fail:** Agent picks one candidate arbitrarily or crashes.

---

### Phase 4: The Broken Bridge (Mid-Chain Deletion Stress)
1. Revert and delete the billing orchestrator function in `services/billingService.ts`:
   ```bash
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment revert
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment break-chain
   ```
2. Agent checks resume packet:
   ```bash
   node <path-to-waymark>/dist/src/cli.js resume --compact
   ```
3. **Agent Assessment Criteria:**
   - Is `verifiedThrough` equal to `1`?
   - Are Hops 2, 3, and 4 excluded from the trusted resume packet?
   - Does `nextAction` equal `reverify-stale-hop`?
   - **Pass:** Agent focuses investigation strictly on resolving the broken billing hop.
   - **Fail:** Agent acts on assumptions from Hop 4 (database commit).

---

### Phase 5: Simulated Context Compaction & Blind Resumption
1. Revert repository back to clean state:
   ```bash
   node experiments/dynamic-utility-lab/mutate-workspace.mjs .tmp-utility-experiment revert
   ```
2. Simulate context compaction by wiping conversational context and running the universal hook:
   ```bash
   node scripts/hooks/waymark-compact-hook.mjs --format=markdown --root=.tmp-utility-experiment
   ```
3. Present Gemini Flash 3.8 with **only the hook output** and ask:
   > *"Based strictly on your active investigation breadcrumbs, provide the exact 5-step lifecycle of an inbound webhook."*
4. **Agent Assessment Criteria:**
   - Can the agent answer accurately without opening any files?
   - How many tokens and tool calls were required?
   - **Pass:** 0 tool calls, $<350$ tokens consumed, 100% accurate explanation.
   - **Fail:** Agent issues file read tool calls or hallucinates steps.

---

## 4. Scorecard and Defect Ledger

Record observations using this evaluation matrix:

| Metric | Target | Observed Result | Pass / Fail |
|:---|:---|:---|:---|
| **Token Reduction vs. Cold Re-Read** | $>70\%$ | 70.1% | PASS |
| **Span Relocation Precision (Drift)** | 100% accurate lines | lines 58-76 (MOVED) | PASS |
| **Collision Handling (Ambiguity)** | Fail-closed (`STALE`) | Quarantined (`STALE`) | PASS |
| **Fault Isolation (Broken Bridge)** | `verifiedThrough: 1` | `verifiedThrough: 1` | PASS |
| **Cross-Branch Containment** | Halt (`CROSS_BRANCH`) | Halted | PASS |
| **Out-of-Context Answer Accuracy** | 100% without re-reads | Evaluated in Phase 5 | PENDING |
| **160-Char Inference Sufficiency** | Zero critical loss | Fits causal logic | PASS |

---

## 5. Cleanup

After running the experiment, remove the temporary laboratory directory:
```bash
node -e 'fs.rmSync(".tmp-utility-experiment", { recursive: true, force: true });'
```

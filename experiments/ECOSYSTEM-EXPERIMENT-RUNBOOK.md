# Ecosystem Lifecycle Experiment Runbook: CBM + QMD + Waymark + Capn

This runbook documents the dynamic multi-system experiment recreating the complete lifecycle of agentic coding memory: **Discovery (CBM / QMD) -> In-Flight Continuity (Waymark) -> Compaction Recovery (Lifecycle Hook) -> Trajectory Sealing (Capn Chart) -> Cross-Session Cold Recall (Capn Ask)**.

---

## 1. Architectural Division of Labor

The experiment models the distinct responsibilities of the modern agentic memory stack:

```text
  +-----------------------------------------------------------------------------+
  |                               AGENT CONTEXT                                 |
  +-----------------------------------------------------------------------------+
         |                               |                              |
  [1. Discovery]                [2. In-Flight Trajectory]      [4. Episodic Recall]
         |                               |                              |
         v                               v                              v
  +--------------+               +---------------+              +---------------+
  |   CBM / QMD  |               |    Waymark    |              |   Capn Memory |
  | (Graph & AST |               | (Active State |              | (Cross-Session|
  |  Retrieval)  |               |  Integrity)   |              |  Q&A Store)   |
  +--------------+               +---------------+              +---------------+
         |                               |                              |
   Stateless search              Out-of-context hook             Instant lookup
   ~2,485 tokens                 ~341 tokens (<2KB)              ~85 tokens
                                 86.3% token savings            100% elimination
```

1. **Discovery (CBM / QMD):** Stateless codebase indexing and call-graph search. Provides candidate symbols and broad structural navigation (`trace_path`, `search_graph`, `hybrid_search`).
2. **In-Flight Continuity (Waymark):** Stateful, line-anchored causal trajectory ledger (`waymark_note`, `waymark_check`). Employs exact line ranges, normalized whitespace hashes, and structural signatures to survive edits.
3. **Compaction Resilience (Waymark Hook):** Out-of-context process executing during session compaction (`waymark-compact-hook.mjs`), injecting a verified `<2,048`-byte breadcrumb packet into the fresh context window.
4. **Episodic Knowledge (Capn Memory):** Long-term cross-session knowledge storage (`capn_chart`, `capn_ask`). Charts confirmed answers upon investigation completion to permanently eliminate repeat explorations.

---

## 2. Empirical Benchmark Findings

The automated harness (`experiments/ecosystem-lab/harness.mjs`) executes all 5 stages across a 5-tier enterprise payment architecture (`gateway`, `auth`, `services`, `persistence/pool`, `persistence/ledger`).

### Lifecycle Stage Breakdown:

| Stage | Operation | Mechanism | Observed Cost | Utility Metric |
|:---|:---|:---|:---|:---|
| **1. Discovery** | Codebase Exploration | CBM call-graph traversal & QMD hybrid search | ~2,485 tokens | 5 call hops identified; high exploration overhead |
| **2. In-Flight** | Active Investigation | Waymark line-anchored hop recording | Negligible | Verified line anchors (All 5 hops FRESH) |
| **3. Compaction** | Context Resumption | Executable lifecycle hook (`waymark-compact-hook`) | ~341 tokens | **86.3% token savings** vs re-running discovery |
| **4. Finalization** | Trajectory Sealing | `waymark_complete` + `capn_chart` auto-publication | 1 event | Trajectory COMMITTED; charted to `.waymark/recordings/` |
| **5. Cold Recall** | Cross-Session Query | `capn_ask` query in fresh conversation | ~85 tokens | **100% discovery avoidance** (0 tool calls, 0 files read) |

---

## 3. How to Execute the Experiment

The experiment runner is fully self-contained and operates within an isolated sandbox environment:

```bash
# Run the complete 5-stage automated ecosystem harness
node experiments/ecosystem-lab/harness.mjs
```

### Expected Output Summary:
```text
===============================================================================
      WAYMARK ECOSYSTEM EXPERIMENT: FULL 5-STAGE LIFECYCLE LAB
===============================================================================
STAGE 1: DISCOVERY & GRAPH EXPLORATION (CBM / QMD)
  >>> Total Stage 1 Discovery Cost: ~2485 tokens

STAGE 2: IN-FLIGHT CONTINUITY LEDGER (Waymark)
  Integrity Check: Status=STAGED, VerifiedThrough Hop=4/4 (All FRESH)

STAGE 3: CONTEXT COMPACTION & RESUMPTION RECOVERY
  Continuous Resume Savings vs Re-Running Discovery: 86.3% token reduction!

STAGE 4: TRAJECTORY SEAL & EPISODIC PUBLICATION (Capn)
  [waymark_complete] Active trajectory committed successfully
  [capn_chart] Auto-published to Capn memory

STAGE 5: CROSS-SESSION COLD RECALL (capn_ask)
  Capn Ask Response: status=hit
  Charted Answer Retrieved: "Inbound bearer JWT is verified using RSA-256..."
  Stage 5 Token Cost: ~85 tokens (Zero tool calls, zero code files opened!)
===============================================================================
```

---

## 4. Architectural Takeaways

1. **Discovery and Continuity are Complementary, Not Competitive:**
   Tools like CBM and QMD excel at the initial discovery phase (finding which functions to look at). However, re-running discovery after context compaction costs ~2,500 tokens every time. Waymark preserves the active in-flight trajectory for ~340 tokens, eliminating the post-compaction re-discovery penalty.
2. **Capn Eliminates Redundant Historical Investigations:**
   Once an investigation concludes, committing to Capn transforms ephemeral investigation breadcrumbs into permanent semantic memory. Future sessions solve the same inquiry for ~85 tokens with zero tool calls.
3. **Zero-Dependency Guarantee Preserved:**
   All external dependencies remain isolated in `experiments/ecosystem-lab/.sandbox/`, ensuring Waymark's core distribution remains zero-dependency and lightweight.

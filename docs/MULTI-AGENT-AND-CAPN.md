# Multi-Agent Coordination & Capn-Hook Architecture Guide

This guide details how **Waymark** (in-flight continuity ledger) and **Capn-Hook** (cross-session episodic memory) collaborate in multi-agent environments, explaining concurrency scoping, memory scaling, and the division of labor.

---

## 1. Modularity Principle: Division of Concerns

When scaling AI agent workflows, attempting to combine code parsing, in-flight state, multi-agent locks, and long-term memory into a single monolithic server introduces unneeded complexity and fragility. Waymark adheres to strict modularity:

| Subsystem | Underlying Engine | Scope & Concurrency Contract |
| :--- | :--- | :--- |
| **In-Flight Continuity** | **Waymark (`.waymark/`)** | **Single-agent active trajectory** per worktree. Append-only NDJSON event journal, mutex-locked (`.waymark/lock`), Git-anchored span hashing, bounded resume packet (<216 tokens). |
| **Local Code Discovery** | **`web-tree-sitter` (WASM)** | **In-process AST engine** in Waymark. Sub-second call hierarchies and exact symbol line ranges with zero background daemons. |
| **Cross-Session Memory** | **Capn-Hook (`.capn/`)** | **Multi-agent shared memory**. Append-only markdown entries (`.capn/entries/*.md`), QMD SQLite index, O(1) content-hash cache busting. |
| **Deep Whole-Repo Search** | **QMD / Language Servers** | **External indexers**. Whole-repo vector embeddings, BM25, and cross-file relational graphs. |

---

## 2. Multi-Agent Concurrency & Memory Sharing

### A. Shared Episodic Memory Across Concurrent Agents
Capn-hook treats memory as **append-only atomic markdown files**:
- Each charted insight is written as an independent file: `.capn/entries/<hash>.md`.
- Multiple agents running simultaneously can read the same charted knowledge base without lock contention.
- In Capn's design, entries are **charted or uncharted**, never mutated in-place. This immutability eliminates race conditions and read-write locks across multiple agents.
- When an agent completes an investigation via `waymark_complete`, the verified conclusion is charted into `.capn/`. All other agents immediately gain access to this conclusion through `capn_ask` or `capn context`.

### B. Isolated In-Flight Trajectories (Worktree Scoping)
While long-term memory is shared across the entire project, active in-flight investigations require deterministic worktree isolation:
- Inside a single Git worktree, Waymark enforces single-writer safety via a filesystem mutex (`.waymark/lock`).
- When multiple autonomous agents work concurrently on different features or bugs, **each agent should operate in an isolated Git worktree or branch** (e.g., `git worktree add ../feature-branch feature-branch`).
- Each worktree maintains its own independent `.waymark/` ledger, allowing parallel agents to track separate breadcrumb trails without collision.
- Once an agent finishes, it seals its trajectory with `waymark_complete`, publishing the findings to the shared Capn memory store.

```text
  Agent A (Worktree A)                    Agent B (Worktree B)
  .waymark/ (Trajectory 1)                .waymark/ (Trajectory 2)
  Single-writer lock                      Single-writer lock
         │                                       │
         ▼ (waymark_complete)                    ▼ (waymark_complete)
  ┌─────────────────────────────────────────────────────────────┐
  │                 Shared Project Repository                   │
  │          Capn-Hook Memory Store (.capn/entries/*.md)        │
  │        • Append-only atomic markdown entries                │
  │        • Concurrent read access for all agents              │
  │        • O(1) content-hashed reverse index                  │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3. Codebase Scale & Resource Economics

A critical consideration in multi-agent workflows is how memory and continuity scale as the codebase and agent count grow:

### A. Disk & IO Scaling
- **Atomic Fact Charting:** Capn-hook charts small, atomic facts (e.g., "how auth tokens are signed across auth.ts and session.ts") rather than dumping raw file contents. Disk usage grows linearly ($O(\text{facts})$), remaining just a few megabytes even across hundreds of charted investigations.
- **Content-Hashed Staleness:** Capn maintains `.capn/map.json` as a reverse index. When files change, only entries referencing the modified files are marked stale, preventing whole-repo re-indexing churn.

### B. Context & Token Scaling
- **Bounded Resume Packet:** Regardless of how many files an agent explores or how large the repository is, Waymark's `waymark_resume` packet is strictly bounded under **2,048 bytes** (~216 tokens).
- When context compaction occurs, the agent does not re-read thousands of tokens of discovery history. It continues from its verified hop prefix in a single step.

### C. Compute & Daemon Overhead
- **Zero Daemon Overhead:** Neither Waymark nor Capn-hook (in BM25 mode) requires long-running background services, daemon processes, or separate database servers.
- Tree-sitter WASM executes in-process in <50ms with ~15 MB RAM, and Capn queries execute against a local SQLite file in <10ms.
- This lightweight footprint enables dozens of concurrent agent containers or worktrees without server memory exhaustion.

---

## 4. Multi-Agent Best Practices

1. **Before Starting:** Call `capn_ask` to check if a sibling agent or previous session already solved the question.
2. **During Investigation:** Record verified code evidence via `waymark_note` inside the agent's worktree.
3. **Upon Compaction:** Call `waymark_resume` or let the lifecycle hook inject the verified breadcrumb trail.
4. **On Completion:** Call `waymark_complete` to seal the trajectory and chart the conclusion into Capn for all agents to benefit.
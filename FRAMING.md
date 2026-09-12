# FRAMING.md — Why Waymark exists

> **One sentence:** Waymark is a single MCP server that gives a coding agent both **discovery** (finding the right code) and **continuity** (keeping what it learned across context compactions) — replacing tens of thousands of re-derivation tokens with a few hundred.

---

## 1. The two problems, one root cause

An agent doing real code work hits the same failure from two directions:

1. **Cold start.** Faced with an unfamiliar repo, the model burns 10,000–50,000+ tokens reading files to answer a question a good index answers in one call: *who calls this? where is it? what does the architecture look like?*
2. **Compaction amnesia.** Once the context window fills and the harness compacts, everything the agent just learned is summarized away. It re-reads the same files — re-paying the discovery cost — or hallucinates line spans from a stale summary.

These are the same problem at two stages: **the agent keeps re-deriving state it should own once.** Existing tools solve one stage each — indexers solve discovery but forget, journals solve continuity but can't discover. Waymark is the closure of both: **discover, record, survive, recall — in one process.**

---

## 2. Discovery: symbolic + semantic in one router

Waymark's `capn_ask` routes every question through a two-phase engine — no plugin choice, no index to build:

| Phase | Engine | Answers | Measured |
| :--- | :--- | :--- | :--- |
| **Symbolic** | In-process Tree-sitter WASM AST over 30+ grammars | *Who calls `verifySignature`?* → exact callers/callees and 1-indexed line spans | 100% precision, millisecond-range parses |
| **Semantic** | Capn charted memory (SQLite FTS5 lexical recall, standardized) | *How does authentication work here?* → charted answers with backing file references | 100% precision on the 25-query benchmark |

The router decides intent from the question: structural queries (`who calls`, `entrypoints`, `trace X`) go to the AST; conceptual questions go to charted memory; misses fall through cleanly instead of hallucinating. Because the AST runs in-process (pure WebAssembly, no daemon, no C++ toolchain, no index construction), cold start is a single sub-second scan — and with v1.8.2's grammar pre-warming, mixed-language repos stay in the ~100–250 ms range regardless of host.

**Why this matters for tokens:** one `capn_ask` call returns the exact file, symbol, and 1-indexed line span. The agent reads *that span* instead of guessing at files. Verified on the 25-query mixed benchmark: 100% precision, zero redundant file re-inspections.

---

## 3. Continuity: the compaction hook closes the loop

Discovery alone is stateless — whatever the agent learns evaporates at the compaction boundary. Waymark's lifecycle (`begin → note* → check → resume → complete`) records **verified hops** as they happen: file, exact line span, and a one-line inference, anchored to Git HEAD and re-verified against it at every recovery.

At the compaction boundary, the lifecycle hook (Codex `SessionStart`, Antigravity `PreInvocation`, Claude Code `post_compact`, **Hermes Agent `pre_llm_call`**) injects the verified breadcrumb trail into the immediate post-compaction continuation:

| Recovery approach | Recovery tokens | Span fidelity | Survives compaction |
| :--- | :--- | :--- | :--- |
| Cold re-exploration | ~6,675 avg (10k–50k+) | Approximate / hallucinated | Starts over |
| Retrieval alone (indexers/LSPs) | 3,000–10,000 | Heuristic | Re-derives candidates |
| **Waymark in-flight ledger** | **~216 (<820 bytes, hard-capped)** | **100% — exact Git span hashes, relocated spans detected** | Yes — verified trail |

The recovery packet is machine-verified, not summarized: any hop whose code changed is `STALE` (quarantined, re-verify that hop only); relocated spans are `MOVED` with new ranges adopted automatically. The agent resumes from the *verified prefix* and never re-reads what it already knows.

**Compounding effect:** discovery finds it once (few hundred tokens of tool calls instead of thousands of blind reads), the journal remembers it for free (append-only NDJSON), and the hook restores it after every compaction (~216 tokens). The token cost of an investigation is paid once — not once per context window.

---

## 4. Division of labor with AGENTS.md Compact Reload

Waymark's companion repo, [`codex-agents-compact-reload`](https://github.com/paragon-ux/codex-agents-compact-reload), owns the *static* half of the boundary: it re-injects the registered root `AGENTS.md` (behavioral rules, invariants, test commands) with a SHA-256 proof. The two bootloaders compose:

```text
               Context Compaction Occurs
                          │
          ┌───────────────┴────────────────┐
          ▼                                ▼
 [ AGENTS.md Compact Reload ]      [ waymark-compact-hook ]
  Target: root AGENTS.md            Target: .waymark/active.json
  Role: static behavioral rules     Role: dynamic verified breadcrumbs
  Output: project authority + hash  Output: hops + relocated line spans
          │                                │
          └────────────────┬───────────────┘
                           ▼
        Immediate Post-Compaction Continuation
        (Full rules + exact code breadcrumb trail, both hash-verified)
```

Static governance (what the rules are) and dynamic continuity (where the investigation is) are reloaded in the same turn, deterministically, for a combined cost of a few hundred tokens — versus thousands of re-derivation tokens or a silently broken session.

---

## 5. Operating posture

- **Zero runtime dependencies, zero daemons.** The AST engine is in-process WASM; Capn is an external CLI invoked per call; state is an append-only journal plus a rebuildable pointer. Nothing to install per-project beyond `waymark init`.
- **Standardized lexical recall.** `capn init --no-embedding` is the recommended Capn configuration: deterministic ~1 s answers, no embedding model, no GPU requirement. (Embedding mode remains available on GPU hosts.)
- **Fail closed on integrity, fail open on infrastructure.** Crossed branches and stale spans quarantine (`exit 2`) rather than resume on unverifiable state; missing charts return clean `miss` rather than guesses.
- **Real-adapter testing.** The test suite exercises the actual capn-hook CLI surface with lexical recall standardized — no synthetic protocol fakes.

The result: a coding agent that cold-starts cheaply (symbolic+semantic discovery), learns once (journal), and survives compaction deterministically (hook) — with token cost bounded at every stage instead of re-paid at each boundary.
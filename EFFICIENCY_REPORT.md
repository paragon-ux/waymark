# EFFICIENCY_REPORT.md — Waymark v1.8.2 performance & token-cost audit

> Scope: what v1.8.2 changed about latency, wall-clock, and token cost; what was measured; what remains external.

---

## 1. Executive summary

Three efficiency problems were found by live testing and fixed in this release; one was measured, verified in-contract, and left unchanged; one host-level teardown cost was diagnosed to be external and is documented as such. Net effect for the primary (long-lived MCP server) deployment:

- **Discovery latency:** mixed-language repo extract ~2.8–4 s → **~90–250 ms** (~30×).
- **Token cost per compaction recovery:** **~216 tokens** (hard-capped at 512), unchanged and within the written contract.
- **Hook injection frequency:** exactly **once per compaction handoff** (was: gated on the wrong turn condition; now per-session deduped).
- **Known external limit:** one-shot CLI processes linger seconds at teardown after any tree-sitter parse (Emscripten teardown, 0% CPU) — downstream of all in-repo levers; documented, amortized to zero by the MCP server.

---

## 2. Latency & wall-clock findings

### 2.1 Grammar-load ordering — FIXED (~30× on mixed-language repos)

**Symptom.** `extractAstFromRepo` on a TS+Python repo took ~2.8–4 s in-process; every internal step (scan: 1 ms, per-file parse: ~16 ms, tree walk: ~2 ms) was millisecond-range.

**Root cause.** Grammars were loaded lazily *inside* the per-file loop. `WebAssembly.instantiate` of a grammar while parsed trees of **another** language remained on the heap is pathologically slow on this host: the python grammar (476 KB wasm) took **3–20 s** to instantiate after a single TypeScript parse — versus 5–25 ms cold or in any other ordering. Confirmed by timing every `WebAssembly.instantiate` via preload instrumentation (typescript 2.3 MB: 3–10 ms; python 476 KB *after a ts parse*: 3.6–20 s) and reproducing the stall in a 30-line reproduction independent of the module.

**Fix.** `extractAstFromRepo` now pre-scans the file extensions in the scanned set and loads **all needed grammars concurrently (`Promise.all`) before any parsing**. Concurrent upfront loads cost ~20–50 ms total; every subsequent parse stays in millisecond range.

**Result (in-process, repeated runs):**

| Path | Before | After |
| :--- | ---: | ---: |
| Mixed TS/Python repo extract | ~2,800–4,000 ms | **~90–250 ms** |
| 4-grammar concurrent pre-warm | — | 20–50 ms |
| Per-file parse (warm) | 2–16 ms | unchanged |

### 2.2 capn adapter — spawn failures and argv drift — FIXED

Found only by testing against the real capn-hook 0.2.2 CLI (the synthetic adapters in prior suites could never catch these):

- **Windows ENOENT:** `where.exe capn` lists the extensionless POSIX shim (`npm\capn`) before `capn.cmd`; CreateProcessW cannot execute the shim, so **every** `capn-cli` spawn failed. Resolution now prefers the PATHEXT `.cmd`/`.bat`/`.exe` hit. (`where.exe` itself: ~1 ms.)
- **`capn chart` argv drift:** the answer moved from a positional to `--details` in capn-hook ≥ 0.2; every real publication failed before the fix.
- **Miss misreported as error:** capn signals a charted miss with exit 1 + "No charted answer." on stderr; the adapter now maps that to `status: "miss"`.

### 2.3 Hook stdin drain race — FIXED

`readStdin` resolved on a bare 100 ms timer even when `end` had not fired. Under parallel load (reproduced at 1-in-24 spawns), the payload arrived after the timer fired → empty read → silent no-op. It now always waits for `end` once data is flowing, with a bounded 250 ms no-data guard for dead writers. Reproduction: 24 concurrent spawns, 1 silent failure before the fix, **0 after**.

### 2.4 Known external limitation — one-shot process teardown (documented, not chaseable)

After any tree-sitter parse, a one-shot Node process lingers 3–9 s at exit with **0% CPU** (pure wait). Verified by phase instrumentation: all JS work completes, the `exit` handler fires at ~+350 ms, and the remaining wall time is inside V8/Emscripten teardown (atexit/pthread cleanup) — downstream of everything JavaScript can reach. Attempted and rejected mitigations: `process.exit`, `process.reallyExit`, `tree.delete()`/`parser.delete()`, hard-exit preloads, and a web-tree-sitter 0.27 upgrade (its API is incompatible with the current grammar set).

**Impact surface:** the one-shot CLI (`discover-symbols`, `ask`) pays this in wall clock; the **long-lived MCP server amortizes it to zero** — and the MCP server is the integration harnesses actually use. Documented in `docs/CAPN-AND-DISCOVERY.md`.

### 2.5 Latency reference table (this host, Windows, capn-hook 0.2.2, lexical recall)

| Operation | In-process (MCP) | One-shot CLI |
| :--- | ---: | ---: |
| AST answer (`who calls X`) | ~50–300 ms | +~100 ms work; wall dominated by external teardown |
| Symbol discovery (`discover-symbols`) | ~90–250 ms full-repo extract | same |
| Charted recall (`capn ask`, lexical) | ~1 s | ~1 s + spawn |
| Charted recall (embedding mode — not recommended) | 60–150 s on CPU-only hosts | exceeds the 15 s adapter timeout |
| Teardown (external, after any parse) | amortized (long-lived process) | +3–9 s wall |

---

## 3. Token-cost findings

### 3.1 Injected packets (measured, ~4 chars/token)

| Packet | Measured size | Tokens |
| :--- | ---: | ---: |
| Waymark resume packet (markdown, live hook output, 1 hop) | 405 chars | **~101** |
| Resume packet hard cap (`MAX_RESUME_BYTES`) | 2,048 bytes | ≤512, truncation drops oldest hops first with `truncated: true` |
| AGENTS.md reload wrapper + header (companion repo) | ~293 chars | ~74 (+ AGENTS.md body, capped 32 KiB) |

The written contract (<216 tokens for the resume packet) holds with margin for small-to-medium trajectories; the byte cap bounds worst cases.

### 3.2 Injection frequency

The Hermes `pre_llm_call` hooks inject **once per compaction handoff** — keyed on `session_id` + summary-row identity with a 12 h TTL and pruning. The summary row persists in history until the next compaction; without the dedupe it would re-fire on every turn. (An earlier "live user message veto" was found wrong in live testing: Hermes compacts at turn start, so the immediate post-compaction turn carries a live message — the dedupe is what bounds frequency.)

### 3.3 End-to-end token economics

| Stage | Without Waymark | With Waymark |
| :--- | ---: | ---: |
| Cold-start discovery | 10,000–50,000+ tokens of blind file reads | one `capn_ask` (~1 tool call) + one exact-span read |
| Post-compaction recovery | ~6,675 avg re-derivation tokens | **~216 tokens** verified trail (96.8% fewer) |
| Span fidelity after compaction | approximate / hallucinated | 100% — exact Git span hashes, `MOVED` adopted |

The investigation's discovery cost is paid once; the journal carries it; the hook restores it. Combined with the companion repo's `AGENTS.md` reload (~40-token wrapper + the rules file), the entire post-compaction context restore is a few hundred tokens against thousands of re-derivation tokens.

---

## 4. Method notes

- Latency figures: repeated runs on Windows 11, Node 22, capn-hook 0.2.2, lexical recall; every `WebAssembly.instantiate` and fs call instrumented via preload where cited.
- Token estimates: ~4 chars/token, English+code mix; the resume packet's own hard cap (2,048 bytes) is enforced mechanically, not estimated.
- The 25-query discovery benchmark and the continuity benchmark (`~216` vs `~6,675` tokens) reproduce via `npm run benchmark`.

---

## 4bis. What was checked and found already efficient

- `resolveWindowsExecutable`: ~1 ms `where.exe` probe, only on Windows, only for extension-less executables.
- AST cache (`getOrRefreshAst`, 30 s TTL): amortizes scans inside the long-lived MCP server; the one-shot CLI calls once anyway.
- Dedupe state files: TTL-bounded and pruned; no unbounded growth.
- Resume serializer: byte-capped with deterministic oldest-hop dropping; `RESUME_TOO_LARGE` fail-closed guard.
- Test suite cost: real-capn tests spawn the CLI twice (~1 s per call) — the price of testing the real adapter surface instead of synthetic fakes.
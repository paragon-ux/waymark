# Waymark Continuity Lab

Waymark preserves one active code investigation across Codex context compaction.

At startup or after a compact reload:

1. Run `waymark check --active --porcelain`.
2. Run `waymark resume --compact` and use only its verified prefix.
3. Do not broadly reread the repository to reconstruct lost context.
4. Treat `STALE` and `CROSS_BRANCH` as non-resumable; reverify or begin again.
5. After each real, validated code hop, run `waymark note` immediately.
6. Run `waymark complete` only after a clean check.

Waymark does not install a Codex hook. The existing `codex-agents-compact-reload`
SessionStart hook reloads this file when Codex starts with source `compact`.

The active investigation is the durable record. Unrecorded internal reasoning is
not recoverable. Capn-hook remains the publication and finalized-memory provider;
Waymark never reads `.capn` files or implements QMD/search.

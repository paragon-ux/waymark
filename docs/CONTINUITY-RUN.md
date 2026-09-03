# Waymark continuity runbook

This runbook is for the one-task Luna demonstration. It is intentionally separate
from the product runtime: Waymark records durable investigation state, while the
existing AGENTS.md Compact Reload (`codex-agents-compact-reload`) hook supplies the reloaded `AGENTS.md`.

## Normal self-hosting loop

1. Start with `waymark ask` when a finalized Capn memory is available.
2. Begin one trajectory with the investigation question.
3. After each real code discovery, record one `waymark note`.
4. Before relying on the path, run `waymark check --active --porcelain`.
5. Use `waymark resume --compact` only when the report is `STAGED`.
6. Complete and publish only after the final clean check.

Waymark never captures unrecorded model reasoning. The note command is the
explicit durability boundary.

## Manual proof

Use one long-lived Luna task at maximum reasoning with an active, multi-hop
trajectory. At an idle phase boundary invoke `/compact` in the Codex composer.
After the native compact reload, send only `Continue.`. The reloaded project
instructions must lead Luna to check and resume the trajectory without a recovery
script or broad repository reread.

Record the trigger, trajectory ID, resume packet, reloaded `AGENTS.md` source and
SHA-256, and the final verified path in `evidence/`.

## Automatic proof

Use the dedicated Luna profile and continue substantive implementation work without
invoking `/compact`. Do not pad prompts or manufacture activity. Continue through
another real phase until Codex records a native automatic compaction. After the
reload, verify the same trajectory ID and targeted recovery behavior.

If an active file is changed during the run, the result must be `STALE` or
`CROSS_BRANCH`, never a fresh path based only on a structural signature.

## Hook isolation

Waymark installs no SessionStart, PreCompact, or PostCompact hook. A future optional
Waymark hook may honor `WAYMARK_HOOK_DISABLED=1` and `WAYMARK_HOOK_DEPTH=1`, but the
continuity proof invokes the CLI directly so the existing reload hook is evaluated
independently.

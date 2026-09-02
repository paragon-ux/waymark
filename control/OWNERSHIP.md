# OWNERSHIP — maintenance boundaries

The project lead owns `AGENTS.md`, `control/`, `docs/CONTINUITY-RUN.md`, the
parent project registration, and the evidence ledger. Changes to those files
must be intentional and auditable.

Runtime maintainers own `src/`, `schemas/`, `scripts/`, and `test/`. A runtime
change must preserve the contracts in `control/CONTRACTS.md` and add or update
deterministic tests. Generated `dist/`, `node_modules/`, `.waymark/`, and
runtime evidence are local artifacts and are not source-of-truth inputs.

Trellis and Mosaic are separate repositories and are outside this project's
ownership. Waymark may refer to their release conventions but must not edit
their files.

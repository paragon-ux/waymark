# TEST-MATRIX — release verification

| Area | Coverage | Command / evidence | Status |
| --- | --- | --- | --- |
| Build | Strict NodeNext TypeScript compilation | `npm run build` | PASS locally |
| Runtime suite | Journal, integrity, CLI, locks, serializer, path safety, adapters | `npm test` | PASS locally |
| Schemas | Flat strict events, active pointer, status-specific resume packets | `npm run schema-check` | PASS locally |
| Clean install | Lockfile-consistent install | `npm ci` | PASS locally |
| Windows adapter | `.cmd` execution without shell interpolation | Node test on Windows | PASS locally |
| Cross-platform | POSIX and Windows fsync/rename/lock behavior | `.github/workflows/verify.yml` | PENDING until CI runs |
| Public hygiene | Common secret/private-key/local-path patterns | `npm run public-check` | PASS locally |
| Manual continuity | Native `/compact`, reload hook, neutral continuation | `control/COMPACTIONS.md` + `evidence/` | PASS (recorded in `control/COMPACTIONS.md`) |
| Automatic continuity | Native automatic compaction during real Luna work | `control/COMPACTIONS.md` + `evidence/` | PASS (recorded in `control/COMPACTIONS.md`) |
| Public release | No secrets, remote review, tagged release state | release checklist | READY |


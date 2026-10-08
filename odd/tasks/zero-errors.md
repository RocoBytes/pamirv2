# Zero errors: repository health cleanup

## Objective
Bring every local quality check to zero errors and zero warnings: dependency audit, type checks (including test files), lint, Prettier, unit tests and build in `backend/` and `frontend/`.

## Problem
The 2026-10-08 health audit found production healthy and all tests passing, plus these gaps:
- `npm audit --omit=dev`: backend has 1 critical, 7 high, 7 moderate and 1 low vulnerability; frontend has 4 high.
- `backend/dist` (120 compiled files) and `.DS_Store` are tracked in git. The tracked `dist` is stale, and the Dockerfile builds `dist` from source anyway.
- `backend/tsconfig.json` excludes `*.test.ts`, which hides 25 type errors.
- 6 `react-hooks/incompatible-library` lint warnings, from React Hook Form `watch()`.
- The frontend has one JS chunk of 797 kB, over Vite's 500 kB warning.
- `.prettierrc` disagrees with the code style: 110 of 178 backend files and 116 of 116 frontend files fail `prettier --check`. CI does not run Prettier.
- `README.md:8` lists the old deploy domain.

## Why
The user asked for the repository to be left at "100% without errors".

## Constraints (hard)
- **No database changes.** Never run `prisma migrate *`, `prisma db push`, `prisma db pull`, `prisma studio`, seeds, `tenant:*`, `oneoff:*` or anything in `backend/src/scripts/`. Never create or edit files under `backend/prisma/migrations/` or change `schema.prisma`.
- No `.env` file exists in this worktree, and none may be copied or created. Tests run with a dummy `DATABASE_URL`, and `prisma generate` gets a dummy URL.
- Work happens only in worktree `../pamirv2-zero-errors` on branch `chore/zero-errors`. The user's uncommitted changes in the main checkout must not be touched.
- No push, PR or deploy. Those are the user's decisions.
- Major-version dependency upgrades need a reason. Never downgrade a major just to silence the audit.

## Authorized scope
Dependency updates (package.json and lockfiles), `.gitignore` and untracking files, test-file type fixes, tsconfig and scripts, the CI workflow check steps, the frontend `watch()` → `useWatch` migration, frontend chunk splitting, Prettier config and formatting, and the README domain line.

## Configuration
- TDD: **off**, because no project configuration enables it (no openspec or `.atl` TDD setting). Ordinary functional checks still apply.
- Runners: backend `npm test`; frontend `npm test` (`vitest run`). Playwright e2e is out of scope locally.
- RDD: on (decided by default). After each work-unit commit, run `gentle-ai review assess --base-ref <last reviewed boundary> --committed-only`. The first boundary is `fcc5d89`.
- Delivery strategy: `ask-on-risk`. Forecast: about 250 authored changed lines, excluding lockfiles and untracked generated `dist`. The size of the Prettier remainder is unknown until the config is aligned.

## Tasks
| ID | Task | Route | Status | Commit | Review |
|---|---|---|---|---|---|
| T1 | Backend prod dependency vulnerabilities → 0 (`npm audit --omit=dev`) | delegated writer (deps + lockfile research) | done | d6c1a43 | assessed medium (configuration_change), review due: slice_budget_reached |
| T2 | Frontend dependency vulnerabilities → 0 | delegated writer | pending | | |
| T3 | Untrack `backend/dist` and `.DS_Store`; ignore them | delegated writer | pending | | |
| T4 | Type-check backend tests: fix 25 errors, add a test typecheck script and CI step | delegated writer (3+ files) | pending | | |
| T5 | Frontend lint warnings → 0 (`watch()` → `useWatch`) | delegated writer (6 files) | pending | | |
| T6 | Frontend chunk > 500 kB → split | delegated writer | pending | | |
| T7 | Align Prettier config with code style, format the remainder, add `format:check` + CI step | delegated writer | pending | | |
| T8 | README deploy-domain line | delegated writer | pending | | |

## Acceptance criteria
In both packages, all of these hold:
- `npm audit --omit=dev` reports 0 vulnerabilities.
- `tsc` reports 0 errors, including backend tests.
- Lint reports 0 errors and 0 warnings.
- `prettier --check` passes.
- All unit tests pass.
- The build passes with no Vite chunk warning.
- No database or migration file changed.

## Progress / evidence
- T1 (d6c1a43): Prisma toolchain 7.7.0 → 7.10.0, kept in lockstep; express 4.22.1 → 4.22.3; @google-cloud/storage 8.2.0 → 8.3.0 (needs Node >= 22; CI and Dockerfiles use 24); tsx 4.21 → 4.23.15. Overrides for packages Prisma pins exactly: `mysql2 ^3.23.1` and `deepmerge-ts ^8.0.2`. The plain `deepmerge()` call Prisma uses gives identical output in v7 and v8. Remove both overrides once Prisma unpins them. Observed: `npm audit --omit=dev` 0, full `npm audit` 0, tsc 0, lint 0/0, tests 773/773, `db:generate` + build OK. Nothing under `backend/prisma/` changed.
  - Deploy note: the one-shot `migrate` compose service runs the Prisma CLI, which now runs as 7.10.0. Watch the first `migrate deploy` after merge. No new migrations were added.

## Next step
T1 native review, then T2.

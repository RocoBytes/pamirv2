# Zero errors: repository health cleanup

## Objective
Bring every local quality check to zero errors and zero warnings: dependency audit, type checks (including test files), lint, Prettier, unit tests and build in `backend/` and `frontend/`.

## Problem
The 2026-10-08 health audit found production healthy and all tests passing, plus these gaps:
- `npm audit --omit=dev`: backend 1 critical / 7 high / 7 moderate / 1 low; frontend 4 high.
- `backend/dist` (120 compiled files) and `.DS_Store` were tracked in git.
- Test files were excluded from type checking, which hid 25 errors.
- 6 `react-hooks/incompatible-library` lint warnings.
- A frontend JS chunk of 797 kB.
- `.prettierrc` did not match the code style.
- The README listed the old deploy domain.

## Why
The user asked for the repository to be left at "100% without errors".

## Constraints (hard)
- **No database changes.** No `prisma migrate|db push|db pull|studio|seed`, no `tenant:*` or `oneoff:*`, nothing in `backend/src/scripts/`. No edits to `backend/prisma/migrations/` or `schema.prisma`. Verified: `git diff --name-only fcc5d89..HEAD -- backend/prisma/` lists 0 files.
- No `.env` in the worktree. Tests ran with a dummy `DATABASE_URL`, and e2e ran behind a 503 sink on :3001 with Chromium resolving localhost only.
- Work happened only in worktree `../pamirv2-zero-errors` on branch `chore/zero-errors`. The user's uncommitted changes in the main checkout were left untouched.
- No push, PR or deploy. Those are the user's decisions.

## Configuration
- TDD: **off**, because no project configuration enables it. Ordinary functional checks still apply.
- Runners: backend `npm test` (node:test via tsx); frontend `npm test` (vitest) and Playwright e2e, run locally under guards.
- RDD: on (default). The user authorized granting review consent on their behalf while away (2026-10-08).
- Delivery strategy: `ask-on-risk`. The running authored total is above 400 lines, so slicing is decided at PR time (pending user).

## Tasks
| ID | Task | Route | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| T1 | Backend prod dependency vulnerabilities → 0 | delegated writer | done | d6c1a43 | approved (1 lens) |
| T2 | Frontend dependency vulnerabilities → 0 | delegated writer | done | 3aa4e41 | approved (1 lens) |
| T3 | Untrack `backend/dist` and `.DS_Store`; ignore them | delegated writer | done | 50686a4 | unavailable: lens_context_budget_exceeded (13.4k deleted generated lines) |
| T3b | Untrack Playwright run artifacts | delegated writer | done | 7a81797 | approved with T6/T7a (4 lenses + 1 correction) |
| T4 | Type-check backend tests (25 errors) + script + CI | delegated writer | done | 0b60798 | approved (4 lenses) |
| T4b | Type-check e2e specs/configs (17 errors) + script + CI | delegated writer | done | ed87fd0 | approved with T5 (4 lenses) |
| T5 | Lint warnings → 0 (`useWatch`); fix the RegistroIntegrante update-depth loop | delegated writer | done | 37d20b7, 293efb4 | approved (4 lenses) |
| T6 | Split the 797 kB chunk (lazy admin screens, codeSplitting groups) | delegated writer | done | 8f900dd | approved with T3b/T7a |
| T7 | Prettier config aligned to code, format, `format:check` in CI, blame-ignore | delegated writer | done | 26e9717, 663cb2d, 2e236b3, e52d203, b55b08b | config approved after 1 bounded correction; formatting commits unavailable (lens_context_budget_exceeded, 2.4k / 8.2k layout-only lines) |
| T8 | README: deploy domain and deployment section | delegated writer | done | 21109d9 | approved (final range, 4 lenses) |
| T9 | Review polish (suggestions from T4 and T5 reviews) | delegated writer | done | 19c56f2 | approved (final range) |
| T10 | Hermetic e2e (default mocks + fail on unmocked `/api`); Recharts first-render warning | delegated writer | done | d7aec6b, 46a78ea | approved (final range) |
| T11 | Offline-safe lazy-chunk recovery (no reload offline, scoped boundaries) | delegated writer | done | e81250d | approved (final range) |
| T12 | Final review suggestions (comments, deterministic no-loop check) | delegated writer | done | ee2714d | not due (under_budget, 38 lines) |

## Acceptance criteria (observed at ee2714d)
- [x] `npm audit`, prod and full: 0 vulnerabilities in both packages.
- [x] Backend `typecheck` (src + tests), `tsc --noEmit`, lint, `format:check`: 0 problems. Tests 773/773. Build OK.
- [x] Frontend `tsc -b`, `typecheck:e2e`, lint (0 warnings), `format:check`: 0 problems. Tests 288/288. Build OK with no chunk-size warning.
- [x] E2E (local, guarded):
  - Dev and production build: 147/147.
  - `lazy-screens` spec: 4/4 on the production build.
  - Sink received 0 requests and the console showed 0 errors.
- [x] No database, schema or migration file changed.

## Progress / evidence notes
- T1:
  - Prisma 7.7.0 → 7.10.0 in lockstep. Overrides `mysql2 ^3.23.1` and `deepmerge-ts ^8.0.2`, because Prisma pins vulnerable versions; remove them once Prisma unpins.
  - The production `migrate` service now runs the Prisma 7.10 CLI. Watch the first `migrate deploy`. No migrations were added.
- T5: the loop came from `clearErrors` being called for every valid field. The `staleErrorFields` guard plus `useWatch` fixed it, and an e2e regression test counts 0 "Maximum update depth" errors.
- T6:
  - The entry JS went from 1309 kB to 746 kB (−43%).
  - Field screens stay eager so they keep working offline.
- T7: history was reordered after review so CI only runs `format:check` once the code is formatted. Every commit keeps CI green. The pre-reorder backup is branch `backup/zero-errors-pre-reorder`.
- T10: e2e moved from about 450 unmocked GETs per run to 0. `route.continue()` became `route.fallback()`.

## Open items for the user
1. A tracked `frontend/.env` is excluded by `.dockerignore`, so production never reads it. Untracking it would delete the local copy on the next pull. User decision pending.
2. Push/PR and delivery slicing (`ask-on-risk`).
3. When merging into the main checkout, git will refuse to overwrite the user's untracked root `.gitignore`; move it aside first (the tracked one keeps `.neon`). The local `.DS_Store` change also needs discarding before pulling.
4. The project `CLAUDE.md` still describes the old Contabo/Cloudflare/andinoclubpamir.app setup.
5. The `claude_agents_temp/` gitlinks have no `.gitmodules` (`git submodule status` errors). Left untouched; it is the owner's tooling folder.
6. E2E does not run in CI. The production-only `lazy-screens` tests only run locally against `vite preview`.

## Next step
User review of the branch, then the delivery decisions above.

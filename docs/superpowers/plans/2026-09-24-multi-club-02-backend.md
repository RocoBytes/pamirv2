# Multi-Club Membership — PR 2: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `User` to `GLOBAL_MODELS` (a platform-wide account) in the same PR where every in-club read of users switches from `User.organizationId`/`User.rol` to `Membresia`, `authMiddleware` resolves the active club per request from `X-Club` + the caller's memberships, login/`/me` expose all of a person's clubs, password-reset branding and the `create-user` CLI become membership-aware — all with zero behavior change for every existing (single-membership) account.
**Architecture:** `User` keeps its `organizationId`/`rol` columns (never dropped — rollback safety) but they stop being read for authorization; `Membresia` (added to `TENANT_MODELS` in PR 1) becomes the only source of "who belongs to this club, with what role". `authMiddleware` loads the account platform-wide, resolves ONE active `Membresia` (from `X-Club`, or the caller's only membership when the header is absent), and builds `req.user` with the exact same `AuthUser` shape as today so every downstream `requireAdmin`/`requireCanInvite`/`puedeGestionarSalida` check keeps working unchanged. A static guard test (mirroring `lib/raw-sql-guard.test.ts`) fails the build if `prisma.user.findMany`/`count`/`groupBy`/`aggregate` appears outside a one-line allowlist, so a future PR can't reintroduce a cross-club user listing by accident.
**Tech Stack:** Express 5, Prisma 7 (TypeScript, `prisma-client` generator), PostgreSQL on Neon, `node:test` via `tsx`.
**Spec:** `docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` (Design → §2 "Backend", §4 "Security, errors, testing and delivery"; Delivery step 2 "Backend")

## Global Constraints

- No schema/migration change in this PR: `Membresia` already exists (PR 1). Only `lib/scope-args.ts`'s classification of `User` changes (`TENANT_MODELS` → `GLOBAL_MODELS`), which is a plain TypeScript array, not a Prisma model change.
- `User.organizationId`/`User.rol` columns are never dropped or altered in this PR (that is PR 5, "Contract"). New users still get `User.organizationId` = the club they are created in. A role change updates `User.rol` **only when** the edited membership's club equals the account's `User.organizationId` (its "primary" club) — never blindly, so a future second membership (PR 3+) can never have its role change stomp the primary club's role.
- **Production behavior is byte-identical for every existing account.** Every account today has exactly one membership (PR 1's backfill, dual-written since) and no current frontend sends `X-Club`. The single-membership fallback in `authMiddleware` and the "no `X-Club` → oldest/only membership" fallback in password-reset branding both exist specifically so this holds; this is pinned by the entire *existing* HTTP check suite (`runHttpChecks`, `runQrChecks`, `runQrDirectoChecks`, `runFileDownloadChecks`, `runClubLogoChecks`, `runTenantCliChecks`, `runRoleChangeMembresiaChecks`, `runCreateUserCliChecks`) continuing to pass **unmodified**, since none of it sends `X-Club`.
- No frontend change in this PR (Delivery step 4, later). `X-Club` is read from the raw header; nothing in this PR requires the frontend to send it.
- The invitation/QR "join with an existing account" flows (`crearInvitacion`/`reenviarInvitacion` no longer 409ing, sign-in-and-confirm acceptance, QR directo with an existing account, `tenant:create --admin-email`) are **not** touched in this PR — see Ruling 1.
- Conventional commits, no `Co-Authored-By` or AI attribution of any kind.
- Code comments in Spanish, matching the surrounding file (`scope-args.ts`, the controllers, `test-isolation.ts` are all commented in Spanish); this plan document itself is in English.
- Single backend replica (rate limiting is in-memory) — nothing in this PR changes that.
- `runAsPlatform` stays importable only from the short allowlist in `eslint.config.mjs` (`RUN_AS_PLATFORM_ALLOWED_FILES`). `middleware/auth.middleware.ts`, `controllers/auth.controller.ts`, `services/invitaciones.repo.prisma.ts` and `services/codigos-qr.repo.prisma.ts` are already on it — no eslint change is needed by this plan.

## Rulings

- **Ruling 1: invitation/QR "join with an existing account" stays out of this PR.** The spec's §2 "Other changes" lists `tenant:create --admin-email`, and its own "Joining a club" paragraphs describe the sign-in-and-confirm flow — but the Delivery section explicitly scopes that whole behavior to PR 3 ("Joining"). In PR 2, `aceptarInvitacion`, `registrarConQrDirecto` and `tenant:create --admin-email` keep 409ing an existing email exactly as today. Only the underlying `findUserByEmail`/`findUserById` reads are reviewed for safety now that `User` is global (see the inventory below) — they need no code change because they're either deliberately platform-wide by design (`findUserByEmail`) or always look up an id already sourced from a club-scoped row (`findUserById`).
- **Ruling 2: `create-user --org` for an existing account is in scope for this PR**, unlike Ruling 1's flows — it's an operator-driven admin script with direct database access, not a self-service "join" requiring consent from the account holder. An existing account with no membership in the target club gets that membership added (purely additive: no password prompt, no profile change, no `--force` needed). An existing account that's **already** a member of the target club keeps today's exact behavior (refuse without `--force`, update with it), now decided by a `Membresia` lookup instead of `User.organizationId` equality.
- **Ruling 3: password-reset branding is read from the raw `X-Club` header directly in `forgotPassword`**, not from `req.user` (this route runs before `authMiddleware` — there's no session yet). Since no frontend sends `X-Club` on this route in this PR and every account has exactly one membership, this reduces to "the account's only membership" for 100% of production traffic today — i.e., today's `found.organization` — while already being correct for the multi-membership case PR 3+ will introduce.
- **Ruling 4: `authMiddleware`'s new club-resolution logic is tested through the real-DB isolation suite (`npm run test:isolation`), not `auth.middleware.test.ts`.** That file only tests `requireAdmin`/`requireCanInvite` (pure functions over `req.user`) because Prisma 7's client can't be mocked with `mock.method` (documented precedent in `invitaciones.repo.prisma.ts`'s own comment) — the same reason PR 1's dual-write logic is proven by `test-isolation.ts` and not a mocked unit test. `auth.middleware.test.ts` is untouched by this plan.
- **Ruling 5: `findUserById` (both repos) and `admin.controller.ts`'s `enviarSaludSalida` lookup stay unwrapped and unchanged.** Every caller passes an id sourced from a field that's itself already club-scoped (`Invitacion.invitadoPorId`, `CodigoQrInvitacion.creadoPorId`/`registradoUsuarioId`, `Salida.userId`) — moving `User` to `GLOBAL_MODELS` removes a scoping check that was already redundant for these specific call sites (the id was never attacker-controlled), not a real isolation guarantee. Rewrapping them in `runAsPlatform` would be cosmetic, not a behavior or safety change, so this PR leaves them as-is.
- **Ruling 6: the static guard matches exactly `.user.findMany`/`.count`/`.groupBy`/`.aggregate`** (per the spec's own wording), not `findUnique`/`create`/`update`/`delete`/`upsert` — a single-row operation by a known key was never the cross-club-listing risk the spec calls out. Its allowlist is exactly one entry, `scripts/test-isolation.ts`, for the orphan-membership invariant check PR 1 already added (`prisma.user.count({ where: { membresias: { none: {} } } })`) — the only legitimate platform-wide count of `User` anywhere in the codebase after this PR's rewrites.
- **Ruling 7: zero-membership accounts stay unhandled as a special case.** The design's own Non-goals state an account with zero memberships cannot exist in this release (every account is created together with its first membership). `authMiddleware`'s "no `X-Club`" branch therefore only distinguishes "exactly one membership" from "everything else" (0 or 2+) and answers `400 "Selecciona un club"` for the latter — not specially tested for the zero case, since the design guarantees it can't occur.
- **Ruling 8: kept as one plan (five tasks), not split.** Tasks 2–5 all depend on Task 1's `GLOBAL_MODELS` flip and are each individually small (one to three files); splitting would only relocate the same five commits across two plan files without changing what's independently deployable. Every task ends with the full backend test suite green.

## Review Focus

1. **An existing single-membership account, calling with no `X-Club` header (every current frontend), resolves to a different club or gets rejected instead of transparently reusing its one membership.** This is the single biggest risk in the PR and has no single dedicated test — it's pinned by the *entire* pre-existing HTTP check suite (60+ checks across `runHttpChecks`/`runQrChecks`/`runQrDirectoChecks`/`runFileDownloadChecks`/`runClubLogoChecks`/`runTenantCliChecks`/`runRoleChangeMembresiaChecks`/`runCreateUserCliChecks`) continuing to pass **unmodified** in Task 2, since none of it sends `X-Club`.
2. **`GET /api/admin/users` or `PATCH /api/admin/users/:id/rol`, now that `User` is global, actually lets an admin of one club list or edit a person who is only a member of another club.** Pinned by Task 1's extended `GET /api/admin/users` exclusion assertions and its new cross-club `404` check on the role-change endpoint.
3. **A role change on a club that is not the account's "primary" club (`User.organizationId`) silently corrupts the legacy `User.rol`/`User.organizationId` columns instead of leaving them alone.** Nothing in production can reach this state yet (every account still has exactly one membership), so this is pinned by Task 2's own multi-membership fixture and a dedicated before/after assertion on the raw `User` row.
4. **`create-user --org` on an existing account silently overwrites the account's shared name/password when the operator only meant to add a club membership**, or the reverse — the additive path silently no-ops instead of adding the membership. Pinned by Task 5's two new CLI checks (additive path preserves the profile; same-club path still refuses without `--force`).
5. **The static `.user.findMany`/`count`/`groupBy`/`aggregate` guard has a blind spot** (a future PR reintroduces a cross-club listing that the regex or the allowlist misses). Pinned by Task 1's mirrored "sanity" test (same pattern as `raw-sql-guard.test.ts`'s second `it`), which fails if the scanner stops finding the one known legitimate occurrence.

---

## File Structure

| File | Responsibility | Task |
|------|-----------------|------|
| `backend/src/lib/scope-args.ts` | Moves `User` from `TENANT_MODELS` to `GLOBAL_MODELS` | 1 |
| `backend/src/lib/scope-args.test.ts` | Updates the "`GLOBAL_MODELS` is empty" assertion | 1 |
| `backend/src/lib/user-global-guard.test.ts` | New static guard: fails the build on an unlisted `.user.findMany/count/groupBy/aggregate` | 1 |
| `backend/src/controllers/admin.controller.ts` | `listUsers`/`updateUserRol` rewritten to read/write through `Membresia` | 1 |
| `backend/src/lib/x-club.ts` | Reads and normalizes the `X-Club` header (shared by the middleware and `forgotPassword`) | 2 |
| `backend/src/lib/x-club.test.ts` | Unit tests for `xClubHeader` | 2 |
| `backend/src/middleware/auth.middleware.ts` | `authMiddleware` resolves the active club from `X-Club` + the account's memberships | 2 |
| `backend/src/controllers/auth.controller.ts` | `login`/`getMe` return `clubes`; `forgotPassword` resolves branding via `Membresia` | 3, 4 |
| `backend/src/lib/reset-branding.ts` | Pure: picks the branding club from a person's memberships + the request's club | 4 |
| `backend/src/lib/reset-branding.test.ts` | Unit tests for `resolveResetBrandingOrganizationId` | 4 |
| `backend/src/scripts/create-user.ts` | `--org` on an existing account adds the membership instead of refusing | 5 |
| `backend/src/scripts/test-isolation.ts` | New/extended checks for every task above | 1, 2, 3, 4, 5 |

---

## `User` read/write site inventory

Every call site found by grepping `\.user\.\(findUnique\|findFirst\|findMany\|count\|create\|update\|upsert\|delete\|aggregate\|groupBy\)` across `backend/src` (excluding `src/generated` and `*.test.ts`), and its fate. 21 sites total, matching the spec's own count exactly: `admin.controller.ts` (4), `auth.controller.ts` (7), `invitaciones.repo.prisma.ts` (3), `codigos-qr.repo.prisma.ts` (3), `create-user.ts` (3), `auth.middleware.ts` (1).

**Real fixes (behavior changes because `User` is now global):**

| Site | What it does today | Fixed by |
|------|---------------------|----------|
| `backend/src/middleware/auth.middleware.ts:29` (`authMiddleware`) | `prisma.user.findUnique({ where: { id }, include: { organization } })` — loads the account and its single club by `User.organizationId` | Task 2 |
| `backend/src/controllers/admin.controller.ts:845` (`listUsers`) | `prisma.user.findMany(...)` — lists every user of the caller's club, relying on automatic tenant scoping that disappears once `User` is global | Task 1 |
| `backend/src/controllers/admin.controller.ts:876` (`updateUserRol`, existence check) | `prisma.user.findUnique({ where: { id } })` — used to 404 an unknown or foreign id; unscoped once `User` is global, so a foreign id would no longer 404 on its own | Task 1 |
| `backend/src/controllers/admin.controller.ts:884` (`updateUserRol`, dual write) | `prisma.user.update` inside the role-change transaction (dual-write to `Membresia` shipped in PR 1) | Task 1 |
| `backend/src/controllers/auth.controller.ts:65` (`login`) | `prisma.user.findUnique({ where: { email }, include: { organization } })` — response gains a new `clubes` field (query itself keeps its `include`, used for today's shape) | Task 3 |
| `backend/src/controllers/auth.controller.ts:163` (`forgotPassword`) | `prisma.user.findUnique({ where: { email }, include: { organization } })` — branding now resolved from `Membresia`, not this inline include | Task 4 |
| `backend/src/scripts/create-user.ts:138` (existence check) | `prisma.user.findUnique({ where: { email } })` — now paired with a `Membresia` lookup to decide refuse / add / update | Task 5 |
| `backend/src/scripts/create-user.ts:184` (`--force` update) | `prisma.user.update` — the `rol` write becomes conditional on the target club being the account's primary one | Task 5 |

**Sites checked and found unaffected (no code change needed):**

| Site | Why it's unaffected |
|------|----------------------|
| `backend/src/controllers/auth.controller.ts:30,37` (`verifyEmail`) | Single-row lookup/update by `verificationToken`, already wrapped in `runAsPlatform` — needed there so *some* tenant context exists on this unauthenticated route, not for scoping. Identical before and after `User` is global. |
| `backend/src/controllers/auth.controller.ts:186` (`forgotPassword`, token write) | Single-row update by an already-resolved `id` — unaffected by how that row was found. |
| `backend/src/controllers/auth.controller.ts:223,233` (`resetPassword`) | Single-row lookup/update by `resetToken` — same reasoning as `verifyEmail`. |
| `backend/src/services/invitaciones.repo.prisma.ts:22` / `backend/src/services/codigos-qr.repo.prisma.ts:47` (`findUserByEmail`) | Already explicitly `runAsPlatform`-wrapped and deliberately platform-wide by design (email is unique across the whole platform). Ruling 1 keeps the "existing account" `409` unchanged until PR 3. |
| `backend/src/services/invitaciones.repo.prisma.ts:30` / `backend/src/services/codigos-qr.repo.prisma.ts:39` (`findUserById`) | Every caller passes an id sourced from a field on an already club-scoped row (`Invitacion.invitadoPorId`, `CodigoQrInvitacion.creadoPorId`/`registradoUsuarioId`) — see Ruling 5. |
| `backend/src/services/invitaciones.repo.prisma.ts:87` / `backend/src/services/codigos-qr.repo.prisma.ts:115` (`tx.user.create`) | Still creates the account with `organizationId` = the invitation's/QR's club and dual-writes its `Membresia` (PR 1) — unaffected by `User`'s scope classification. |
| `backend/src/scripts/create-user.ts:172` (brand-new user create) | Same reasoning — a genuinely new account, unaffected. |
| `backend/src/controllers/admin.controller.ts:674` (`enviarSaludSalida`) | Looks up `salida.userId`, a field on an already club-scoped `Salida` row — same "already-known-safe id" reasoning as `findUserById` (Ruling 5). |

---

### Task 1: `User` → `GLOBAL_MODELS`, static guard, and the two admin endpoints that would otherwise leak

**Files:**
- Modify: `backend/src/lib/scope-args.ts` (lines 15–40, `TENANT_MODELS`/`GLOBAL_MODELS`)
- Modify: `backend/src/lib/scope-args.test.ts` (lines 59–63, the `GLOBAL_MODELS` describe block)
- Create: `backend/src/lib/user-global-guard.test.ts`
- Modify: `backend/src/controllers/admin.controller.ts` (`listUsers`, lines 843–854; `updateUserRol`, lines 859–906)
- Modify: `backend/src/scripts/test-isolation.ts` (extend the `GET /api/admin/users` check; extend `runRoleChangeMembresiaChecks` with a `seedB` param and a new check; update its call site)

**Interfaces:**
- Consumes: `prisma.membresia` (PR 1), `requireOrganizationId()` (`lib/tenant-context.ts`, already imported in `admin.controller.ts`)
- Produces: nothing new exported — `listUsers`/`updateUserRol` keep their existing HTTP response shapes; `runRoleChangeMembresiaChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void>` (signature grows by one param), consumed by `main()`

- [ ] **Step 1: Flip the classification**

In `backend/src/lib/scope-args.ts`, replace lines 15–40:

```ts
// Los 17 modelos de negocio: toda fila pertenece a exactamente un club.
export const TENANT_MODELS = [
  'User',
  'Membresia',
  'DashboardLayout',
  'Invitacion',
  'CodigoQrInvitacion',
  'Salida',
  'EvaluacionToken',
  'EvaluacionRespuesta',
  'Cierre',
  'Documento',
  'Integrante',
  'CategoriaEvento',
  'GestorCategoria',
  'DeclaracionJuradaVersion',
  'Evento',
  'Inscripcion',
  'Notificacion',
] as const;

// Modelos sin organizationId: no pertenecen a ningún club y jamás se filtran.
// Vacía desde que el único modelo global (guardaba el refresh token de
// Google, ya eliminado tras migrar el almacenamiento de archivos) dejó de
// existir — el mecanismo se conserva tipado para el próximo modelo global.
export const GLOBAL_MODELS = [] as const;
```

with:

```ts
// Los 16 modelos de negocio: toda fila pertenece a exactamente un club. User
// se movió a GLOBAL_MODELS (ver abajo) — sigue teniendo organization_id como
// columna heredada (fase de expansión del diseño multi-club, nunca leída
// para el aislamiento), pero una cuenta ya no pertenece a un único club.
export const TENANT_MODELS = [
  'Membresia',
  'DashboardLayout',
  'Invitacion',
  'CodigoQrInvitacion',
  'Salida',
  'EvaluacionToken',
  'EvaluacionRespuesta',
  'Cierre',
  'Documento',
  'Integrante',
  'CategoriaEvento',
  'GestorCategoria',
  'DeclaracionJuradaVersion',
  'Evento',
  'Inscripcion',
  'Notificacion',
] as const;

// Modelos sin organization_id como filtro de aislamiento: no pertenecen a un
// único club y jamás se filtran por él. User es el primero desde el diseño
// multi-club (docs/superpowers/specs/2026-09-23-multi-club-membership-design.md):
// una cuenta puede tener una Membresia (esa sí tenant-scoped, ver arriba) en
// cualquier número de clubes. Todo listado o conteo de User debe pasar por
// Membresia — ver lib/user-global-guard.test.ts, que falla el build si
// aparece un prisma.user.findMany/count/groupBy/aggregate fuera de la
// allowlist corta que declara ese archivo.
export const GLOBAL_MODELS = ['User'] as const;
```

- [ ] **Step 2: Run `scope-args.test.ts` and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/lib/scope-args.test.ts
```

Expected: `describe('scopeArgs — GLOBAL_MODELS')` → `it('está vacía')` **fails** — `GLOBAL_MODELS` is now `['User']`. Every other `describe` block still passes, including `'TENANT_MODELS ∪ GLOBAL_MODELS ∪ {Organization} vs. schema.prisma'` (the union of both arrays plus `Organization` is unchanged — `User` just moved sides).

- [ ] **Step 3: Update the `GLOBAL_MODELS` test**

In `backend/src/lib/scope-args.test.ts`, replace lines 59–63:

```ts
describe('scopeArgs — GLOBAL_MODELS', () => {
  it('está vacía', () => {
    assert.deepEqual(GLOBAL_MODELS, []);
  });
});
```

with:

```ts
describe('scopeArgs — GLOBAL_MODELS', () => {
  it('contiene exactamente User — la única cuenta es global desde el diseño multi-club', () => {
    assert.deepEqual(GLOBAL_MODELS, ['User']);
  });

  it('deja pasar los args sin modificar para un modelo global, incluso bajo un contexto de club', () => {
    const args = { where: { id: '1' } };
    const result = scopeArgs({ model: 'User', operation: 'findMany', args, store: asA });
    assert.deepEqual(result, args);
  });
});
```

- [ ] **Step 4: Re-run and confirm PASS**

```bash
node --import tsx --test src/lib/scope-args.test.ts
```

Expected: all `describe` blocks pass.

- [ ] **Step 5: Write the failing static guard test**

Create `backend/src/lib/user-global-guard.test.ts`:

```ts
// Guardia estática: mover User a GLOBAL_MODELS (ver scope-args.ts) significa
// que ya no hay ningún filtro automático por club en NINGUNA de estas
// operaciones — un prisma.user.findMany/count/groupBy/aggregate sin filtrar
// a mano por Membresia devolvería personas de TODOS los clubes. Este test
// escanea el código fuente y falla si aparece una ocurrencia nueva fuera de
// la lista permitida, o si la permitida dejó de correr dentro de
// runAsPlatform (la única forma legítima de que sea deliberadamente
// cross-club).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url)); // src/lib/.. -> src

// Cada entrada nueva acá es una decisión explícita: un listado o conteo de
// User fuera del club activo debe pasar por Membresia (ver
// controllers/admin.controller.ts, listUsers) — la única excepción legítima
// hoy es el invariante global de la suite de aislamiento (PR 1, Task 5): un
// conteo deliberadamente cross-club de usuarios sin ninguna Membresia.
const USER_LISTING_ALLOWED_FILES = new Set(['scripts/test-isolation.ts']);

// Requiere un "." inmediatamente antes (prisma.user.count, tx.user.findMany)
// para no confundir una mención en un comentario con una llamada real.
const USER_LISTING_PATTERN = /\.user\.(findMany|count|groupBy|aggregate)\b/g;
const LOOKAHEAD_LINES = 10;

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated') continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  reason: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];

  for (const file of collectTsFiles(SRC_DIR)) {
    const relative = path.relative(SRC_DIR, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      USER_LISTING_PATTERN.lastIndex = 0;
      if (!USER_LISTING_PATTERN.test(line)) return;

      if (!USER_LISTING_ALLOWED_FILES.has(relative)) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: 'usa prisma.user.findMany/count/groupBy/aggregate pero el archivo no está en ' +
            'USER_LISTING_ALLOWED_FILES — lee por Membresia en su lugar',
        });
        return;
      }

      const window = lines.slice(index, index + LOOKAHEAD_LINES).join('\n');
      if (!window.includes('runAsPlatform')) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: `no corre dentro de runAsPlatform en las ${LOOKAHEAD_LINES} líneas siguientes`,
        });
      }
    });
  }

  return violations;
}

describe('user-global-guard', () => {
  it('toda ocurrencia de prisma.user.findMany/count/groupBy/aggregate está permitida y es deliberadamente cross-club', () => {
    const violations = scan();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.line} — ${v.reason}`).join('\n'),
    );
  });

  it('el escaneo sigue encontrando la ocurrencia real conocida (no se rompió en silencio)', () => {
    let occurrences = 0;
    for (const file of collectTsFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      USER_LISTING_PATTERN.lastIndex = 0;
      occurrences += content.match(USER_LISTING_PATTERN)?.length ?? 0;
    }
    assert.ok(occurrences >= USER_LISTING_ALLOWED_FILES.size, 'el escaneo no encontró la ocurrencia esperada');
  });
});
```

- [ ] **Step 6: Run and confirm the expected failure**

```bash
node --import tsx --test src/lib/user-global-guard.test.ts
```

Expected: the first `it` **fails** with exactly one violation: `controllers/admin.controller.ts:845 — usa prisma.user.findMany/count/groupBy/aggregate pero el archivo no está en USER_LISTING_ALLOWED_FILES — lee por Membresia en su lugar`. The second `it` passes (the scanner still finds the one known occurrence in `test-isolation.ts`).

- [ ] **Step 7: Write the failing isolation checks for the two admin endpoints**

In `backend/src/scripts/test-isolation.ts`, extend the existing `'GET /api/admin/users — solo los usuarios del propio club'` check (inside `runHttpChecks`):

```ts
  await check('GET /api/admin/users — solo los usuarios del propio club (por Membresia desde este PR)', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/admin/users');
    assert.equal(res.status, 200);
    const users = res.body as { email: string; rol: string }[];
    // 2: el admin y el socio "de biblioteca" seedeados en el club A.
    assert.equal(users.length, 2);
    const emails = users.map((u) => u.email);
    assert.ok(emails.includes(seedA.adminEmail));
    assert.ok(emails.includes(seedA.socioEmail));
    // User es global desde este PR (ver scope-args.ts): si listUsers volviera
    // a leer prisma.user.findMany en vez de Membresia, este assert lo
    // detectaría filtrando personas de OTRO club adentro de la lista de A.
    assert.ok(!emails.includes(seedB.adminEmail));
    assert.ok(!emails.includes(seedB.socioEmail));
  });
```

Extend `runRoleChangeMembresiaChecks` (add the `seedB` parameter and a second check):

```ts
async function runRoleChangeMembresiaChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  await check(
    'PATCH /api/admin/users/:id/rol actualiza también la Membresia del usuario (mismo club, mismo rol nuevo)',
    async () => {
      const res = await patchJsonAuth(baseUrl, tokenA, `/api/admin/users/${seedA.socioUserId}/rol`, { rol: 'LIDER' });
      assert.equal(res.status, 200);
      const body = res.body as { rol: string };
      assert.equal(body.rol, 'LIDER');

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: seedA.socioUserId } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'LIDER');
    },
  );

  await check(
    'PATCH /api/admin/users/:id/rol — el admin de A no puede cambiar el rol de alguien que solo es socio de B (404, User ya es global) (Review Focus #2)',
    async () => {
      const res = await patchJsonAuth(baseUrl, tokenA, `/api/admin/users/${seedB.socioUserId}/rol`, { rol: 'ADMIN' });
      assert.equal(res.status, 404);

      const membresiaIntacta = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedB.organizationId, usuarioId: seedB.socioUserId } },
        }),
      );
      assert.equal(membresiaIntacta?.rol, 'SOCIO');
    },
  );
}
```

Update its call site in `main()`:

```ts
    await runRoleChangeMembresiaChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 8: Run and confirm the expected failures**

```bash
npm run test:isolation
```

Expected: the extended `GET /api/admin/users` check fails on `assert.equal(users.length, 2)` — `listUsers` is unscoped now that `User` is global, so it returns every user in the whole database (at least A's and B's 4 seeded accounts, plus whatever else exists in this dev database), not just A's 2. The new `PATCH .../rol` check fails on `assert.equal(res.status, 404)` (it gets `200` — `updateUserRol`'s existence check finds `seedB.socioUserId` globally and lets the edit through). Every other check still passes.

- [ ] **Step 9: Rewrite `listUsers`**

In `backend/src/controllers/admin.controller.ts`, replace lines 843–854:

```ts
// GET /api/admin/users
export async function listUsers(_req: Request, res: Response): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, rol: true, emailVerified: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error('[listUsers]', error);
    res.status(500).json({ error: 'No se pudieron obtener los usuarios' });
  }
}
```

with:

```ts
// GET /api/admin/users — User es global desde este PR (ver scope-args.ts):
// se lee por Membresia, que sigue siendo tenant-scoped, para listar solo a
// quienes son socios del club activo (ver lib/user-global-guard.test.ts).
export async function listUsers(_req: Request, res: Response): Promise<void> {
  try {
    const membresias = await prisma.membresia.findMany({
      select: {
        rol: true,
        usuario: { select: { id: true, email: true, name: true, emailVerified: true, createdAt: true } },
      },
      orderBy: { usuario: { name: 'asc' } },
    });
    const users = membresias.map((m) => ({
      id: m.usuario.id,
      email: m.usuario.email,
      name: m.usuario.name,
      rol: m.rol,
      emailVerified: m.usuario.emailVerified,
      createdAt: m.usuario.createdAt,
    }));
    res.json(users);
  } catch (error) {
    console.error('[listUsers]', error);
    res.status(500).json({ error: 'No se pudieron obtener los usuarios' });
  }
}
```

- [ ] **Step 10: Run the guard test and confirm PASS**

```bash
node --import tsx --test src/lib/user-global-guard.test.ts
```

Expected: both `it`s pass — no more `.user.findMany` outside the allowlist.

- [ ] **Step 11: Rewrite `updateUserRol`**

In `backend/src/controllers/admin.controller.ts`, replace lines 859–906:

```ts
const rolSchema = z.object({ rol: z.enum(['SOCIO', 'LIDER', 'ADMIN']) });

// PATCH /api/admin/users/:id/rol
export async function updateUserRol(req: Request, res: Response): Promise<void> {
  try {
    const parsed = rolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'El rol debe ser SOCIO, LIDER o ADMIN' });
      return;
    }

    const id = req.params['id'] as string;

    // Nadie cambia su propio rol: garantiza que el sistema siempre conserve
    // al menos un ADMIN (el propio requester).
    if (!puedeCambiarRol(req.user!.id, id)) {
      res.status(409).json({ error: 'No puedes cambiar tu propio rol' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const organizationId = requireOrganizationId();
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { rol: parsed.data.rol },
        select: { id: true, email: true, name: true, rol: true, emailVerified: true, createdAt: true },
      }),
      // Dual write: el rol de una cuenta EN ESTE club vive también en su
      // Membresia — ver schema.prisma. `existing` (arriba) ya probó, vía el
      // aislamiento por club de User.findUnique, que `id` pertenece al club
      // vigente, así que esta fila ya existe (todo alta la crea — ver
      // invitaciones.repo.prisma.ts / codigos-qr.repo.prisma.ts /
      // create-user.ts). Se usa `update` (no `upsert`): si faltara sería un
      // bug real que conviene que falle ruidoso, no que se tape en silencio.
      prisma.membresia.update({
        where: { organizationId_usuarioId: { organizationId, usuarioId: id } },
        data: { rol: parsed.data.rol },
      }),
    ]);
    res.json(updated);
  } catch (error) {
    console.error('[updateUserRol]', error);
    res.status(500).json({ error: 'No se pudo actualizar el rol' });
  }
}
```

with:

```ts
const rolSchema = z.object({ rol: z.enum(['SOCIO', 'LIDER', 'ADMIN']) });

// PATCH /api/admin/users/:id/rol — opera sobre la Membresia del club activo,
// nunca sobre User directamente (que es global desde este PR): un id que no
// tiene Membresia en este club es "no encontrado" para el admin de este
// club, sea porque no existe o porque pertenece a otro.
export async function updateUserRol(req: Request, res: Response): Promise<void> {
  try {
    const parsed = rolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'El rol debe ser SOCIO, LIDER o ADMIN' });
      return;
    }

    const id = req.params['id'] as string;

    // Nadie cambia su propio rol: garantiza que el sistema siempre conserve
    // al menos un ADMIN (el propio requester).
    if (!puedeCambiarRol(req.user!.id, id)) {
      res.status(409).json({ error: 'No puedes cambiar tu propio rol' });
      return;
    }

    const organizationId = requireOrganizationId();

    const membresia = await prisma.membresia.findUnique({
      where: { organizationId_usuarioId: { organizationId, usuarioId: id } },
      include: {
        usuario: {
          select: { id: true, email: true, name: true, emailVerified: true, createdAt: true, organizationId: true },
        },
      },
    });
    if (!membresia) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const updatedMembresia = await prisma.$transaction(async (tx) => {
      const updated = await tx.membresia.update({
        where: { organizationId_usuarioId: { organizationId, usuarioId: id } },
        data: { rol: parsed.data.rol },
      });
      // Columna heredada de User (fase de expansión, ver schema.prisma): solo
      // se actualiza cuando el club activo sigue siendo el club "primario"
      // de la cuenta (User.organizationId) — si en el futuro esta persona
      // tiene otra membresía primaria, este cambio en OTRO club no le pisa
      // ese rol (Review Focus #3).
      if (membresia.usuario.organizationId === organizationId) {
        await tx.user.update({ where: { id }, data: { rol: parsed.data.rol } });
      }
      return updated;
    });

    res.json({
      id: membresia.usuario.id,
      email: membresia.usuario.email,
      name: membresia.usuario.name,
      rol: updatedMembresia.rol,
      emailVerified: membresia.usuario.emailVerified,
      createdAt: membresia.usuario.createdAt,
    });
  } catch (error) {
    console.error('[updateUserRol]', error);
    res.status(500).json({ error: 'No se pudo actualizar el rol' });
  }
}
```

- [ ] **Step 12: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: every check passes, including the two extended/new ones from Step 7.

- [ ] **Step 13: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 14: Commit**

```bash
git add backend/src/lib/scope-args.ts backend/src/lib/scope-args.test.ts backend/src/lib/user-global-guard.test.ts backend/src/controllers/admin.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): move User to GLOBAL_MODELS, read club membership from Membresia"
```

---

### Task 2: `authMiddleware` resolves the active club from `X-Club` + memberships

**Files:**
- Create: `backend/src/lib/x-club.ts`
- Create: `backend/src/lib/x-club.test.ts`
- Modify: `backend/src/middleware/auth.middleware.ts` (the `authMiddleware` function, lines 9–89; `requireAuth`/`requireAdmin`/`requireCanInvite`/`requireGestorEventos` are untouched)
- Modify: `backend/src/scripts/test-isolation.ts` (new `getJsonWithClub` helper; new `runAuthMembershipChecks` function; wire it into `main()`)

**Interfaces:**
- Consumes: `prisma.membresia` (PR 1), `isOrganizationSuspended`/`CLUB_SUSPENDIDO_MENSAJE` (`lib/organization-status.ts`, unchanged)
- Produces: `xClubHeader(req: Pick<Request, 'headers'>): string | undefined`, consumed by Task 4's `forgotPassword`; `getJsonWithClub(baseUrl: string, token: string, urlPath: string, xClub?: string): Promise<{ status: number; body: unknown }>`, consumed by Task 3's checks. `req.user`'s `AuthUser` shape (`types/index.ts`) is **unchanged** — every existing consumer (`authz.ts`, `gestores-eventos.ts`, every controller) keeps working without modification.

- [ ] **Step 1: Write the failing unit tests for `xClubHeader`**

Create `backend/src/lib/x-club.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { xClubHeader } from './x-club.js';

describe('xClubHeader', () => {
  it('returns the header value when present', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': 'el-montanista' } }), 'el-montanista');
  });

  it('returns undefined when absent', () => {
    assert.equal(xClubHeader({ headers: {} }), undefined);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': '  testing  ' } }), 'testing');
  });

  it('treats an empty or whitespace-only header as absent', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': '   ' } }), undefined);
  });

  it('takes the first value when the header repeats', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': ['a', 'b'] } }), 'a');
  });
});
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/lib/x-club.test.ts
```

Expected: fails to resolve `./x-club.js` — the module doesn't exist yet.

- [ ] **Step 3: Write `xClubHeader`**

Create `backend/src/lib/x-club.ts`:

```ts
// El club activo de cada request llega en el header X-Club (ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md) — el
// slug de uno de los clubes de los que la cuenta es socia. Separado de
// auth.middleware.ts (que lo consume para resolver req.user) y de
// auth.controller.ts (que también lo necesita para la marca del correo de
// forgotPassword) para no duplicar la lectura del header.
import type { Request } from 'express';

// Un header repetido llega como array en Express; se toma el primer valor,
// igual que el resto de los headers de una sola ocurrencia. Una cadena vacía
// o solo espacios se trata como "ausente": un X-Club: "" nunca debe
// intentar resolver un club con slug "".
export function xClubHeader(req: Pick<Request, 'headers'>): string | undefined {
  const raw = req.headers['x-club'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
```

- [ ] **Step 4: Run and confirm PASS**

```bash
node --import tsx --test src/lib/x-club.test.ts
```

- [ ] **Step 5: Add the `X-Club`-aware HTTP helper**

In `backend/src/scripts/test-isolation.ts`, add right after `patchJsonAuth` (this is test infrastructure the next step's checks need — it has no behavior of its own to fail red/green on):

```ts
// Como getJson, pero con el header X-Club — lo necesitan los checks nuevos de
// resolución de club activo (ver runAuthMembershipChecks): antes de este PR,
// ningún check de esta suite necesitaba enviarlo.
async function getJsonWithClub(
  baseUrl: string,
  token: string,
  urlPath: string,
  xClub?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (xClub !== undefined) headers['X-Club'] = xClub;
  const res = await fetch(`${baseUrl}${urlPath}`, { headers });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}
```

- [ ] **Step 6: Write the failing checks**

Add right after `runRoleChangeMembresiaChecks`:

```ts
// ─── Resolución de club activo (X-Club) y membresías múltiples ────────────────

async function runAuthMembershipChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  // El socio de A también se hace ADMIN de B — la única cuenta de todo el
  // fixture con más de una membresía, y con un rol DISTINTO en cada club, así
  // los checks de abajo prueban que el rol activo es el de la MEMBRESÍA, no
  // el de User.rol "primario". Nunca se limpia a mano: la purga final de B
  // borra esta fila junto con el resto de sus membresías.
  const tokenMulti = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
  await runAsPlatform(() =>
    prisma.membresia.create({
      data: { organizationId: seedB.organizationId, usuarioId: seedA.socioUserId, rol: 'ADMIN' },
    }),
  );

  await check('GET /api/me con X-Club resuelve la membresía de ESE club (rol incluido)', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
    assert.equal(res.status, 200);
    const body = res.body as { user: { rol: string; organization: { slug: string } } };
    assert.equal(body.user.organization.slug, SLUG_A);
    assert.equal(body.user.rol, 'SOCIO');
  });

  await check('GET /api/me con X-Club de la OTRA membresía resuelve SU rol ahí (ADMIN, no SOCIO)', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_B);
    assert.equal(res.status, 200);
    const body = res.body as { user: { rol: string; organization: { slug: string } } };
    assert.equal(body.user.organization.slug, SLUG_B);
    assert.equal(body.user.rol, 'ADMIN');
  });

  await check('GET /api/me sin X-Club y con varias membresías responde 400 "Selecciona un club"', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', undefined);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Selecciona un club' });
  });

  await check('GET /api/me con X-Club de un club inexistente responde 404 "Club no encontrado"', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', `iso-test-no-existe-${RANDOM_SUFFIX}`);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Club no encontrado' });
  });

  await check(
    'GET /api/me con X-Club de un club real del que NO es socio responde 403 "No perteneces a este club"',
    async () => {
      const tokenSoloA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
      const res = await getJsonWithClub(baseUrl, tokenSoloA, '/api/me', SLUG_B);
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: 'No perteneces a este club' });
    },
  );

  await check(
    'GET /api/me con X-Club de un club suspendido responde 403 con el mensaje de club suspendido',
    async () => {
      await runAsPlatform(() =>
        prisma.organization.update({ where: { id: seedA.organizationId }, data: { status: 'SUSPENDED' } }),
      );
      try {
        const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
        assert.equal(res.status, 403);
        const body = res.body as { error: string };
        assert.match(body.error, /suspendido/i);
      } finally {
        await runAsPlatform(() =>
          prisma.organization.update({ where: { id: seedA.organizationId }, data: { status: 'ACTIVE' } }),
        );
      }
    },
  );

  await check(
    'PATCH /api/admin/users/:id/rol en B no toca la columna heredada User.rol/organizationId cuando B no es el club primario (Review Focus #3)',
    async () => {
      const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
      const antes = await runAsPlatform(() => prisma.user.findUnique({ where: { id: seedA.socioUserId } }));

      try {
        const res = await patchJsonAuth(baseUrl, tokenB, `/api/admin/users/${seedA.socioUserId}/rol`, { rol: 'LIDER' });
        assert.equal(res.status, 200);
        assert.equal((res.body as { rol: string }).rol, 'LIDER');

        const despues = await runAsPlatform(() => prisma.user.findUnique({ where: { id: seedA.socioUserId } }));
        // User.organizationId/rol (columna heredada) sigue intacta: A sigue
        // siendo el club "primario" de la cuenta, y este cambio ocurrió en B.
        assert.equal(despues?.organizationId, seedA.organizationId);
        assert.equal(despues?.rol, antes?.rol);
      } finally {
        // Deja la membresía de B como la espera runClubesFieldChecks (Task
        // 3): ADMIN, tal como la creó este mismo fixture.
        await runAsPlatform(() =>
          prisma.membresia.update({
            where: { organizationId_usuarioId: { organizationId: seedB.organizationId, usuarioId: seedA.socioUserId } },
            data: { rol: 'ADMIN' },
          }),
        );
      }
    },
  );
}
```

Wire it into `main()`, right after `await runCreateUserCliChecks(seedA);` and before the global invariant check:

```ts
    await runCreateUserCliChecks(seedA);
    await runAuthMembershipChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 7: Run and confirm the expected failures**

```bash
npm run test:isolation
```

Expected: the first six checks fail — `X-Club` is not read at all by today's `authMiddleware`, so every request resolves to `req.user.organizationId = user.organizationId` (the caller's *primary* club) regardless of the header, and no `400`/`403`/`404` branch exists yet (for example, the "no `X-Club`, several memberships" check gets a `200` instead of `400`, silently resolving to `seedA.socioUserId`'s primary club, A). The seventh check (`PATCH .../rol` in B) already **passes** even before the rewrite — it authenticates as `seedB.adminUserId` directly (whose primary club is already B, with or without `X-Club` support) and only exercises Task 1's conditional `User.rol` write, not the club-resolution logic this task is adding. It's included here — not as a red step — because it needs this step's fixture (`seedA.socioUserId` also being a member of B) to exist, and this is the first point in the file where that fixture does.

- [ ] **Step 8: Rewrite `authMiddleware`**

In `backend/src/middleware/auth.middleware.ts`, add the import and replace the `authMiddleware` function (lines 1–89):

```ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { isAdmin, canInvite } from '../lib/authz.js';
import { categoriasGestionadas } from '../lib/gestores-eventos.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { isOrganizationSuspended, CLUB_SUSPENDIDO_MENSAJE } from '../lib/organization-status.js';
import { xClubHeader } from '../lib/x-club.js';

// Campos de Organization que arma req.user.organization (OrganizationSummary,
// ver types/index.ts), más "status", que solo se usa acá para el chequeo de
// suspensión y nunca se copia al objeto final.
const ORGANIZATION_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  status: true,
  membresiaPropia: true,
  alertEmail: true,
  contactName: true,
  contactEmail: true,
  logoObjectKey: true,
} as const;

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { userId } = verifyToken(token);
    // La cuenta (User) es global desde este PR — ver scope-args.ts — así que
    // se busca por id en contexto de plataforma, junto con TODAS sus
    // membresías. El club activo se resuelve aparte, abajo: X-Club decide
    // CUÁL de las membresías de la cuenta usar, nunca otorga pertenencia por
    // sí solo (la pertenencia ya la prueba que exista la Membresia).
    const user = await runAsPlatform(() =>
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          membresias: {
            orderBy: { creadoAt: 'asc' },
            include: { organization: { select: ORGANIZATION_SELECT } },
          },
        },
      }),
    );

    if (!user) {
      req.user = null;
      next();
      return;
    }

    const membresias = user.membresias;
    const xClub = xClubHeader(req);

    let activa: (typeof membresias)[number] | undefined;

    if (xClub !== undefined) {
      activa = membresias.find((m) => m.organization.slug === xClub);
      if (!activa) {
        // Se distingue "el club no existe" de "existe pero no soy socio" sin
        // filtrar más que eso — ver la tabla de errores del diseño multi-club.
        const orgExiste = await runAsPlatform(() =>
          prisma.organization.findUnique({ where: { slug: xClub }, select: { id: true } }),
        );
        res.status(orgExiste ? 403 : 404).json({
          error: orgExiste ? 'No perteneces a este club' : 'Club no encontrado',
        });
        return;
      }
    } else if (membresias.length === 1) {
      // Regla de transición: sin X-Club y con una sola membresía, se usa
      // esa — así un frontend que todavía no envía el header (el único que
      // existe en este PR) sigue funcionando exactamente igual que antes.
      activa = membresias[0];
    } else {
      // Cero o varias membresías sin X-Club: nada que asumir con seguridad.
      // (Una cuenta con cero membresías no puede existir hoy — ver el
      // diseño — así que en la práctica esto es siempre "varias".)
      res.status(400).json({ error: 'Selecciona un club' });
      return;
    }

    if (isOrganizationSuspended(activa.organization.status)) {
      res.status(403).json({ error: CLUB_SUSPENDIDO_MENSAJE });
      return;
    }

    req.user = {
      id: user.id,
      organizationId: activa.organization.id,
      email: user.email,
      name: user.name,
      rol: activa.rol,
      // Resumen cargado una sola vez acá: los controladores lo leen de
      // req.user.organization en vez de volver a consultar Organization.
      organization: {
        id: activa.organization.id,
        slug: activa.organization.slug,
        name: activa.organization.name,
        shortName: activa.organization.shortName,
        membresiaPropia: activa.organization.membresiaPropia,
        alertEmail: activa.organization.alertEmail,
        contactName: activa.organization.contactName,
        contactEmail: activa.organization.contactEmail,
        logoObjectKey: activa.organization.logoObjectKey,
      },
    };
    // Todo lo que siga en la cadena de middlewares/handler corre dentro del
    // contexto del club ACTIVO (no necesariamente el "primario" de User): es
    // lo que hace que prisma.ts filtre automáticamente cada consulta de este
    // request por su organizationId.
    runWithOrganization(activa.organization.id, () => next());
  } catch {
    req.user = null;
    next();
  }
}
```

`requireAuth`, `requireAdmin`, `requireCanInvite` and `requireGestorEventos` (today's lines 91–163) are unchanged — leave them exactly as they are.

- [ ] **Step 9: Verify `lib/gestores-eventos.ts` needs no change**

`categoriasGestionadas` (its only export) takes `user: { id, rol }` and reads `prisma.categoriaEvento`/`prisma.gestorCategoria`, both still `TENANT_MODELS`, scoped by whatever `runWithOrganization` context is active when it's called. Since `authMiddleware` now calls `runWithOrganization(activa.organization.id, ...)` — the *active* club, exactly like before (previously `user.organizationId`, now `activa.organization.id`) — this file needs no edit. Read `backend/src/lib/gestores-eventos.ts` once more to confirm; no diff follows this step.

- [ ] **Step 10: Run again and confirm PASS**

```bash
npm run test:isolation
```

Expected: all seven checks from Step 6 pass, and — critically for Review Focus #1 — every pre-existing check in `runHttpChecks`/`runQrChecks`/`runQrDirectoChecks`/`runFileDownloadChecks`/`runClubLogoChecks`/`runTenantCliChecks`/`runRoleChangeMembresiaChecks`/`runCreateUserCliChecks` still passes unmodified (none of them send `X-Club`, so they all exercise the single-membership fallback).

- [ ] **Step 11: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 12: Commit**

```bash
git add backend/src/lib/x-club.ts backend/src/lib/x-club.test.ts backend/src/middleware/auth.middleware.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): resolve the active club from X-Club and the account's memberships"
```

---

### Task 3: `login`/`GET /api/me` return `clubes`

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts` (`login`, lines 52–127; `getMe`, lines 133–144)
- Modify: `backend/src/scripts/test-isolation.ts` (extend the existing CLI-login check; new `runClubesFieldChecks` function; wire it into `main()`)

**Interfaces:**
- Consumes: `toPublicOrganizationBrand` (`lib/serializers/organization.ts`, already exported), `runAsPlatform` (already imported in `auth.controller.ts`)
- Produces: no new exported symbol — `login`'s and `getMe`'s JSON response gains a `clubes: { slug: string; name: string; shortName: string | null; hasLogo: boolean; logoVersion: string | null; rol: RolUsuario }[]` field, ordered oldest membership first

- [ ] **Step 1: Add the import**

In `backend/src/controllers/auth.controller.ts`, extend the existing import:

```ts
import { toPublicOrganization, toPublicOrganizationBrand } from '../lib/serializers/organization.js';
```

- [ ] **Step 2: Write the failing checks**

In `backend/src/scripts/test-isolation.ts`, extend the existing check inside `runTenantCliChecks` (currently `'POST /api/auth/login devuelve la organización pública propia del club recién creado (7 campos, sin datos privados)'`):

```ts
  await check(
    'POST /api/auth/login devuelve la organización pública propia del club recién creado (7 campos, sin datos privados) y clubes con su única membresía',
    async () => {
      const login = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
      assert.equal(login.status, 200);
      const body = login.body as {
        user: { organization?: Record<string, unknown>; clubes?: { slug: string; rol: string }[] };
      };
      const org = body.user.organization;
      assert.ok(org);
      assert.deepEqual(Object.keys(org!).sort(), [
        'hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug',
      ]);
      assert.equal(org!.hasLogo, false);
      assert.equal(org!.logoVersion, null);
      assert.equal(org!.slug, cliSlug);
      assert.equal(org!.membresiaPropia, MEMBRESIA_A);

      assert.equal(body.user.clubes?.length, 1);
      assert.equal(body.user.clubes?.[0]?.slug, cliSlug);
      assert.equal(body.user.clubes?.[0]?.rol, 'ADMIN');
    },
  );
```

Add a new function right after `runAuthMembershipChecks`:

```ts
// ─── Campo clubes en /me (login ya se cubre arriba, en runTenantCliChecks) ────

async function runClubesFieldChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  // Reutiliza el fixture de runAuthMembershipChecks (socio de A, también
  // ADMIN de B) — ya existe para cuando esta función corre.
  const tokenMulti = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });

  await check(
    'GET /api/me devuelve clubes con TODAS las membresías de la cuenta (slug/name/shortName/hasLogo/logoVersion/rol), no solo la activa',
    async () => {
      const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
      assert.equal(res.status, 200);
      const body = res.body as {
        user: {
          clubes?: { slug: string; name: string; shortName: string | null; hasLogo: boolean; logoVersion: string | null; rol: string }[];
        };
      };
      const clubes = body.user.clubes;
      assert.ok(clubes);
      assert.equal(clubes!.length, 2);
      assert.deepEqual(Object.keys(clubes![0]!).sort(), ['hasLogo', 'logoVersion', 'name', 'rol', 'shortName', 'slug']);
      const porSlug = Object.fromEntries(clubes!.map((c) => [c.slug, c]));
      assert.equal(porSlug[SLUG_A]?.rol, 'SOCIO');
      assert.equal(porSlug[SLUG_B]?.rol, 'ADMIN');
    },
  );
}
```

Wire it into `main()`, right after `await runAuthMembershipChecks(started.baseUrl, seedA, seedB);`:

```ts
    await runAuthMembershipChecks(started.baseUrl, seedA, seedB);
    await runClubesFieldChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 3: Run and confirm the expected failures**

```bash
npm run test:isolation
```

Expected: the extended login check fails on `assert.equal(body.user.clubes?.length, 1)` (`clubes` is `undefined`). The new `GET /api/me` check fails the same way.

- [ ] **Step 4: Add `clubes` to `login`**

In `backend/src/controllers/auth.controller.ts`, inside `login` (after computing `gestorCategorias`, before `res.json(...)`, around line 108):

```ts
    const token = signToken({ userId: user.id, email: user.email });
    // categoriasGestionadas consulta modelos de tenant (CategoriaEvento o
    // GestorCategoria): corre ya dentro del contexto del club del usuario
    // autenticado.
    const gestorCategorias = await runWithOrganization(user.organizationId, () => categoriasGestionadas(user));

    // Todas las membresías de la cuenta (plataforma-wide: el club activo de
    // esta respuesta sigue siendo el de arriba, User.organizationId — ver
    // Ruling 3 del plan de esta PR). Ordenadas por antigüedad: el frontend
    // (PR 4) las usa para "Mis clubes".
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: user.id },
        orderBy: { creadoAt: 'asc' },
        select: { rol: true, organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true } } },
      }),
    ).then((rows) => rows.map((m) => ({ ...toPublicOrganizationBrand(m.organization), rol: m.rol })));

    res.json({
      token,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        picture: user.picture ?? undefined,
        rol: user.rol,
        gestorCategorias,
        organization: toPublicOrganization(user.organization),
        clubes,
      },
    });
```

- [ ] **Step 5: Add `clubes` to `getMe`**

In `backend/src/controllers/auth.controller.ts`, replace `getMe` (lines 133–144):

```ts
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { id, organizationId, email, name, rol, organization } = req.user!;
    const gestorCategorias = await categoriasGestionadas(req.user!);
    res.json({
      user: { id, organizationId, email, name, rol, gestorCategorias, organization: toPublicOrganization(organization) },
    });
  } catch (error) {
    console.error('[getMe]', error);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
}
```

with:

```ts
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { id, organizationId, email, name, rol, organization } = req.user!;
    const gestorCategorias = await categoriasGestionadas(req.user!);
    // Plataforma-wide a propósito (ver login más arriba): el club activo
    // sigue siendo el que authMiddleware ya resolvió (con X-Club o el
    // fallback de una sola membresía) — clubes es la lista completa.
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: id },
        orderBy: { creadoAt: 'asc' },
        select: { rol: true, organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true } } },
      }),
    ).then((rows) => rows.map((m) => ({ ...toPublicOrganizationBrand(m.organization), rol: m.rol })));

    res.json({
      user: { id, organizationId, email, name, rol, gestorCategorias, organization: toPublicOrganization(organization), clubes },
    });
  } catch (error) {
    console.error('[getMe]', error);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
}
```

- [ ] **Step 6: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: both checks pass; every other check (including the strict `Object.keys` assertions on `.organization` alone, unaffected by the new sibling `clubes` field) stays green.

- [ ] **Step 7: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): expose clubes (all memberships) on login and GET /me"
```

---

### Task 4: Password-reset branding resolved via `Membresia`

**Files:**
- Create: `backend/src/lib/reset-branding.ts`
- Create: `backend/src/lib/reset-branding.test.ts`
- Modify: `backend/src/controllers/auth.controller.ts` (`forgotPassword`, lines 148–207)
- Modify: `backend/src/scripts/test-isolation.ts` (new check inside `runClubesFieldChecks` or a small addition after it)

**Interfaces:**
- Consumes: nothing new
- Produces: `resolveResetBrandingOrganizationId(memberships: { organizationId: string }[], requestOrganizationId: string | null): string | null`, consumed by `forgotPassword`

- [ ] **Step 1: Write the pure resolver**

Create `backend/src/lib/reset-branding.ts`:

```ts
// Elige el club cuya marca (nombre, contacto) usa el correo de
// restablecimiento de contraseña, ahora que una cuenta puede pertenecer a
// varios clubes — ver diseño multi-club §2 "Password reset". Puro: recibe
// las membresías ya cargadas (ordenadas por antigüedad) y el id del club de
// la request, si lo hay; no toca Prisma ni Express.
export interface MembresiaParaBranding {
  organizationId: string;
}

// `memberships` debe venir ordenado por creadoAt ascendente: el primero es
// "la más antigua". `requestOrganizationId` es el club resuelto del header
// X-Club de la request (null si no vino, o si no existe ningún club con ese
// slug) — se usa solo si la persona es efectivamente socia de él.
export function resolveResetBrandingOrganizationId(
  memberships: MembresiaParaBranding[],
  requestOrganizationId: string | null,
): string | null {
  if (requestOrganizationId && memberships.some((m) => m.organizationId === requestOrganizationId)) {
    return requestOrganizationId;
  }
  return memberships[0]?.organizationId ?? null;
}
```

- [ ] **Step 2: Write its unit tests**

Create `backend/src/lib/reset-branding.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResetBrandingOrganizationId } from './reset-branding.js';

describe('resolveResetBrandingOrganizationId', () => {
  it('uses the request club when the person is a member of it', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, 'org-new'), 'org-new');
  });

  it('falls back to the oldest membership when there is no request club', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, null), 'org-old');
  });

  it('falls back to the oldest membership when the request club is not one of theirs', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, 'org-other'), 'org-old');
  });

  it('returns null when there are no memberships at all', () => {
    assert.equal(resolveResetBrandingOrganizationId([], null), null);
  });

  it('reduces to today\'s only membership when nobody sends X-Club yet (single-membership world, Global Constraint)', () => {
    const memberships = [{ organizationId: 'org-solo' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, null), 'org-solo');
  });
});
```

- [ ] **Step 3: Run and confirm PASS**

```bash
node --import tsx --test src/lib/reset-branding.test.ts
```

- [ ] **Step 4: Write the failing isolation check**

In `backend/src/scripts/test-isolation.ts`, add to `runClubesFieldChecks` (right after its existing check):

```ts
  await check(
    'POST /api/auth/forgot-password con X-Club de un club ajeno no revienta y responde el mensaje genérico igual',
    async () => {
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club': SLUG_B },
        body: JSON.stringify({ email: seedA.adminEmail }),
      });
      const body = await res.json().catch(() => undefined);
      assert.equal(res.status, 200);
      assert.deepEqual(body, {
        message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.',
      });
    },
  );
```

- [ ] **Step 5: Run and confirm it already passes (or fails only if `forgotPassword` throws)**

```bash
npm run test:isolation
```

Expected: this specific check already passes even before Step 6 — today's `forgotPassword` ignores unknown headers and behaves identically. This step exists to prove the rewrite in Step 6 doesn't regress it, not to drive new implementation (same pattern as PR 1 Task 3's race-test step).

- [ ] **Step 6: Rewrite `forgotPassword`**

In `backend/src/controllers/auth.controller.ts`, add the imports:

```ts
import { xClubHeader } from '../lib/x-club.js';
import { resolveResetBrandingOrganizationId } from '../lib/reset-branding.js';
```

Replace `forgotPassword` (lines 148–207):

```ts
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    return;
  }
  const { email } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    // El email es único en toda la plataforma, así que este flujo corre en
    // contexto de plataforma. El correo se envía "como" el club de la marca
    // (ver resolveResetBrandingOrganizationId): el de la request (X-Club) si
    // la persona es socia de él, si no su membresía más antigua — hoy eso es
    // siempre su única membresía (ver Ruling 3 del plan de esta PR).
    await runAsPlatform(async () => {
      const found = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!found) return;

      const memberships = await prisma.membresia.findMany({
        where: { usuarioId: found.id },
        orderBy: { creadoAt: 'asc' },
        select: { organizationId: true },
      });

      const xClub = xClubHeader(req);
      let requestOrganizationId: string | null = null;
      if (xClub) {
        const org = await prisma.organization.findUnique({ where: { slug: xClub }, select: { id: true } });
        requestOrganizationId = org?.id ?? null;
      }

      const brandingOrgId = resolveResetBrandingOrganizationId(memberships, requestOrganizationId);
      // Sin membresías: no puede pasar hoy (toda cuenta nace con una — ver
      // el diseño), pero no revienta si pasara — simplemente no hay con qué
      // marca enviar el correo.
      if (!brandingOrgId) return;

      const organization = await prisma.organization.findUnique({
        where: { id: brandingOrgId },
        select: {
          id: true,
          slug: true,
          name: true,
          shortName: true,
          membresiaPropia: true,
          alertEmail: true,
          contactName: true,
          contactEmail: true,
          logoObjectKey: true,
        },
      });
      if (!organization) return;

      const resetToken = randomUUID();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await prisma.user.update({
        where: { id: found.id },
        data: { resetToken, resetTokenExpiry },
      });

      const resetUrl = `${FRONTEND_URL}?reset=${resetToken}`;
      const branding = brandingFor(organization);
      sendClubEmail(organization, {
        to: normalizedEmail,
        subject: subjectPasswordReset(branding),
        html: buildPasswordResetEmail(found.name, resetUrl, branding),
        kind: 'notificacion',
      }).catch((err) => console.error('[forgotPassword] email error:', err));
    });

    // Siempre responder 200 para no revelar si el email existe
    res.json({ message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.' });
  } catch (error) {
    console.error('[forgotPassword]', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
```

- [ ] **Step 7: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: the Step 4 check still passes; every other check (nothing else in the suite calls `forgot-password`) stays green.

- [ ] **Step 8: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/lib/reset-branding.ts backend/src/lib/reset-branding.test.ts backend/src/controllers/auth.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): resolve password-reset branding from the account's memberships"
```

---

### Task 5: CLI `create-user --org` adds a membership instead of refusing

**Files:**
- Modify: `backend/src/scripts/create-user.ts` (`run`, lines 117–210)
- Modify: `backend/src/scripts/test-isolation.ts` (extend `runCreateUserCliChecks` with a `seedB` param and two new checks; update its call site)

**Interfaces:**
- Consumes: `prisma.membresia` (already used elsewhere in the file)
- Produces: `runCreateUserCliChecks(seedA: OrgSeed, seedB: OrgSeed): Promise<void>` (signature grows by one param), consumed by `main()`

- [ ] **Step 1: Write the failing checks**

In `backend/src/scripts/test-isolation.ts`, change `runCreateUserCliChecks`'s signature and add two checks at the end of it:

```ts
async function runCreateUserCliChecks(seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  await check('CLI create-user: un usuario nuevo obtiene exactamente una Membresia con su rol y club', async () => {
    /* unchanged — omitted here for brevity, keep as-is */
  });

  await check('CLI create-user --force: cambia el rol y también actualiza la Membresia existente', async () => {
    /* unchanged — omitted here for brevity, keep as-is */
  });

  await check(
    'CLI create-user --force autosana una Membresia faltante (fila borrada a mano) en vez de fallar (Review Focus #5 de PR 1)',
    async () => {
      /* unchanged — omitted here for brevity, keep as-is */
    },
  );

  await check(
    'CLI create-user sin --force sigue rechazando cuando la cuenta YA es socia de este club',
    async () => {
      const email = `cli-rechazo-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Rechazo', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Rechazo', '--org', SLUG_A, '--rol', 'LIDER'],
        'password123',
      );
      assert.notEqual(segundo.code, 0);
      assert.match(segundo.stderr, /ya es socio de/);
    },
  );

  await check(
    'CLI create-user: cuenta existente en OTRO club recibe la membresía nueva en vez de ser rechazada (Ruling 2 del plan de esta PR)',
    async () => {
      const email = `cli-multi-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Multi Original', '--org', SLUG_B, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Multi Ignorado', '--org', SLUG_A, '--rol', 'LIDER'],
        'password123',
      );
      // Éxito, no rechazo: antes de este PR, un email existente en otro club
      // siempre fallaba (incluso con --force).
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);
      assert.doesNotMatch(segundo.stdout + segundo.stderr, /pertenece a otra organización/);

      const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(user);
      // El alta aditiva nunca toca el perfil compartido: el nombre sigue
      // siendo el original, pese a que el segundo comando pasó otro con
      // --name (Review Focus #4).
      assert.equal(user!.name, 'CLI Multi Original');

      const membresias = await runAsPlatform(() =>
        prisma.membresia.findMany({ where: { usuarioId: user!.id }, orderBy: { creadoAt: 'asc' } }),
      );
      assert.equal(membresias.length, 2);
      assert.equal(membresias[0]?.organizationId, seedB.organizationId);
      assert.equal(membresias[0]?.rol, 'SOCIO');
      assert.equal(membresias[1]?.organizationId, seedA.organizationId);
      assert.equal(membresias[1]?.rol, 'LIDER');
    },
  );
}
```

Update the call site in `main()`:

```ts
    await runCreateUserCliChecks(seedA, seedB);
```

- [ ] **Step 2: Run and confirm the expected failures**

```bash
npm run test:isolation
```

Expected: `'CLI create-user sin --force sigue rechazando...'` still passes (today's behavior for the same-club case is already this). `'CLI create-user: cuenta existente en OTRO club...'` **fails** — the second CLI invocation exits non-zero with `pertenece a otra organización` (today's cross-club refusal).

- [ ] **Step 3: Rewrite `create-user.ts`'s `run` function**

In `backend/src/scripts/create-user.ts`, replace lines 117–210 (from right after `verifyDbTargetOrExit();` inside `run` through the end of the function):

```ts
async function run(): Promise<void> {
  verifyDbTargetOrExit();

  const parsed = parseCreateUserArgs(process.argv.slice(2));
  if (!parsed.success) {
    for (const error of parsed.errors) {
      console.error(`[create-user] ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  const { email, name, rol, force, org } = parsed.data;

  const organization = await prisma.organization.findUnique({ where: { slug: org } });
  if (!organization) {
    console.error(`[create-user] No existe ninguna organización con slug="${org}".`);
    process.exitCode = 1;
    return;
  }

  // Se comprueba antes de pedir la contraseña para no hacerla teclear en vano.
  const existing = await prisma.user.findUnique({ where: { email } });

  // Multi-club (ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md,
  // Ruling 2 del plan de la PR de backend): una cuenta existente puede no
  // tener todavía membresía en ESTE club.
  const existingMembresia = existing
    ? await prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: organization.id, usuarioId: existing.id } },
      })
    : null;

  if (existingMembresia && !force) {
    console.error(`[create-user] "${email}" ya es socio de "${org}". Usa --force para actualizarlo.`);
    process.exitCode = 1;
    return;
  }

  // Alta de membresía en un club nuevo para una cuenta ya existente: siempre
  // aditivo (nunca pisa nombre/contraseña de la cuenta compartida), así que
  // no hace falta --force ni pedir contraseña.
  if (existing && !existingMembresia) {
    await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: existing.id, rol },
    });
    console.log(`[create-user] Se agregó a "${email}" como socio de "${org}" con rol="${rol}".`);
    return;
  }

  const rawPassword = await readPassword();
  if (rawPassword === null) {
    process.exitCode = 1;
    return;
  }

  const passwordResult = passwordField.safeParse(rawPassword);
  if (!passwordResult.success) {
    console.error(`[create-user] ${passwordResult.error.issues[0]?.message ?? 'Contraseña inválida'}`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(passwordResult.data, SALT_ROUNDS);

  if (!existing) {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: organization.id, email, name, passwordHash, rol, emailVerified: true },
      });
      await tx.membresia.create({
        data: { organizationId: organization.id, usuarioId: user.id, rol },
      });
    });
    console.log(`[create-user] Usuario creado: email="${email}" rol="${rol}" org="${org}"`);
    return;
  }

  // existing && existingMembresia && force: actualiza el perfil compartido
  // de la cuenta y el rol de ESTA membresía.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { email },
      data: {
        name,
        passwordHash,
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
        resetToken: null,
        resetTokenExpiry: null,
        // Columna heredada de User (fase de expansión, ver schema.prisma):
        // solo se actualiza cuando este club sigue siendo el club
        // "primario" de la cuenta (User.organizationId) — igual que
        // updateUserRol en admin.controller.ts.
        ...(existing.organizationId === organization.id ? { rol } : {}),
      },
    });
    // upsert (no update): --force es una herramienta de reparación operativa
    // (ver su descripción en create-user-args.ts, "actualizarlo") — a
    // diferencia de PATCH /admin/users/:id/rol (admin.controller.ts), que
    // falla ruidoso si la Membresia falta, acá se prefiere autosanar: una
    // fila que falte (backfill incompleto, borrado a mano) no debe bloquear
    // al operador que está tratando de arreglar justamente ese usuario.
    await tx.membresia.upsert({
      where: { organizationId_usuarioId: { organizationId: organization.id, usuarioId: user.id } },
      create: { organizationId: organization.id, usuarioId: user.id, rol },
      update: { rol },
    });
  });
  console.log(`[create-user] Usuario actualizado: email="${email}" rol="${rol}" org="${org}"`);
}
```

- [ ] **Step 4: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: every check passes, including the two from Step 1 and the three pre-existing CLI checks (still exercising the "brand-new user" and "same-club `--force`" paths, both untouched in behavior).

- [ ] **Step 5: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/create-user.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): CLI create-user --org adds a membership to an existing account"
```

---

## Deployment

**No migration in this PR.** Every change is TypeScript (`scope-args.ts`, two controllers, one middleware, one CLI script, two new small `lib/` files) plus new tests — `prisma/schema.prisma` is untouched (`Membresia` already exists from PR 1). The CI job's existing "Apply migrations" step (`docker compose run --rm migrate`) will find nothing pending and is a no-op, exactly like any other release with no schema change. **No Neon backup branch is needed before approving the deploy job.**

The CI job (`.github/workflows/deploy.yml`) already deploys automatically once a reviewer approves the `production` environment gate: preflight (new image starts cleanly against production's real env) → report pending migrations (none) → apply migrations (no-op) → roll the containers → health check (`https://riala.cl/api/health`, retried). Nothing about that flow needs to change for this PR.

**Post-deploy read-only checks** (optional, over the same WireGuard VPN the CI job itself uses, after CI already reports healthy — this PR's core risk is `User` going global, so the checks below specifically look for a cross-club leak or an orphaned account):

```bash
# Sobre la misma red WireGuard que ya usa el job de CI — cualquier máquina
# unida a ella y con acceso SSH al servidor sirve; no hay un alias fijo
# documentado en este repo para esa conexión manual.
ssh <usuario>@<dirección VPN del servidor>
cd ~/riala      # $DEPLOY_DIR
set -a; . ./.env; set +a

# El invariante de PR 1 (todo usuario tiene al menos una Membresia) no lo
# toca esta PR — solo cambia cómo se LEE — así que debería seguir en 0.
docker run --rm postgres:16-alpine psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS usuarios_sin_membresia
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM membresias m WHERE m.usuario_id = u.id);
"
```

Expected: `usuarios_sin_membresia | 0`.

```bash
# Con un token real de un ADMIN conocido, confirma que /api/admin/users
# devuelve exactamente los socios de SU club (no un conteo global) —
# comparar con lo que se ve hoy en el panel antes de esta PR.
curl -fsS -H "Authorization: Bearer <token de un ADMIN real>" https://riala.cl/api/admin/users | jq 'length'
```

Expected: the same headcount that club's admin panel showed before this deploy.

**Rollback note:** since this PR is pure application code (no schema/migration change), rolling back is the ordinary image rollback (`RIALA_TAG` in `~/riala/.env` set back to the previous `sha-` value, then `docker compose up -d`) — there is no migration to reverse, and no data was altered by this PR's deploy.

---

## Self-review

**1. Spec coverage.** Design §2 "Backend": club resolution per request (Task 2), transition rule (Task 2, Global Constraints), login/`/me` `clubes` (Task 3), admin endpoints on memberships (Task 1), gestores de eventos (verified no-op, Task 2 Step 9), password reset branding (Task 4), CLI `create-user --org` (Task 5). `tenant:create --admin-email` is explicitly deferred to PR 3 (Ruling 1) — not in this plan. Design §4 "Security, errors, testing": the static guard (Task 1), the full error table (`404`/`403`/suspended/`400` — Task 2 Step 6; `409`/`403` for invitations are unchanged, out of scope per Ruling 1), and every isolation case the spec names explicitly ("person in A and B sees only A with `X-Club: A`", "cannot use C", "A's admin cannot list/change B's memberships", "A's user list excludes people only in B") are covered by Task 1's two new/extended checks and Task 2's seven new checks.

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N" language anywhere in this plan — every step shows real, complete code, including the parts of `runCreateUserCliChecks` marked `/* unchanged — omitted here for brevity, keep as-is */` in Task 5 Step 1, which is an explicit instruction to leave three specific, already-fully-written (in Task-1-of-PR-1's plan) checks untouched, not a placeholder for new code.

**3. Type consistency.** `xClubHeader`'s signature (`Pick<Request, 'headers'>`) is used identically in both its own tests (plain object literals) and in `auth.middleware.ts`/`auth.controller.ts` (a real Express `Request`). `resolveResetBrandingOrganizationId`'s `MembresiaParaBranding` shape (`{ organizationId: string }`) matches exactly what `forgotPassword`'s `prisma.membresia.findMany({ select: { organizationId: true } })` returns. `AuthUser` (`types/index.ts`) is never modified — every field `authMiddleware` sets in Task 2 matches the interface already declared. `Membresia.rol`/`RolUsuario` is used consistently as the source of "role in this club" from Task 1 onward, never re-introducing a read of `User.rol` for authorization.

**4. Review Focus.** All five items list their pinning task/test explicitly in the section above; none are left uncovered.

# Multi-Club Membership — PR 1: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Membresia` model (backfilled from every existing user) and make every code path that creates a `User` or changes `User.rol` also write the matching `Membresia`, with zero behavior change — reads still go through `User.organizationId`/`User.rol`.
**Architecture:** Expand-only migration (`membresias` table + backfill from `users.organization_id`/`users.rol`), `Membresia` added to `TENANT_MODELS` so it inherits the same fail-closed tenant isolation as every other model, and a dual write inside each existing `User`-creating/role-changing transaction. `User` stays in `TENANT_MODELS` and its columns are untouched — this PR is reversible by rolling back the image alone.
**Tech Stack:** Express 5, Prisma 7 (TypeScript, `prisma-client` generator), PostgreSQL on Neon, `node:test` via `tsx`.
**Spec:** docs/superpowers/specs/2026-09-23-multi-club-membership-design.md (Design → §1 "Data model and migration"; Delivery step 1 "Data")

## Global Constraints

- No behavior change in this PR: every read still uses `User.organizationId`/`User.rol`; `Membresia` is write-only from the app's perspective until PR 2.
- `User` stays in `TENANT_MODELS` (unchanged) — moving it to `GLOBAL_MODELS` is PR 2, together with the static guard and every in-club read switching to `Membresia`.
- `User.organizationId`/`User.rol` columns are never dropped or altered in this PR — only read, for the backfill.
- Conventional commits, no `Co-Authored-By` or AI attribution of any kind.
- Code comments in Spanish, matching the surrounding file (`schema.prisma`, `scope-args.ts`, the repos, the isolation suite are all commented in Spanish); this plan document itself is in English.
- Single backend replica (rate limiting is in-memory) — nothing in this PR changes that.
- The database is Neon, never dockerized; migrations run via the `migrate` one-shot service (`docker compose run --rm migrate`), never applied by hand against production outside that container.
- `RolUsuario` (`SOCIO`/`LIDER`/`ADMIN`) is reused as-is for `Membresia.rol` — no new enum.
- `gen_random_uuid()` is used for the backfill's generated ids: it is a PostgreSQL 13+ core function (Neon runs ≥13), no extension needed — the app itself never generates ids in SQL (Prisma's `@default(uuid())` is client-side), but a raw backfill `INSERT` has no app process to ask.

## Review Focus

The five failure modes most likely to slip past a shallow implementation, and the task that pins each one with a real test:

1. **A user-creation path this PR missed leaves that user with zero memberships.** Pinned by the global invariant check added at the end of Task 5: `prisma.user.count({ where: { membresias: { none: {} } } })` must be `0` across the *entire* database (not just the fixtures this suite seeds), after every check in the suite — including the ones that create users through HTTP, through the CLI, and through direct Prisma calls — has run.
2. **A role change updates `User.rol` but leaves `Membresia.rol` stale.** Pinned by Task 4's new HTTP check on `PATCH /api/admin/users/:id/rol`.
3. **The backfill `INSERT` is re-run** (a retried deploy, or a human re-applying it by hand) **and duplicates rows or errors instead of being a no-op.** Pinned by Task 1's idempotency verification step (re-run the exact backfill statement against the dev database and assert the row count is unchanged).
4. **Two invitations for the same not-yet-existing email both reach `acceptInvitacion`/`registrarUsuarioQrDirecto` at once; the transaction that loses the `User.email` unique-constraint race must not leave an orphaned `Membresia` behind.** Pinned by Task 3's concurrent-acceptance test, which calls the repo directly with two real pending `Invitacion` rows for the same email and asserts exactly one `Membresia` exists afterward.
5. **CLI `create-user --force` runs against a user whose `Membresia` row is missing** (backfill gap, or a row deleted by hand) **and either crashes or silently leaves it missing instead of repairing it.** Pinned by Task 5's self-healing test, which deletes the `Membresia` row before running `--force` and asserts it comes back correct.

---

## File Structure

| File | Responsibility | Task |
|------|-----------------|------|
| `backend/prisma/schema.prisma` | `Membresia` model + relation fields on `User`/`Organization` | 1 |
| `backend/prisma/migrations/<timestamp>_add_membresias/migration.sql` | Creates `membresias`, backfills it from `users` | 1 |
| `backend/src/lib/scope-args.ts` | Registers `Membresia` in `TENANT_MODELS` | 1 |
| `backend/src/scripts/test-isolation.ts` | Seeds/purges/probes `Membresia`; new dual-write and race assertions; CLI checks; global invariant | 2, 3, 4, 5 |
| `backend/src/services/invitaciones.repo.prisma.ts` | Dual write on invitation acceptance | 3 |
| `backend/src/services/codigos-qr.repo.prisma.ts` | Dual write on QR-directo registration | 3 |
| `backend/src/controllers/admin.controller.ts` | Dual write on `PATCH /api/admin/users/:id/rol` | 4 |
| `backend/src/scripts/create-user.ts` | Dual write on CLI create + `--force` (self-healing) | 5 |

---

## User-creation / role-change site inventory

Every `User` create/update site found by grepping `\.user\.create\|\.user\.update\|\.user\.upsert\|\.user\.createMany` and `INSERT INTO "\?users"` across `backend/src` (excluding `src/generated`), and what happens to it:

**Real dual-write sites (fixed by this plan):**

| Site | What it does | Fixed by |
|------|---------------|----------|
| `backend/src/services/invitaciones.repo.prisma.ts:87` | `tx.user.create` inside `acceptInvitacion` — invitation-by-email/QR-by-email acceptance, and the platform bootstrap-admin invitation from `tenants.service.ts` (it also ends up here once accepted) | Task 3 |
| `backend/src/services/codigos-qr.repo.prisma.ts:115` | `tx.user.create` inside `registrarUsuarioQrDirecto` — QR-directo one-scan signup | Task 3 |
| `backend/src/controllers/admin.controller.ts:882` | `prisma.user.update` inside `updateUserRol` — `PATCH /api/admin/users/:id/rol` | Task 4 |
| `backend/src/scripts/create-user.ts:171` | `prisma.user.create` — CLI, new user | Task 5 |
| `backend/src/scripts/create-user.ts:178` | `prisma.user.update` — CLI `--force`, updates `rol` on an existing user | Task 5 |

**Sites checked and found irrelevant (no `rol`/`organizationId` change, or no `User` write at all):**

| Site | Why it's irrelevant |
|------|----------------------|
| `backend/src/controllers/auth.controller.ts:37` (`verifyEmail`) | Only sets `emailVerified`/`verificationToken*` — never `rol` or `organizationId` |
| `backend/src/controllers/auth.controller.ts:186` (`forgotPassword`) | Only sets `resetToken`/`resetTokenExpiry` |
| `backend/src/controllers/auth.controller.ts:233` (`resetPassword`) | Only sets `passwordHash`/`resetToken*`/`emailVerified`/`verificationToken*` |
| `backend/src/services/tenants.repo.prisma.ts` (`crearClubTransaccion`) | Creates `Organization` + `CategoriaEvento` + `DeclaracionJuradaVersion` only — never touches `User` |
| `backend/src/services/tenants.service.ts` (`crearClub`, `invitarAdminClub`) | Only issue a platform `Invitacion` via `crearInvitacionPlataforma`; the `User` row is created later when that invitation is accepted, through the already-covered `invitaciones.repo.prisma.ts:87` site |
| `backend/src/scripts/test-isolation.ts:192,240` (`seedOrganization`) | Test fixture code, not a production code path — it calls `prisma.user.create` directly to build the suite's own `A`/`B` clubs. Made consistent by Task 2, which seeds a matching `Membresia` for each seeded user directly (not "dual write": this is the test's own fixture, not application code) |
| No `prisma/seed*` script | None exists in this repo (`find . -iname "seed*"` under `backend`, excluding `node_modules`/`dist`, returns nothing) |
| No raw SQL `INSERT INTO users` | `grep -rn 'INSERT INTO "users"' backend/src` returns nothing — the only raw-SQL sites in the codebase are the two already allow-listed in `raw-sql-guard.test.ts` (`admin.controller.ts`, `eventos-admin.controller.ts`), neither of which writes to `users` |
| No `.user.upsert`/`.user.createMany` anywhere in current application code | Confirmed by the same grep — the only `upsert` this plan introduces is `tx.membresia.upsert` in `create-user.ts`'s `--force` branch (Task 5), never on `User` itself |

---

### Task 1: `Membresia` model, migration, and tenant registration

**Files:**
- Modify: `backend/prisma/schema.prisma` (insert new model after `User`, currently lines 122–156; add one relation line to `Organization`, currently lines 77–118; add one relation line to `User`)
- Create: `backend/prisma/migrations/<timestamp>_add_membresias/migration.sql` (e.g. `20260923150000_add_membresias`, the exact timestamp is whatever `prisma migrate dev` stamps when this step actually runs)
- Modify: `backend/src/lib/scope-args.ts` (lines 15–31, `TENANT_MODELS`)

**Interfaces:**
- Consumes: nothing (new model)
- Produces: `prisma.membresia` (Prisma delegate: `create`, `findUnique({ where: { organizationId_usuarioId } })`, `findMany`, `update`, `deleteMany`, …), consumed by Tasks 2–5

- [ ] **Step 1: Write the failing test — add the model to the schema, nothing else**

Open `backend/prisma/schema.prisma`. In the `Organization` model (line 100), add the relation field right after `users`:

```prisma
  users                      User[]
  membresias                 Membresia[]
  dashboardLayouts           DashboardLayout[]
```

In the `User` model, add the relation field right after `codigoQrRegistro` (line 152):

```prisma
  // El QR directo que dio de alta a este usuario (null para toda cuenta que
  // nació por otro camino) — ver CodigoQrInvitacion.registradoUsuarioId.
  codigoQrRegistro     CodigoQrInvitacion?  @relation("CodigoQrRegistro")
  membresias           Membresia[]
```

Insert the new model right after `User` closes (after line 156, before the `DashboardLayout` comment on line 158):

```prisma
// Pertenencia de una cuenta a un club, con su rol EN ESE club — ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md. Fase de
// expansión: hoy es una copia con dual write de User.organizationId/rol
// (User sigue siendo la fuente de verdad de lectura), no confundir con
// Integrante.membresiaClub/MEMBRESIA_CLUBS (lib/membresias.ts), que es un
// concepto totalmente distinto (afiliación declarada en la ficha de socio).
model Membresia {
  id             String     @id @default(uuid())
  organizationId String     @map("organization_id")
  usuarioId      String     @map("usuario_id")
  rol            RolUsuario
  creadoAt       DateTime   @default(now()) @map("creado_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  usuario      User         @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@unique([organizationId, usuarioId])
  @@index([usuarioId])
  @@index([organizationId])
  @@map("membresias")
}
```

- [ ] **Step 2: Run the schema-consistency tests and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/lib/scope-args.test.ts src/lib/schema-organization.test.ts
```

Expected: `src/lib/schema-organization.test.ts` passes (the new model already declares `organizationId String @map("organization_id")`). `src/lib/scope-args.test.ts` **fails** on `describe('TENANT_MODELS ∪ GLOBAL_MODELS ∪ {Organization} vs. schema.prisma')` — `Membresia` is now in the schema but not yet in `TENANT_MODELS`/`GLOBAL_MODELS`/`ORGANIZATION_MODEL`. This is the guard working as designed (a new model must declare its scope explicitly).

- [ ] **Step 3: Register `Membresia` in `TENANT_MODELS`**

In `backend/src/lib/scope-args.ts`, update the comment and array (lines 15–31):

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
```

- [ ] **Step 4: Re-run and confirm PASS**

```bash
node --import tsx --test src/lib/scope-args.test.ts src/lib/schema-organization.test.ts
```

Expected: both files pass, no failures.

- [ ] **Step 5: Create the migration skeleton**

```bash
npm run db:guard
npx prisma migrate dev --name add_membresias --create-only
```

This writes `backend/prisma/migrations/<timestamp>_add_membresias/migration.sql` with the auto-generated `CreateTable`/`CreateIndex`/`AddForeignKey` statements for `membresias`, without applying it yet.

- [ ] **Step 6: Hand-edit the migration to add the backfill**

Open the generated `migration.sql` and prepend a comment block, then append the backfill `INSERT` after the generated DDL. The full file should read:

```sql
-- Membresías: pertenencia de una cuenta a un club con su rol EN ESE club.
-- Fase de expansión (1 de 2) del diseño multi-club — ver
-- docs/superpowers/specs/2026-09-23-multi-club-membership-design.md. Crea la
-- tabla y rellena una fila por cada usuario existente a partir de
-- users.organization_id y users.rol. users.organization_id/rol NO se tocan
-- todavía (siguen siendo la fuente de verdad de lectura hasta la migración
-- de contracción de una fase posterior) — así el rollback de esta imagen es
-- seguro sin perder datos.

-- CreateTable
CREATE TABLE "membresias" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "creado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membresias_organization_id_usuario_id_key" ON "membresias"("organization_id", "usuario_id");

-- CreateIndex
CREATE INDEX "membresias_usuario_id_idx" ON "membresias"("usuario_id");

-- CreateIndex
CREATE INDEX "membresias_organization_id_idx" ON "membresias"("organization_id");

-- AddForeignKey
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill ──────────────────────────────────────────────────────────────
-- Una fila por usuario existente. ON CONFLICT DO NOTHING vuelve la migración
-- segura de reintentar (por ejemplo si el deploy se corta después de crear la
-- tabla pero antes de terminar el backfill): reaplicar este INSERT no duplica
-- ni pisa una fila que ya quedó bien.
INSERT INTO "membresias" ("id", "organization_id", "usuario_id", "rol", "creado_at")
SELECT gen_random_uuid()::text, "organization_id", "id", "rol", CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("organization_id", "usuario_id") DO NOTHING;
```

If the auto-generated `CreateIndex`/`AddForeignKey` block Prisma actually wrote differs in statement order from the one above (Prisma's migration engine does not always preserve `@@unique`/`@@index` declaration order), keep Prisma's real output for that block verbatim — only the top comment and the backfill `INSERT` are hand-written and must match exactly.

- [ ] **Step 7: Apply the migration**

`db:migrate` and the `psql` calls below write to whatever `DATABASE_URL` in `backend/.env` points to, and neither runs the target guard on its own. Check the target first; stop if it is not the local/development database:

```bash
npm run db:guard
npm run db:migrate -- add_membresias
```

Expected: Prisma reports the pending `add_membresias` migration applied, computes zero further drift against `schema.prisma` (so it does not prompt to create a second migration), and regenerates the client. Confirm:

```bash
npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 8: Verify the backfill and its idempotency (Review Focus #3)**

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM membresias;"
```

Expected: the two counts are equal (one membership per existing user).

```bash
psql "$DATABASE_URL" -c "
INSERT INTO membresias (id, organization_id, usuario_id, rol, creado_at)
SELECT gen_random_uuid()::text, organization_id, id, rol, CURRENT_TIMESTAMP
FROM users
ON CONFLICT (organization_id, usuario_id) DO NOTHING;
"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM membresias;"
```

Expected: `INSERT 0 0` (every row conflicted and was skipped) and the count from Step 8 is unchanged — re-running the backfill is a safe no-op.

- [ ] **Step 9: Full backend test + lint pass**

```bash
npm run lint
npm test
```

Expected: no new failures (this PR has not touched any dual-write site yet, so behavior is unchanged; this just confirms the schema/migration/scope-args change alone is clean).

- [ ] **Step 10: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/lib/scope-args.ts
git commit -m "feat(db): add Membresia model with backfill from User"
```

---

### Task 2: Seed, purge, and probe `Membresia` in the real-DB isolation suite

**Files:**
- Modify: `backend/src/scripts/test-isolation.ts`
  - `OrgSeed` interface (lines 148–171)
  - `seedOrganization` (lines 176–440)
  - `purgeOrganization` (lines 105–128)
  - `buildProbes` (lines 478–570)

**Interfaces:**
- Consumes: `prisma.membresia` (Task 1)
- Produces: `OrgSeed.membresiaAdminId`, consumed by Task 4's HTTP check

- [ ] **Step 1: Run the suite once to see today's baseline (nothing to assert against yet — this is the "before" snapshot)**

```bash
npm run test:isolation
```

Expected: passes, same report shape as before this PR (no `Membresia.*` lines yet).

- [ ] **Step 2: Add `membresiaAdminId` to `OrgSeed`**

In the `OrgSeed` interface (after `adminEmail`, line 152):

```ts
  adminUserId: string;
  adminEmail: string;
  membresiaAdminId: string;
```

- [ ] **Step 3: Seed a `Membresia` for both the admin and the socio**

In `seedOrganization`, right after the `adminUser` block (after the `});` that closes it, line 200):

```ts
    const membresiaAdmin = await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: adminUser.id, rol: 'ADMIN' },
    });
```

Right after the `socioUser` block (after the `});` that closes it, line 248):

```ts
    await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: socioUser.id, rol: 'SOCIO' },
    });
```

Add `membresiaAdminId: membresiaAdmin.id,` to the object returned at the end of `seedOrganization` (next to `adminUserId: adminUser.id,`).

- [ ] **Step 4: Purge `Membresia` rows before deleting the club**

In `purgeOrganization`, right before `await prisma.user.deleteMany({ where: { organizationId } });` (line 125):

```ts
    await prisma.membresia.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
```

- [ ] **Step 5: Add the generic cross-tenant probe for `Membresia`**

In `buildProbes`, right after the `User` entry:

```ts
    {
      name: 'Membresia',
      delegate: asCheckable(prisma.membresia),
      idA: seedA.membresiaAdminId,
      idB: seedB.membresiaAdminId,
      updateProbe: { rol: 'SOCIO' },
      rowCount: 2,
    },
```

- [ ] **Step 6: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: the report now includes eight new `Membresia.*` lines (one per `runProbeChecks` assertion — `findMany`, `findUnique`, `findFirst`, `count`, `update`, `delete`, `updateMany`, `deleteMany`, `create`), all `✓`. Final line still reads `N/N verificaciones pasaron` with `N` increased by those new checks and no `✗`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/scripts/test-isolation.ts
git commit -m "test(isolation): seed and probe Membresia for cross-tenant isolation"
```

---

### Task 3: Dual write — invitation acceptance and QR-directo registration

**Files:**
- Modify: `backend/src/services/invitaciones.repo.prisma.ts` (`acceptInvitacion`, lines 71–104)
- Modify: `backend/src/services/codigos-qr.repo.prisma.ts` (`registrarUsuarioQrDirecto`, lines 91–136)
- Modify: `backend/src/scripts/test-isolation.ts` (extend two existing checks; add one new check)

**Interfaces:**
- Consumes: `prisma.membresia` (Task 1)
- Produces: no new exported interface — `InvitacionesRepo.acceptInvitacion` and `CodigosQrRepo.registrarUsuarioQrDirecto` keep their existing return shapes (`UsuarioBasico | null` and the existing discriminated union), so the in-memory repo doubles used by `invitaciones.service.test.ts` and `codigos-qr.service.test.ts` need **no changes** — dual write is a persistence detail invisible to the service layer and its unit tests.

- [ ] **Step 1: Write the failing checks — extend the two existing HTTP flows with membership assertions**

In `backend/src/scripts/test-isolation.ts`, in the "invitación de plataforma…" check, right after line 993 (`assert.equal(creado?.emailVerified, true);`):

```ts
      assert.equal(creado?.emailVerified, true);

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: creado!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'ADMIN');
```

In the "registrar con el QR directo de A…" check, right after line 1411 (`assert.equal(creado?.emailVerified, true);`):

```ts
      assert.equal(creado?.emailVerified, true);

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: creado!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'SOCIO');
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
npm run test:isolation
```

Expected: both extended checks fail with `AssertionError [ERR_ASSERTION]` on `assert.ok(membresia)` (`membresia` is `null` — `acceptInvitacion`/`registrarUsuarioQrDirecto` don't create one yet). Every other check still passes.

- [ ] **Step 3: Dual write on invitation acceptance**

In `backend/src/services/invitaciones.repo.prisma.ts`, inside `acceptInvitacion`'s transaction (lines 87–91), between creating the user and updating the invitation:

```ts
        // El club del usuario nuevo es siempre el de la invitación, nunca el
        // del body de la request (que aceptarInvitacion ya ignora).
        const user = await tx.user.create({
          data: { organizationId, email, name, passwordHash, rol, emailVerified: true },
          select: { id: true, email: true, name: true, rol: true },
        });
        // Dual write (fase de expansión del multi-club, ver schema.prisma):
        // toda alta de User crea su Membresia en la misma transacción.
        await tx.membresia.create({
          data: { organizationId, usuarioId: user.id, rol },
        });
        await tx.invitacion.update({ where: { id: invitacionId }, data: { usuarioId: user.id } });
```

- [ ] **Step 4: Dual write on QR-directo registration**

In `backend/src/services/codigos-qr.repo.prisma.ts`, inside `registrarUsuarioQrDirecto`'s transaction (lines 112–123), between creating the user and updating the código:

```ts
        // Mismo shape que acceptInvitacion (acá arriba): mismo costo de
        // bcrypt, mismos campos, emailVerified true — el QR de un solo uso,
        // mostrado en persona, reemplaza el paso de verificación por correo.
        const user = await tx.user.create({
          data: { organizationId, email, name, passwordHash, rol, emailVerified: true },
          select: { id: true, email: true, name: true, rol: true },
        });
        // Dual write — mismo motivo que invitaciones.repo.prisma.ts.
        await tx.membresia.create({
          data: { organizationId, usuarioId: user.id, rol },
        });

        await tx.codigoQrInvitacion.update({
          where: { id: codigoQrId },
          data: { registradoUsuarioId: user.id },
        });
```

- [ ] **Step 5: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: the two extended checks now pass.

- [ ] **Step 6: Write the failing race test (Review Focus #4)**

Right after the "el admin de B no ve por HTTP una invitación de plataforma emitida para A" check (inside `runHttpChecks`, after it closes around line 1008):

```ts
  await check(
    'dos invitaciones pendientes para el mismo correo: la transacción que pierde la carrera de User.email no deja una Membresia huérfana',
    async () => {
      const email = `race-invite-${RANDOM_SUFFIX}@iso-test.local`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const invitacion1 = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
          },
        }),
      );
      const invitacion2 = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email,
            rol: 'LIDER',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
          },
        }),
      );

      const [primero, segundo] = await Promise.all([
        invitacionesRepoPrisma.acceptInvitacion({
          invitacionId: invitacion1.id,
          organizationId: seedA.organizationId,
          email,
          name: 'Primero',
          passwordHash: 'hashed:primero',
          rol: 'SOCIO',
          now,
        }),
        invitacionesRepoPrisma.acceptInvitacion({
          invitacionId: invitacion2.id,
          organizationId: seedA.organizationId,
          email,
          name: 'Segundo',
          passwordHash: 'hashed:segundo',
          rol: 'LIDER',
          now,
        }),
      ]);

      // Exactamente una de las dos transacciones gana la carrera del unique
      // de User.email; la otra vuelve null (ver el catch de P2002 en
      // invitaciones.repo.prisma.ts) sin dejar rastro.
      const ganadores = [primero, segundo].filter((r) => r !== null);
      assert.equal(ganadores.length, 1);

      const creado = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(creado);

      const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: creado!.id } }));
      // Si el dual write viviera fuera de la transacción de Prisma, este
      // assert es el que lo detectaría: una Membresia "huérfana" de la
      // transacción que perdió la carrera de User.email.
      assert.equal(membresias.length, 1);
      assert.equal(membresias[0]?.rol, creado?.rol);
    },
  );
```

This uses only imports already present in the file (`invitacionesRepoPrisma`, `runAsPlatform`, `randomUUID`, `prisma`) — no new imports needed.

- [ ] **Step 7: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: the new race check passes (it exercises code already written in Step 3; this step exists to prove the transaction boundary is correct, not to drive new implementation).

- [ ] **Step 8: Full backend test + lint pass**

```bash
npm run lint
npm test
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/invitaciones.repo.prisma.ts backend/src/services/codigos-qr.repo.prisma.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(db): dual write Membresia on invitation and QR-directo signup"
```

---

### Task 4: Dual write — admin role change (`PATCH /api/admin/users/:id/rol`)

**Files:**
- Modify: `backend/src/controllers/admin.controller.ts` (`updateUserRol`, lines 859–890)
- Modify: `backend/src/scripts/test-isolation.ts` (new `patchJsonAuth` helper + new `runRoleChangeMembresiaChecks` function, called from `main()`)

**Interfaces:**
- Consumes: `prisma.membresia`, `requireOrganizationId()` (already imported in `admin.controller.ts`)
- Produces: `runRoleChangeMembresiaChecks(baseUrl: string, seedA: OrgSeed): Promise<void>`, called once from `main()`

- [ ] **Step 1: Write the failing check**

In `backend/src/scripts/test-isolation.ts`, add a `patchJsonAuth` helper right after `postJsonAuth` (this file has no PATCH helper yet):

```ts
// Como postJsonAuth, pero con method PATCH — lo necesita el check de cambio
// de rol (ver runRoleChangeMembresiaChecks), la primera vez que este archivo
// prueba PATCH /api/admin/users/:id/rol.
async function patchJsonAuth(
  baseUrl: string,
  token: string,
  urlPath: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}
```

Add a new function right after `runTenantCliChecks`:

```ts
// ─── Cambio de rol y Membresia ──────────────────────────────────────────────

async function runRoleChangeMembresiaChecks(baseUrl: string, seedA: OrgSeed): Promise<void> {
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
}
```

Wire it into `main()`, right after `await runTenantCliChecks(started.baseUrl, seedA, seedB);`:

```ts
    await runTenantCliChecks(started.baseUrl, seedA, seedB);
    await runRoleChangeMembresiaChecks(started.baseUrl, seedA);
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
npm run test:isolation
```

Expected: the new check fails on `assert.equal(membresia?.rol, 'LIDER')` — `membresia?.rol` is still `'SOCIO'` (`updateUserRol` doesn't touch `Membresia` yet).

- [ ] **Step 3: Dual write in `updateUserRol`**

In `backend/src/controllers/admin.controller.ts`, replace lines 882–887:

```ts
    const updated = await prisma.user.update({
      where: { id },
      data: { rol: parsed.data.rol },
      select: { id: true, email: true, name: true, rol: true, emailVerified: true, createdAt: true },
    });
    res.json(updated);
```

with:

```ts
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
```

- [ ] **Step 4: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: the new check passes; every previously-passing check (including `GET /api/admin/users` and the earlier role-independent checks, which all ran before this check in `main()`'s ordering) is unaffected.

- [ ] **Step 5: Full backend test + lint pass**

```bash
npm run lint
npm test
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(db): dual write Membresia on admin role change"
```

---

### Task 5: Dual write — CLI `create-user` (create + self-healing `--force`) and the global invariant

**Files:**
- Modify: `backend/src/scripts/create-user.ts` (lines 170–191)
- Modify: `backend/src/scripts/test-isolation.ts` (new `child_process` import, `runCreateUserCli` helper, `runCreateUserCliChecks` function, global invariant check, wiring in `main()`)

**Interfaces:**
- Consumes: `prisma.membresia`
- Produces: `runCreateUserCliChecks(seedA: OrgSeed): Promise<void>`, called once from `main()`; the global invariant check, run inline in `main()`

- [ ] **Step 1: Write the failing checks**

In `backend/src/scripts/test-isolation.ts`, add to the top-level imports:

```ts
import { spawn } from 'node:child_process';
```

Add a CLI-invocation helper and its checks, right after `runRoleChangeMembresiaChecks`:

```ts
// ─── CLI create-user ─────────────────────────────────────────────────────────

interface CreateUserCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Corre create-user.ts como proceso real (misma DATABASE_URL, guardada por
// su propio db:guard). stdin no es una TTY en un proceso hijo con stdio en
// pipe, así que readPassword() toma la rama de una sola línea (ver
// create-user.ts, readLineFromStdin): ni confirmación ni eco oculto, una
// línea con la contraseña basta.
function runCreateUserCli(args: string[], password: string): Promise<CreateUserCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/scripts/create-user.ts', ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(`${password}\n`);
    child.stdin.end();
  });
}

async function runCreateUserCliChecks(seedA: OrgSeed): Promise<void> {
  await check('CLI create-user: un usuario nuevo obtiene exactamente una Membresia con su rol y club', async () => {
    const email = `cli-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    const result = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Nuevo', '--org', SLUG_A, '--rol', 'LIDER'],
      'password123',
    );
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
    assert.ok(user);
    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: user!.id } }));
    assert.equal(membresias.length, 1);
    assert.equal(membresias[0]?.organizationId, seedA.organizationId);
    assert.equal(membresias[0]?.rol, 'LIDER');
  });

  await check('CLI create-user --force: cambia el rol y también actualiza la Membresia existente', async () => {
    const email = `cli-force-${RANDOM_SUFFIX}@iso-test.local`;
    const primero = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Force', '--org', SLUG_A, '--rol', 'SOCIO'],
      'password123',
    );
    assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

    const segundo = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Force', '--org', SLUG_A, '--rol', 'ADMIN', '--force'],
      'password123',
    );
    assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

    const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
    assert.ok(user);
    const membresia = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
      }),
    );
    assert.ok(membresia);
    assert.equal(membresia?.rol, 'ADMIN');
  });

  await check(
    'CLI create-user --force autosana una Membresia faltante (fila borrada a mano) en vez de fallar (Review Focus #5)',
    async () => {
      const email = `cli-force-autosana-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Autosana', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(user);
      await runAsPlatform(() =>
        prisma.membresia.delete({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
        }),
      );

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Autosana', '--org', SLUG_A, '--rol', 'LIDER', '--force'],
        'password123',
      );
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'LIDER');
    },
  );
}
```

Wire it into `main()`, right after `await runRoleChangeMembresiaChecks(started.baseUrl, seedA);`, and add the global invariant check right after it (still inside the `try` block, before `catch`):

```ts
    await runRoleChangeMembresiaChecks(started.baseUrl, seedA);
    await runCreateUserCliChecks(seedA);

    await check(
      'invariante global: todo usuario de la base tiene al menos una Membresia (ningún alta se saltó el dual write) (Review Focus #1)',
      async () => {
        const huerfanos = await runAsPlatform(() => prisma.user.count({ where: { membresias: { none: {} } } }));
        assert.equal(huerfanos, 0);
      },
    );
```

- [ ] **Step 2: Run and confirm the expected failures**

```bash
npm run test:isolation
```

Expected: all three new CLI checks fail — the first two on `assert.equal(membresias.length, 1)` / `assert.ok(membresia)` (`create-user.ts` doesn't write `Membresia` yet), the third the same way. The global invariant check also fails (`huerfanos` is nonzero: every user this whole run created outside Task 3/4's paths — plus these CLI users — has no membership).

- [ ] **Step 3: Dual write in `create-user.ts`**

In `backend/src/scripts/create-user.ts`, replace lines 170–191:

```ts
  if (!existing) {
    await prisma.user.create({
      data: { organizationId: organization.id, email, name, passwordHash, rol, emailVerified: true },
    });
    console.log(`[create-user] Usuario creado: email="${email}" rol="${rol}" org="${org}"`);
    return;
  }

  await prisma.user.update({
    where: { email },
    data: {
      name,
      passwordHash,
      rol,
      emailVerified: true,
      verificationToken: null,
      verificationTokenExpiry: null,
      resetToken: null,
      resetTokenExpiry: null,
    },
  });
  console.log(`[create-user] Usuario actualizado: email="${email}" rol="${rol}"`);
```

with:

```ts
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

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { email },
      data: {
        name,
        passwordHash,
        rol,
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
        resetToken: null,
        resetTokenExpiry: null,
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
  console.log(`[create-user] Usuario actualizado: email="${email}" rol="${rol}"`);
```

- [ ] **Step 4: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: every check in the suite passes, including the three CLI checks and the global invariant check. Final report line: `N/N verificaciones pasaron`, `N` matching the full accumulated count from Tasks 2–5, zero `✗`.

- [ ] **Step 5: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

Expected: all clean — this is the last task of the PR, so this is also the final verification that the whole data layer is consistent.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/create-user.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(db): dual write Membresia on CLI create-user, self-healing --force"
```

---

## Deployment (manual, VPN)

Production deploy for this PR stays manual (see the open CI-network decision in the spec's Non-goals), over the VPN, on host alias `emgusprod`, stack directory `~/riala`, mirroring `.github/workflows/deploy.yml`'s steps by hand.

0. **Manual, before anything — Neon backup branch.** In the Neon console, open the `riala` project and create a new branch from the branch `DATABASE_URL` in `~/riala/.env` points to. Keep it until this deploy is confirmed healthy: it is the rollback path if the backfill needs to be undone by restoring data, on top of the image rollback below.

```bash
ssh emgusprod
cd ~/riala

# 1. Pin this release (the merge commit's short SHA, e.g. sha-1a2b3c4) and
#    pull the images GHCR already has for it. Write down the current
#    RIALA_TAG first: it is the rollback target.
grep '^RIALA_TAG=' .env
grep -v '^RIALA_TAG=' .env > .env.next && echo 'RIALA_TAG=sha-<merge-sha>' >> .env.next && mv .env.next .env && chmod 600 .env
docker compose pull

# 2. Preflight: the new backend image must start cleanly against this
#    environment before anything irreversible runs (mirrors the CI job's
#    own preflight step).
docker compose run --rm --no-deps -T backend timeout 15 node dist/index.js
echo "exit code: $? (124 = still running after the timeout = healthy)"

# 3. See what's pending before applying it.
docker compose run --rm migrate npx prisma migrate status

# 4. Apply the migration: creates membresias and backfills it.
docker compose run --rm migrate

# 5. Roll the containers to the new image.
docker compose up -d --remove-orphans

# 6. Health check.
curl -fsS https://riala.cl/api/health

# 7. Close the migrate-to-roll window: the OLD container kept serving
#    between step 4 and step 5, and it creates users without a membership.
#    Re-run the idempotent backfill now that only the new image serves.
set -a; . ./.env; set +a
docker run --rm postgres:16-alpine psql "$DATABASE_URL" -c "
INSERT INTO membresias (id, organization_id, usuario_id, rol, creado_at)
SELECT gen_random_uuid()::text, organization_id, id, rol, CURRENT_TIMESTAMP
FROM users
ON CONFLICT (organization_id, usuario_id) DO NOTHING;
"
```

Expected at step 7: `INSERT 0 0` in the normal case; `INSERT 0 N` means N users were created inside the window and are now covered.

**Post-deploy verification (read-only):**

`prisma db execute` only reports success/failure — it never prints `SELECT` results — so the read-only check runs through `psql` instead, in a throwaway official Postgres container (no need for `psql` to be installed on the VPS itself, and no need to guess what client tools the app image carries):

```bash
set -a; . ~/riala/.env; set +a
docker run --rm postgres:16-alpine psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS usuarios_sin_membresia
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM membresias m WHERE m.usuario_id = u.id);
"
```

Expected: `usuarios_sin_membresia | 0`. The old container keeps serving between the migration (step 4) and the roll (step 5), so a user can be created without a `Membresia` inside that window; step 7 exists for exactly that. A nonzero count after step 7 is a real dual-write gap in the new image and must be investigated before considering the deploy complete.

**Rollback note:** `users.organization_id`/`users.rol` are never read, written, or altered by this PR's migration — only copied from. Rolling back to the previous image tag (`RIALA_TAG` set back to the prior `sha-` value in `~/riala/.env`, then `docker compose up -d`) is safe without reversing the migration: the old image never references `membresias`, so the table is simply unused again, with no data loss on either side. **Re-deploying after a rollback:** the old image creates users without memberships while it runs, and the migration will not run again, so repeat step 7 (the idempotent backfill) right after rolling forward again.

# Multi-Club Membership — PR 3: Joining an Existing Account to a Second Club Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An email that already has a RIALA account is never blocked from joining a second club again: inviting, resending, requesting-by-QR and QR-directo all stop 409ing an existing account (only 409ing when that account is already a member of *this* club), and the invitee proves ownership of that account — by password (works with the CURRENT frontend, unchanged) or by a Bearer token of the same email (forward-compatible with PR 4) — before only a `Membresia` is created, never touching the shared account row. `tenant:create --admin-email` gets this for free through the same code path.

**Architecture:** Two independent join surfaces (email invitations, the QR reusable/directo codes) each get an "invite-side" change (stop blocking existing accounts, 409 only on same-club duplicates, enumeration-safe for the inviting admin) and an "accept-side" change (an existing account must prove ownership before a bare `Membresia` row is created — never a new `User`, never a profile overwrite). Both accept-side changes share one pure proof-verification function and one pair of new repository primitives (`findAccountMembershipStatus`, `findAccountForOwnershipProof`), added once in Task 1. A schema migration removes two now-incorrect uniqueness constraints (`Invitacion.usuarioId`, `CodigoQrInvitacion.registradoUsuarioId`) that assumed one account could accept at most one invitation/QR-directo code ever — false as soon as the same account joins a second club.

**Tech Stack:** Express 5, Prisma 7 (TypeScript, `prisma-client` generator), PostgreSQL on Neon, `node:test` via `tsx`, `bcrypt`.

**Spec:** `docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` (Design → §2 "Joining a club"; §4 "Security, errors, testing" error table and testing list; Decisions 1–2; Delivery step 3 "Joining")

## Global Constraints

- No frontend change in this PR (Delivery step 4, later). The CURRENT frontend's accept-invitation and QR-directo screens keep sending `{ token, name, password }` / `{ token, name, email, password }` with no `Authorization` header — the existing-account path MUST succeed against exactly that request shape, using the submitted `password` as the ownership proof (constant-time `bcrypt.compare` against the account's real `passwordHash`).
- A Bearer token is also accepted as proof (`Authorization: Bearer <jwt>`, decoded and verified — never trusted unverified — only by the controller, never by the service layer) for PR 4's future screen; a Bearer token whose verified email does not match the invitation's/QR's email is rejected with `403`, never silently ignored or silently treated as "no proof supplied."
- The existing-account path creates **only** a `Membresia` row (`organizationId`, `usuarioId`, `rol` from the invitation/QR) — it never writes to `User.name`, `User.passwordHash`, `User.emailVerified`, or any other shared-profile column, and never changes `User.organizationId`/`User.rol` (those stay pointing at the account's primary club — PR 2 Global Constraints, unchanged by this PR).
- The inviting admin's response from `crearInvitacion`/`reenviarInvitacion` (status, body shape, and the number of DB round trips on the hot path) is identical whether the invited email has no account, has an account in another club, or — the one case that legitimately differs — already has a `Membresia` in the admin's own club (`409 "Ya es socio de este club"`, spec's exact wording). `solicitarInvitacionQr` (public, unauthenticated QR-by-email) stays even stricter: its response is the same generic `202` in **all** of those cases, including the same-club one — it must never leak membership status to an anonymous scanner.
- An invitation/QR-directo code is single-use and race-safe: accepting it as an existing account is one atomic transaction (conditional update on the invitation/code + `Membresia` creation), exactly like today's new-account path; two concurrent acceptances of the same token produce exactly one `Membresia`.
- `Invitacion.usuarioId` and `CodigoQrInvitacion.registradoUsuarioId` stop being `@unique` (migration, Task 1) — see Ruling 1. This is expand-only: no data loss, and byte-identical behavior for any code that predates this PR (which never attempted to reuse a `usuarioId`/`registradoUsuarioId`, since every prior code path 409ed an existing account before reaching that write).
- Code comments in Spanish, matching the surrounding file; this plan document is in English. Conventional commits, no `Co-Authored-By` or AI attribution. Single backend replica (rate limiting is in-memory) — nothing in this PR changes that.
- `runAsPlatform`/`runWithOrganization` usage follows the exact same rules as today (PR 2 Global Constraints): `findAccountMembershipStatus`/`findAccountForOwnershipProof` are platform-wide lookups (email is unique across the whole platform), always wrapped in `runAsPlatform` inside the repo implementation, never by the caller.
- Local dev DB is the Neon `dev` branch (`db:guard` enforces it). Tests: `node:test` via `tsx` for unit tests; `npm run test:isolation` (real DB) for the end-to-end flows, including the spec §4 cases for joining.

## Rulings

- **Ruling 1: this PR needs a migration — drop `@unique` from `Invitacion.usuarioId` and `CodigoQrInvitacion.registradoUsuarioId`.** Both columns record "who accepted/registered with this row" and were declared `@unique` on the (reasonable, at the time) assumption that one account accepts at most one invitation and registers via at most one QR-directo code, ever. That assumption is false the moment the same account joins a *second* club: `invitaciones.repo.prisma.ts`'s `acceptInvitacion` (and this PR's new `acceptInvitacionExistente`) writes `Invitacion.usuarioId = user.id` unconditionally on every accept, and the second invitation accepted by the same `user.id` (for a different club) would violate the unique index (`invitaciones_usuario_id_key`) with a raw Postgres error, not a clean service-layer response — this is not a rare edge case, it is the **main path** this PR adds. Same reasoning for `codigos_qr_invitacion_registrado_usuario_id_key` if the same account later uses QR-directo to join a second club. Dropping both is expand-only (removes a constraint, writes no new data, loses no data) and changes nothing for any code path that predates this PR — every pre-PR-3 code path 409ed an existing account before ever reaching the write that could have collided, so the constraint was never load-bearing for pre-PR-3 correctness. See Task 1.
- **Ruling 2: enumeration-safe existing-account check is one combined DB round trip, not "check existence, then separately check membership."** A naive `if (await findUserByEmail(email)) { if (await hasMembresia(...)) ... }` costs an *extra* awaited query specifically when the account exists, which is a timing side channel the admin (or a scripted client) could use to learn "this email has an account somewhere on the platform" without ever seeing a different HTTP response — exactly what the spec forbids ("The inviting club's admin never learns whether the email belongs to other clubs"). `findAccountMembershipStatus(email, organizationId)` (Task 1) issues exactly one Prisma call (a `user.findUnique` with a nested `membresias` filter) regardless of outcome, returning `{ cuentaExiste, esSocioDeEsteClub }` in one round trip. `crearInvitacion`/`reenviarInvitacion`/`crearInvitacionPlataforma`/`solicitarInvitacionQr` all call this exactly once, on the exact same code path, whether the account exists or not.
- **Ruling 3: ownership proof is password OR verified Bearer email — never both required, never a fallback that widens the attack surface.** If a verified Bearer email is present (`AuthProof.verifiedEmail !== null`, decoded and signature-checked by the controller via `verifyToken`, never by the service), it alone is the proof: an exact match against the invitation's/QR's email succeeds, any mismatch is `403` and the body's `password`/`name` are never even read (this is what lets PR 4 stop sending a password at all). If there is no verified Bearer, the submitted `password` must `bcrypt.compare` against the account's real `passwordHash` — the same constant-time comparison `login` already uses. An account with `passwordHash === null` (type-permitted, never actually produced by any code path in this codebase — every creation path sets it) is treated as a guaranteed mismatch, mirroring `login.ts`'s own `if (!user.passwordHash)` short-circuit; this is not special-cased further because, like in `login.ts`, it cannot occur in practice.
- **Ruling 4: no new rate-limiting middleware.** Brute-forcing an existing account's password through `aceptarInvitacion`/`registrarConQrDirecto` requires first possessing a live, unexpired invitation/QR token — a per-token limit is a *tighter* identity than login's IP+email. `app.ts`'s existing `inviteTokenKey` limiter on `/api/auth/invitaciones` (max 10/15min) and `qrTokenKey` limiter on `/api/qr/registrar` (max 10/15min) already numerically match `login`'s brute-force limiter (max 10/15min, IP+email) and are keyed by the sha256 of the specific token, so no new middleware is added; Task 3/4 add a code comment at the password-verification branch pointing back to these existing limiters so a future reader doesn't mistake the omission for an oversight. See Review Focus #1 for the test that pins this at the code level (not by exhausting the real limiter, which would make the isolation suite slow and flaky).
- **Ruling 5: status codes — `401` for a wrong password, `403` for a Bearer/invitation email mismatch, no `409` for "cuenta existente" on the accept-side.** `401` matches `login.ts`'s own convention for "identity claimed, credentials wrong." `403 "Esta invitación es para otro correo"` is the spec's own exact text for `aceptarInvitacion`; `registrarConQrDirecto` gets the analogous `403 "Este código es para otro correo"` (the spec does not give this one verbatim — QR-directo is not an "invitación" — so this wording is chosen for this PR, kept close to the spec's own phrasing). The whole class of "409 Ya existe una cuenta con ese correo" response that `aceptarInvitacion`/`registrarConQrDirecto` return today is removed: it is exactly the case this PR now handles instead of rejecting.
- **Ruling 6: `solicitarInvitacionQr` (QR-by-email, public/unauthenticated) mints an invitation for an existing account exactly like it does for a new one — silently, behind the same generic `202`.** This is the most exposed surface in the whole feature: *anyone* who has scanned a public QR can submit *any* email. Its current code already special-cases "account exists" by silently returning without minting anything; this PR changes that branch to only stay silent when the account is **already a member of this specific club** (checked via the same enumeration-safe `findAccountMembershipStatus`) — otherwise it mints the invitation exactly like the new-account path, using the "sign in to join" email copy. The public response is unchanged in every case: the same `202` with `MENSAJE_SOLICITUD_GENERICA`.
- **Ruling 7: `crearInvitacionPlataforma`/`tenant:create --admin-email`/`tenant:invite` need no new code beyond what Task 2 already does.** `crearInvitacionPlataforma` reuses the exact same `findAccountMembershipStatus` check as `crearInvitacion` (409 only if already a member of *this* club — no enumeration constraint applies here, since the caller is a trusted CLI operator, not an external admin), and `aceptarInvitacion`'s existing-account path (Task 3) is what actually turns that invitation into a `Membresia` when the invited email already has an account. `scripts/tenant.ts`'s `crearInvitacionAdmin` closure (lines 52–71) forwards to `crearInvitacionPlataforma` unchanged — it needs a **verification step, not a code change** (mirrors PR 2 Task 2 Step 9's "verify no change needed" pattern). Task 6 adds the end-to-end isolation check proving this.
- **Ruling 8: CLI `create-user --force` on a non-primary-club membership stops overwriting the shared profile.** Carried over from PR 2's open question. Today, `--force` on an *existing* membership always rewrites `User.name`/`passwordHash`/`emailVerified`/tokens, regardless of which club is being updated — harmless before this PR (every account had exactly one club, so "the club being updated" and "the primary club" were always the same club), actively wrong now that a non-primary membership can be `--force`-updated on its own. Decision: `--force` on a **non-primary** club (`organization.id !== existing.organizationId`) updates **only** the `Membresia.rol` — no password prompt, no profile write, matching the additive (no-`--force`) path's "never touch the shared profile" guarantee exactly. `--force` on the **primary** club is unchanged (full profile update, as today). Small, isolated, own task (Task 5) with its own tests — not deferred.
- **Ruling 9: kept as one plan, six tasks.** Tasks 2–6 all depend on Task 1's shared primitives; Tasks 2/3/4 are each one coherent surface (invite-side, accept-an-invitation, QR-directo) matching the spec's own "Joining a club" sub-bullets; Task 5 is Ruling 8's small, independently-testable CLI fix; Task 6 is the cross-cutting, real-DB proof of the whole feature (enumeration invariance, race safety, the CLI end-to-end scenario) that no single earlier task's fake-repo unit tests can fully exercise. Splitting further would only relocate the same commits across files without changing what is independently deployable — this PR still lands and deploys as one unit, exactly like PR 2.

## Review Focus

1. **Brute force against an existing account's password via `aceptarInvitacion`/`registrarConQrDirecto`.** The spec explicitly calls out brute force; mitigated by reusing the existing per-token rate limiters (Ruling 4) plus `bcrypt.compare`'s constant-time comparison. Pinned by Task 3/4's own isolation checks: several wrong-password attempts against the *same* invitation/QR token all fail `401` without ever creating a `Membresia`, and the code comment ties this to the specific `app.ts` limiter (no test exhausts the real limiter — that would make the suite slow and flaky for no additional signal, per Ruling 4).
2. **Enumeration — the admin never learns whether an invited email has an account elsewhere.** Pinned by Task 2's fake-repo unit tests asserting `crearInvitacion`'s `ok`/`status`/response-body shape (not just a spot value) is identical across "no account," "account in another club" and by Task 6's real-DB isolation check counting the exact number of Prisma calls is unaffected by which branch runs (via a call-counting fake wrapped around the real repo, see Task 6).
3. **Replay/race — accepting the same invitation or QR-directo token twice concurrently (same existing account, two browser tabs) must create exactly one `Membresia`, never two, and the token must end up fully consumed either way.** Pinned by Task 3/4's dedicated concurrent-acceptance isolation checks, modeled directly on the existing race check in `test-isolation.ts` (`'dos invitaciones pendientes para el mismo correo...'`, around line 1070).
4. **Cross-club impersonation via a stale or unrelated Bearer token.** A Bearer token that verifies but whose email does not match the invitation's/QR's email must `403`, never silently fall back to the token's own email or to "no proof supplied" (which would then ask for a password the attacker doesn't have, but *also* must never accidentally succeed via the wrong branch). Pinned by Task 3/4's dedicated mismatch checks.
5. **CLI `create-user --force` on a non-primary club silently corrupting the shared profile (Ruling 8) — or the reverse, silently no-op'ing the role update.** Pinned by Task 5's two new isolation checks (non-primary `--force` updates only the role; primary `--force` still updates the full profile, regression).

---

## File Structure

| File | Responsibility | Task |
|------|-----------------|------|
| `backend/prisma/schema.prisma` | Drop `@unique` on `Invitacion.usuarioId`/`CodigoQrInvitacion.registradoUsuarioId`; widen the two `User` back-relations to arrays | 1 |
| `backend/prisma/migrations/20260924090000_allow_second_club_membership/migration.sql` | The migration itself (two `DROP INDEX`) | 1 |
| `backend/src/lib/verified-email.ts` | Decodes and verifies a request's `Authorization: Bearer` header into an email, or `null` — never trusts an unverified token | 1 |
| `backend/src/lib/verified-email.test.ts` | Unit tests for `verifiedEmailFromAuthHeader` | 1 |
| `backend/src/services/invitaciones.service.ts` | New types (`AccountMembershipStatus`, `AccountForOwnershipProof`, `AuthProof`, `OwnershipProofResult`), `verificarPruebaDeCuentaExistente`, new repo methods on `InvitacionesRepo`, `comparePassword` on `InvitacionesDeps`; `crearInvitacion`/`reenviarInvitacion`/`crearInvitacionPlataforma` stop blocking existing accounts; `aceptarInvitacion` supports the existing-account path | 1, 2, 3 |
| `backend/src/services/invitaciones.repo.prisma.ts` | Implements the new repo methods; removes now-dead `findUserByEmail` | 1, 3 |
| `backend/src/services/codigos-qr.service.ts` | Mirrors the invitaciones.service.ts changes for `solicitarInvitacionQr`/`registrarConQrDirecto` | 1, 2, 4 |
| `backend/src/services/codigos-qr.repo.prisma.ts` | Implements the new repo methods; removes now-dead `findUserByEmail` | 1, 4 |
| `backend/src/controllers/invitaciones.controller.ts` | Wires `comparePassword`; decodes the Bearer header for `aceptarInvitacion` | 1, 3 |
| `backend/src/controllers/codigos-qr.controller.ts` | Wires `comparePassword`; decodes the Bearer header for `registrarConQrDirecto` | 1, 4 |
| `backend/src/lib/email-templates.ts` | `buildInvitationEmail` grows an `existingAccount` option that swaps the intro/CTA copy | 2 |
| `backend/src/lib/email-templates.test.ts` | Tests for the new copy | 2 |
| `backend/src/scripts/create-user.ts` | `--force` on a non-primary club only updates the role | 5 |
| `backend/src/scripts/test-isolation.ts` | New/extended checks for every task above | 1, 2, 3, 4, 5, 6 |
| `backend/src/services/invitaciones.service.test.ts` | New fake-repo unit tests for every invitaciones.service.ts change | 2, 3 |
| `backend/src/services/codigos-qr.service.test.ts` | New fake-repo unit tests for every codigos-qr.service.ts change | 2, 4 |

---

### Task 1: Migration + shared ownership-proof primitives

**Files:**
- Modify: `backend/prisma/schema.prisma` (`User` lines 141–154, `Invitacion.usuarioId` line 221, `CodigoQrInvitacion.registradoUsuarioId` line 270)
- Create: `backend/prisma/migrations/20260924090000_allow_second_club_membership/migration.sql`
- Create: `backend/src/lib/verified-email.ts`
- Create: `backend/src/lib/verified-email.test.ts`
- Modify: `backend/src/services/invitaciones.service.ts` (imports lines 1–19; `InvitacionesRepo` lines 83–96; `InvitacionesDeps` lines 108–124)
- Modify: `backend/src/services/invitaciones.repo.prisma.ts` (add three methods after `findUserById`, lines 29–34)
- Modify: `backend/src/services/codigos-qr.service.ts` (imports line 30; `CodigosQrRepo` lines 103–118; `CodigosQrDeps` lines 135–151)
- Modify: `backend/src/services/codigos-qr.repo.prisma.ts` (add three methods after `findUserById`, lines 38–40)
- Modify: `backend/src/scripts/test-isolation.ts` (three inline `InvitacionesDeps`/`CodigosQrDeps` literals gain `comparePassword`; one new raw-Prisma regression check in `runCrossCuttingChecks`)

**Interfaces:**
- Consumes: `verifyToken` (`lib/jwt.ts`, already exported), `prisma.membresia`/`prisma.user` (existing)
- Produces (consumed by Tasks 2–4):
  - `verifiedEmailFromAuthHeader(req: Pick<Request, 'headers'>): string | null`
  - `AccountMembershipStatus { cuentaExiste: boolean; esSocioDeEsteClub: boolean }`
  - `AccountForOwnershipProof { id: string; email: string; passwordHash: string | null }`
  - `AuthProof { verifiedEmail: string | null }`
  - `OwnershipProofResult = { ok: true } | { ok: false; status: number; error: string }`
  - `verificarPruebaDeCuentaExistente(deps: { comparePassword(password: string, hash: string): Promise<boolean> }, account: AccountForOwnershipProof, auth: AuthProof, submittedPassword: string | undefined, mensajes: { correoDistinto: string; contrasenaIncorrecta: string }): Promise<OwnershipProofResult>`
  - `InvitacionesRepo.findAccountMembershipStatus(email: string, organizationId: string): Promise<AccountMembershipStatus>`
  - `InvitacionesRepo.findAccountForOwnershipProof(email: string): Promise<AccountForOwnershipProof | null>`
  - `InvitacionesRepo.acceptInvitacionExistente(input: { invitacionId: string; organizationId: string; usuarioId: string; rol: RolUsuario; now: Date }): Promise<boolean>`
  - `CodigosQrRepo.findAccountMembershipStatus`/`findAccountForOwnershipProof` (same shapes)
  - `CodigosQrRepo.registrarMembresiaQrDirectoExistente(input: { codigoQrId: string; organizationId: string; usuarioId: string; rol: RolUsuario; now: Date }): Promise<{ kind: 'ok' } | { kind: 'agotado' }>`
  - `InvitacionesDeps.comparePassword`/`CodigosQrDeps.comparePassword: (password: string, hash: string) => Promise<boolean>`

- [ ] **Step 1: Write the failing unit tests for `verifiedEmailFromAuthHeader`**

Create `backend/src/lib/verified-email.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signToken } from './jwt.js';
import { verifiedEmailFromAuthHeader } from './verified-email.js';

describe('verifiedEmailFromAuthHeader', () => {
  it('returns the verified email from a valid Bearer token', () => {
    const token = signToken({ userId: 'user-1', email: 'ana@club.cl' });
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: `Bearer ${token}` } }), 'ana@club.cl');
  });

  it('returns null when there is no Authorization header', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: {} }), null);
  });

  it('returns null when the header is not a Bearer token', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: 'Basic abc123' } }), null);
  });

  it('returns null for a malformed/invalid token — never throws', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: 'Bearer not-a-real-jwt' } }), null);
  });

  it('returns null for an expired or tampered token — signature verification, not just decoding', () => {
    const token = signToken({ userId: 'user-1', email: 'ana@club.cl' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: `Bearer ${tampered}` } }), null);
  });
});
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/lib/verified-email.test.ts
```

Expected: fails to resolve `./verified-email.js` — the module doesn't exist yet.

- [ ] **Step 3: Write `verifiedEmailFromAuthHeader`**

Create `backend/src/lib/verified-email.ts`:

```ts
// Decodifica y VERIFICA (nunca solo decodifica) el header Authorization en un
// email de cuenta, o null si no hay uno válido — usado por los endpoints
// públicos de "unirse con una cuenta existente" (aceptarInvitacion,
// registrarConQrDirecto) como prueba alternativa a la contraseña: ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md y el plan
// de esta PR (Ruling 3). Deliberadamente separado de auth.middleware.ts: esos
// dos endpoints son públicos (nunca pasan por authMiddleware, ni deben — la
// persona todavía no es socia del club al que se está uniendo), así que este
// helper nunca resuelve membresías ni club activo, solo el email verificado
// del propio JWT.
import type { Request } from 'express';
import { verifyToken } from './jwt.js';

export function verifiedEmailFromAuthHeader(req: Pick<Request, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  try {
    return verifyToken(header.slice(7)).email;
  } catch {
    // Token ausente, mal formado, expirado o con firma inválida: se trata
    // igual que "no se envió Bearer" — el llamador cae a la prueba por
    // contraseña, nunca revienta el endpoint público.
    return null;
  }
}
```

- [ ] **Step 4: Run and confirm PASS**

```bash
node --import tsx --test src/lib/verified-email.test.ts
```

- [ ] **Step 5: Migrate the schema**

In `backend/prisma/schema.prisma`, replace the `User` model's relation block (lines 148–154):

```prisma
  invitacionesEnviadas Invitacion[]         @relation("InvitacionesEnviadas")
  invitacionAceptada   Invitacion?          @relation("InvitacionAceptada")
  codigosQrCreados     CodigoQrInvitacion[] @relation("CodigosQrCreados")
  // El QR directo que dio de alta a este usuario (null para toda cuenta que
  // nació por otro camino) — ver CodigoQrInvitacion.registradoUsuarioId.
  codigoQrRegistro     CodigoQrInvitacion?  @relation("CodigoQrRegistro")
  membresias           Membresia[]
```

with:

```prisma
  invitacionesEnviadas  Invitacion[]         @relation("InvitacionesEnviadas")
  // Cada invitación aceptada por esta cuenta — una por club al que se unió
  // así. Antes de la fase "Joining" del diseño multi-club era como mucho una
  // (Invitacion.usuarioId era @unique en toda la tabla); ver la migración
  // 20260924090000_allow_second_club_membership y el plan de esta PR
  // (Ruling 1).
  invitacionesAceptadas Invitacion[]         @relation("InvitacionAceptada")
  codigosQrCreados      CodigoQrInvitacion[] @relation("CodigosQrCreados")
  // Cada QR directo que dio de alta o unió a esta cuenta — uno por club.
  // Mismo cambio de cardinalidad que invitacionesAceptadas, mismo motivo.
  codigosQrRegistro     CodigoQrInvitacion[] @relation("CodigoQrRegistro")
  membresias            Membresia[]
```

In the `Invitacion` model, replace line 221:

```prisma
  usuarioId            String?    @unique @map("usuario_id")
```

with:

```prisma
  // Quién aceptó esta invitación. Ya NO @unique en toda la tabla desde la
  // fase "Joining" (ver la migración de esta PR): la MISMA cuenta puede
  // aceptar más de una invitación, una por club al que se une.
  usuarioId            String?    @map("usuario_id")
```

In the `CodigoQrInvitacion` model, replace lines 269–270:

```prisma
  registradoUsuarioId String? @unique @map("registrado_usuario_id")
```

with:

```prisma
  // Ya NO @unique en toda la tabla desde la fase "Joining" (ver la migración
  // de esta PR): la MISMA cuenta puede unirse por QR directo a más de un
  // club a lo largo del tiempo.
  registradoUsuarioId String? @map("registrado_usuario_id")
```

- [ ] **Step 6: Create the migration**

Create `backend/prisma/migrations/20260924090000_allow_second_club_membership/migration.sql`:

```sql
-- Permite que la MISMA cuenta acepte más de una invitación (una por club) y
-- se registre por más de un QR directo (uno por club) — fase "Joining" del
-- diseño multi-club (docs/superpowers/specs/2026-09-23-multi-club-membership-design.md).
-- Antes de esta migración, invitaciones.usuario_id y
-- codigos_qr_invitacion.registrado_usuario_id eran @unique en TODA la tabla:
-- la segunda vez que la MISMA cuenta aceptaba una invitación o se registraba
-- por QR directo (en un club distinto) violaba esa unicidad con un error
-- crudo de Postgres en vez de una respuesta de servicio limpia — ver el plan
-- de esta PR, Ruling 1. Ninguna columna pierde su sentido: siguen
-- registrando "quién aceptó esta invitación / se registró con este código",
-- solo que ahora la misma persona puede aparecer en más de una fila (una por
-- club). Expand-only: no borra datos, y ningún código anterior a esta PR
-- intentó jamás reusar el mismo usuario_id/registrado_usuario_id dos veces
-- (todo código anterior bloqueaba con 409 una cuenta ya existente antes de
-- llegar a ese punto), así que el comportamiento no cambia para nada
-- anterior a esta PR — segura de revertir sin pérdida de datos.
DROP INDEX "invitaciones_usuario_id_key";
DROP INDEX "codigos_qr_invitacion_registrado_usuario_id_key";
```

- [ ] **Step 7: Apply the migration and regenerate the client**

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

Expected: `npx prisma migrate dev` reports the new migration applied against the local `dev` Neon branch, with no drift warnings; `npx prisma generate` regenerates `src/generated/prisma` with `User.invitacionesAceptadas`/`codigosQrRegistro` as arrays.

- [ ] **Step 8: Confirm `scope-args.test.ts` is unaffected**

```bash
node --import tsx --test src/lib/scope-args.test.ts
```

Expected: PASS, unchanged. Its schema-drift check only matches `^model\s+(\w+)\s*\{` (model names), never relation field names — the renames above don't touch it. No diff follows this step; it exists to prove the claim before moving on.

- [ ] **Step 9: Add the new types and pure proof function to `invitaciones.service.ts`**

In `backend/src/services/invitaciones.service.ts`, after the `Requester` interface (after line 133), add:

```ts
// ─── Prueba de titularidad de una cuenta existente (PR "Joining") ─────────────
// Ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §2
// "Joining a club" y el plan de esta PR (Rulings 2, 3). Compartido por
// aceptarInvitacion (este archivo) y registrarConQrDirecto
// (codigos-qr.service.ts, que importa estos símbolos de acá).

// Una consulta, dos datos: si la cuenta existe Y si ya es socia de ESTE
// club — nunca dos consultas separadas (ver Ruling 2: una consulta extra
// SOLO cuando la cuenta existe es un canal de tiempo que revela su
// existencia al admin que invita, algo que el diseño prohíbe
// explícitamente).
export interface AccountMembershipStatus {
  cuentaExiste: boolean;
  // Solo tiene sentido cuando cuentaExiste es true.
  esSocioDeEsteClub: boolean;
}

// Lo mínimo para verificar titularidad — nunca se expone fuera de la rama de
// prueba de titularidad (nunca se mezcla con UsuarioBasico, que si se
// serializa en una vista pública).
export interface AccountForOwnershipProof {
  id: string;
  email: string;
  passwordHash: string | null;
}

// Ya verificado por el controlador (lib/verified-email.ts) antes de llegar
// acá — el servicio NUNCA decodifica un JWT él mismo.
export interface AuthProof {
  verifiedEmail: string | null;
}

export type OwnershipProofResult = { ok: true } | { ok: false; status: number; error: string };

// Prueba que quien está aceptando/registrándose es dueño de una cuenta YA
// EXISTENTE con este email: por Bearer (si coincide exactamente con el email
// de la cuenta) o, si no hay Bearer, por contraseña (bcrypt, tiempo
// constante — igual que login). Los mensajes se inyectan porque cada
// endpoint usa su propio texto (ver Ruling 5 del plan de esta PR).
export async function verificarPruebaDeCuentaExistente(
  deps: { comparePassword: (password: string, hash: string) => Promise<boolean> },
  account: AccountForOwnershipProof,
  auth: AuthProof,
  submittedPassword: string | undefined,
  mensajes: { correoDistinto: string; contrasenaIncorrecta: string },
): Promise<OwnershipProofResult> {
  if (auth.verifiedEmail !== null) {
    if (auth.verifiedEmail !== account.email) {
      return { ok: false, status: 403, error: mensajes.correoDistinto };
    }
    return { ok: true };
  }

  if (!account.passwordHash || submittedPassword === undefined) {
    return { ok: false, status: 401, error: mensajes.contrasenaIncorrecta };
  }
  const matches = await deps.comparePassword(submittedPassword, account.passwordHash);
  if (!matches) {
    return { ok: false, status: 401, error: mensajes.contrasenaIncorrecta };
  }
  return { ok: true };
}
```

- [ ] **Step 10: Add the new repo methods and `comparePassword` to `InvitacionesRepo`/`InvitacionesDeps`**

In `backend/src/services/invitaciones.service.ts`, extend the `InvitacionesRepo` interface (after `findUserById`, before `revokePendingForEmail`, around line 86):

```ts
export interface InvitacionesRepo {
  findUserByEmail(email: string): Promise<UsuarioBasico | null>;
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol'> | null>;
  // Una sola consulta que responde "existe" y "ya es socia de ESTE club" a
  // la vez — ver AccountMembershipStatus arriba (Ruling 2).
  findAccountMembershipStatus(email: string, organizationId: string): Promise<AccountMembershipStatus>;
  // Lo mínimo para verificar titularidad (incluye passwordHash) — separado
  // de findUserByEmail para no exponer el hash a ningún llamador que no lo
  // necesite.
  findAccountForOwnershipProof(email: string): Promise<AccountForOwnershipProof | null>;
  revokePendingForEmail(email: string, now: Date): Promise<void>;
  createInvitacion(data: CrearInvitacionData): Promise<InvitacionRow>;
  findByTokenHash(tokenHash: string): Promise<InvitacionRow | null>;
  findById(id: string): Promise<InvitacionRow | null>;
  list(filter: { invitadoPorId?: string }): Promise<InvitacionConInvitador[]>;
  markRevoked(id: string, now: Date): Promise<void>;
  acceptInvitacion(input: AceptarInvitacionInput): Promise<UsuarioBasico | null>;
  // Contraparte de acceptInvitacion para una cuenta YA EXISTENTE: crea SOLO
  // la Membresia (nunca toca User), consumiendo la invitación en la misma
  // transacción. true = se unió; false = la invitación ya no estaba
  // disponible (carrera) — mismo contrato ok/null que acceptInvitacion,
  // adaptado a que acá no hay un UsuarioBasico nuevo que devolver.
  acceptInvitacionExistente(input: AceptarInvitacionExistenteInput): Promise<boolean>;
}

export interface AceptarInvitacionExistenteInput {
  invitacionId: string;
  organizationId: string;
  usuarioId: string;
  rol: RolUsuario;
  now: Date;
}
```

Extend `InvitacionesDeps` (after `hashPassword`, around line 114):

```ts
  hashPassword: (password: string) => Promise<string>;
  // Comparación de tiempo constante contra un hash ya guardado — usada solo
  // por la rama de "cuenta existente" de aceptarInvitacion (ver
  // verificarPruebaDeCuentaExistente). Igual patrón de inyección que
  // hashPassword: el servicio nunca importa bcrypt directamente.
  comparePassword: (password: string, hash: string) => Promise<boolean>;
```

- [ ] **Step 11: Implement the new methods in `invitaciones.repo.prisma.ts`**

In `backend/src/services/invitaciones.repo.prisma.ts`, add the import and three methods after `findUserById` (line 34):

```ts
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import type {
  InvitacionesRepo,
  InvitacionConInvitador,
} from './invitaciones.service.js';
```

(imports unchanged — no new import needed, `Prisma`/`runAsPlatform`/`prisma` are already imported)

```ts
  async findUserById(id) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, rol: true },
    });
  },

  // Una sola consulta de plataforma (ver Ruling 2 del plan de esta PR): si
  // el email no tiene cuenta, membresias es irrelevante; si la tiene, el
  // filtro anidado por organizationId ya resuelve "es socia de ESTE club"
  // sin una segunda consulta.
  async findAccountMembershipStatus(email, organizationId) {
    return runAsPlatform(async () => {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, membresias: { where: { organizationId }, select: { id: true } } },
      });
      if (!user) return { cuentaExiste: false, esSocioDeEsteClub: false };
      return { cuentaExiste: true, esSocioDeEsteClub: user.membresias.length > 0 };
    });
  },

  async findAccountForOwnershipProof(email) {
    return runAsPlatform(() =>
      prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      }),
    );
  },

  async acceptInvitacionExistente({ invitacionId, organizationId, usuarioId, rol, now }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Mismo update condicional que acceptInvitacion: solo avanza si la
        // invitación sigue pendiente y vigente.
        const { count } = await tx.invitacion.updateMany({
          where: { id: invitacionId, aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
          data: { aceptadaAt: now },
        });
        if (count !== 1) {
          return false;
        }

        // A diferencia de acceptInvitacion: NUNCA se toca User acá — solo la
        // Membresia nueva (Ruling del plan de esta PR: la cuenta existente
        // nunca se sobreescribe).
        await tx.membresia.create({ data: { organizationId, usuarioId, rol } });
        await tx.invitacion.update({ where: { id: invitacionId }, data: { usuarioId } });

        return true;
      });
    } catch (error) {
      // P2002: la Membresia (organizationId, usuarioId) ya existía — una
      // carrera concurrente contra ESTA MISMA invitación (el update
      // condicional de arriba solo protege el conteo de filas de
      // Invitacion, no la unicidad de Membresia). La transacción ya revirtió
      // el update de aceptadaAt.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  },
```

- [ ] **Step 12: Mirror the same additions in `codigos-qr.service.ts`/`codigos-qr.repo.prisma.ts`**

In `backend/src/services/codigos-qr.service.ts`, extend the import from `invitaciones.service.js` (line 30). `verificarPruebaDeCuentaExistente` is a function (not a type), so it needs its own value import, split from the `import type` block:

```ts
import type {
  UsuarioBasico,
  InvitacionRow,
  Requester,
  ServiceResult,
  AccountMembershipStatus,
  AccountForOwnershipProof,
  AuthProof,
} from './invitaciones.service.js';
import { verificarPruebaDeCuentaExistente } from './invitaciones.service.js';
```

Extend `CodigosQrRepo` (after `findUserByEmail`, before `hasPendingInvitacion`, around line 113):

```ts
export interface CodigosQrRepo {
  create(data: CrearCodigoQrData): Promise<CodigoQrRow>;
  list(filter: { creadoPorId?: string }): Promise<CodigoQrConCreador[]>;
  findById(id: string): Promise<CodigoQrRow | null>;
  findByTokenHash(tokenHash: string): Promise<CodigoQrRow | null>;
  markRevoked(id: string, now: Date): Promise<void>;
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol' | 'email'> | null>;
  // Igual contrato que en InvitacionesRepo — ver AccountMembershipStatus /
  // AccountForOwnershipProof (invitaciones.service.ts, Ruling 2).
  findAccountMembershipStatus(email: string, organizationId: string): Promise<AccountMembershipStatus>;
  findAccountForOwnershipProof(email: string): Promise<AccountForOwnershipProof | null>;
  hasPendingInvitacion(email: string, now: Date): Promise<boolean>;
  mintInvitacion(input: MintInvitacionInput): Promise<InvitacionRow | null>;
  registrarUsuarioQrDirecto(input: RegistrarQrDirectoInput): Promise<RegistrarQrDirectoResultado>;
  // Contraparte de registrarUsuarioQrDirecto para una cuenta YA EXISTENTE:
  // crea solo la Membresia, consumiendo el único uso del código en la misma
  // transacción — nunca crea ni modifica User.
  registrarMembresiaQrDirectoExistente(
    input: RegistrarMembresiaQrDirectoExistenteInput,
  ): Promise<RegistrarQrDirectoExistenteResultado>;
}

export interface RegistrarMembresiaQrDirectoExistenteInput {
  codigoQrId: string;
  organizationId: string;
  usuarioId: string;
  rol: RolUsuario;
  now: Date;
}

export type RegistrarQrDirectoExistenteResultado = { kind: 'ok' } | { kind: 'agotado' };
```

**Note:** `findUserByEmail` stays on `CodigosQrRepo` for now — Task 4 removes it once its last caller (`registrarConQrDirecto`) migrates off it (its other caller, `solicitarInvitacionQr`, migrates in Task 2). Removing it here would leave `findUserByEmail`'s Prisma implementation and fake-repo test double dead for two tasks with no compiler signal either way; removing it at its actual last use keeps every intermediate commit's diff minimal and obviously connected to the task that causes it.

Extend `CodigosQrDeps` (after `hashPassword`, around line 146):

```ts
  hashPassword: (password: string) => Promise<string>;
  comparePassword: (password: string, hash: string) => Promise<boolean>;
```

In `backend/src/services/codigos-qr.repo.prisma.ts`, add the same three methods after `findUserById` (line 40), reusing the exact same query shapes as Step 11:

```ts
  async findUserById(id) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, rol: true, email: true } });
  },

  async findAccountMembershipStatus(email, organizationId) {
    return runAsPlatform(async () => {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, membresias: { where: { organizationId }, select: { id: true } } },
      });
      if (!user) return { cuentaExiste: false, esSocioDeEsteClub: false };
      return { cuentaExiste: true, esSocioDeEsteClub: user.membresias.length > 0 };
    });
  },

  async findAccountForOwnershipProof(email) {
    return runAsPlatform(() =>
      prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      }),
    );
  },

  async registrarMembresiaQrDirectoExistente({ codigoQrId, organizationId, usuarioId, rol, now }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Mismo update condicional que registrarUsuarioQrDirecto: solo
        // decrementa si el código sigue siendo DIRECTO, activo y con su
        // único uso disponible.
        const { count } = await tx.codigoQrInvitacion.updateMany({
          where: {
            id: codigoQrId,
            modo: 'DIRECTO',
            revocadoAt: null,
            expiresAt: { gt: now },
            usosRestantes: { gt: 0 },
          },
          data: { usosRestantes: { decrement: 1 } },
        });
        if (count !== 1) {
          return { kind: 'agotado' as const };
        }

        // A diferencia de registrarUsuarioQrDirecto: NUNCA se crea ni
        // modifica User acá — solo la Membresia nueva.
        await tx.membresia.create({ data: { organizationId, usuarioId, rol } });
        await tx.codigoQrInvitacion.update({ where: { id: codigoQrId }, data: { registradoUsuarioId: usuarioId } });

        return { kind: 'ok' as const };
      });
    } catch (error) {
      // P2002 defensivo: la Membresia (organizationId, usuarioId) ya
      // existía — mismo motivo que en acceptInvitacionExistente. El update
      // condicional de arriba ya serializa el único uso del código, así que
      // esta rama es prácticamente inalcanzable en la práctica, pero se
      // mantiene por el mismo motivo que el resto de los catches P2002 de
      // este archivo: fallar cerrado, nunca dejar un uso consumido sin una
      // Membresia (o viceversa).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: 'agotado' as const };
      }
      throw error;
    }
  },
```

- [ ] **Step 13: Wire `comparePassword` into the three inline deps literals in `test-isolation.ts`**

In `backend/src/scripts/test-isolation.ts`, add `bcrypt.compare`-backed or fake-consistent `comparePassword` to each of the three existing `InvitacionesDeps`/`CodigosQrDeps` object literals (`bcrypt` is already imported at the top of the file):

```ts
  const fakeInvitacionDeps: InvitacionesDeps = {
    repo: invitacionesRepoPrisma,
    sendEmail: async () => {},
    hashPassword: async (password) => `hashed:${password}`,
    // Fake consistente con el hashPassword de arriba (nunca se usa bcrypt
    // real acá — mismo motivo que hashPassword: esta invitación de
    // plataforma nunca pasa por el flujo HTTP de aceptar).
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
    now: () => new Date(),
    frontendUrl: 'https://iso-test.local',
  };
```

(same one-line addition, same fake, at `fakeInvitacionDepsCli` around line 2025–2031)

```ts
function buildFakeCodigosQrDeps(capturedEmails: SendCodigoQrInvitationEmailParams[]): CodigosQrDeps {
  return {
    repo: codigosQrRepoPrisma,
    sendInvitationEmail: async (_organizationId, params) => {
      capturedEmails.push(params);
    },
    getOrganizationPublic: async (organizationId) => {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true },
      });
      if (!org) return null;
      return { brand: toPublicOrganizationBrand(org), suspended: isOrganizationSuspended(org.status) };
    },
    withOrganization: (organizationId, fn) => runWithOrganization(organizationId, fn),
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Repositorio real por debajo (codigosQrRepoPrisma), así que la
    // comparación también debe ser real bcrypt — no el fake de arriba.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: 'https://iso-test.local',
    jwtSecret: requireJwtSecret(),
    logError: () => {},
  };
}
```

- [ ] **Step 14: Write the failing migration-proof isolation check**

In `backend/src/scripts/test-isolation.ts`, add to `runCrossCuttingChecks` (before its closing brace):

```ts
  await check(
    'Invitacion.usuarioId ya no es @unique: la MISMA cuenta puede aparecer como usuarioId en dos invitaciones de clubes distintos (Ruling 1 del plan de la PR de Joining)',
    async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const invA = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email: `migracion-usuario-id-${RANDOM_SUFFIX}@iso-test.local`,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
            usuarioId: seedA.adminUserId,
          },
        }),
      );
      const invB = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedB.organizationId,
            email: `migracion-usuario-id-${RANDOM_SUFFIX}@iso-test.local`,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedB.adminUserId,
            // Antes de la migración de esta PR, este segundo create hubiera
            // fallado con P2002 (invitaciones_usuario_id_key): el mismo
            // usuarioId ya estaba en invA.
            usuarioId: seedA.adminUserId,
          },
        }),
      );

      assert.equal(invA.usuarioId, seedA.adminUserId);
      assert.equal(invB.usuarioId, seedA.adminUserId);

      await runAsPlatform(() =>
        prisma.invitacion.deleteMany({ where: { id: { in: [invA.id, invB.id] } } }),
      );
    },
  );
```

- [ ] **Step 15: Run and confirm the expected failure, then re-run to confirm PASS**

```bash
npm run test:isolation
```

Expected before Step 7's migration is applied to this environment: `P2002` (unique constraint violation) on the second `prisma.invitacion.create` call. After Step 7 (the migration already applied in Step 7, so this should already pass now — this step exists to prove it, mirroring PR 2 Task 4 Step 5's "prove the rewrite doesn't regress" pattern rather than a real red step): PASS.

- [ ] **Step 16: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

Expected: `npm test` and `npx tsc --noEmit` both PASS even though `crearInvitacion`/`reenviarInvitacion`/`aceptarInvitacion`/`solicitarInvitacionQr`/`registrarConQrDirecto` don't call any of the new repo methods yet (Tasks 2–4) — Task 1 only adds new, unused-so-far exports; nothing in this step's diff removes or narrows an existing type in a way older code depends on. `npm run lint` may need the new files' import ordering checked against the project's ESLint config; fix any ordering complaints inline.

- [ ] **Step 17: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260924090000_allow_second_club_membership backend/src/lib/verified-email.ts backend/src/lib/verified-email.test.ts backend/src/services/invitaciones.service.ts backend/src/services/invitaciones.repo.prisma.ts backend/src/services/codigos-qr.service.ts backend/src/services/codigos-qr.repo.prisma.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(auth): allow the same account to join a second club (migration + shared proof primitives)"
```

---

### Task 2: Invite-side stops blocking an existing account

**Files:**
- Modify: `backend/src/services/invitaciones.service.ts` (`crearInvitacion` lines 219–282, `reenviarInvitacion` lines 359–417, `crearInvitacionPlataforma` lines 577–632, `SendInvitationEmailParams` lines 100–106, message constants lines 184–193)
- Modify: `backend/src/services/codigos-qr.service.ts` (`solicitarInvitacionQr` lines 559–631, `SendCodigoQrInvitationEmailParams` lines 122–128)
- Modify: `backend/src/lib/email-templates.ts` (`InvitationEmailData`/`InvitationEmailOptions`/`buildInvitationEmail`, lines 975–1030)
- Modify: `backend/src/lib/email-templates.test.ts` (new cases for `existingAccount`)
- Modify: `backend/src/services/invitaciones.service.test.ts` (new/changed cases for the three functions)
- Modify: `backend/src/services/codigos-qr.service.test.ts` (new/changed cases for `solicitarInvitacionQr`)
- Modify: `backend/src/scripts/test-isolation.ts` (new `runInviteJoiningChecks`, wired into `main()`)

**Interfaces:**
- Consumes: `AccountMembershipStatus`/`InvitacionesRepo.findAccountMembershipStatus`/`CodigosQrRepo.findAccountMembershipStatus` (Task 1)
- Produces: `SendInvitationEmailParams.existingAccount: boolean` / `SendCodigoQrInvitationEmailParams.existingAccount: boolean` (consumed by the controllers' `sendEmail` closures, unchanged signature otherwise); `InvitationEmailOptions.existingAccount?: boolean` (consumed nowhere else yet — no downstream task)

- [ ] **Step 1: Write the failing unit tests for `crearInvitacion`**

In `backend/src/services/invitaciones.service.test.ts`, replace the existing `'rechaza con 409 si ya existe una cuenta con ese email'` test (lines 179–189) with:

```ts
  it('un email con cuenta en OTRO club ya no se rechaza: se invita igual que a un email nuevo', async () => {
    const { deps, sentEmails } = createDeps({}, [
      { id: 'u1', organizationId: 'otro-club', email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacion(deps, ADMIN, { email: 'ya@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.emailEnviado, true);
    }
    assert.equal(sentEmails.length, 1);
  });

  it('rechaza con 409 "Ya es socio de este club" si la cuenta YA es socia del club que invita', async () => {
    const { deps } = createDeps({}, [
      { id: 'u1', organizationId: ADMIN.organizationId, email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacion(deps, ADMIN, { email: 'ya@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, 'Ya es socio de este club');
    }
  });

  it('la respuesta (ok/status/forma del body) es IDÉNTICA para un email sin cuenta y un email con cuenta en otro club — nunca revela cuál fue (enumeración, Review Focus #2)', async () => {
    const { deps: depsNuevo } = createDeps();
    const { deps: depsOtroClub } = createDeps({}, [
      { id: 'u2', organizationId: 'otro-club', email: 'otro-club@club.cl', name: 'Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    const nuevo = await crearInvitacion(depsNuevo, ADMIN, { email: 'nunca-existio@club.cl' });
    const existente = await crearInvitacion(depsOtroClub, ADMIN, { email: 'otro-club@club.cl' });
    assert.equal(nuevo.ok, existente.ok);
    if (nuevo.ok && existente.ok) {
      assert.equal(nuevo.status, existente.status);
      assert.deepEqual(Object.keys(nuevo.body).sort(), Object.keys(existente.body).sort());
      assert.equal(nuevo.body.emailEnviado, existente.body.emailEnviado);
    }
  });

  it('el correo a una cuenta existente dice "inicia sesión" (existingAccount: true); a una nueva, "crea tu cuenta" (existingAccount: false)', async () => {
    const { deps: depsNuevo, sentEmails: emailsNuevo } = createDeps();
    await crearInvitacion(depsNuevo, ADMIN, { email: 'nunca-existio-2@club.cl' });
    assert.equal((emailsNuevo[0] as { existingAccount: boolean }).existingAccount, false);

    const { deps: depsExistente, sentEmails: emailsExistente } = createDeps({}, [
      { id: 'u3', organizationId: 'otro-club', email: 'con-cuenta@club.cl', name: 'Con Cuenta', rol: 'SOCIO', emailVerified: true },
    ]);
    await crearInvitacion(depsExistente, ADMIN, { email: 'con-cuenta@club.cl' });
    assert.equal((emailsExistente[0] as { existingAccount: boolean }).existingAccount, true);
  });
```

Update `createFakeRepo`'s `findUserByEmail` usage: the fake repo needs `findAccountMembershipStatus` now. Replace the `createFakeRepo` function's return object (lines 38–104) to add, right after `findUserById`:

```ts
    async findUserById(id) {
      const u = users.find((x) => x.id === id);
      return u ? { id: u.id, name: u.name, rol: u.rol } : null;
    },
    async findAccountMembershipStatus(email, organizationId) {
      const u = users.find((x) => x.email === email);
      if (!u) return { cuentaExiste: false, esSocioDeEsteClub: false };
      // El fake modela "socio de este club" como u.organizationId ===
      // organizationId — una simplificación deliberada: este repositorio en
      // memoria nunca modeló Membresia como una tabla propia (solo User),
      // así que "socia de este club" es, para el fake, "su organizationId
      // ES este club". Suficiente para las pruebas de crearInvitacion/
      // reenviarInvitacion/crearInvitacionPlataforma, que solo necesitan
      // distinguir "mismo club" de "cualquier otra cosa".
      return { cuentaExiste: true, esSocioDeEsteClub: u.organizationId === organizationId };
    },
    async findAccountForOwnershipProof(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, email: u.email, passwordHash: `hashed:${u.email}-password` } : null;
    },
```

And add `acceptInvitacionExistente` as a stub at the end of the returned object (Task 3 gives it real behavior; Task 2's tests never call it, but the interface requires it to compile):

```ts
    async acceptInvitacionExistente() {
      throw new Error('acceptInvitacionExistente: not modeled until Task 3 — no Task 2 test should call this');
    },
```

- [ ] **Step 2: Run and confirm the expected failures**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: every new `it` fails — `crearInvitacion` still 409s unconditionally on `findUserByEmail`, `SendInvitationEmailParams` has no `existingAccount` field yet (a TS compile error at this point, since the fake repo/test file now references `findAccountMembershipStatus`, which doesn't exist on `InvitacionesRepo` until it's actually the SAME interface from Task 1 — this should already compile since Task 1 added it; the runtime failures are in `crearInvitacion`'s own logic).

- [ ] **Step 3: Rewrite `crearInvitacion`**

In `backend/src/services/invitaciones.service.ts`, replace the message constants (lines 186–187):

```ts
const MENSAJE_CUENTA_EXISTENTE = 'Ya existe una cuenta con ese correo';
```

with:

```ts
// MENSAJE_CUENTA_EXISTENTE ya no existe: crearInvitacion/reenviarInvitacion/
// crearInvitacionPlataforma dejaron de bloquear una cuenta existente (ver el
// plan de la PR de Joining) — el único 409 de esta familia ahora es "ya es
// socia de ESTE club".
const MENSAJE_YA_SOCIO_CLUB = 'Ya es socio de este club';
```

Extend `SendInvitationEmailParams` (lines 100–106):

```ts
export interface SendInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
  // La persona invitada ya tiene una cuenta RIALA (en este club o en otro):
  // el correo debe decir "inicia sesión" en vez de "crea tu cuenta" (ver
  // lib/email-templates.ts). El admin que invita NUNCA ve este campo ni nada
  // derivado de él — solo cambia el texto del correo que recibe el invitado.
  existingAccount: boolean;
}
```

Replace `crearInvitacion` (lines 219–282):

```ts
export async function crearInvitacion(
  deps: InvitacionesDeps,
  requester: Requester,
  body: { email: unknown; rol?: unknown },
): Promise<ServiceResult<CrearInvitacionBody>> {
  if (!canInvite(requester)) {
    return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
  }

  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();

  const rolInput = typeof body.rol === 'string' ? body.rol : 'SOCIO';
  if (!puedeInvitarRol(requester.rol, rolInput)) {
    return { ok: false, status: 403, error: MENSAJE_ROL_NO_PERMITIDO };
  }
  const rol = rolInput as RolUsuario;

  // Una sola consulta que responde a la vez "existe" y "ya es socia de ESTE
  // club" (ver Ruling 2 del plan de esta PR) — el admin nunca aprende cuál
  // de los dos casos restantes ocurrió, ni por el body de la respuesta ni
  // por el tiempo que tarda: el camino de abajo es idéntico en ambos.
  const estado = await deps.repo.findAccountMembershipStatus(email, requester.organizationId);
  if (estado.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
  }

  const now = deps.now();
  await deps.repo.revokePendingForEmail(email, now);

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const invitacion = await deps.repo.createInvitacion({
    organizationId: requester.organizationId,
    email,
    rol,
    tokenHash,
    expiresAt,
    invitadoPorId: requester.id,
    emitidaPorPlataforma: false,
  });

  // Fragmento (#) a propósito: nunca llega al servidor ni a los logs del proxy.
  const inviteUrl = `${deps.frontendUrl}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
    existingAccount: estado.cuentaExiste,
  });

  return {
    ok: true,
    status: 201,
    body: {
      invitacion: toPublicView(invitacion, { id: requester.id, name: requester.name }, now),
      inviteUrl,
      emailEnviado,
    },
  };
}
```

- [ ] **Step 4: Run and confirm the `crearInvitacion` tests PASS**

```bash
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: `crearInvitacion` cases pass; `reenviarInvitacion`/`crearInvitacionPlataforma` cases (if written already) and the whole-file compile still reference the removed `MENSAJE_CUENTA_EXISTENTE` in those two functions — expected to fail/not-compile until Step 5.

- [ ] **Step 5: Write the failing unit tests for `reenviarInvitacion` and `crearInvitacionPlataforma`, then rewrite both**

Add to `invitaciones.service.test.ts`, in the `describe('reenviarInvitacion', ...)` block, a test mirroring `crearInvitacion`'s:

```ts
  it('un email con cuenta en OTRO club ya no se rechaza al reenviar', async () => {
    const { deps, users, invitaciones } = createDeps({}, [
      { id: 'u4', organizationId: 'otro-club', email: 'reenvio-otro@club.cl', name: 'Reenvío', rol: 'SOCIO', emailVerified: true },
    ]);
    void users;
    const primera = await crearInvitacion(
      { ...deps, repo: { ...deps.repo, findAccountMembershipStatus: async () => ({ cuentaExiste: false, esSocioDeEsteClub: false }) } },
      ADMIN,
      { email: 'reenvio-otro@club.cl' },
    );
    assert.equal(primera.ok, true);
    if (!primera.ok) return;

    const reenviada = await reenviarInvitacion(deps, ADMIN, primera.body.invitacion.id);
    assert.equal(reenviada.ok, true);
    assert.equal(invitaciones.filter((i) => i.email === 'reenvio-otro@club.cl').length, 2);
  });
```

In `backend/src/services/invitaciones.service.ts`, replace the account check inside `reenviarInvitacion` (lines 377–380):

```ts
  const existing = await deps.repo.findUserByEmail(inv.email);
  if (existing) {
    return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
  }
```

with:

```ts
  const estado = await deps.repo.findAccountMembershipStatus(inv.email, requester.organizationId);
  if (estado.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
  }
```

And its `enviarCorreoInvitacion` call (lines 400–406) gains `existingAccount: estado.cuentaExiste`:

```ts
  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: inv.email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[inv.rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
    existingAccount: estado.cuentaExiste,
  });
```

For `crearInvitacionPlataforma` (lines 592–595), replace:

```ts
  const existing = await deps.repo.findUserByEmail(email);
  if (existing) {
    return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
  }
```

with:

```ts
  const estado = await deps.repo.findAccountMembershipStatus(email, input.organizationId);
  if (estado.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
  }
```

And its `enviarCorreoInvitacion` call (lines 615–621) gains `existingAccount: estado.cuentaExiste`.

- [ ] **Step 6: Run and confirm PASS**

```bash
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: all cases pass, including every pre-existing `crearInvitacion`/`reenviarInvitacion`/`crearInvitacionPlataforma`/`consultarInvitacion`/`aceptarInvitacion` (unchanged so far) test.

- [ ] **Step 7: Add the `existingAccount` copy to `buildInvitationEmail`**

In `backend/src/services/invitaciones.service.test.ts`... — this step is about `lib/email-templates.ts`, not the service test file; continuing:

In `backend/src/lib/email-templates.test.ts`, add two cases after `'buildInvitationEmail con viaQr agrega el párrafo del QR'` (after line 270):

```ts
  it('buildInvitationEmail sin existingAccount es byte a byte igual que con existingAccount: false', () => {
    assert.equal(
      buildInvitationEmail(invitationData, branding),
      buildInvitationEmail(invitationData, branding, { existingAccount: false }),
    );
  });

  it('buildInvitationEmail con existingAccount: true dice "inicia sesión" en vez de "crea tu cuenta"', () => {
    const html = buildInvitationEmail(invitationData, branding, { existingAccount: true });
    assert.match(html, /inicia sesión/i);
    assert.doesNotMatch(html, /crear mi cuenta/i);
    assertMentionsClub(html);
    assert.equal(html.includes(invitationData.inviteUrl), true);
  });
```

- [ ] **Step 8: Run and confirm the expected failure**

```bash
node --import tsx --test src/lib/email-templates.test.ts
```

Expected: fails — `InvitationEmailOptions` has no `existingAccount` field yet, and the button always says "Crear mi cuenta".

- [ ] **Step 9: Rewrite `buildInvitationEmail`**

In `backend/src/lib/email-templates.ts`, replace `InvitationEmailOptions` (lines 982–988):

```ts
export interface InvitationEmailOptions {
  // true cuando la invitación nació de solicitarInvitacionQr (alguien
  // escaneó el QR reusable del club y pidió la suya): agrega un párrafo
  // aclaratorio. Ausente (o false) deja el correo byte a byte igual que
  // antes de este campo.
  viaQr?: boolean;
  // true cuando la persona invitada ya tiene una cuenta RIALA (fase
  // "Joining" del diseño multi-club): cambia el párrafo introductorio y el
  // botón de "Crear mi cuenta" a "Iniciar sesión y unirme". El enlace en sí
  // no cambia — sigue siendo el mismo inviteUrl; hasta que el frontend de
  // PR 4 distinga la pantalla, quien haga clic ve hoy la pantalla de "crear
  // cuenta" de siempre, y su contraseña ahí se usa como prueba de
  // titularidad (ver el backend de aceptarInvitacion). Ausente (o false)
  // deja el correo byte a byte igual que antes de este campo.
  existingAccount?: boolean;
}
```

Replace `buildInvitationEmail` (lines 990–1030):

```ts
export function buildInvitationEmail(
  data: InvitationEmailData,
  branding: OrgBranding,
  opts: InvitationEmailOptions = {},
): string {
  const inviteUrlSafe = escapeHtml(data.inviteUrl);

  const introPrincipal = opts.existingAccount
    ? `<p style="margin:0;color:#1f2937;font-size:15px;">
    <strong>${escapeHtml(data.invitadoPorNombre)}</strong> te invitó a unirte a ${escapeHtml(branding.name)} con tu cuenta RIALA.
  </p>
  <p style="margin:10px 0 0;color:#1f2937;font-size:15px;">
    Ya tienes una cuenta en el sistema: inicia sesión con tu correo y tu contraseña de siempre para unirte a este club.
  </p>`
    : `<p style="margin:0;color:#1f2937;font-size:15px;">
    <strong>${escapeHtml(data.invitadoPorNombre)}</strong> te invitó a crear una cuenta en el sistema de ${escapeHtml(branding.name)}.
  </p>`;

  const intro = `${introPrincipal}${
    opts.viaQr
      ? `
  <p style="margin:10px 0 0;color:#1f2937;font-size:15px;">
    Solicitaste esta invitación escaneando el código QR de ${escapeHtml(branding.name)}. Si no fuiste tú, puedes ignorar este correo.
  </p>`
      : ''
  }`;

  const tabla = `${row('Rol asignado', data.rolLabel)}`;

  const ctaLabel = opts.existingAccount ? 'Iniciar sesión y unirme' : 'Crear mi cuenta';
  const cta = `
        <tr>
          <td style="padding:0 32px 28px;text-align:center;">
            <a href="${inviteUrlSafe}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">${ctaLabel}</a>
            <p style="margin:14px 0 0;color:#6b7280;font-size:11px;word-break:break-all;">
              Si el botón no funciona, copia este enlace: ${inviteUrlSafe}
            </p>
            <p style="margin:14px 0 0;color:#ef4444;font-size:13px;font-weight:600;">⚠ Este enlace expira en ${data.expiraEnDias} días.</p>
            <p style="margin:8px 0 0;color:${GRAY};font-size:12px;">Es un enlace personal y de un solo uso: no lo compartas con nadie.</p>
          </td>
        </tr>`;

  return emailShell(
    `Invitación a ${escapeHtml(branding.name)}`,
    intro,
    tabla,
    `Este correo es una notificación automática del sistema de ${escapeHtml(branding.name)}. Si no esperabas esta invitación, puedes ignorar este mensaje.`,
    cta,
    branding,
  );
}
```

- [ ] **Step 10: Run and confirm PASS**

```bash
node --import tsx --test src/lib/email-templates.test.ts
```

- [ ] **Step 11: Wire `existingAccount` through the controllers' `sendEmail` closures**

`backend/src/controllers/invitaciones.controller.ts`'s `buildDeps` (lines 29–45) and `scripts/tenant.ts`'s `crearInvitacionAdmin` (lines 52–71) both call `buildInvitationEmail(params, branding)` / `buildInvitationEmail(params, branding)` where `params` is the `SendInvitationEmailParams` the service already passes through (now carrying `existingAccount`). Update both call sites to forward it:

In `backend/src/controllers/invitaciones.controller.ts`, replace the `sendEmail` closure inside `buildDeps` (lines 32–40):

```ts
    sendEmail: async (params) => {
      const branding = brandingFor(organization);
      await sendClubEmail(organization, {
        to: params.to,
        subject: subjectInvitacion(branding),
        html: buildInvitationEmail(params, branding, { existingAccount: params.existingAccount }),
        kind: 'notificacion',
      });
    },
```

In `backend/src/scripts/tenant.ts`, the same change inside `crearInvitacionAdmin`'s `sendEmail` (lines 57–65):

```ts
      sendEmail: async (params) => {
        const branding = brandingFor(organization);
        await sendClubEmail(organization, {
          to: params.to,
          subject: subjectInvitacion(branding),
          html: buildInvitationEmail(params, branding, { existingAccount: params.existingAccount }),
          kind: 'notificacion',
        });
      },
```

- [ ] **Step 12: Write the failing unit tests for `solicitarInvitacionQr`**

In `backend/src/services/codigos-qr.service.test.ts`, find the `describe('solicitarInvitacionQr', ...)` block and add:

```ts
  it('un email con cuenta en OTRO club ya no se ignora: mintea la invitación igual que a un email nuevo', async () => {
    const { deps, invitaciones, users } = createDeps({}, [
      { id: 'u5', organizationId: 'otro-club', email: 'qr-otro-club@club.cl', name: 'QR Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    void users;
    const qrToken = await crearQrActivo(deps, ADMIN);
    const result = await solicitarInvitacionQr(deps, qrToken, { email: 'qr-otro-club@club.cl' });
    assert.equal(result.ok, true);
    assert.equal(invitaciones.some((i) => i.email === 'qr-otro-club@club.cl'), true);
  });

  it('un email YA socio de este club sigue sin mintear nada (silencioso, mismo 202 genérico)', async () => {
    const { deps, invitaciones } = createDeps({}, [
      { id: 'u6', organizationId: ADMIN.organizationId, email: 'qr-ya-socio@club.cl', name: 'QR Ya Socio', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrActivo(deps, ADMIN);
    const result = await solicitarInvitacionQr(deps, qrToken, { email: 'qr-ya-socio@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, MENSAJE_SOLICITUD_GENERICA);
    assert.equal(invitaciones.some((i) => i.email === 'qr-ya-socio@club.cl'), false);
  });

  it('el correo mezcla viaQr y existingAccount cuando ambos aplican', async () => {
    const { deps, sentEmails } = createDeps({}, [
      { id: 'u7', organizationId: 'otro-club', email: 'qr-viaqr-existente@club.cl', name: 'QR Existente', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrActivo(deps, ADMIN);
    await solicitarInvitacionQr(deps, qrToken, { email: 'qr-viaqr-existente@club.cl' });
    assert.equal((sentEmails[0] as { existingAccount: boolean }).existingAccount, true);
  });
```

(`crearQrActivo` is a test helper that must already exist in this file, given `crearCodigoQr` is exercised elsewhere in the same suite — reuse whatever helper the existing `solicitarInvitacionQr`/`consultarCodigoQr` tests already use to obtain an active token; if none is factored out yet, extract one from the existing setup at the top of the `describe('solicitarInvitacionQr', ...)` block rather than duplicating the `crearCodigoQr` + `descifrarTokenQr` dance inline.)

Extend the fake repo's `findUserByEmail`-adjacent methods (mirroring Task 2 Step 1's addition to invitaciones.service.test.ts): add `findAccountMembershipStatus`/`findAccountForOwnershipProof` to `createFakeRepo`'s returned `CodigosQrRepo`, same shape and same "organizationId equality models club membership" simplification, plus a stub `registrarMembresiaQrDirectoExistente` (Task 4 gives it real behavior).

- [ ] **Step 13: Run and confirm the expected failures**

```bash
node --import tsx --test src/services/codigos-qr.service.test.ts
```

- [ ] **Step 14: Rewrite `solicitarInvitacionQr`**

In `backend/src/services/codigos-qr.service.ts`, extend `SendCodigoQrInvitationEmailParams` (lines 122–128):

```ts
export interface SendCodigoQrInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
  existingAccount: boolean;
}
```

Replace the body of the `deps.withOrganization` callback inside `solicitarInvitacionQr` (lines 586–628):

```ts
  await deps.withOrganization(qr.organizationId, async () => {
    // Antes de la fase "Joining", una cuenta existente cortaba acá sin
    // mintear nada. Desde esta PR, solo se sigue cortando si YA es socia de
    // ESTE club — si tiene cuenta en otro club, o no tiene cuenta, el flujo
    // es el mismo: mintear la invitación (el correo cambia de texto según
    // cuentaExiste; la respuesta pública NUNCA cambia — sigue siendo el
    // mismo 202 genérico en los tres casos, ver Ruling 6 del plan de esta
    // PR: nadie que escanea un QR público debe poder distinguirlos).
    const estado = await deps.repo.findAccountMembershipStatus(email, qr.organizationId);
    if (estado.esSocioDeEsteClub) return;

    // Nunca se revoca una invitación pendiente existente para este email en
    // este club (a diferencia de crearInvitacion): quien sostiene el QR
    // podría, si no, pisar una invitación ADMIN pendiente de otra persona.
    const yaPendiente = await deps.repo.hasPendingInvitacion(email, now);
    if (yaPendiente) return;

    const { token: inviteToken, tokenHash: inviteTokenHash } = generateInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const minted = await deps.repo.mintInvitacion({
      codigoQrId: qr.id,
      organizationId: qr.organizationId,
      email,
      rol: ROL_QR,
      tokenHash: inviteTokenHash,
      expiresAt,
      invitadoPorId: qr.creadoPorId,
      now,
    });
    // null = se perdió la carrera por el último uso (otra solicitud ganó
    // entre verificarVigenciaQr y este punto): no se envía correo.
    if (!minted) return;

    const inviteUrl = `${deps.frontendUrl}/#invite=${inviteToken}`;
    // Sin await a propósito: la respuesta pública es idéntica exista o no la
    // cuenta, así que nunca debe esperar (ni fallar por) el envío del correo.
    deps
      .sendInvitationEmail(qr.organizationId, {
        to: email,
        invitadoPorNombre: creador.name,
        rolLabel: ROL_LABELS[ROL_QR],
        inviteUrl,
        expiraEnDias: INVITE_TTL_DIAS,
        existingAccount: estado.cuentaExiste,
      })
      .catch(deps.logError);
  });
```

- [ ] **Step 15: Wire `existingAccount` through `codigos-qr.controller.ts`'s two `sendInvitationEmail` closures**

In `backend/src/controllers/codigos-qr.controller.ts`, update both `buildDeps` (lines 36–44) and `buildPublicDeps` (lines 64–76) to forward `params.existingAccount` into `buildInvitationEmail`'s third argument, same one-line change as Step 11:

```ts
    sendInvitationEmail: async (_organizationId, params) => {
      const branding = brandingFor(organization);
      await sendClubEmail(organization, {
        to: params.to,
        subject: subjectInvitacion(branding),
        html: buildInvitationEmail(params, branding, { viaQr: true, existingAccount: params.existingAccount }),
        kind: 'notificacion',
      });
    },
```

(and the equivalent inside `buildPublicDeps`'s closure, which additionally awaits `loadOrganizationSummary`)

- [ ] **Step 16: Run and confirm PASS**

```bash
node --import tsx --test src/services/codigos-qr.service.test.ts
node --import tsx --test src/services/invitaciones.service.test.ts
node --import tsx --test src/lib/email-templates.test.ts
```

- [ ] **Step 17: Write the failing real-DB isolation checks**

In `backend/src/scripts/test-isolation.ts`, add a new function after `runClubesFieldChecks`:

```ts
// ─── Invitar/reenviar/QR-por-correo con una cuenta existente (PR "Joining") ────

async function runInviteJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  await check(
    'POST /api/invitaciones con el email de una cuenta que ya existe SOLO EN B: A la invita igual (201), no 409',
    async () => {
      const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email: seedB.adminEmail });
      assert.equal(res.status, 201);
    },
  );

  await check(
    'POST /api/invitaciones con el email de alguien que YA es socio de A responde 409 "Ya es socio de este club"',
    async () => {
      const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email: seedA.socioEmail });
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { error: 'Ya es socio de este club' });
    },
  );
}
```

Wire it into `main()`, right after `await runClubesFieldChecks(started.baseUrl, seedA, seedB);`:

```ts
    await runClubesFieldChecks(started.baseUrl, seedA, seedB);
    await runInviteJoiningChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 18: Run and confirm the expected failure, then PASS**

```bash
npm run test:isolation
```

Expected before this task's rewrite: the first check fails with `409` (today's unconditional block); after Step 3–5's rewrite (already applied by this point in the task), both checks PASS.

- [ ] **Step 19: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 20: Commit**

```bash
git add backend/src/services/invitaciones.service.ts backend/src/services/invitaciones.service.test.ts backend/src/services/codigos-qr.service.ts backend/src/services/codigos-qr.service.test.ts backend/src/lib/email-templates.ts backend/src/lib/email-templates.test.ts backend/src/controllers/invitaciones.controller.ts backend/src/controllers/codigos-qr.controller.ts backend/src/scripts/tenant.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(invitaciones): stop blocking an email that already has an account elsewhere"
```

---

### Task 3: Accept an invitation with an existing account (`aceptarInvitacion`)

**Files:**
- Modify: `backend/src/services/invitaciones.service.ts` (`aceptarInvitacion` lines 509–560; remove now-dead `findUserByEmail`/`MENSAJE_CUENTA_EXISTENTE`)
- Modify: `backend/src/services/invitaciones.repo.prisma.ts` (remove now-dead `findUserByEmail`)
- Modify: `backend/src/services/invitaciones.service.test.ts` (fake repo drops `findUserByEmail`, gains a real `acceptInvitacionExistente`; new cases for `aceptarInvitacion`)
- Modify: `backend/src/controllers/invitaciones.controller.ts` (`aceptarInvitacion` controller lines 162–183; `buildPublicDeps`/`buildDeps` gain `comparePassword`)
- Modify: `backend/src/scripts/test-isolation.ts` (new `runAcceptJoiningChecks`, wired into `main()`)

**Interfaces:**
- Consumes: `verificarPruebaDeCuentaExistente`, `AuthProof`, `InvitacionesRepo.findAccountForOwnershipProof`/`acceptInvitacionExistente` (Task 1)
- Produces: `aceptarInvitacion(deps, token, body, auth: AuthProof): Promise<ServiceResult<AceptarInvitacionBody>>` — signature grows by one required parameter; consumed by the controller and by every existing test call site

- [ ] **Step 1: Write the failing unit tests for `aceptarInvitacion`**

In `backend/src/services/invitaciones.service.test.ts`, every EXISTING call to `aceptarInvitacion(deps, token, body)` in the `describe('aceptarInvitacion', ...)` block must add a fourth argument, `{ verifiedEmail: null }`, to keep compiling and to keep testing today's no-Bearer, no-existing-account behavior unchanged. Do this mechanical update first (find/replace `aceptarInvitacion(deps, ` → keep args, add `, { verifiedEmail: null }` before the closing paren of each call), then add:

```ts
describe('aceptarInvitacion — cuenta existente (PR "Joining")', () => {
  it('con la contraseña correcta, crea SOLO la Membresia (nunca un User nuevo, nunca toca el nombre)', async () => {
    const { deps, users } = createDeps({}, [
      { id: 'existente-1', organizationId: 'otro-club', email: 'existe@club.cl', name: 'Nombre Original', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe@club.cl', rol: 'LIDER' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const usersAntes = users.length;
    const result = await aceptarInvitacion(
      deps,
      token,
      { name: 'Nombre Que Se Ignora', password: 'existe@club.cl-password' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.email, 'existe@club.cl');
    // El fake modela "cuenta existente" en el array `users`; ningún User
    // nuevo se agrega (createFakeRepo.acceptInvitacionExistente, ver más
    // abajo, no empuja a `users`).
    assert.equal(users.length, usersAntes);
  });

  it('con la contraseña incorrecta, responde 401 y no crea nada', async () => {
    const { deps, invitaciones } = createDeps({}, [
      { id: 'existente-2', organizationId: 'otro-club', email: 'existe2@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe2@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, { name: 'X', password: 'contraseña-incorrecta' }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.equal(invitaciones.find((i) => i.tokenHash)?.aceptadaAt, null);
  });

  it('con un Bearer del MISMO email (sin password), crea la Membresia igual', async () => {
    const { deps } = createDeps({}, [
      { id: 'existente-3', organizationId: 'otro-club', email: 'existe3@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe3@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, { name: undefined, password: undefined }, { verifiedEmail: 'existe3@club.cl' });
    assert.equal(result.ok, true);
  });

  it('con un Bearer de OTRO email, responde 403 "Esta invitación es para otro correo"', async () => {
    const { deps } = createDeps({}, [
      { id: 'existente-4', organizationId: 'otro-club', email: 'existe4@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe4@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, {}, { verifiedEmail: 'alguien-mas@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'Esta invitación es para otro correo');
    }
  });

  it('sin cuenta existente, el comportamiento de siempre no cambia (regresión)', async () => {
    const { deps } = createDeps();
    const crear = await crearInvitacion(deps, ADMIN, { email: 'nunca-existio-3@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' }, { verifiedEmail: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, 'Cuenta creada. Ya puedes iniciar sesión.');
  });
});
```

(`extractTokenFromInviteUrl` is a small helper — add it near the top of the test file if it doesn't already exist: `function extractTokenFromInviteUrl(inviteUrl: string): string { return new URL(inviteUrl).hash.replace('#invite=', ''); }`)

Update `createFakeRepo`'s `comparePassword`-adjacent fixture: the fake's `findAccountForOwnershipProof` (added in Task 2 Step 1) already returns `passwordHash: \`hashed:${u.email}-password\`` — keep `deps.comparePassword` as `async (password, hash) => hash === \`hashed:${password}\``, matching `createDeps`'s existing `hashPassword: async (password) => \`hashed:${password}\``, and add a REAL `acceptInvitacionExistente` to `createFakeRepo`'s returned object (replacing Task 2's throwing stub):

```ts
    async acceptInvitacionExistente({ invitacionId, organizationId, usuarioId, rol, now }) {
      const inv = invitaciones.find((i) => i.id === invitacionId);
      if (!inv || inv.aceptadaAt !== null || inv.revocadaAt !== null || inv.expiresAt <= now) {
        return false;
      }
      inv.aceptadaAt = now;
      inv.usuarioId = usuarioId;
      void organizationId;
      void rol;
      return true;
    },
```

And extend `createDeps` (around line 121–130) with `comparePassword: async (password, hash) => hash === \`hashed:${password}\``.

- [ ] **Step 2: Run and confirm the expected failures**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: compile error first (`aceptarInvitacion` doesn't accept a fourth argument yet) — this is the correct "red," matching a signature-change task.

- [ ] **Step 3: Rewrite `aceptarInvitacion`**

In `backend/src/services/invitaciones.service.ts`, remove the now-dead `MENSAJE_CUENTA_EXISTENTE` constant if any reference remains (Task 2 already removed the other three uses; confirm none remain with `grep -n MENSAJE_CUENTA_EXISTENTE backend/src/services/invitaciones.service.ts` before deleting) and add two new message constants near the others (around line 190):

```ts
const MENSAJE_INVITACION_OTRO_CORREO = 'Esta invitación es para otro correo';
const MENSAJE_CONTRASENA_INCORRECTA = 'Ya tienes una cuenta con este correo. Verifica tu contraseña e inténtalo de nuevo.';
```

Replace `aceptarInvitacion` (lines 509–560):

```ts
export async function aceptarInvitacion(
  deps: InvitacionesDeps,
  token: string,
  body: { name: unknown; password: unknown },
  auth: AuthProof,
): Promise<ServiceResult<AceptarInvitacionBody>> {
  const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
  if (!inv) {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  const now = deps.now();
  const vigencia = await verificarVigencia(deps, inv, now);
  if (!('vigente' in vigencia)) return vigencia;

  // El email y el rol nunca se leen del body: solo importan los de la
  // invitación.
  const existing = await deps.repo.findAccountForOwnershipProof(inv.email);

  if (existing) {
    // Cuenta existente (fase "Joining", ver el plan de esta PR): unirse a un
    // club nuevo requiere PROBAR que se es dueño de esa cuenta. name del
    // body se ignora siempre — el perfil compartido nunca se toca acá. Si
    // hay un Bearer verificado, la contraseña ni se valida ni se lee: es la
    // rama que usará la pantalla de PR 4. Sin Bearer, la contraseña sí es
    // obligatoria — mismo rate limit por token que login (ver Ruling 4 del
    // plan de esta PR: app.ts's inviteTokenKey limiter, 10/15min).
    let submittedPassword: string | undefined;
    if (auth.verifiedEmail === null) {
      const passwordParsed = passwordField.safeParse(body.password);
      if (!passwordParsed.success) {
        return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
      }
      submittedPassword = passwordParsed.data;
    }

    const prueba = await verificarPruebaDeCuentaExistente(deps, existing, auth, submittedPassword, {
      correoDistinto: MENSAJE_INVITACION_OTRO_CORREO,
      contrasenaIncorrecta: MENSAJE_CONTRASENA_INCORRECTA,
    });
    if (!prueba.ok) return prueba;

    const unido = await deps.repo.acceptInvitacionExistente({
      invitacionId: inv.id,
      organizationId: inv.organizationId,
      usuarioId: existing.id,
      rol: inv.rol,
      now,
    });
    if (!unido) {
      return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
    }

    return {
      ok: true,
      status: 201,
      body: { message: 'Te uniste al club. Ya puedes iniciar sesión.', email: existing.email },
    };
  }

  // Sin cuenta: el flujo de siempre (crea User + Membresia).
  const nameParsed = nameField.safeParse(body.name);
  if (!nameParsed.success) {
    return { ok: false, status: 400, error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };
  }
  const passwordParsed = passwordField.safeParse(body.password);
  if (!passwordParsed.success) {
    return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
  }

  const passwordHash = await deps.hashPassword(passwordParsed.data);

  const user = await deps.repo.acceptInvitacion({
    invitacionId: inv.id,
    organizationId: inv.organizationId,
    email: inv.email,
    name: nameParsed.data,
    passwordHash,
    rol: inv.rol,
    now,
  });

  if (!user) {
    return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
  }

  return {
    ok: true,
    status: 201,
    body: { message: 'Cuenta creada. Ya puedes iniciar sesión.', email: user.email },
  };
}
```

- [ ] **Step 4: Remove the now-dead `findUserByEmail`**

`InvitacionesRepo.findUserByEmail` has no remaining caller in `invitaciones.service.ts` (Task 2 migrated `crearInvitacion`/`reenviarInvitacion`/`crearInvitacionPlataforma`; this step migrates `aceptarInvitacion`, the last one). Confirm with:

```bash
grep -n 'repo.findUserByEmail' backend/src/services/invitaciones.service.ts
```

Expected: no output. Remove `findUserByEmail(email: string): Promise<UsuarioBasico | null>;` from the `InvitacionesRepo` interface (line 84), remove its implementation from `backend/src/services/invitaciones.repo.prisma.ts` (lines 12–27, the whole `findUserByEmail` method including its long comment), and remove it from `createFakeRepo`'s returned object in `invitaciones.service.test.ts` (the block added by Task 2 Step 1's edit no longer needs it — it never depended on it after Task 2/3's rewrites; confirm no test still calls `repo.findUserByEmail` directly before deleting).

- [ ] **Step 5: Run and confirm PASS**

```bash
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: every case passes, including the mechanically-updated pre-existing `aceptarInvitacion` cases (now passing `{ verifiedEmail: null }`) and `consultarInvitacion`'s untouched cases.

- [ ] **Step 6: Wire the controller — decode the Bearer header, add `comparePassword`**

In `backend/src/controllers/invitaciones.controller.ts`, extend the import block:

```ts
import {
  crearInvitacion as crearInvitacionService,
  listarInvitaciones as listarInvitacionesService,
  revocarInvitacion as revocarInvitacionService,
  reenviarInvitacion as reenviarInvitacionService,
  consultarInvitacion as consultarInvitacionService,
  aceptarInvitacion as aceptarInvitacionService,
  type InvitacionesDeps,
  type Requester,
  type ServiceResult,
  type AuthProof,
} from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import { verifiedEmailFromAuthHeader } from '../lib/verified-email.js';
```

Add `comparePassword` to both `buildDeps` (lines 29–45) and `buildPublicDeps` (lines 50–70):

```ts
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
```

Replace the `aceptarInvitacion` controller (lines 162–183):

```ts
// POST /api/auth/invitaciones/aceptar
export async function aceptarInvitacion(req: Request, res: Response): Promise<void> {
  const parsedToken = tokenField.safeParse(req.body?.token);
  if (!parsedToken.success) {
    res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el usuario nuevo (o la Membresia nueva, si la cuenta ya
    // existe) hereda el organizationId de la invitación, no de ningún
    // contexto previo — corre en contexto de plataforma. Un Bearer válido
    // (ver lib/verified-email.ts) es la prueba de titularidad para PR 4's
    // pantalla; el servicio nunca decodifica el token él mismo, solo recibe
    // el email YA verificado.
    const auth: AuthProof = { verifiedEmail: verifiedEmailFromAuthHeader(req) };
    const result = await runAsPlatform(() =>
      aceptarInvitacionService(
        buildPublicDeps(),
        parsedToken.data,
        { name: req.body?.name, password: req.body?.password },
        auth,
      ),
    );
    respond(res, result);
  } catch (error) {
    console.error('[aceptarInvitacion]', error);
    res.status(500).json({ error: 'Error al aceptar la invitación' });
  }
}
```

- [ ] **Step 7: Run and confirm PASS, then write the failing real-DB isolation checks**

```bash
npm run lint
npm test
npx tsc --noEmit
```

In `backend/src/scripts/test-isolation.ts`, add a new function after `runInviteJoiningChecks`:

```ts
// ─── aceptarInvitacion con una cuenta existente (PR "Joining") ────────────────

async function runAcceptJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const B_PASSWORD = 'password-b-existente';

  // Una cuenta nueva, propia de B, con contraseña conocida — para poder
  // probarla como "cuenta existente" al unirse a A.
  const emailExistenteEnB = `joining-existente-${RANDOM_SUFFIX}@iso-test.local`;
  const usuarioExistenteEnB = await runAsPlatform(async () => {
    const passwordHash = await bcrypt.hash(B_PASSWORD, SALT_ROUNDS);
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: seedB.organizationId, email: emailExistenteEnB, name: 'Existente En B', passwordHash, rol: 'SOCIO', emailVerified: true },
      });
      await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      return user;
    });
  });

  async function invitarYObtenerToken(email: string, rol: 'SOCIO' | 'LIDER' | 'ADMIN' = 'LIDER'): Promise<string> {
    const invitar = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email, rol });
    assert.equal(invitar.status, 201);
    const inviteUrl = (invitar.body as { inviteUrl: string }).inviteUrl;
    return new URL(inviteUrl).hash.replace('#invite=', '');
  }

  await check('aceptar con la contraseña correcta de la cuenta existente crea SOLO la Membresia en A, con el rol de la invitación', async () => {
    const token = await invitarYObtenerToken(emailExistenteEnB, 'LIDER');
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'Nombre Que Se Ignora', password: B_PASSWORD });
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: usuarioExistenteEnB.id } },
      }),
    );
    assert.ok(membresiaA);
    assert.equal(membresiaA?.rol, 'LIDER');

    // El perfil compartido nunca se tocó: sigue el nombre original de B, no
    // "Nombre Que Se Ignora".
    const perfil = await runAsPlatform(() => prisma.user.findUnique({ where: { id: usuarioExistenteEnB.id } }));
    assert.equal(perfil?.name, 'Existente En B');
  });

  await check('aceptar con la contraseña incorrecta responde 401 y no crea ninguna Membresia', async () => {
    const emailOtra = `joining-mal-password-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('la-correcta', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailOtra, name: 'Mal Password', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    const token = await invitarYObtenerToken(emailOtra);
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'X', password: 'la-incorrecta' });
    assert.equal(res.status, 401);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.equal(membresiaA, null);
    void token;
  });

  await check('varios intentos de contraseña incorrecta contra el MISMO token siguen fallando 401, nunca 200 (Review Focus #1 — la política de brute force sigue siendo la del rate limiter existente)', async () => {
    const emailBrute = `joining-brute-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('la-real', SALT_ROUNDS);
    await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailBrute, name: 'Brute', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      }),
    );
    await invitarYObtenerToken(emailBrute);
    for (const intento of ['a', 'b', 'c']) {
      const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'X', password: intento });
      assert.equal(res.status, 401);
    }
  });

  await check('aceptar con un Bearer del MISMO email crea la Membresia sin enviar contraseña', async () => {
    const emailBearer = `joining-bearer-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('no-se-usa', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailBearer, name: 'Bearer', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    const token = await invitarYObtenerToken(emailBearer);
    const bearerCuenta = signToken({ userId: cuenta.id, email: emailBearer });
    const res = await postJsonAuth(baseUrl, bearerCuenta, '/api/auth/invitaciones/aceptar', {});
    void token;
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.ok(membresiaA);
  });

  await check('aceptar con un Bearer de OTRO email responde 403 "Esta invitación es para otro correo" (Review Focus #4)', async () => {
    const emailMismatch = `joining-mismatch-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('x', SALT_ROUNDS);
    await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailMismatch, name: 'Mismatch', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      }),
    );
    await invitarYObtenerToken(emailMismatch);
    // seedA.socioUserId es una cuenta real, pero NO la invitada.
    const bearerAjeno = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const res = await postJsonAuth(baseUrl, bearerAjeno, '/api/auth/invitaciones/aceptar', {});
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Esta invitación es para otro correo' });
  });

  await check('dos aceptaciones concurrentes de la MISMA invitación (cuenta existente) crean exactamente una Membresia (Review Focus #3)', async () => {
    const emailRace = `joining-race-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('race-password', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailRace, name: 'Race', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    await invitarYObtenerToken(emailRace);
    const [primero, segundo] = await Promise.all([
      postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'X', password: 'race-password' }),
      postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'X', password: 'race-password' }),
    ]);
    const statuses = [primero.status, segundo.status].sort();
    // Exactamente uno gana (201); el otro pierde la carrera del update
    // condicional (409, MENSAJE_NO_PENDIENTE).
    assert.deepEqual(statuses, [201, 409]);

    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: cuenta.id } }));
    assert.equal(membresias.length, 2); // la de B (seed) + la nueva de A.
  });

  await check('sin cuenta existente, aceptar sigue creando la cuenta nueva (regresión)', async () => {
    const emailNuevo = `joining-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    const token = await invitarYObtenerToken(emailNuevo, 'SOCIO');
    void token;
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { name: 'Persona Nueva', password: 'password123' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { message: 'Cuenta creada. Ya puedes iniciar sesión.', email: emailNuevo });
  });
}
```

Wire it into `main()`, right after `await runInviteJoiningChecks(started.baseUrl, seedA, seedB);`:

```ts
    await runInviteJoiningChecks(started.baseUrl, seedA, seedB);
    await runAcceptJoiningChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 8: Run and confirm PASS**

```bash
npm run test:isolation
```

Expected: every new check passes; every pre-existing check (including `runHttpChecks`'s original invitation-accept flow, which never sends a Bearer or targets an existing account) stays green — that flow is Task 3's own no-account regression, doubly covered by both the unit test in Step 1 and this step's `'sin cuenta existente...'` check.

- [ ] **Step 9: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/invitaciones.service.ts backend/src/services/invitaciones.repo.prisma.ts backend/src/services/invitaciones.service.test.ts backend/src/controllers/invitaciones.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(invitaciones): accepting an invitation with an existing account joins the club instead of 409ing"
```

---

### Task 4: QR directo with an existing account (`registrarConQrDirecto`)

**Files:**
- Modify: `backend/src/services/codigos-qr.service.ts` (`registrarConQrDirecto` lines 645–713; remove now-dead `findUserByEmail`)
- Modify: `backend/src/services/codigos-qr.repo.prisma.ts` (remove now-dead `findUserByEmail`)
- Modify: `backend/src/services/codigos-qr.service.test.ts` (fake repo drops `findUserByEmail`, gains a real `registrarMembresiaQrDirectoExistente`; new cases for `registrarConQrDirecto`)
- Modify: `backend/src/controllers/codigos-qr.controller.ts` (`registrarConQrDirecto` controller lines 237–259; `buildPublicDeps`/`buildDeps` gain `comparePassword`)
- Modify: `backend/src/scripts/test-isolation.ts` (new `runQrDirectoJoiningChecks`, wired into `main()`)

**Interfaces:**
- Consumes: `verificarPruebaDeCuentaExistente`, `AuthProof`, `CodigosQrRepo.findAccountForOwnershipProof`/`registrarMembresiaQrDirectoExistente` (Task 1)
- Produces: `registrarConQrDirecto(deps, token, body, auth: AuthProof): Promise<ServiceResult<RegistrarConQrDirectoBody>>` — signature grows by one required parameter

- [ ] **Step 1: Write the failing unit tests for `registrarConQrDirecto`**

In `backend/src/services/codigos-qr.service.test.ts`, every existing call to `registrarConQrDirecto(deps, token, body)` gains a fourth argument, `{ verifiedEmail: null }` (same mechanical update as Task 3 Step 1), then add:

```ts
describe('registrarConQrDirecto — cuenta existente (PR "Joining")', () => {
  it('con la contraseña correcta, crea SOLO la Membresia y consume el único uso', async () => {
    const { deps, codigos } = createDeps({}, [
      { id: 'qr-existente-1', organizationId: 'otro-club', email: 'qr-existe@club.cl', name: 'Nombre Original', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'Se Ignora', email: 'qr-existe@club.cl', password: 'qr-existe@club.cl-password' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
    const codigo = codigos.find((c) => c.modo === 'DIRECTO');
    assert.equal(codigo?.usosRestantes, 0);
  });

  it('con la contraseña incorrecta, responde 401 y no consume el uso', async () => {
    const { deps, codigos } = createDeps({}, [
      { id: 'qr-existente-2', organizationId: 'otro-club', email: 'qr-mal@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'X', email: 'qr-mal@club.cl', password: 'incorrecta' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    const codigo = codigos.find((c) => c.modo === 'DIRECTO');
    assert.equal(codigo?.usosRestantes, 1);
  });

  it('con un Bearer de OTRO email, responde 403 "Este código es para otro correo"', async () => {
    const { deps } = createDeps({}, [
      { id: 'qr-existente-3', organizationId: 'otro-club', email: 'qr-mismatch@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'X', email: 'qr-mismatch@club.cl', password: undefined },
      { verifiedEmail: 'alguien-mas@club.cl' },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'Este código es para otro correo');
    }
  });

  it('sin cuenta existente, el comportamiento de siempre no cambia (regresión)', async () => {
    const { deps } = createDeps();
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'Nuevo', email: 'qr-nuevo-directo@club.cl', password: 'password123' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
  });
});
```

(`crearQrDirectoActivo` mirrors Task 2 Step 12's `crearQrActivo` helper, but for `modo: 'DIRECTO'` — reuse or extract whatever helper the existing `registrarConQrDirecto` describe block already uses to obtain an active DIRECTO token.)

Add `findAccountForOwnershipProof`/`registrarMembresiaQrDirectoExistente` to `createFakeRepo`'s returned `CodigosQrRepo` (mirroring Task 3 Step 1's real `acceptInvitacionExistente`):

```ts
    async findAccountForOwnershipProof(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, email: u.email, passwordHash: `hashed:${u.email}-password` } : null;
    },
    async registrarMembresiaQrDirectoExistente({ codigoQrId, organizationId, usuarioId, rol, now }) {
      const codigo = codigos.find((c) => c.id === codigoQrId);
      if (!codigo || codigo.modo !== 'DIRECTO' || codigo.revocadoAt !== null || codigo.expiresAt <= now || codigo.usosRestantes <= 0) {
        return { kind: 'agotado' as const };
      }
      codigo.usosRestantes -= 1;
      codigo.registradoUsuarioId = usuarioId;
      void organizationId;
      void rol;
      return { kind: 'ok' as const };
    },
```

Add `comparePassword: async (password, hash) => hash === \`hashed:${password}\`` to `createDeps` (mirroring `hashPassword`'s existing fake).

- [ ] **Step 2: Run and confirm the expected failures**

```bash
cd backend
node --import tsx --test src/services/codigos-qr.service.test.ts
```

- [ ] **Step 3: Rewrite `registrarConQrDirecto`**

In `backend/src/services/codigos-qr.service.ts`, add a new message constant near `MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO` (line 210):

```ts
// Distinto del de aceptarInvitacion (invitaciones.service.ts): "invitación"
// no describe un QR — ver Ruling 5 del plan de la PR de Joining.
const MENSAJE_QR_OTRO_CORREO = 'Este código es para otro correo';
```

Replace `registrarConQrDirecto` (lines 645–713):

```ts
export async function registrarConQrDirecto(
  deps: CodigosQrDeps,
  token: string,
  body: { name?: unknown; email?: unknown; password?: unknown },
  auth: AuthProof,
): Promise<ServiceResult<RegistrarConQrDirectoBody>> {
  const now = deps.now();

  // (1) Vigencia del token primero, igual que solicitarInvitacionQr — un
  // token desconocido O en modo CORREO se trata igual: no existe para este
  // endpoint.
  const vigencia = await verificarVigenciaQr(deps, token, now);
  if (!('vigente' in vigencia)) return vigencia;
  if (vigencia.qr.modo !== 'DIRECTO') {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();
  const { qr } = vigencia;

  // (2) Todo lo que sigue corre en el contexto de tenant del club del QR.
  return deps.withOrganization(qr.organizationId, async (): Promise<ServiceResult<RegistrarConQrDirectoBody>> => {
    const existing = await deps.repo.findAccountForOwnershipProof(email);

    if (existing) {
      // Cuenta existente (fase "Joining"): pide sign-in en vez de crear una
      // cuenta — mismas reglas de prueba que aceptarInvitacion (Ruling 3 del
      // plan de esta PR). name del body se ignora siempre.
      let submittedPassword: string | undefined;
      if (auth.verifiedEmail === null) {
        const passwordParsed = passwordField.safeParse(body.password);
        if (!passwordParsed.success) {
          return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
        }
        submittedPassword = passwordParsed.data;
      }

      const prueba = await verificarPruebaDeCuentaExistente(deps, existing, auth, submittedPassword, {
        correoDistinto: MENSAJE_QR_OTRO_CORREO,
        // Reusa el texto de siempre: "Ya existe una cuenta con ese correo.
        // Inicia sesión." también describe correctamente una contraseña
        // incorrecta — la persona ya sabe que tiene cuenta (recibió/escaneó
        // el QR sabiendo su propio correo), solo falta la contraseña.
        contrasenaIncorrecta: MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO,
      });
      if (!prueba.ok) return prueba;

      const resultado = await deps.repo.registrarMembresiaQrDirectoExistente({
        codigoQrId: qr.id,
        organizationId: qr.organizationId,
        usuarioId: existing.id,
        rol: ROL_QR,
        now,
      });

      if (resultado.kind === 'agotado') {
        return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
      }
      return { ok: true, status: 201, body: { ok: true } };
    }

    // Sin cuenta: el flujo de siempre.
    const nameParsed = nameField.safeParse(body.name);
    if (!nameParsed.success) {
      return { ok: false, status: 400, error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };
    }
    const passwordParsed = passwordField.safeParse(body.password);
    if (!passwordParsed.success) {
      return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
    }

    const passwordHash = await deps.hashPassword(passwordParsed.data);

    const resultado = await deps.repo.registrarUsuarioQrDirecto({
      codigoQrId: qr.id,
      organizationId: qr.organizationId,
      email,
      name: nameParsed.data,
      passwordHash,
      rol: ROL_QR,
      now,
    });

    if (resultado.kind === 'agotado') {
      return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
    }
    if (resultado.kind === 'email-en-uso') {
      return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO };
    }

    return { ok: true, status: 201, body: { ok: true } };
  });
}
```

- [ ] **Step 4: Remove the now-dead `findUserByEmail`**

Confirm with:

```bash
grep -n 'repo.findUserByEmail' backend/src/services/codigos-qr.service.ts
```

Expected: no output (Task 2 migrated `solicitarInvitacionQr`, this step migrates the last caller). Remove `findUserByEmail(email: string): Promise<UsuarioBasico | null>;` from `CodigosQrRepo` (line 112), its implementation from `backend/src/services/codigos-qr.repo.prisma.ts` (lines 42–52, including the comment), and its implementation from `createFakeRepo` in `codigos-qr.service.test.ts`.

- [ ] **Step 5: Run and confirm PASS**

```bash
node --import tsx --test src/services/codigos-qr.service.test.ts
```

- [ ] **Step 6: Wire the controller**

In `backend/src/controllers/codigos-qr.controller.ts`, extend the import:

```ts
import type { Requester, ServiceResult } from '../services/invitaciones.service.js';
import type { AuthProof } from '../services/invitaciones.service.js';
import { verifiedEmailFromAuthHeader } from '../lib/verified-email.js';
```

Add `comparePassword` to both `buildDeps` (line 50) and `buildPublicDeps` (line 86):

```ts
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
```

Replace the `registrarConQrDirecto` controller (lines 237–259):

```ts
// POST /api/qr/registrar — contraparte DIRECTO de solicitarInvitacionQr: da
// de alta la cuenta en el acto (o une una cuenta existente), sin correo de
// por medio.
export async function registrarConQrDirecto(req: Request, res: Response): Promise<void> {
  const parsedToken = tokenField.safeParse(req.body?.token);
  if (!parsedToken.success) {
    res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el usuario nuevo (o la Membresia nueva) hereda el
    // organizationId del QR, no de ningún contexto previo — corre en
    // contexto de plataforma, igual que aceptar una invitación individual.
    const auth: AuthProof = { verifiedEmail: verifiedEmailFromAuthHeader(req) };
    const result = await runAsPlatform(() =>
      registrarConQrDirectoService(
        buildPublicDeps(),
        parsedToken.data,
        { name: req.body?.name, email: req.body?.email, password: req.body?.password },
        auth,
      ),
    );
    respond(res, result);
  } catch (error) {
    console.error('[registrarConQrDirecto]', error);
    res.status(500).json({ error: 'Error al registrar la cuenta' });
  }
}
```

- [ ] **Step 7: Run and confirm PASS, then write the failing real-DB isolation checks**

```bash
npm run lint
npm test
npx tsc --noEmit
```

In `backend/src/scripts/test-isolation.ts`, add a new function after `runAcceptJoiningChecks`, mirroring its structure with `/api/qr/registrar` and a DIRECTO code instead of an invitation. Use the existing `runQrDirectoChecks`'s pattern for minting an active DIRECTO code (`crearCodigoQr` via `postJsonAuth` with `{ modo: 'DIRECTO' }`, extract the token from `qrUrl`) as the model:

```ts
// ─── registrarConQrDirecto con una cuenta existente (PR "Joining") ────────────

async function runQrDirectoJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  async function crearQrDirectoYObtenerToken(): Promise<string> {
    const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones/qr', { modo: 'DIRECTO' });
    assert.equal(res.status, 201);
    const qrUrl = (res.body as { qrUrl: string }).qrUrl;
    return new URL(qrUrl).hash.replace('#qr=', '');
  }

  async function crearCuentaEnB(email: string, password: string): Promise<{ id: string }> {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return runAsPlatform(() =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email, name: 'Existente QR', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
  }

  await check('QR directo con la contraseña correcta de una cuenta existente crea SOLO la Membresia en A y consume el único uso', async () => {
    const email = `qr-directo-existe-${RANDOM_SUFFIX}@iso-test.local`;
    const cuenta = await crearCuentaEnB(email, 'qr-directo-password');
    const token = await crearQrDirectoYObtenerToken();

    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'Se Ignora', email, password: 'qr-directo-password' });
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.ok(membresiaA);

    // Un segundo intento contra el MISMO código (ya de un solo uso) da 410,
    // aunque la contraseña sea correcta — el uso ya se consumió.
    const segundo = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'qr-directo-password' });
    assert.equal(segundo.status, 410);
  });

  await check('QR directo con la contraseña incorrecta responde 401 y NO consume el uso', async () => {
    const email = `qr-directo-mal-${RANDOM_SUFFIX}@iso-test.local`;
    await crearCuentaEnB(email, 'la-correcta');
    const token = await crearQrDirectoYObtenerToken();

    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'la-incorrecta' });
    assert.equal(res.status, 401);

    // El uso sigue disponible: un segundo intento con la contraseña correcta
    // funciona.
    const segundo = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'la-correcta' });
    assert.equal(segundo.status, 201);
  });

  await check('QR directo con un Bearer de OTRO email responde 403 "Este código es para otro correo"', async () => {
    const email = `qr-directo-mismatch-${RANDOM_SUFFIX}@iso-test.local`;
    await crearCuentaEnB(email, 'x');
    const token = await crearQrDirectoYObtenerToken();

    const bearerAjeno = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const res = await postJsonAuth(baseUrl, bearerAjeno, '/api/qr/registrar', { token, email });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Este código es para otro correo' });
  });

  await check('dos registros concurrentes con la MISMA cuenta existente y el MISMO código directo consumen el uso exactamente una vez', async () => {
    const email = `qr-directo-race-${RANDOM_SUFFIX}@iso-test.local`;
    const cuenta = await crearCuentaEnB(email, 'race-password');
    const token = await crearQrDirectoYObtenerToken();

    const [primero, segundo] = await Promise.all([
      postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'race-password' }),
      postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'race-password' }),
    ]);
    const statuses = [primero.status, segundo.status].sort();
    assert.deepEqual(statuses, [201, 410]);

    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: cuenta.id } }));
    assert.equal(membresias.length, 2); // la de B (seed) + la nueva de A.
  });

  await check('QR directo sin cuenta existente sigue creando la cuenta nueva (regresión)', async () => {
    const email = `qr-directo-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    const token = await crearQrDirectoYObtenerToken();
    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'Persona Nueva', email, password: 'password123' });
    assert.equal(res.status, 201);
  });
}
```

Wire it into `main()`, right after `await runAcceptJoiningChecks(started.baseUrl, seedA, seedB);`:

```ts
    await runAcceptJoiningChecks(started.baseUrl, seedA, seedB);
    await runQrDirectoJoiningChecks(started.baseUrl, seedA, seedB);
```

- [ ] **Step 8: Run and confirm PASS**

```bash
npm run test:isolation
```

- [ ] **Step 9: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/codigos-qr.service.ts backend/src/services/codigos-qr.repo.prisma.ts backend/src/services/codigos-qr.service.test.ts backend/src/controllers/codigos-qr.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(qr): registering via QR directo with an existing account joins the club instead of 409ing"
```

---

### Task 5: CLI `create-user --force` never overwrites a non-primary club's shared profile

**Files:**
- Modify: `backend/src/scripts/create-user.ts` (`run`, the `--force` branch, lines 194–226)
- Modify: `backend/src/scripts/test-isolation.ts` (extend `runCreateUserCliChecks` with two new checks)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new exported — behavior-only change

- [ ] **Step 1: Write the failing isolation checks**

In `backend/src/scripts/test-isolation.ts`, add two checks at the end of `runCreateUserCliChecks` (after the `'CLI create-user: cuenta existente en OTRO club recibe la membresía nueva...'` check):

```ts
  await check(
    'CLI create-user --force en un club NO primario actualiza SOLO el rol de la Membresia, nunca el nombre/contraseña compartidos (Ruling 8 del plan de la PR de Joining)',
    async () => {
      const email = `cli-force-no-primario-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'Nombre Primario', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const usuarioAntes = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(usuarioAntes);
      assert.equal(usuarioAntes?.organizationId, seedA.organizationId);

      // Se agrega como socio de B (aditivo, sin --force) y LUEGO se corrige
      // el rol en B con --force: B nunca fue ni es el club primario de esta
      // cuenta (ese sigue siendo A).
      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'Nombre Primario', '--org', SLUG_B, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

      const tercero = await runCreateUserCli(
        ['--email', email, '--name', 'Nombre Que NO Debe Guardarse', '--org', SLUG_B, '--rol', 'LIDER', '--force'],
        'password-que-no-debe-guardarse',
      );
      assert.equal(tercero.code, 0, `stderr: ${tercero.stderr}`);

      const usuarioDespues = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      // El perfil compartido no cambió NADA: ni nombre ni passwordHash.
      assert.equal(usuarioDespues?.name, usuarioAntes?.name);
      assert.equal(usuarioDespues?.passwordHash, usuarioAntes?.passwordHash);
      // La columna heredada User.organizationId/rol tampoco (B no es el
      // primario).
      assert.equal(usuarioDespues?.organizationId, seedA.organizationId);
      assert.equal(usuarioDespues?.rol, usuarioAntes?.rol);

      // Pero la Membresia de B sí quedó con el rol nuevo.
      const membresiaB = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedB.organizationId, usuarioId: usuarioDespues!.id } },
        }),
      );
      assert.equal(membresiaB?.rol, 'LIDER');
    },
  );

  await check(
    'CLI create-user --force en el club PRIMARIO sigue actualizando el perfil completo (regresión)',
    async () => {
      const email = `cli-force-primario-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'Nombre Viejo', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password-vieja',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'Nombre Nuevo', '--org', SLUG_A, '--rol', 'LIDER', '--force'],
        'password-nueva',
      );
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

      const usuario = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.equal(usuario?.name, 'Nombre Nuevo');
      assert.equal(usuario?.rol, 'LIDER');
    },
  );
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
npm run test:isolation
```

Expected: `'CLI create-user --force en un club NO primario...'` fails — today's `--force` branch always rewrites `name`/`passwordHash` regardless of which club is being updated, so `usuarioDespues?.name` would equal `'Nombre Que NO Debe Guardarse'`, not the original. The regression check already passes (today's behavior for the primary club is already this).

- [ ] **Step 3: Rewrite the `--force` branch**

In `backend/src/scripts/create-user.ts`, replace the final `existing && existingMembresia && force` block (lines 194–226):

```ts
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

with:

```ts
  // existing && existingMembresia && force: club PRIMARIO de la cuenta →
  // actualiza el perfil compartido completo (name/contraseña/rol), como
  // siempre. Club NO primario → --force es una herramienta de reparación de
  // ROL para ESTE club, nunca del perfil compartido de la cuenta (Ruling 8
  // del plan de la PR de Joining: el mismo motivo por el que la alta
  // aditiva de arriba nunca lo toca). No se pide/hashea contraseña para esa
  // rama: ya se leyó rawPassword más arriba en TODA invocación con --force,
  // así que simplemente se descarta acá si el club no es el primario —
  // mantiene un solo camino de parseo de argumentos, sin --force
  // condicionando qué flags son válidos.
  if (existing.organizationId !== organization.id) {
    await prisma.membresia.upsert({
      where: { organizationId_usuarioId: { organizationId: organization.id, usuarioId: existing.id } },
      create: { organizationId: organization.id, usuarioId: existing.id, rol },
      update: { rol },
    });
    console.log(
      `[create-user] Se actualizó el rol de "${email}" en "${org}" a rol="${rol}" (club no primario: el ` +
        'perfil compartido de la cuenta no se tocó).',
    );
    return;
  }

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
        rol,
      },
    });
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

Expected: both new checks pass, along with every pre-existing `runCreateUserCliChecks` check (the additive path, the same-club refusal without `--force`, and the self-healing-Membresia check — none of which exercise the non-primary + `--force` combination this step changes).

- [ ] **Step 5: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/create-user.ts backend/src/scripts/test-isolation.ts
git commit -m "fix(cli): create-user --force on a non-primary club only updates the role"
```

---

### Task 6: End-to-end coverage — `tenant:create --admin-email`, enumeration invariance, full regression

**Files:**
- Modify: `backend/src/scripts/test-isolation.ts` (extend `runTenantCliChecks`; add an enumeration-invariance check to `runInviteJoiningChecks` or a small new function)

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: nothing new — this task is proof, not new production code

- [ ] **Step 1: Write the failing `tenant:create --admin-email` end-to-end check**

In `backend/src/scripts/test-isolation.ts`, inside `runTenantCliChecks`, add a check after the existing `'POST /api/auth/login devuelve la organización pública propia del club recién creado...'` check (Ruling 7 of this PR's plan: no new code in `scripts/tenant.ts` — this proves it):

```ts
  await check(
    'tenant:create --admin-email con una cuenta YA existente (en otro club) la vuelve ADMIN del club nuevo mediante sign-in-and-confirm (Ruling 7 del plan de la PR de Joining)',
    async () => {
      const preexistenteEmail = `tenant-preexistente-${RANDOM_SUFFIX}@iso-test.local`;
      const preexistentePassword = 'ya-tengo-cuenta';
      const preexistente = await runAsPlatform(async () => {
        const passwordHash = await bcrypt.hash(preexistentePassword, SALT_ROUNDS);
        return prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              organizationId: seedA.organizationId,
              email: preexistenteEmail,
              name: 'Ya Tengo Cuenta',
              passwordHash,
              rol: 'SOCIO',
              emailVerified: true,
            },
          });
          await tx.membresia.create({ data: { organizationId: seedA.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
          return user;
        });
      });

      const segundoClubSlug = `iso-test-cli-2-${RANDOM_SUFFIX}`;
      const input: CrearClubInput = {
        slug: segundoClubSlug,
        name: `Iso Test Club CLI 2 ${RANDOM_SUFFIX}`,
        membresiaPropia: MEMBRESIA_B,
        alertEmail: `alert-cli-2-${RANDOM_SUFFIX}@iso-test.local`,
        contactName: 'Contacto CLI 2',
        contactEmail: `contacto-cli-2-${RANDOM_SUFFIX}@iso-test.local`,
        adminEmail: preexistenteEmail,
      };
      const creado = await crearClub(depsOperativos, input);
      assert.equal(creado.ok, true);
      if (!creado.ok) return;
      assert.equal(creado.body.invitacion.emitida, true);
      // Ruling 7: crearInvitacionPlataforma NO 409ea una cuenta existente —
      // el club queda creado y la invitación, emitida.

      const inviteToken = creado.body.invitacion.emitida
        ? new URL(creado.body.invitacion.inviteUrl).hash.replace('#invite=', '')
        : '';
      const aceptar = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
        name: 'Se Ignora',
        password: preexistentePassword,
      });
      assert.equal(aceptar.status, 201);

      const nuevaOrg = await runAsPlatform(() => prisma.organization.findUnique({ where: { slug: segundoClubSlug } }));
      assert.ok(nuevaOrg);
      const membresiaNueva = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: nuevaOrg!.id, usuarioId: preexistente.id } },
        }),
      );
      assert.equal(membresiaNueva?.rol, 'ADMIN');

      // El perfil compartido nunca se tocó.
      const perfil = await runAsPlatform(() => prisma.user.findUnique({ where: { id: preexistente.id } }));
      assert.equal(perfil?.name, 'Ya Tengo Cuenta');

      await runAsPlatform(() => purgeOrganization(nuevaOrg!.id));
    },
  );
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
npm run test:isolation
```

Expected before Task 2/3 (already applied, since this is Task 6): this check should already pass, since it only exercises code paths Tasks 2 and 3 already made correct. This step exists to prove the end-to-end wiring across `tenant.ts` → `tenants.service.ts` → `invitaciones.service.ts` (Ruling 7), not to drive new implementation — same pattern as PR 2 Task 4 Step 5.

- [ ] **Step 3: Write the enumeration call-counting check**

In `backend/src/scripts/test-isolation.ts`, add to `runInviteJoiningChecks` (after its two existing checks):

```ts
  await check(
    'crearInvitacion hace EXACTAMENTE una consulta de cuenta/membresía sin importar si el email existe en otro club o no existe en absoluto (Review Focus #2 — sin canal de tiempo)',
    async () => {
      let llamadas = 0;
      const repoInstrumentado: InvitacionesRepo = {
        ...invitacionesRepoPrisma,
        findAccountMembershipStatus: async (email, organizationId) => {
          llamadas += 1;
          return invitacionesRepoPrisma.findAccountMembershipStatus(email, organizationId);
        },
      };
      const deps: InvitacionesDeps = {
        repo: repoInstrumentado,
        sendEmail: async () => {},
        hashPassword: async (password) => `hashed:${password}`,
        comparePassword: async (password, hash) => hash === `hashed:${password}`,
        now: () => new Date(),
        frontendUrl: 'https://iso-test.local',
      };
      const requester = { id: seedA.adminUserId, organizationId: seedA.organizationId, name: 'Admin A', rol: 'ADMIN' as const };

      llamadas = 0;
      await runWithOrganization(seedA.organizationId, () =>
        crearInvitacionService(deps, requester, { email: `enum-sin-cuenta-${RANDOM_SUFFIX}@iso-test.local` }),
      );
      const llamadasSinCuenta = llamadas;

      llamadas = 0;
      await runWithOrganization(seedA.organizationId, () => crearInvitacionService(deps, requester, { email: seedB.adminEmail }));
      const llamadasConCuentaEnOtroClub = llamadas;

      assert.equal(llamadasSinCuenta, 1);
      assert.equal(llamadasConCuentaEnOtroClub, 1);
    },
  );
```

This requires importing `crearInvitacion as crearInvitacionService` and `type InvitacionesRepo` alongside the existing `InvitacionesDeps`/`crearInvitacionPlataforma` import at the top of `test-isolation.ts` (extend the existing import from `'../services/invitaciones.service.js'`).

- [ ] **Step 4: Run and confirm PASS**

```bash
npm run test:isolation
```

- [ ] **Step 5: Full backend test + lint pass**

```bash
npm run lint
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/test-isolation.ts
git commit -m "test(isolation): cover tenant:create --admin-email and invite-side enumeration invariance for Joining"
```

---

## Deployment

**A migration is needed.** Task 1 drops two `@unique` constraints (`invitaciones_usuario_id_key`, `codigos_qr_invitacion_registrado_usuario_id_key`) — expand-only (no data written, no data lost, no behavior change for any pre-PR-3 code, per Ruling 1). `docker compose run --rm migrate` in `.github/workflows/deploy.yml` applies it automatically as part of the existing CI flow (preflight → report pending migrations → apply migrations → roll the containers → health check) once a reviewer approves the `production` environment gate — nothing about that flow needs to change for this PR.

**Before approving the deploy job — Neon backup branch (manual, same as PR 1's migration).** In the Neon console, open the `riala` project and create a new branch from the branch `DATABASE_URL` in production's `.env` points to. Keep it until this deploy is confirmed healthy: even though `DROP INDEX` alone cannot lose data, it is still schema DDL running against production, and the backup branch is the same safety net PR 1 used for its migration. There is no backfill in this PR, so there is no "close the migrate-to-roll window" step like PR 1's — dropping an index needs no follow-up write once applied.

**Post-deploy read-only checks** (optional, over the same WireGuard VPN the CI job itself uses, after CI already reports healthy):

```bash
ssh <usuario>@<dirección VPN del servidor>
cd ~/riala
set -a; . ./.env; set +a

# Confirma que la migración se aplicó: ambos índices únicos ya no existen.
docker run --rm postgres:16-alpine psql "$DATABASE_URL" -c "
SELECT indexname FROM pg_indexes
WHERE indexname IN ('invitaciones_usuario_id_key', 'codigos_qr_invitacion_registrado_usuario_id_key');
"
```

Expected: zero rows (both indexes gone).

```bash
# El invariante de PR 1 (todo usuario tiene al menos una Membresia) tampoco
# lo toca esta PR.
docker run --rm postgres:16-alpine psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS usuarios_sin_membresia
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM membresias m WHERE m.usuario_id = u.id);
"
```

Expected: `usuarios_sin_membresia | 0`.

**Rollback note:** the migration is a `DROP INDEX`, which is not reversible by re-running a "down" migration (Prisma migrations are forward-only) — but it needs no reversal: an image rollback (`RIALA_TAG` back to the previous `sha-` value, then `docker compose up -d`) runs the OLD application code against a schema that is now *more* permissive than the old code expects (it never relied on the uniqueness for its own correctness — every old code path already 409ed an existing account before reaching the write that constraint would have caught), so old code keeps working unchanged. No data was altered by this PR's deploy.

---

## Self-review

**1. Spec coverage.** Design §2 "Joining a club": *Invite* (Task 2 — `crearInvitacion`/`reenviarInvitacion`, plus `crearInvitacionPlataforma`/`solicitarInvitacionQr` which the spec's bullet also names via "QR by email"); *Accept* (Task 3 — no-account flow unchanged, existing-account flow creates only the `Membresia`); *QR directo* (Task 4 — sign-in instead of account creation, single use consumed only on membership creation); the invitation email's "sign in with your RIALA account" copy (Task 2, `buildInvitationEmail`'s `existingAccount` option); `tenant:create --admin-email` (Ruling 7 + Task 6's end-to-end check, no new code needed). Design §4 error table: `409 "Ya es socio de este club"` (Task 2), `403 "Esta invitación es para otro correo"` (Task 3, spec's exact wording). Decisions 1–2 ("one account for all clubs," "joining a second club requires consent"): the whole PR is the consent mechanism (password/Bearer proof) for Decision 2; Decision 1 is what makes "the same account, a second club" a real state to design for at all — already true since PR 1/2, unchanged here. The orchestrator's explicit rulings-to-encode are all present: frontend-compatibility of the password path (Global Constraints + Ruling 3), enumeration/brute-force/replay Review Focus (items 1–3), CLI `--force` decision (Ruling 8, not deferred), migration assessment (Ruling 1 + Deployment section).

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N" language. The one place that reuses unchanged code verbatim (Task 5 Step 3's primary-club branch, structurally identical to today's code) is shown in full, not referenced. Every step shows complete, compilable code.

**3. Type consistency.** `AuthProof`/`OwnershipProofResult`/`AccountMembershipStatus`/`AccountForOwnershipProof` are defined once (Task 1, `invitaciones.service.ts`) and imported — never redefined — by `codigos-qr.service.ts` (Task 1 Step 12), the two controllers (Tasks 3/4), and `test-isolation.ts` (Task 6). `aceptarInvitacion`/`registrarConQrDirecto`'s new fourth parameter (`auth: AuthProof`) has the identical name and type at every call site touched (service, both controllers, both test files, `test-isolation.ts`). `verificarPruebaDeCuentaExistente`'s `mensajes` parameter names (`correoDistinto`/`contrasenaIncorrecta`) match between its Task 1 definition and both Task 3/4 call sites. `SendInvitationEmailParams.existingAccount`/`SendCodigoQrInvitationEmailParams.existingAccount`/`InvitationEmailOptions.existingAccount` all use the same name end to end (service → controller → `buildInvitationEmail`).

**4. Review Focus.** All five items list their pinning task/test explicitly in the section above (brute force → Task 3/4's repeated-wrong-password checks + Ruling 4's reasoned no-new-middleware decision; enumeration → Task 2's fake-repo identical-response tests + Task 6's call-counting check; replay/race → Task 3/4's concurrent-acceptance checks; Bearer impersonation → Task 3/4's mismatched-email checks; CLI profile corruption → Task 5's two checks) — none are left uncovered.

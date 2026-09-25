# Multi-Club Membership — Design

**Date:** 2026-09-23
**Status:** Approved in conversation, pending written-spec review
**Scope:** RIALA (`riala.cl`): backend, frontend, data migration on Neon, docs.

## Context

RIALA serves several clubs (tenants) from one deployment, but today **one account belongs to
exactly one club**. That rule is structural, not incidental:

| Fact | Evidence |
|------|----------|
| An account has one club | `User.organizationId` is a required scalar FK (`backend/prisma/schema.prisma`, model `User`) |
| An email can exist only once on the whole platform | `User.email @unique`; no per-club uniqueness |
| The role is per account, not per club | `User.rol` (`SOCIO`/`LIDER`/`ADMIN`) |
| The session decides the club, the URL does not | `authMiddleware` loads `User.organizationId` and pins the request with `runWithOrganization` (`backend/src/middleware/auth.middleware.ts`); the JWT carries only `userId` and `email` (`backend/src/lib/jwt.ts`) |
| Every join path rejects an existing email | `crearInvitacion`, `reenviarInvitacion`, `aceptarInvitacion`, `crearInvitacionPlataforma` (`services/invitaciones.service.ts`), `solicitarInvitacionQr`, `registrarConQrDirecto` (`services/codigos-qr.service.ts`) and `scripts/create-user.ts` all stop on `findUserByEmail` |
| The URL is cosmetic | The pre-login club comes from `?club=<slug>` or `localStorage['pamir_club_preferido']` and only paints the logo (`frontend/src/lib/club-preferido.ts`) |
| The rule is documented | `README.md` ("Una cuenta pertenece a exactamente un club") and `docs/de-pamir-a-riala.html` ("La dirección web no decide a qué club entras") |

The product now needs one person, with one email and one password, to belong to several clubs
(for example a RIALA staff member who administers several clubs, or a climber who is a member of
two clubs) and to reach each club at a path URL: `riala.cl/el-montanista`, `riala.cl/testing`.

This design deliberately reverses the two documented rules above.

## Decisions taken with the product owner

1. **One account for all clubs.** Same email and password everywhere; one login; a different
   role in each club.
2. **Joining a second club requires consent.** The new club invites by email or QR as today; a
   person who already has an account signs in with their existing password and confirms. No club
   can add someone without that person accepting.
3. **Approach A: global account + memberships, club selected by the URL.** Rejected: a token per
   club (one active club per browser, URL and session can disagree) and club-prefixed API routes
   (rewrites every route and API call with no visible benefit).

## Goals

1. One person can hold memberships in any number of clubs, with an independent role in each.
2. `riala.cl/<slug>` opens that club; a member reaches it without logging in again.
3. Tenant isolation stays exactly as strong as today: a club sees only its own data and only the
   people who are its members.
4. Existing users see no change: each keeps their current club and role.
5. Every step is deployable on its own and reversible without data loss.

## Non-goals

- Removing a person from a club (not possible today either; follow-up).
- A person-level profile shared across clubs beyond name, email, picture and password. Club data
  (`Integrante`, `Salida`, `Inscripcion`, …) stays per club.
- Deep-linking to screens inside a club (`/el-montanista/eventos`). Only the club is in the path.
- Fixing CI's network access to the production server (separate open decision).

## Design

### 1. Data model and migration

**`User` becomes a platform account.** It keeps only what belongs to the person: `email`
(still globally unique), `name`, `picture`, `passwordHash`, `emailVerified`, verification and
reset tokens. `organizationId` and `rol` move to the membership.

**New model `Membresia`** (table `membresias`):

| Column | Notes |
|--------|-------|
| `id` | uuid |
| `organizationId` | the club; tenant column |
| `usuarioId` | FK to `User.id`, `onDelete: Cascade` |
| `rol` | `RolUsuario` (`SOCIO`/`LIDER`/`ADMIN`) |
| `creadoAt` | default now |

Constraints: `@@unique([organizationId, usuarioId])`, `@@index([usuarioId])`.

**Scope classification** (`backend/src/lib/scope-args.ts`):
- `Membresia` is added to `TENANT_MODELS`: inside a club only that club's memberships are
  visible, with the same fail-closed checks as every other tenant model.
- `User` moves from `TENANT_MODELS` to `GLOBAL_MODELS`.

**Central invariant:** a club only sees people who hold a membership in it. Every read of users
from inside a club goes through `Membresia` (joined to `User`), never through a bare
`prisma.user.findMany`/`count`.

**Unchanged:** `Salida`, `Cierre`, `Inscripcion`, `Evento`, `GestorCategoria`, `Invitacion`,
`CodigoQrInvitacion`, `DashboardLayout` and the rest keep their own `organizationId` and keep
pointing at `User.id`. A person's salidas in El Montañista stay separate from their salidas in
Testing because each row is scoped to its club.

**Migration in two phases (expand, then contract):**
1. *Expand* (first release): create `membresias`; backfill one row per existing user from
   `User.organizationId` and `User.rol`; every code path that creates a `User` also creates its
   `Membresia`. `User.organizationId` and `User.rol` stay in place, so rolling back the image is
   safe.
2. *Contract* (a later release, after production is verified): drop `User.organizationId` and
   `User.rol`.

Before applying the expand migration, create a backup branch in Neon.

### 2. Backend

**Club resolution per request.** The frontend sends the active club on every API call in the
header `X-Club: <slug>`. `authMiddleware`:
1. verifies the JWT and loads the `User` (platform scope, as today);
2. resolves the `Organization` by slug from `X-Club`;
3. loads the `Membresia` for (`user.id`, `organization.id`);
4. builds `req.user` **with the same `AuthUser` shape as today**: `organizationId` is the active
   club and `rol` is the membership's role. `lib/authz.ts`, `requireAdmin`, `requireCanInvite`,
   `requireGestorEventos` and the controllers keep working unchanged;
5. runs the rest of the chain inside `runWithOrganization(organization.id)`.

`X-Club` **grants nothing by itself**: it only selects which of the caller's own memberships is
active. Authorization is the membership lookup.

*Transition rule:* if `X-Club` is absent and the person has exactly one membership, that club is
used. This keeps old clients working during the rollout. With several memberships and no header
the request fails with `400`.

**Login and session.**
- Login stays email + password and becomes platform-wide. The JWT payload does not change
  (`userId`, `email`).
- The login response and `GET /api/auth/me` include `clubes`: the person's memberships as
  `{ slug, name, shortName, hasLogo, logoVersion, rol }`. `/me` with `X-Club` also returns the
  active club and role, in today's shape.

**Joining a club.**
- *Invite* (`crearInvitacion`, `reenviarInvitacion`, QR by email): an existing account is no
  longer a `409`. It is rejected only when that person is already a member of *this* club.
- *Accept* (`aceptarInvitacion`):
  - no account for the invited email → today's flow (create `User` + `Membresia`);
  - account exists → the request must be authenticated as that same email (sign in with the
    existing password in the same screen); only the `Membresia` is created, with the invitation's
    role.
- *QR directo* (`registrarConQrDirecto`): with an existing account it asks the person to sign in
  instead of creating an account; the single use is consumed only when the membership is created.
- The invitation email to an existing account says "sign in with your RIALA account to join".
- The inviting club's admin never learns whether the email belongs to other clubs. The admin
  response is the same whether or not the account exists elsewhere.

**Other changes.**
- *Admin users list and role change* (`GET /api/admin/users`, `PATCH /api/admin/users/:id/rol`):
  they list and update memberships of the active club. The role lives on `Membresia`.
- *Gestores de eventos* (`lib/gestores-eventos.ts`): the LIDER check reads the active
  membership's role, which is already what `req.user.rol` holds.
- *Password reset*: one password for all clubs. The reset email uses the branding of the club
  the request came from when the person is a member of it, otherwise their oldest membership.
- *CLI* `create-user --org <slug>`: when the account already exists, it adds the membership
  instead of refusing.
- *Tenant CLI* `tenant:create --admin-email`: an existing account becomes the first ADMIN through
  the same "sign in and confirm" invitation.
- Salida, closing-report and alert emails do not change: they already use each salida's club.

### 3. Frontend

**The path selects the club.** The first path segment is the club: `riala.cl/el-montanista`.
In-app navigation stays state-based as today. nginx already falls back to `index.html` for any
path, so it needs no change. Asset URLs are absolute (`/assets/...`), so they are unaffected.

- Invitation and QR links carry the club: `https://riala.cl/<slug>#invite=<token>`,
  `https://riala.cl/<slug>#qr=<token>`. The token stays in the fragment, out of server logs.
- Legacy links with `?club=<slug>` redirect to `/<slug>` (`history.replaceState`).
- Reserved slugs grow to cover top-level static paths: `assets`, `auth`, `brand`, next to the
  current `platform`, `plataforma`, `admin`, `api`, `www`, `app`, `riala`
  (`backend/src/scripts/tenant-args.ts`). The house club keeps its existing slug `riala`.

**What the person sees:**

> Decision (2026-09-25): single login, always at `riala.cl`, with RIALA branding; after signing
> in the person always picks their club — even with a single membership; after picking, the app
> keeps using `/<slug>` internally exactly as before.

| Address | Signed out | Signed in |
|---------|------------|-----------|
| `riala.cl` | Login with RIALA branding | **"Mis clubes"** picker, always — one membership or several (suspended ones listed and disabled) |
| `riala.cl/<slug>` (no `#invite=`/`#qr=`) | Redirects to `riala.cl` (RIALA branding; no club logo, no "Club no encontrado" screen) | Member: the app for that club. Not a member: "No perteneces a este club" + link to "Mis clubes" |
| `riala.cl/<slug>#invite=<token>` / `#qr=<token>` (also bare-domain `#invite=`/`#qr=`) | Invitation/QR screen, with the inviting club's branding | Same interstitial/QR screen |
| unknown slug (no `#invite=`/`#qr=`) | Redirects to `riala.cl` (same as any other slug) | "Club no encontrado" |

Redirecting every signed-out non-root path back to `riala.cl` applies equally to a valid slug, an
unknown one, and a reserved path: the frontend never distinguishes them before authenticating, so
the old signed-out "Club no encontrado" screen is unreachable and was removed as dead code.

An account with zero memberships cannot exist in this release (every account is created together
with its first membership and memberships are never removed), so `riala.cl` never needs a
"no clubs" screen. The removal follow-up must add one.

- The user menu shows **"Cambiar de club"** only for people with more than one membership.
- One session per browser (the person's). Because the club comes from each tab's URL, two tabs
  can be open on two clubs at once.
- The API client adds `X-Club` from the current path on every request.
- `OrganizationProvider` and role-gated UI keep reading `user.organization` / `user.rol`, now
  filled from the active membership.

**Browser storage per club.** The wizard draft and saved integrantes (`pamir_draft`,
`pamir_draft_step`, `pamir_integrantes` in `frontend/src/lib/storage.ts`) become keyed per club,
so a draft started in El Montañista never appears in Testing. On first load after the release, an
existing unkeyed draft is assigned to the current club, so no one loses a salida they were
registering in the mountains. `pamir_auth` stays one per browser.

**Joining with an existing account.** The invitation and QR screens detect that the account
exists and show "Ya tienes cuenta RIALA: inicia sesión para unirte a <club>". After the
password, the membership is created and the person lands on `/<slug>`.

### 4. Security, errors, testing and delivery

**Isolation.** Making `User` global is the main risk. Any query that lists users relying on the
automatic club filter would start returning users from every club. Two layers:
1. Every in-club read of users goes through `Membresia`. The affected call sites are few:
   `controllers/admin.controller.ts` (4), `controllers/auth.controller.ts` (7),
   `services/invitaciones.repo.prisma.ts` (3), `services/codigos-qr.repo.prisma.ts` (3),
   `scripts/create-user.ts` (3), `middleware/auth.middleware.ts` (1).
2. A static guard test (like `lib/raw-sql-guard.test.ts`) fails the build when
   `prisma.user.findMany`/`count`/`groupBy`/`aggregate` appears outside a short allowlist.

**Error responses:**

| Case | Response |
|------|----------|
| `X-Club` names an unknown club | `404` "Club no encontrado" |
| Caller is not a member of that club | `403` "No perteneces a este club" |
| Club suspended | today's `CLUB_SUSPENDIDO_MENSAJE` |
| Several memberships and no `X-Club` | `400` "Selecciona un club" |
| Inviting someone already in this club | `409` "Ya es socio de este club" |
| Accepting an invitation while signed in as another email | `403` "Esta invitación es para otro correo" |

**Testing.**
- Unit: membership resolution in `authMiddleware` (member, not a member, unknown club, suspended,
  missing header with one or several memberships); invitation and QR services on the
  existing-account path; per-club storage keys and the one-time draft migration (vitest).
- Isolation suite (`npm run test:isolation`, against the real database), new cases: a person in
  clubs A and B sees only A's data with `X-Club: A`; the same person cannot use club C; A's admin
  cannot list or change B's memberships; A's user list does not include people only in B.
- E2E (Playwright): login at `/el-montanista`; "Mis clubes" with two clubs; "Cambiar de club";
  the not-a-member screen; joining with an existing account by invitation and by QR directo.

**Delivery: chained PRs, each deployable on its own.**
1. **Data:** `Membresia` model (added to `TENANT_MODELS`), migration and backfill, dual write on
   every path that creates a `User` or changes `User.rol`. Reads still use `User.organizationId`,
   and `User` stays tenant-scoped.
2. **Backend:** `User` moves to `GLOBAL_MODELS` together with the static guard, in the same PR
   where every in-club read switches to `Membresia` (moving it earlier would expose users of
   every club to the admin list); `authMiddleware` reads memberships and `X-Club`; login and
   `/me` return `clubes`; admin endpoints on memberships; password reset branding; CLI.
3. **Joining:** invitations, QR by email and QR directo with an existing account.
4. **Frontend:** path routing, `X-Club`, "Mis clubes", "Cambiar de club", not-a-member and
   club-not-found screens, per-club storage, join screens.
5. **Contract** (a later release): drop `User.organizationId` and `User.rol`.

Deployment stays manual over the VPN (see the open CI decision), using the same steps as
`.github/workflows/deploy.yml`, including `docker compose run --rm migrate`.

**Docs.** Update `README.md` ("Clubes (multi-tenant)"), the `alta-de-club` skill (the first
admin's email may already have an account) and the "La dirección web no decide…" passage of
`docs/de-pamir-a-riala.html`.

## Risks

| Risk | Mitigation |
|------|------------|
| A global `User` leaks people across clubs | All in-club reads through `Membresia`; static guard; new isolation cases |
| Rolling back after the expand migration | Old columns are kept until the contract release; dual write keeps them valid |
| A draft lost in the mountains during the storage change | One-time migration assigns the unkeyed draft to the current club |
| Old frontends without `X-Club` during rollout | Single-membership fallback; the backend ships before the frontend |
| A slug colliding with a static path | Reserved-slug list extended |

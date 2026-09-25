# Multi-Club Membership — PR 4a: Frontend Routing, X-Club, Storage Keying + Backend Contract Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Split note:** Delivery step 4 ("Frontend") is too large for one reviewable PR, so it is split into two independently deployable plans. **This plan (4a)** ships the backend contract additions the frontend needs, plus the frontend's core plumbing: path-based club resolution, the `X-Club` header, per-club browser storage, and the full routing table from Design §3 (including a working — not yet polished — "Mis clubes" list and the not-a-member/club-not-found/suspended screens). **Plan 4b** (`docs/superpowers/plans/2026-09-24-multi-club-04b-join-screens.md`) builds on 4a to add the "Cambiar de club" entry point, polishes "Mis clubes", updates the invitation/QR-directo join screens for an existing account, and does the docs + remaining E2E pass. 4a is deployable and correct on its own: single-membership accounts get a transparent path redirect, multi-membership accounts get a working (plain) club picker, and every row of the Design §3 routing table already resolves correctly — 4b only adds UX polish and the join-screen affordances on top.

**Goal:** `riala.cl/<slug>` resolves the active club from the URL path, the API client sends `X-Club` on every authenticated request, browser storage keys by club, and the four routing-table outcomes (redirect, "Mis clubes", the app, not-a-member/club-not-found/suspended) all render correctly — while every backend contract this needs (`clubes[].suspendido`, slug-carrying invite/QR links, `consultarInvitacion`'s `cuentaExistente`, the three new reserved slugs) ships alongside it.

**Architecture:** The backend half is four small, independent additions to the already-shipped multi-club contracts (PR 1–3): a derived `suspendido` boolean on each of the caller's own `clubes` entries (no new column — computed from `Organization.status`, exactly like `isOrganizationSuspended` already does for the active club), a `cuentaExistente` boolean on `consultarInvitacion` (reusing PR 3's `findAccountForOwnershipProof`, zero new repo methods), a `organizationSlug` field threaded through `InvitacionesDeps`/`CodigosQrDeps` so the five invite/QR link-building call sites can emit `/<slug>#invite=<token>` instead of `/#invite=<token>`, and three new reserved slugs. The frontend half makes `window.location.pathname`'s first segment the single source of truth for "which club": `lib/club-path.ts` parses it, `api.ts`'s `authHeaders()` attaches it as `X-Club` to every authenticated call (the single integration point that fixes ~40 call sites at once), `lib/storage.ts`'s three per-club keys get slug-suffixed with a one-time migration of the old unkeyed draft, and `App.tsx` gains a routing layer above today's state machine that reconciles the path's club against `user.organization`/`user.clubes` (both already returned by login/`/me` since PR 2, just not yet typed or read on the frontend) and renders the redirect/picker/not-a-member/club-not-found/suspended outcomes. `useAuth`'s existing mount-time `fetchMe()` becomes the mechanism that "activates" a path's club (it already re-runs on every mount and will now carry the right `X-Club`); it grows one new piece of state, `clubAccessError`, to surface a 403/404 it currently swallows silently, but only when a path slug is in play (a network hiccup with no path slug must stay silent, exactly as it behaves today).

**Tech Stack:** React 19 + Vite + Tailwind CSS + TypeScript (frontend), Express 5 + Prisma 7 + PostgreSQL/Neon (backend), Vitest for frontend unit tests, Playwright for frontend E2E (mocked backend via `page.route` — the E2E `webServer` only starts `npm run dev` for the frontend; no real backend process runs during `npm run test:e2e`, so every E2E scenario in this plan is achievable through mocking alone), `node:test` via `tsx` for backend unit tests, `npm run test:isolation` (real Neon `dev` branch) for backend end-to-end checks.

**Spec:** `docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` (Design §3 "Frontend" — path selection, routing table, `X-Club`, per-club storage; §4 "Security, errors, testing" error table; Delivery step 4 "Frontend"). Builds on `docs/superpowers/plans/2026-09-24-multi-club-03-joining.md` (PR 3, deployed at `b1548fa`), whose `AuthProof`/Bearer-token ownership-proof plumbing plan 4b's join screens will use.

## Global Constraints

- **No behavior change for a single-membership account that never touches a `/<slug>` URL.** `riala.cl` with no path slug and exactly one membership keeps working exactly as today (backend's existing single-membership `X-Club`-absent fallback, `authMiddleware`) — this plan adds a *transparent* redirect to `/<slug>` for that case, never a behavior change to what data loads.
- **`X-Club` is derived from the URL path, never stored, never sent by anything other than `authHeaders()`.** No component reads or writes an `X-Club`-shaped value directly; `lib/api.ts` is the single integration point.
- **`clubes[].suspendido` is computed only for the caller's own memberships, in `login`/`getMe`, from `Organization.status` already loaded by the existing `Membresia` query — no new column, no new query.** It must never appear on `OrganizationBrand`/`PublicOrganizationBrand` (used for other clubs' public branding, e.g. `fetchMarcaClub`, `consultarInvitacion`) — leaking a club's suspension state to a non-member is out of scope and the serializer (`lib/serializers/organization.ts`) is not touched by this plan.
- **The legacy invite/QR link format (`https://riala.cl/#invite=<token>`, no slug, already sitting in inboxes) keeps working unchanged.** `App.tsx`'s hash parsing (`parseInviteToken`/`parseQrToken`) reads `window.location.hash` independently of the path; this plan adds a path segment to *newly minted* links (backend) and adds path-aware branding/routing around the *existing* hash-token flow (frontend) — it never requires a slug for the hash-token flow to work.
- **Legacy `?club=<slug>` bare-domain links redirect to `/<slug>` via `history.replaceState`, never a hard navigation** — no request is lost, no flash of the wrong branding beyond what already happens today while `fetchMarcaClub` resolves.
- **Reserved slugs (`backend/src/scripts/tenant-args.ts`) grow to include `assets`, `auth`, `brand`, verified against every slug already in code, fixtures, and production (`riala`, `el-montanista` — neither collides).** `tenant:create`/`tenant:update` reject any of the eight reserved slugs (five existing + three new) exactly as they already reject the existing five.
- **`consultarInvitacion`'s new `cuentaExistente` field is invitee-facing only.** It is added to `ConsultarInvitacionBody` (the public, unauthenticated response the invitee's own browser reads) and never to any admin-facing invitation view (`ListarInvitacionesResponse`, `Invitacion`) — the inviting admin still never learns whether an invited email has an account (PR 3's enumeration-safety guarantee is unchanged; this field only informs the *invitee*, about *their own* email, which they already know).
- Code comments in Spanish, matching the surrounding file; this plan document is in English. Conventional commits, no `Co-Authored-By` or AI attribution.
- Single backend replica (rate limiting is in-memory) — nothing in this plan changes that.
- `runAsPlatform`/`runWithOrganization` usage follows the exact same rules as PR 1–3: any new platform-wide read (e.g. resolving an org's slug for a link) is wrapped in `runAsPlatform` inside the repo/service layer, never by a controller ad hoc.
- Local dev DB is the Neon `dev` branch (`db:guard` enforces it). Backend tests: `node:test` via `tsx` for unit tests; `npm run test:isolation` (real DB) for end-to-end flows. Frontend tests: `npm run test` (Vitest, `src/**/*.test.ts`) for unit/component tests; `npm run test:e2e` (Playwright, mocked backend) for E2E.
- Frontend UI copy in Spanish (neutral register), mobile-first, matching existing components (`ui/Button`, `ui/Card`, `ClubLogo`, the `alpine-canvas`/`surface-container` Tailwind tokens already used throughout `AuthPage.tsx`/`QrInvitacionPage.tsx`).
- No Prisma migration in this plan: `suspendido` is derived from the already-existing `Organization.status` column, and every other change is either a pure TypeScript constant (reserved slugs), a computed string (link URLs), or frontend-only.

## Rulings

- **Ruling 1: the mount-time `fetchMe()` in `useAuth.ts` is the mechanism that "activates" a path's club — no new API call is introduced.** `fetchMe()` already re-runs unconditionally on every mount when a saved session exists (`useAuth.ts:56-65`); once `api.ts`'s `authHeaders()` (Task 6) attaches `X-Club` from the current path, that same call now asks the backend to resolve `req.user` against *this* path's club and returns `user.organization` matching it on success. The only gap is that its `.catch(() => {})` today swallows every failure identically (network hiccup, expired token, wrong club) — Task 9 makes it distinguish "the backend told us we can't be in this club" (403/404, only when a path slug is present) from everything else, and surfaces the former as `clubAccessError` instead of silently keeping stale data. A network hiccup with no path slug must keep behaving exactly as it does today (silent, stale data kept) — this ruling narrows the new surfacing to the one case that needs it.
- **Ruling 2: at bare-domain root (no path slug) with 2+ memberships, the app never calls an endpoint that requires `X-Club` before the person picks a club.** `authMiddleware` 400s ("Selecciona un club") any authenticated call with 2+ memberships and no `X-Club`. `loadAuth()` already returns the previously-stored `user.clubes` synchronously (from a prior login/`/me`, both of which have returned `clubes` since PR 2 — the frontend simply never typed or read the field until now), so the bare-domain "Mis clubes" branch renders from that stored array without waiting on any network call. `useAuth`'s mount-time `fetchMe()` is skipped in exactly this one case (no path slug, stored `clubes.length > 1`) to avoid a guaranteed, wasted 400 — every other case (path slug present, or 0/1 stored memberships) calls it exactly as today.
- **Ruling 3: a stale stored session with an unknown/missing `clubes` (a `pamir_auth` saved before this PR, or the very first paint before the mount effect resolves) renders the existing `Spinner`, never a guess.** `user.clubes === undefined` is treated the same as `isLoading` — the app does not decide between "redirect" and "show the picker" without knowing the membership count, and it does not flash one and then replace it with the other.
- **Ruling 4: "Mis clubes" in this plan is a real, working component, not a placeholder — its visual polish and its entry point from inside the app ("Cambiar de club") are deferred to 4b.** It is reachable in 4a only as the render target of the bare-domain-multi-membership branch (not yet as a menu item reachable from inside the app); 4b adds the header entry point and the suspended-badge/logo polish on top of the same component and props shape, so no props are renamed between the two plans.
- **Ruling 5: the not-a-member/club-not-found/suspended screens read the error text the backend already returns verbatim, never a hardcoded frontend string, for the 403/404 body.** The three cases share one status/message shape (`{status: 403 | 404; message: string}`) coming straight from `authMiddleware`'s existing responses ("No perteneces a este club", "Club no encontrado", `CLUB_SUSPENDIDO_MENSAJE`) — this avoids the frontend's copy silently drifting from the backend's, and matches how the codebase already trusts backend error text elsewhere (e.g. `AuthPage`'s invitation-error display, `e2e/invitaciones.spec.ts`'s exact-text assertions).
- **Ruling 6: link-slug threading uses a new `organizationSlug: string` field on `InvitacionesDeps`/`CodigosQrDeps`, populated once where each deps object is already built from a loaded `Organization` row — never a new query at the URL-building call site.** `buildDeps(organization)` in both controllers and `crearInvitacionAdmin` in `scripts/tenant.ts` already hold the full `Organization`/`OrganizationSummary` row (which has `.slug`) when they construct deps; `solicitarInvitacionQr` already resolves the org via `verificarVigenciaQr` → `deps.getOrganizationPublic` → `vigencia.org.brand.slug`, so it needs no new field at all. `buildPublicDeps()` (used only by `consultarInvitacion`/`aceptarInvitacion`/`consultarCodigoQr`/`registrarConQrDirecto`, none of which build a link) never needs the field.

## Review Focus

1. **A multi-membership account hitting `riala.cl` (no slug) must never see a 400 "Selecciona un club" screen with no explanation.** The spec's routing table promises "Mis clubes"; a naive implementation that calls `/me` unconditionally on every mount (today's code) would 400 and silently keep stale data instead. Pinned by Ruling 2 and Task 10's routing tests.
2. **A path slug for a club the account is *not* a member of must show "No perteneces a este club", never the previous session's dashboard.** Without Task 9's `clubAccessError` surfacing, `fetchMe()`'s 403 is swallowed and the stale stored `user` (pointing at a *different* club) would render the dashboard while every subsequent API call silently sends the *new* path's `X-Club` — a data-mismatch bug, not just a UX gap. Pinned by Task 9 and Task 10's mismatch tests.
3. **An unknown slug at any depth (`riala.cl/no-existe`) must show "Club no encontrado", distinguished from "not a member" by status code (404 vs 403), using the backend's own message.** Pinned by Task 10.
4. **A draft in progress in one club must never bleed into another club's storage, and the one-time migration of an old unkeyed draft must assign it to the *current* club exactly once — not re-run on every load.** Pinned by Task 7's migration idempotency test.
5. **A legacy `?club=<slug>` bare-domain link must redirect before any component reads the old (now-absent) query param, and must never loop or redirect a `/<slug>` URL that already has a path segment.** Pinned by Task 5/Task 10's redirect tests.

---

## File Structure

| File | Responsibility | Task |
|------|-----------------|------|
| `backend/src/controllers/auth.controller.ts` | `login`/`getMe`: `clubes[]` entries gain `suspendido` | 1 |
| `backend/src/scripts/test-isolation.ts` | Extend `runClubesFieldChecks`; new suspended-club-in-clubes check; new reserved-slug checks; new link-slug checks; new `cuentaExistente` checks | 1, 2, 3, 4 |
| `backend/src/scripts/tenant-args.ts` | `SLUGS_RESERVADOS` grows to 8 entries | 2 |
| `backend/src/scripts/tenant-args.test.ts` | New cases for the 3 new reserved slugs | 2 |
| `backend/src/services/invitaciones.service.ts` | `InvitacionesDeps.organizationSlug`; `crearInvitacion`/`reenviarInvitacion`/`crearInvitacionPlataforma` build `/<slug>#invite=<token>`; `consultarInvitacion` gains `cuentaExistente` | 3, 4 |
| `backend/src/services/invitaciones.service.test.ts` | New unit tests for the slug-carrying link and `cuentaExistente` | 3, 4 |
| `backend/src/services/codigos-qr.service.ts` | `CodigosQrDeps.organizationSlug`; `crearCodigoQr`/`verCodigoQr` build `/<slug>#qr=<token>`; `solicitarInvitacionQr` builds `/<slug>#invite=<token>` from `vigencia.org.brand.slug` (no new field) | 3 |
| `backend/src/services/codigos-qr.service.test.ts` | New unit tests for the slug-carrying links | 3 |
| `backend/src/controllers/invitaciones.controller.ts` | `buildDeps` passes `organizationSlug: organization.slug` | 3 |
| `backend/src/controllers/codigos-qr.controller.ts` | `buildDeps` passes `organizationSlug: organization.slug` | 3 |
| `backend/src/scripts/tenant.ts` | `crearInvitacionAdmin`'s inline deps gain `organizationSlug: organization.slug` | 3 |
| `frontend/src/lib/club-path.ts` | New: `clubSlugFromPath`, `redirectLegacyClubQueryParam` | 5 |
| `frontend/src/lib/club-path.test.ts` | New: unit tests | 5 |
| `frontend/src/lib/api.ts` | `authHeaders()` attaches `X-Club` | 6 |
| `frontend/src/lib/storage.ts` | `pamir_draft`/`pamir_draft_step`/`pamir_integrantes` keyed per club; one-time migration | 7 |
| `frontend/src/lib/storage.test.ts` | New per-club-key and migration tests | 7 |
| `frontend/src/types/salida.ts` | `User.clubes: ClubMembership[]`; new `ClubMembership` type | 8 |
| `frontend/src/types/invitacion.ts` | `ConsultarInvitacionResponse.cuentaExistente` | 8 |
| `frontend/src/hooks/useAuth.ts` | New `clubAccessError` state; mount-effect gains Ruling 1/2 logic | 9 |
| `frontend/src/components/MisClubesPage.tsx` | New: plain, working club picker (4a scope — polish deferred to 4b) | 10 |
| `frontend/src/components/ClubAccessErrorPage.tsx` | New: shared not-a-member/club-not-found/suspended screen | 10 |
| `frontend/src/App.tsx` | Routing layer: legacy redirect, path/club reconciliation, renders the two new screens | 10 |
| `frontend/src/components/AuthPage.tsx` | Pre-login branding prefers the path slug over `clubPreferido()` | 11 |
| `frontend/e2e/multi-club-routing.spec.ts` | New: E2E for the routing table subset owned by this plan | 12 |

---

### Task 1: `clubes[].suspendido`

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts` (`login` lines 116-136, `getMe` lines 148-170)
- Modify: `backend/src/scripts/test-isolation.ts` (`runClubesFieldChecks`, lines 2580-2608)

**Interfaces:**
- Consumes: `isOrganizationSuspended` (`lib/organization-status.ts`, already exported), `toPublicOrganizationBrand` (`lib/serializers/organization.ts`, unchanged — `suspendido` is computed alongside it, not inside it)
- Produces (consumed by Task 8's frontend type, and by plan 4b's "Mis clubes"):
  - Each entry of `login`'s and `getMe`'s response `user.clubes[]` gains `suspendido: boolean`, alongside the existing `slug`/`name`/`shortName`/`hasLogo`/`logoVersion`/`rol`.

- [ ] **Step 1: Write the failing isolation check for `suspendido` in `clubes`**

In `backend/src/scripts/test-isolation.ts`, extend `runClubesFieldChecks` (replace the body of the first `check(...)` call, lines 2587-2608):

```ts
  await check(
    'GET /api/me devuelve clubes con TODAS las membresías de la cuenta (slug/name/shortName/hasLogo/logoVersion/rol/suspendido), no solo la activa',
    async () => {
      const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
      assert.equal(res.status, 200);
      const body = res.body as {
        user: {
          clubes?: {
            slug: string;
            name: string;
            shortName: string | null;
            hasLogo: boolean;
            logoVersion: string | null;
            rol: string;
            suspendido: boolean;
          }[];
        };
      };
      const clubes = body.user.clubes;
      assert.ok(clubes);
      assert.equal(clubes!.length, 2);
      assert.deepEqual(
        Object.keys(clubes![0]!).sort(),
        ['hasLogo', 'logoVersion', 'name', 'rol', 'shortName', 'slug', 'suspendido'],
      );
      const porSlug = Object.fromEntries(clubes!.map((c) => [c.slug, c]));
      // LIDER y no SOCIO: runRoleChangeMembresiaChecks ya promovió a este
      // mismo socio a LIDER en A antes de este punto de la suite (ver el
      // comentario equivalente en runAuthMembershipChecks, más arriba).
      assert.equal(porSlug[SLUG_A]?.rol, 'LIDER');
      assert.equal(porSlug[SLUG_B]?.rol, 'ADMIN');
      // Ninguno de los dos clubes está suspendido en este punto de la suite.
      assert.equal(porSlug[SLUG_A]?.suspendido, false);
      assert.equal(porSlug[SLUG_B]?.suspendido, false);
    },
  );

  await check(
    'clubes[] marca suspendido:true para un club suspendido, sin bloquear la respuesta (aunque X-Club apunte a OTRO club, activo)',
    async () => {
      await runAsPlatform(() =>
        prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }),
      );
      try {
        const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
        assert.equal(res.status, 200);
        const body = res.body as { user: { clubes?: { slug: string; suspendido: boolean }[] } };
        const porSlug = Object.fromEntries((body.user.clubes ?? []).map((c) => [c.slug, c]));
        assert.equal(porSlug[SLUG_A]?.suspendido, false);
        assert.equal(porSlug[SLUG_B]?.suspendido, true);
      } finally {
        await runAsPlatform(() =>
          prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }),
        );
      }
    },
  );
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd backend
npm run test:isolation
```

Expected: the two `clubes[]` checks above fail — the first on the `deepEqual` key list (missing `'suspendido'`), the second because `porSlug[SLUG_B]?.suspendido` is `undefined`, not `true`.

- [ ] **Step 3: Add `suspendido` in `login`**

In `backend/src/controllers/auth.controller.ts`, replace the `clubes` block inside `login` (lines 116-122):

```ts
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: user.id },
        orderBy: { creadoAt: 'asc' },
        select: { rol: true, organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true } } },
      }),
    ).then((rows) => rows.map((m) => ({ ...toPublicOrganizationBrand(m.organization), rol: m.rol })));
```

with:

```ts
    // suspendido se calcula acá, NUNCA dentro de toPublicOrganizationBrand
    // (esa función también arma la marca pública de OTROS clubes — p.ej.
    // fetchMarcaClub, consultarInvitacion — donde filtrar por suspensión
    // filtraría datos de un club que no es el propio): solo tiene sentido
    // para las propias membresías de quien inicia sesión.
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: user.id },
        orderBy: { creadoAt: 'asc' },
        select: {
          rol: true,
          organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true } },
        },
      }),
    ).then((rows) =>
      rows.map((m) => ({
        ...toPublicOrganizationBrand(m.organization),
        rol: m.rol,
        suspendido: isOrganizationSuspended(m.organization.status),
      })),
    );
```

- [ ] **Step 4: Add `suspendido` in `getMe`**

In `backend/src/controllers/auth.controller.ts`, replace the `clubes` block inside `getMe` (lines 155-161):

```ts
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: id },
        orderBy: { creadoAt: 'asc' },
        select: { rol: true, organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true } } },
      }),
    ).then((rows) => rows.map((m) => ({ ...toPublicOrganizationBrand(m.organization), rol: m.rol })));
```

with:

```ts
    // Mismo criterio que login: ver el comentario ahí.
    const clubes = await runAsPlatform(() =>
      prisma.membresia.findMany({
        where: { usuarioId: id },
        orderBy: { creadoAt: 'asc' },
        select: {
          rol: true,
          organization: { select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true } },
        },
      }),
    ).then((rows) =>
      rows.map((m) => ({
        ...toPublicOrganizationBrand(m.organization),
        rol: m.rol,
        suspendido: isOrganizationSuspended(m.organization.status),
      })),
    );
```

`isOrganizationSuspended` is already imported in this file (line 14) — no new import needed.

- [ ] **Step 5: Run and confirm PASS**

```bash
cd backend
npm run test:isolation
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(clubs): mark suspended clubs in the caller's own clubes list"
```

---

### Task 2: Reserved slugs — `assets`, `auth`, `brand`

**Files:**
- Modify: `backend/src/scripts/tenant-args.ts` (`SLUGS_RESERVADOS`, line 19)
- Modify: `backend/src/scripts/tenant-args.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `SLUGS_RESERVADOS` (unexported, internal to `tenant-args.ts`) grows from 6 to 8 entries; `validarSlug` (already exported behavior via `parseTenantArgs`) rejects the 3 new slugs with the same error shape as the existing ones.

- [ ] **Step 1: Confirm no collision with production or fixtures (read-only check, not a diff)**

```bash
cd backend
grep -rn "slug:.*'assets'\|slug:.*\"assets\"\|slug:.*'auth'\|slug:.*\"auth\"\|slug:.*'brand'\|slug:.*\"brand\"" src/ prisma/
```

Expected: no matches. Production has only `riala` and `el-montanista` (confirmed by the task brief); neither collides with `assets`/`auth`/`brand`.

- [ ] **Step 2: Write the failing tests**

In `backend/src/scripts/tenant-args.test.ts`, find the existing `describe` block that covers reserved slugs (search for `'está reservado y no puede usarse'` or similar — mirror its exact assertion shape) and add, in the same `describe`:

```ts
  it('rechaza "assets" como slug reservado (create)', () => {
    const result = parseTenantArgs([
      'create',
      '--slug', 'assets',
      '--name', 'Club de Prueba',
      '--membresia', 'SOCIO_ANDINO_PAMIR',
      '--alert-email', 'alertas@example.com',
      '--contact-name', 'Contacto',
      '--contact-email', 'contacto@example.com',
      '--admin-email', 'admin@example.com',
    ]);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.errors.join('\n'), /reservado/);
  });

  it('rechaza "auth" como slug reservado (create)', () => {
    const result = parseTenantArgs([
      'create',
      '--slug', 'auth',
      '--name', 'Club de Prueba',
      '--membresia', 'SOCIO_ANDINO_PAMIR',
      '--alert-email', 'alertas@example.com',
      '--contact-name', 'Contacto',
      '--contact-email', 'contacto@example.com',
      '--admin-email', 'admin@example.com',
    ]);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.errors.join('\n'), /reservado/);
  });

  it('rechaza "brand" como slug reservado (suspend, que solo valida --slug)', () => {
    const result = parseTenantArgs(['suspend', '--slug', 'brand']);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.errors.join('\n'), /reservado/);
  });
```

Add `import assert from 'node:assert/strict';` and `import { parseTenantArgs } from './tenant-args.js';` if not already present at the top of the file (check first — `tenant-args.test.ts` already exercises `parseTenantArgs` for the existing reserved slugs, so both imports are already there).

- [ ] **Step 3: Run and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/scripts/tenant-args.test.ts
```

Expected: all three new tests fail — `result.success` is `true` (the slug is currently accepted).

- [ ] **Step 4: Add the three reserved slugs**

In `backend/src/scripts/tenant-args.ts`, replace line 19:

```ts
const SLUGS_RESERVADOS = ['platform', 'plataforma', 'admin', 'api', 'www', 'app', 'riala'];
```

with:

```ts
// assets/auth/brand: rutas estáticas reservadas del frontend multi-club (ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3) — un
// club con uno de estos slugs colisionaría con una ruta de nivel superior que
// el SPA podría necesitar en el futuro, aunque nginx no la reserve hoy con su
// propio location block (a diferencia de /api y /assets, que sí lo tienen —
// ver frontend/nginx/default.conf).
const SLUGS_RESERVADOS = ['platform', 'plataforma', 'admin', 'api', 'www', 'app', 'riala', 'assets', 'auth', 'brand'];
```

- [ ] **Step 5: Run and confirm PASS**

```bash
cd backend
node --import tsx --test src/scripts/tenant-args.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/tenant-args.ts backend/src/scripts/tenant-args.test.ts
git commit -m "feat(clubs): reserve assets/auth/brand slugs for the multi-club frontend"
```

---

### Task 3: Invite/QR links carry the club slug

**Files:**
- Modify: `backend/src/services/invitaciones.service.ts` (`InvitacionesDeps` interface, `crearInvitacion` line 364, `reenviarInvitacion` line ~500, `crearInvitacionPlataforma` line 756)
- Modify: `backend/src/services/invitaciones.service.test.ts`
- Modify: `backend/src/services/codigos-qr.service.ts` (`CodigosQrDeps` interface, `crearCodigoQr` line 339, `verCodigoQr` line 455, `solicitarInvitacionQr` line 651)
- Modify: `backend/src/services/codigos-qr.service.test.ts`
- Modify: `backend/src/controllers/invitaciones.controller.ts` (`buildDeps`, lines 31-52)
- Modify: `backend/src/controllers/codigos-qr.controller.ts` (`buildDeps`, lines 34-62)
- Modify: `backend/src/scripts/tenant.ts` (`crearInvitacionAdmin`, lines 52-76)

**Interfaces:**
- Consumes: nothing new for `solicitarInvitacionQr` (uses `vigencia.org.brand.slug`, already resolved by the existing `verificarVigenciaQr` call)
- Produces (consumed by Task 4 and by plan 4b's join screens, which read the slug out of the URL they already navigate to):
  - `InvitacionesDeps.organizationSlug: string` (new required field)
  - `CodigosQrDeps.organizationSlug: string` (new required field)
  - Every invite/QR link built by an authenticated flow becomes `${deps.frontendUrl}/${deps.organizationSlug}/#invite=${token}` / `/#qr=${token}` (path segment + fragment); `solicitarInvitacionQr`'s link becomes `${deps.frontendUrl}/${vigencia.org.brand.slug}/#invite=${inviteToken}`.

- [ ] **Step 1: Write the failing unit test for `crearInvitacion`'s link**

In `backend/src/services/invitaciones.service.test.ts`, find the existing fake `InvitacionesDeps` builder used by the `crearInvitacion` tests (it already has `repo`/`sendEmail`/`hashPassword`/`comparePassword`/`now`/`frontendUrl` — search for the literal object, likely a `buildDeps`-style helper near the top of the file) and add `organizationSlug: 'el-montanista'` to it. Then add:

```ts
it('crearInvitacion arma inviteUrl con el slug del club antes del fragmento', async () => {
  const deps = buildFakeDeps({ organizationSlug: 'el-montanista' });
  const result = await crearInvitacion(deps, ADMIN_REQUESTER, { email: 'nueva@example.com' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.body.inviteUrl, /^https:\/\/iso-test\.local\/el-montanista\/#invite=/);
});
```

(Use the file's actual fake-deps helper name/signature and its actual `ADMIN_REQUESTER`/frontend-URL constant — match whatever the file already uses for its other `crearInvitacion` tests; the exact helper name is visible once the file is open, but the shape above — one new field on the deps object, one new assertion on `inviteUrl`'s prefix — is what every existing `crearInvitacion` test in this file needs.)

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: a TypeScript error (missing `organizationSlug` on the deps object) until Step 4 adds the field, then — once the field exists but is unused — the new assertion fails because `inviteUrl` still starts with `https://iso-test.local/#invite=`.

- [ ] **Step 3: Mirror the failing test for `reenviarInvitacion`, `crearInvitacionPlataforma`, and the QR equivalents**

Add analogous one-line assertions (`assert.match(result.body.inviteUrl, /^https:\/\/iso-test\.local\/el-montanista\/#invite=/)` or `/qrUrl/.../#qr=/`) to the existing `reenviarInvitacion` and `crearInvitacionPlataforma` tests in `invitaciones.service.test.ts`, and to the existing `crearCodigoQr`/`verCodigoQr`/`solicitarInvitacionQr` tests in `codigos-qr.service.test.ts` (same fake-deps `organizationSlug` addition there).

- [ ] **Step 4: Add `organizationSlug` to `InvitacionesDeps` and use it in the three call sites**

In `backend/src/services/invitaciones.service.ts`, extend `InvitacionesDeps` (after the existing `frontendUrl: string;` field, inside the interface — search for it, it is a sibling of `hashPassword`/`comparePassword`):

```ts
  frontendUrl: string;
  // Slug del club de esta request — SIEMPRE el propio club de quien invita
  // (buildDeps ya construye estas deps por request, a partir de
  // req.user!.organization, que ya trae slug). Nunca se resuelve con una
  // consulta nueva en el punto de armar el link (ver Ruling 6 del plan de
  // esta PR).
  organizationSlug: string;
```

Replace the three link-building lines:

Line 364 (`crearInvitacion`):
```ts
  const inviteUrl = `${deps.frontendUrl}/#invite=${token}`;
```
becomes:
```ts
  // Segmento del club ANTES del fragmento (#): nginx sirve index.html para
  // cualquier path (SPA fallback), así que /<slug>/#invite=<token> llega
  // intacto al frontend — ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
  const inviteUrl = `${deps.frontendUrl}/${deps.organizationSlug}/#invite=${token}`;
```

Line ~500 (`reenviarInvitacion`) and line 756 (`crearInvitacionPlataforma`): same replacement, same comment.

- [ ] **Step 5: Wire `organizationSlug` in `invitaciones.controller.ts`'s `buildDeps`**

In `backend/src/controllers/invitaciones.controller.ts`, in `buildDeps` (after `frontendUrl: FRONTEND_URL,`, inside the returned object):

```ts
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
    organizationSlug: organization.slug,
  };
```

`buildPublicDeps()` (used only for `consultarInvitacion`/`aceptarInvitacion`, which never build a link) does NOT get this field — but `InvitacionesDeps` now requires it, so TypeScript will fail to compile `buildPublicDeps()`'s return until it is added there too. Add a clearly-marked never-used placeholder:

```ts
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
    // Nunca se usa: ningún flujo público (consultarInvitacion, aceptarInvitacion)
    // arma un link — se cablea solo porque InvitacionesDeps lo exige.
    organizationSlug: '',
```

- [ ] **Step 6: Same wiring in `codigos-qr.controller.ts`'s `buildDeps`/`buildPublicDeps`**

In `backend/src/controllers/codigos-qr.controller.ts`, `buildDeps` gets `organizationSlug: organization.slug,`; `buildPublicDeps()` gets the same never-used `organizationSlug: '',` placeholder with the same comment (its callers — `consultarCodigoQr`, `registrarConQrDirecto` — never build a link either; `solicitarInvitacionQr` builds its own from `vigencia.org.brand.slug`, see Step 8).

- [ ] **Step 7: Same wiring in `scripts/tenant.ts`'s `crearInvitacionAdmin`**

In `backend/src/scripts/tenant.ts`, inside the `deps: InvitacionesDeps = { ... }` literal (lines 55-74), after `frontendUrl: FRONTEND_URL,`:

```ts
      now: () => new Date(),
      frontendUrl: FRONTEND_URL,
      organizationSlug: organization.slug,
    };
```

(`organization` is already loaded on the line above via `prisma.organization.findUniqueOrThrow`, so `.slug` is already in scope.)

- [ ] **Step 8: Add `organizationSlug` to `CodigosQrDeps`; update `crearCodigoQr`, `verCodigoQr`, `solicitarInvitacionQr`**

In `backend/src/services/codigos-qr.service.ts`, extend `CodigosQrDeps` the same way as Step 4 (after its `frontendUrl: string;` field):

```ts
  frontendUrl: string;
  // Mismo criterio que InvitacionesDeps.organizationSlug.
  organizationSlug: string;
```

Line 339 (`crearCodigoQr`) and line 455 (`verCodigoQr`): replace
```ts
const qrUrl = `${deps.frontendUrl}/#qr=${token}`;
```
with
```ts
const qrUrl = `${deps.frontendUrl}/${deps.organizationSlug}/#qr=${token}`;
```
(and the inline `qrUrl:` field at line 455 gets the same change in place).

Line 651 (`solicitarInvitacionQr`) does NOT use `deps.organizationSlug` — it already has `vigencia.org.brand.slug` in scope (the QR's own club, resolved from the token, which may differ from any deps-level club). Replace:
```ts
const inviteUrl = `${deps.frontendUrl}/#invite=${inviteToken}`;
```
with:
```ts
// El slug es el del club DUEÑO DEL QR (vigencia.org), nunca deps.organizationSlug:
// solicitarInvitacionQr es pública y el QR puede pertenecer a un club distinto
// del de cualquier sesión — acá no hay ninguna.
const inviteUrl = `${deps.frontendUrl}/${vigencia.org.brand.slug}/#invite=${inviteToken}`;
```

- [ ] **Step 9: Run and confirm PASS**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts src/services/codigos-qr.service.test.ts
npx tsc --noEmit
```

Expected: all tests pass; `tsc` reports no errors (confirms every `InvitacionesDeps`/`CodigosQrDeps` literal in the codebase — including `test-isolation.ts`'s three inline deps objects from PR 3 — now supplies `organizationSlug`).

- [ ] **Step 10: Add `organizationSlug` to the three inline deps literals in `test-isolation.ts`**

If Step 9's `tsc` run flags `test-isolation.ts`, add `organizationSlug: seedA.slug` (or the relevant seed's slug) to each of the three `InvitacionesDeps`/`CodigosQrDeps` object literals introduced in PR 3 (`fakeInvitacionDeps`, `fakeInvitacionDepsCli`, `buildFakeCodigosQrDeps`) — mirroring the `comparePassword` addition PR 3 already made to the same three literals.

- [ ] **Step 11: Add one isolation check that the real HTTP response carries the slug**

In `backend/src/scripts/test-isolation.ts`, add to `runClubesFieldChecks` (or a nearby existing invitation-focused check function):

```ts
  await check('crearInvitacion (HTTP) devuelve inviteUrl con /<slug>/ antes del fragmento', async () => {
    const res = await postJsonWithClub(baseUrl, adminTokenA, '/api/invitaciones', SLUG_A, {
      email: `slug-link-${RANDOM_SUFFIX}@iso-test.local`,
    });
    assert.equal(res.status, 201);
    const body = res.body as { inviteUrl: string };
    assert.match(body.inviteUrl, new RegExp(`/${SLUG_A}/#invite=`));
  });
```

(Use whichever existing helper the file already has for an authenticated `POST` with `X-Club` — e.g. a `postJsonWithClub` sibling of `getJsonWithClub`; if none exists yet, model it on `getJsonWithClub`, lines 863-874, adding a `body: unknown` parameter and `method: 'POST'`.)

- [ ] **Step 12: Run the full isolation suite and confirm PASS**

```bash
cd backend
npm run test:isolation
```

- [ ] **Step 13: Commit**

```bash
git add backend/src/services/invitaciones.service.ts backend/src/services/invitaciones.service.test.ts \
        backend/src/services/codigos-qr.service.ts backend/src/services/codigos-qr.service.test.ts \
        backend/src/controllers/invitaciones.controller.ts backend/src/controllers/codigos-qr.controller.ts \
        backend/src/scripts/tenant.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(clubs): invitation and QR links carry the club slug in the path"
```

---

### Task 4: `consultarInvitacion` gains `cuentaExistente`

**Files:**
- Modify: `backend/src/services/invitaciones.service.ts` (`ConsultarInvitacionBody` interface and `consultarInvitacion`, lines 567-603)
- Modify: `backend/src/services/invitaciones.service.test.ts`

**Interfaces:**
- Consumes: `InvitacionesRepo.findAccountForOwnershipProof` (already exists, PR 3 Task 1)
- Produces (consumed by plan 4b's `AuthPage` accept-invite screen):
  - `ConsultarInvitacionBody.cuentaExistente: boolean`

- [ ] **Step 1: Write the failing unit test**

In `backend/src/services/invitaciones.service.test.ts`, find the existing `consultarInvitacion` test(s) and add:

```ts
it('consultarInvitacion informa cuentaExistente:true cuando el email invitado ya tiene cuenta', async () => {
  const deps = buildFakeDeps({
    repo: {
      ...fakeRepo,
      findAccountForOwnershipProof: async (email) =>
        email === 'existente@example.com' ? { id: 'user-1', email, passwordHash: 'hash' } : null,
    },
  });
  const result = await consultarInvitacion(deps, TOKEN_PARA_INVITACION_A('existente@example.com'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.cuentaExistente, true);
});

it('consultarInvitacion informa cuentaExistente:false cuando el email invitado no tiene cuenta', async () => {
  const deps = buildFakeDeps({
    repo: { ...fakeRepo, findAccountForOwnershipProof: async () => null },
  });
  const result = await consultarInvitacion(deps, TOKEN_PARA_INVITACION_A('nueva@example.com'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.cuentaExistente, false);
});
```

(Match the file's actual fake-repo/fake-deps helper names and however it already stubs a findable invitation by token — the two new tests only need one new repo stub, `findAccountForOwnershipProof`, layered on whatever pattern the file's existing `consultarInvitacion` tests already use to make `findByTokenHash` return a pending invitation.)

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts
```

Expected: both new tests fail — `result.body.cuentaExistente` is `undefined`.

- [ ] **Step 3: Add the field**

In `backend/src/services/invitaciones.service.ts`, extend `ConsultarInvitacionBody` (lines 567-575):

```ts
export interface ConsultarInvitacionBody {
  email: string;
  rol: RolUsuario;
  rolLabel: string;
  invitadoPor: string;
  organization: PublicOrganizationBrand | null;
  // true si el email invitado ya tiene una cuenta RIALA (en este club o en
  // otro). Solo se expone acá — la propia pantalla de quien SOSTIENE el
  // token, consultando SU PROPIO email — nunca en una vista de admin (ver
  // Global Constraints del plan de esta PR). Permite que la pantalla de
  // aceptar invitación (PR 4b) muestre "inicia sesión" en vez de "crea tu
  // cuenta" sin depender de que el correo lo haya dejado claro.
  cuentaExistente: boolean;
}
```

Replace the `consultarInvitacion` function body (lines 590-602):

```ts
  const organization = deps.getOrganizationBrand ? await deps.getOrganizationBrand(inv.organizationId) : null;

  return {
    ok: true,
    status: 200,
    body: {
      email: inv.email,
      rol: inv.rol,
      rolLabel: ROL_LABELS[inv.rol],
      invitadoPor: vigencia.inviter ? vigencia.inviter.name : PLATAFORMA_NOMBRE,
      organization,
    },
  };
```

with:

```ts
  const organization = deps.getOrganizationBrand ? await deps.getOrganizationBrand(inv.organizationId) : null;
  const existing = await deps.repo.findAccountForOwnershipProof(inv.email);

  return {
    ok: true,
    status: 200,
    body: {
      email: inv.email,
      rol: inv.rol,
      rolLabel: ROL_LABELS[inv.rol],
      invitadoPor: vigencia.inviter ? vigencia.inviter.name : PLATAFORMA_NOMBRE,
      organization,
      cuentaExistente: existing !== null,
    },
  };
```

- [ ] **Step 4: Run and confirm PASS**

```bash
cd backend
node --import tsx --test src/services/invitaciones.service.test.ts
```

- [ ] **Step 5: Add one isolation check**

In `backend/src/scripts/test-isolation.ts`, extend the existing `consultarInvitacion`-focused check (search for a check whose body calls `POST /api/auth/invitaciones/consultar`) to also assert on `cuentaExistente` for both a fresh email and an email with an existing account (the suite already creates existing accounts for other Joining checks — reuse one of those emails):

```ts
  await check('consultarInvitacion informa cuentaExistente según si el email invitado ya tiene cuenta', async () => {
    const nueva = await fetch(`${baseUrl}/api/auth/invitaciones/consultar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInvitacionEmailNuevo }),
    });
    const nuevaBody = (await nueva.json()) as { cuentaExistente: boolean };
    assert.equal(nuevaBody.cuentaExistente, false);

    const existente = await fetch(`${baseUrl}/api/auth/invitaciones/consultar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInvitacionEmailExistente }),
    });
    const existenteBody = (await existente.json()) as { cuentaExistente: boolean };
    assert.equal(existenteBody.cuentaExistente, true);
  });
```

(Reuse the suite's existing fixtures for `tokenInvitacionEmailNuevo`/`tokenInvitacionEmailExistente` — PR 3's Joining checks already mint invitations for both a fresh email and an existing account's email; wire this check into whichever function already runs after those fixtures exist.)

- [ ] **Step 6: Run the full isolation suite and confirm PASS**

```bash
cd backend
npm run test:isolation
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/invitaciones.service.ts backend/src/services/invitaciones.service.test.ts backend/src/scripts/test-isolation.ts
git commit -m "feat(invitations): consultarInvitacion reports whether the invited email already has an account"
```

---

### Task 5: `lib/club-path.ts`

**Files:**
- Create: `frontend/src/lib/club-path.ts`
- Create: `frontend/src/lib/club-path.test.ts`

**Interfaces:**
- Consumes: `SLUG_PATTERN` (`lib/club-brand.ts`, already exported)
- Produces (consumed by Tasks 6, 10, 11):
  - `clubSlugFromPath(pathname?: string): string | null`
  - `redirectLegacyClubQueryParam(params?: { search?: string; pathname?: string; replaceState?: (path: string) => void }): void`

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/src/lib/club-path.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { clubSlugFromPath, redirectLegacyClubQueryParam } from './club-path'

describe('clubSlugFromPath', () => {
  it('extrae el primer segmento de un path de club', () => {
    expect(clubSlugFromPath('/el-montanista')).toBe('el-montanista')
  })

  it('extrae el primer segmento aunque haya más path después', () => {
    expect(clubSlugFromPath('/el-montanista/lo-que-sea')).toBe('el-montanista')
  })

  it('devuelve null para la raíz', () => {
    expect(clubSlugFromPath('/')).toBeNull()
  })

  it('devuelve null para un path vacío', () => {
    expect(clubSlugFromPath('')).toBeNull()
  })

  it('devuelve null para un segmento que no cumple el patrón de slug', () => {
    expect(clubSlugFromPath('/Con Mayusculas Y Espacios')).toBeNull()
  })

  it('acepta guiones simples en minúsculas', () => {
    expect(clubSlugFromPath('/club-de-prueba-2')).toBe('club-de-prueba-2')
  })
})

describe('redirectLegacyClubQueryParam', () => {
  it('reescribe ?club=<slug> a /<slug> cuando no hay slug en el path', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=el-montanista', pathname: '/', replaceState })
    expect(replaceState).toHaveBeenCalledWith('/el-montanista')
  })

  it('no hace nada si ya hay un slug en el path', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=el-montanista', pathname: '/riala', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('no hace nada sin ?club= en la URL', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '', pathname: '/', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('no hace nada si el valor de ?club= no es un slug válido', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=../../etc', pathname: '/', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx vitest run src/lib/club-path.test.ts
```

Expected: fails to resolve `./club-path` — the module doesn't exist yet.

- [ ] **Step 3: Write `club-path.ts`**

Create `frontend/src/lib/club-path.ts`:

```ts
// El primer segmento del path es el club (riala.cl/<slug>) — ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
// Separado de club-preferido.ts (que sigue gobernando SOLO la marca del login
// en la raíz sin sesión, vía ?club= o el club recordado): este archivo
// resuelve el club ACTIVO de la sesión, la fuente que api.ts usa para el
// header X-Club y que App.tsx usa para decidir qué pantalla mostrar.
import { SLUG_PATTERN } from './club-brand'

// pathname es inyectable (mismo criterio que storage.ts/club-preferido.ts,
// para poder probar esto sin window) y se resuelve DENTRO del try/catch,
// nunca en el valor por defecto del parámetro.
export function clubSlugFromPath(pathname?: string): string | null {
  try {
    const raw = pathname ?? window.location.pathname
    const first = raw.split('/').find((segment) => segment.length > 0)
    return first && SLUG_PATTERN.test(first) ? first : null
  } catch {
    return null
  }
}

interface RedirectLegacyClubQueryParamParams {
  search?: string
  pathname?: string
  replaceState?: (path: string) => void
}

// Enlaces viejos de la forma riala.cl/?club=<slug> (antes de esta fase, solo
// gobernaban el branding del login) pasan a redirigir a riala.cl/<slug> — sin
// perder ningún otro parámetro de la URL. Nunca toca una URL que YA trae un
// slug en el path: evita un loop y evita pisar /<slug>?club=<otro>, que no
// debería existir pero no se asume.
export function redirectLegacyClubQueryParam(params: RedirectLegacyClubQueryParamParams = {}): void {
  try {
    const search = params.search ?? window.location.search
    const pathname = params.pathname ?? window.location.pathname
    if (clubSlugFromPath(pathname)) return

    const query = new URLSearchParams(search)
    const raw = query.get('club')
    if (!raw || !SLUG_PATTERN.test(raw)) return

    query.delete('club')
    const rest = query.toString()
    const target = `/${raw}${rest ? `?${rest}` : ''}`
    const replaceState = params.replaceState ?? ((path: string) => window.history.replaceState(null, '', path))
    replaceState(target)
  } catch {
    // Sin window, o storage/URL bloqueados: la redirección de un link legacy
    // es solo una conveniencia, nunca debe romper el arranque de la app.
  }
}
```

- [ ] **Step 4: Run and confirm PASS**

```bash
cd frontend
npx vitest run src/lib/club-path.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/club-path.ts frontend/src/lib/club-path.test.ts
git commit -m "feat(clubs): parse the active club slug from the URL path"
```

---

### Task 6: `api.ts` sends `X-Club`

**Files:**
- Modify: `frontend/src/lib/api.ts` (`authHeaders`, lines 41-44)

**Interfaces:**
- Consumes: `clubSlugFromPath` (Task 5)
- Produces: every call through `authHeaders()` now includes `X-Club: <slug>` whenever `clubSlugFromPath()` resolves one; unchanged (no `X-Club`) at bare-domain root — matching the backend's existing single-membership fallback and Ruling 2's bare-domain-multi-membership skip.

- [ ] **Step 1: Update `authHeaders`**

In `frontend/src/lib/api.ts`, add the import (near the top, after the existing `getAuthToken` import):

```ts
import { getAuthToken } from './auth-token'
import { clubSlugFromPath } from './club-path'
```

Replace `authHeaders` (lines 41-44):

```ts
function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
```

with:

```ts
// Único punto de integración de X-Club: cada una de las ~40 llamadas
// autenticadas de este archivo pasa por acá, así que agregar el header acá
// alcanza para todas. Ausente en la raíz sin slug (riala.cl) — el backend ya
// sabe resolver ese caso con una sola membresía (ver authMiddleware) y
// App.tsx nunca deja que una cuenta con varias membresías llegue a llamar acá
// sin antes haber navegado a /<slug> (ver Ruling 2 del plan de esta PR).
function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const slug = clubSlugFromPath()
  if (slug) headers['X-Club'] = slug
  return headers
}
```

- [ ] **Step 2: Run the frontend build/typecheck**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(clubs): send X-Club derived from the URL path on every authenticated request"
```

---

### Task 7: Per-club browser storage

**Files:**
- Modify: `frontend/src/lib/storage.ts`
- Modify: `frontend/src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `clubSlugFromPath` (Task 5)
- Produces (consumed by `WizardLayout.tsx`/`RegistroIntegrante.tsx`, unchanged call sites — this task changes only the storage keys under the hood):
  - `saveDraft`/`loadDraft`/`saveDraftStep`/`loadDraftStep`/`clearDraft` keep their exact signatures, but the underlying key is `pamir_draft:<slug>`/`pamir_draft_step:<slug>` (or the unkeyed legacy key at bare domain, unchanged)
  - `saveIntegrante`/`loadIntegrantes`/`clearIntegrantesCache` same treatment for `pamir_integrantes:<slug>`
  - New: `migrateUnkeyedDraftToCurrentClub(storage?: Storage): void` — one-time migration, called once from `App.tsx` (Task 10)

- [ ] **Step 1: Write the failing tests**

In `frontend/src/lib/storage.test.ts`, add (after the existing imports, add `clubSlugFromPath` is NOT imported here — the test drives keying entirely through the `slug` parameter storage.ts's functions will accept, see Step 3):

```ts
describe('per-club draft/integrantes keys', () => {
  it('saveDraft/loadDraft usan una clave por club cuando se pasa un slug', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'A' }, storage, 'el-montanista')
    saveDraft({ nombreActividad: 'B' }, storage, 'riala')
    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'A' })
    expect(loadDraft(storage, 'riala')).toEqual({ nombreActividad: 'B' })
  })

  it('sin slug, usa la clave sin club de siempre (compatibilidad)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Sin club' }, storage)
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Sin club' })
  })

  it('clearDraft con slug no borra el draft de otro club', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'A' }, storage, 'el-montanista')
    saveDraft({ nombreActividad: 'B' }, storage, 'riala')
    clearDraft(storage, 'el-montanista')
    expect(loadDraft(storage, 'el-montanista')).toBeNull()
    expect(loadDraft(storage, 'riala')).toEqual({ nombreActividad: 'B' })
  })
})

describe('migrateUnkeyedDraftToCurrentClub', () => {
  it('mueve un draft SIN club (guardado antes de esta fase) a la clave del club actual', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Draft viejo' }, storage)
    saveDraftStep(2, storage)

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Draft viejo' })
    expect(loadDraftStep(storage, 'el-montanista')).toBe(2)
    expect(loadDraft(storage)).toBeNull()
  })

  it('no hace nada si no hay draft sin club', () => {
    const storage = createFakeStorage()
    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')
    expect(loadDraft(storage, 'el-montanista')).toBeNull()
  })

  it('no hace nada si ya existe un draft en la clave del club actual (nunca lo pisa)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Viejo sin club' }, storage)
    saveDraft({ nombreActividad: 'Ya en el club actual' }, storage, 'el-montanista')

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Ya en el club actual' })
    // El draft viejo sin club se conserva intacto: no se migró (destino
    // ocupado) y tampoco se borró (nadie pierde una ficha en curso).
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Viejo sin club' })
  })

  it('correr la migración dos veces es un no-op la segunda vez (idempotente)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Draft viejo' }, storage)

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')
    saveDraft({ nombreActividad: 'Nuevo draft sin club, después de migrar' }, storage)
    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    // La segunda corrida encuentra la clave del club actual YA ocupada (por
    // la primera migración) y no la pisa con el segundo draft sin club.
    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Draft viejo' })
  })
})
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx vitest run src/lib/storage.test.ts
```

Expected: fails to compile / `saveDraft`'s third argument, `migrateUnkeyedDraftToCurrentClub` do not exist yet.

- [ ] **Step 3: Key the draft/integrantes functions by an optional slug**

In `frontend/src/lib/storage.ts`, replace the `KEYS` constant (lines 8-14):

```ts
const KEYS = {
  AUTH: 'pamir_auth',
  DRAFT: 'pamir_draft',
  DRAFT_STEP: 'pamir_draft_step',
  INTEGRANTES: 'pamir_integrantes',
  OWNER: 'pamir_owner',
} as const
```

with:

```ts
const KEYS = {
  AUTH: 'pamir_auth',
  // DRAFT/DRAFT_STEP/INTEGRANTES son BASES: la clave real agrega ":<slug>"
  // cuando se pasa un club (ver draftKey/integrantesKey abajo). pamir_auth y
  // pamir_owner siguen siendo únicos por navegador, sin club — la sesión y su
  // dueño no son datos de un club, son datos de la persona.
  DRAFT: 'pamir_draft',
  DRAFT_STEP: 'pamir_draft_step',
  INTEGRANTES: 'pamir_integrantes',
  OWNER: 'pamir_owner',
} as const

// Sin slug, la clave de siempre (compatibilidad hacia atrás: una sesión ya
// abierta antes de esta fase, o cualquier caller que todavía no pasa club).
function draftKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.DRAFT}:${clubSlug}` : KEYS.DRAFT
}

function draftStepKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.DRAFT_STEP}:${clubSlug}` : KEYS.DRAFT_STEP
}

function integrantesKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.INTEGRANTES}:${clubSlug}` : KEYS.INTEGRANTES
}
```

Replace the draft-persistence functions (lines 120-165):

```ts
export function saveDraft(data: Partial<Omit<SalidaFormData, 'gpxFile'>>, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.DRAFT, JSON.stringify(data))
  } catch {
    // Storage might be full
  }
}

export function saveDraftStep(step: number, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.DRAFT_STEP, String(step))
  } catch {
    // ignore
  }
}

export function loadDraft(storage?: Storage): Partial<Omit<SalidaFormData, 'gpxFile'>> | null {
  try {
    const raw = resolve(storage).getItem(KEYS.DRAFT)
    if (!raw) return null
    return JSON.parse(raw) as Partial<Omit<SalidaFormData, 'gpxFile'>>
  } catch {
    return null
  }
}

export function loadDraftStep(storage?: Storage): number {
  try {
    const raw = resolve(storage).getItem(KEYS.DRAFT_STEP)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch {
    return 0
  }
}

export function clearDraft(storage?: Storage): void {
  try {
    const s = resolve(storage)
    s.removeItem(KEYS.DRAFT)
    s.removeItem(KEYS.DRAFT_STEP)
  } catch {
    // ignore
  }
}
```

with:

```ts
export function saveDraft(data: Partial<Omit<SalidaFormData, 'gpxFile'>>, storage?: Storage, clubSlug?: string): void {
  try {
    resolve(storage).setItem(draftKey(clubSlug), JSON.stringify(data))
  } catch {
    // Storage might be full
  }
}

export function saveDraftStep(step: number, storage?: Storage, clubSlug?: string): void {
  try {
    resolve(storage).setItem(draftStepKey(clubSlug), String(step))
  } catch {
    // ignore
  }
}

export function loadDraft(storage?: Storage, clubSlug?: string): Partial<Omit<SalidaFormData, 'gpxFile'>> | null {
  try {
    const raw = resolve(storage).getItem(draftKey(clubSlug))
    if (!raw) return null
    return JSON.parse(raw) as Partial<Omit<SalidaFormData, 'gpxFile'>>
  } catch {
    return null
  }
}

export function loadDraftStep(storage?: Storage, clubSlug?: string): number {
  try {
    const raw = resolve(storage).getItem(draftStepKey(clubSlug))
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch {
    return 0
  }
}

export function clearDraft(storage?: Storage, clubSlug?: string): void {
  try {
    const s = resolve(storage)
    s.removeItem(draftKey(clubSlug))
    s.removeItem(draftStepKey(clubSlug))
  } catch {
    // ignore
  }
}
```

Apply the same `clubSlug?: string` parameter and `integrantesKey(clubSlug)` treatment to `saveIntegrante`, `loadIntegrantes`, `clearIntegrantesCache` (lines 172-204), preserving every existing behavior (default-unkeyed lookup, try/catch shape) exactly.

- [ ] **Step 4: Add `migrateUnkeyedDraftToCurrentClub`**

In `frontend/src/lib/storage.ts`, add after `clearIntegrantesCache`:

```ts
// Migración de una sola vez: un draft guardado ANTES de esta fase vive en la
// clave sin club (pamir_draft). Al primer load posterior al release, se
// asigna al club ACTUAL — nadie pierde una ficha que estaba llenando en la
// montaña. Nunca pisa un draft que YA exista en la clave del club actual
// (si alguien ya empezó de cero ahí, ese draft gana), y nunca borra el
// draft sin club si el destino está ocupado — se queda huérfano mejor que
// perderse (un caso raro: dos sesiones/pestañas distintas en el mismo
// navegador, una vieja y una ya migrada).
export function migrateUnkeyedDraftToCurrentClub(storage?: Storage, clubSlug?: string): void {
  if (!clubSlug) return
  try {
    const s = resolve(storage)
    const legacy = s.getItem(KEYS.DRAFT)
    if (!legacy) return
    if (s.getItem(draftKey(clubSlug)) !== null) return

    s.setItem(draftKey(clubSlug), legacy)
    const legacyStep = s.getItem(KEYS.DRAFT_STEP)
    if (legacyStep !== null) s.setItem(draftStepKey(clubSlug), legacyStep)

    s.removeItem(KEYS.DRAFT)
    s.removeItem(KEYS.DRAFT_STEP)
  } catch {
    // Storage bloqueado: la migración es una conveniencia, nunca debe romper
    // el arranque de la app.
  }
}
```

- [ ] **Step 5: Run and confirm PASS**

```bash
cd frontend
npx vitest run src/lib/storage.test.ts
```

- [ ] **Step 6: Update the two callers that persist drafts (`WizardLayout.tsx`, `RegistroIntegrante.tsx`) to pass the current club slug**

```bash
cd frontend
grep -rln "saveDraft\|loadDraft\|saveDraftStep\|loadDraftStep\|clearDraft\|saveIntegrante\|loadIntegrantes\|clearIntegrantesCache" src/components
```

For each call site found, add `, undefined, clubSlugFromPath()` (or the component's already-in-scope `Storage` argument plus `clubSlugFromPath()`) as the trailing argument(s), and add the `import { clubSlugFromPath } from '../../lib/club-path'` (adjust relative path per file) if not already present. Run `npx tsc --noEmit` after editing to confirm every call site compiles — a stale call site is a compile error, not a silent bug, because `clubSlug` is an added *optional* parameter at the end, so omitting it still compiles; grep is the only way to find every site that SHOULD be updated. Confirm the grep count and list them explicitly in the commit message body.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/storage.ts frontend/src/lib/storage.test.ts frontend/src/components/wizard/WizardLayout.tsx frontend/src/components/RegistroIntegrante.tsx
git commit -m "feat(clubs): key the draft and integrantes cache per club, with a one-time migration"
```

---

### Task 8: Frontend type updates

**Files:**
- Modify: `frontend/src/types/salida.ts` (`User` interface, lines 31-44)
- Modify: `frontend/src/types/invitacion.ts` (`ConsultarInvitacionResponse`, lines 48-56)

**Interfaces:**
- Produces (consumed by Tasks 9, 10, 11 and by plan 4b):
  - `ClubMembership extends OrganizationBrand { rol: 'SOCIO' | 'LIDER' | 'ADMIN'; suspendido: boolean }`
  - `User.clubes?: ClubMembership[]`
  - `ConsultarInvitacionResponse.cuentaExistente: boolean`

- [ ] **Step 1: Extend `types/salida.ts`**

In `frontend/src/types/salida.ts`, after the `OrganizationBrand` interface (line 29) and before `User` (line 31), add:

```ts
// Una membresía de "Mis clubes" (login/GET /me devuelven clubes: esto[]).
// suspendido solo tiene sentido acá — nunca en OrganizationBrand a secas, que
// también describe la marca pública de OTRO club (ver
// backend/src/lib/serializers/organization.ts).
export interface ClubMembership extends OrganizationBrand {
  rol: 'SOCIO' | 'LIDER' | 'ADMIN'
  suspendido: boolean
}
```

Extend `User` (after `organization?: Organization`, line 43):

```ts
  organization?: Organization
  // Todas las membresías de la cuenta, más antigua primero — login y GET
  // /api/me las devuelven desde PR 2, pero el frontend no las tipaba ni leía
  // hasta esta fase. Opcional por el mismo motivo que organization: una
  // sesión guardada antes de esta fase no lo trae hasta que useAuth refresca
  // /me.
  clubes?: ClubMembership[]
```

- [ ] **Step 2: Extend `types/invitacion.ts`**

In `frontend/src/types/invitacion.ts`, extend `ConsultarInvitacionResponse` (lines 48-56):

```ts
export interface ConsultarInvitacionResponse {
  email: string
  rol: Rol
  rolLabel: string
  invitadoPor: string
  organization: OrganizationBrand | null
  // true si el email invitado ya tiene una cuenta RIALA. Usado por la
  // pantalla de aceptar invitación (PR 4b) para mostrar "inicia sesión" en
  // vez de "crea tu cuenta".
  cuentaExistente: boolean
}
```

- [ ] **Step 3: Run the frontend typecheck**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors (both fields are additive; nothing currently destructures `ConsultarInvitacionResponse`/`User` exhaustively in a way a new optional/required field would break — verify by reading the diagnostics if any appear, and fix the one call site in `AuthPage.tsx` that already destructures `ConsultarInvitacionResponse` if it uses an exhaustive object-literal type check anywhere, which it does not — it only reads `.email`/`.rol`/`.rolLabel`/`.invitadoPor`/`.organization`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/salida.ts frontend/src/types/invitacion.ts
git commit -m "feat(clubs): type the clubes list and cuentaExistente on the frontend"
```

---

### Task 9: `useAuth.ts` — `clubAccessError`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts`

**Interfaces:**
- Consumes: `clubSlugFromPath` (Task 5), `ApiError` (`lib/api.ts`, already exported)
- Produces (consumed by Task 10):
  - `useAuth()` return gains `clubAccessError: { status: 403 | 404; message: string } | null`

- [ ] **Step 1: Write the failing test**

There is no existing `useAuth.test.ts` (it is exercised only through component/E2E tests today). Add one, `frontend/src/hooks/useAuth.test.ts`, using `@testing-library/react`'s `renderHook` (already a transitive dependency via the project's React testing setup — confirm with `grep '"@testing-library' frontend/package.json`; if absent, this step instead drives the same behavior through `AuthPage`/`App`-level component tests in Task 10, and this file is skipped):

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'
import * as api from '../lib/api'
import { ApiError } from '../lib/api'

vi.mock('../lib/api')

const STORED_USER = {
  id: 'user-1', name: 'Test', email: 'test@example.com', rol: 'SOCIO' as const,
  organization: { id: 'org-a', slug: 'el-montanista', name: 'El Montañista', shortName: null, membresiaPropia: 'X', hasLogo: false, logoVersion: null },
}

beforeEach(() => {
  localStorage.setItem('pamir_auth', JSON.stringify({ user: STORED_USER, token: 'tok' }))
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useAuth clubAccessError', () => {
  it('se llena con 403 cuando fetchMe falla con 403 y hay un slug en el path', async () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/otro-club' } as Location)
    vi.mocked(api.fetchMe).mockRejectedValue(new ApiError('No perteneces a este club', 403))

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.clubAccessError).not.toBeNull())
    expect(result.current.clubAccessError).toEqual({ status: 403, message: 'No perteneces a este club' })
  })

  it('queda en null cuando fetchMe falla sin slug en el path (comportamiento de hoy: se ignora)', async () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/' } as Location)
    vi.mocked(api.fetchMe).mockRejectedValue(new ApiError('Network error', 0))

    const { result } = renderHook(() => useAuth())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.clubAccessError).toBeNull()
  })

  it('se limpia tras un login exitoso', async () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/otro-club' } as Location)
    vi.mocked(api.fetchMe).mockRejectedValue(new ApiError('No perteneces a este club', 403))
    vi.mocked(api.loginWithCredentials).mockResolvedValue({ user: STORED_USER, token: 'tok2' })

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.clubAccessError).not.toBeNull())

    await result.current.loginWithCredentials('test@example.com', 'pw', true)
    expect(result.current.clubAccessError).toBeNull()
  })
})
```

If `@testing-library/react` is not already a dependency, add it: `npm install --save-dev @testing-library/react` (frontend workspace) — this is the only new dependency this plan introduces, and only if the hook-level test is chosen over the component-level alternative; note the choice made in the commit message.

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx vitest run src/hooks/useAuth.test.ts
```

Expected: `result.current.clubAccessError` is `undefined` (property doesn't exist yet) in all three tests.

- [ ] **Step 3: Add `clubAccessError` state and surface it from the mount effect**

In `frontend/src/hooks/useAuth.ts`, add the import:

```ts
import { establishSession, loadAuth, clearAuth, isAuthRemembered } from '../lib/storage'
import { setAuthToken } from '../lib/auth-token'
import { loginWithCredentials, fetchMe, ApiError } from '../lib/api'
import { clubSlugFromPath } from '../lib/club-path'
```

Extend `UseAuthReturn` (after `refreshSession`):

```ts
  refreshSession: () => Promise<void>
  // No-null solo cuando el club de la URL (ver lib/club-path.ts) existe pero
  // el backend acaba de rechazar la cuenta activa para ese club — 403 "no
  // soy socio" o 404 "club no encontrado". App.tsx lo usa para decidir entre
  // el dashboard y una de las pantallas de la Tabla de routing (Design §3).
  // Nunca se llena por un error SIN slug en el path (Ruling 1 del plan de
  // esta PR: ahí el comportamiento sigue siendo el silencioso de siempre).
  clubAccessError: { status: 403 | 404; message: string } | null
```

Inside `useAuth`, add the state:

```ts
export function useAuth(): UseAuthReturn {
  const [state, setState] = useState(buildInitialState)
  const [isLoading, setIsLoading] = useState(false)
  const [clubAccessError, setClubAccessError] = useState<{ status: 403 | 404; message: string } | null>(null)
```

Replace the mount-time refresh effect:

```ts
  useEffect(() => {
    const saved = loadAuth()
    if (!saved?.token) return
    const savedToken = saved.token
    fetchMe()
      .then(({ user }) => applyUser(user, savedToken))
      .catch(() => {
        // Token inválido/expirado o red caída: no se toca el estado
      })
  }, [applyUser])
```

with:

```ts
  useEffect(() => {
    const saved = loadAuth()
    if (!saved?.token) return
    const savedToken = saved.token
    // Ruling 2 del plan de esta PR: en la raíz sin slug, con varias
    // membresías YA conocidas por una sesión guardada, esta llamada
    // recibiría siempre 400 "Selecciona un club" (authMiddleware) — se
    // evita a propósito; App.tsx muestra "Mis clubes" con los datos
    // guardados sin esperar ninguna red.
    const slug = clubSlugFromPath()
    if (!slug && (saved.user?.clubes?.length ?? 0) > 1) return

    fetchMe()
      .then(({ user }) => {
        setClubAccessError(null)
        applyUser(user, savedToken)
      })
      .catch((err: unknown) => {
        // Ruling 1: solo se convierte en clubAccessError cuando HAY un slug
        // en el path — sin slug, un 403/404 sería inesperado (no debería
        // pasar, ver el comentario de arriba) y se prefiere no arriesgar un
        // falso positivo; se trata como cualquier otro fallo silencioso.
        if (slug && err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setClubAccessError({ status: err.status, message: err.message })
          return
        }
        // Token inválido/expirado o red caída: no se toca el estado
      })
  }, [applyUser])
```

Update `login` to clear `clubAccessError` on success (it already only runs on explicit user action, so clearing here is safe and matches "se limpia tras un login exitoso"):

```ts
  const login = useCallback(async (email: string, password: string, remember: boolean): Promise<void> => {
    setIsLoading(true)
    try {
      const { user, token } = await loginWithCredentials(email, password)
      setAuthToken(token)
      establishSession({ user, token }, { remember })
      setClubAccessError(null)
      setState({ user, token })
    } finally {
      setIsLoading(false)
    }
  }, [])
```

Update `logout` to also clear it:

```ts
  const logout = useCallback((): void => {
    clearAuth()
    setAuthToken(null)
    setClubAccessError(null)
    setState({ user: null, token: null })
  }, [])
```

Add `clubAccessError` to the returned object:

```ts
  return {
    user: state.user,
    token: state.token,
    isLoading,
    loginWithCredentials: login,
    logout,
    refreshSession,
    clubAccessError,
  }
```

- [ ] **Step 4: Run and confirm PASS**

```bash
cd frontend
npx vitest run src/hooks/useAuth.test.ts
```

- [ ] **Step 5: Run the full frontend typecheck and unit suite**

```bash
cd frontend
npx tsc --noEmit
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useAuth.ts frontend/src/hooks/useAuth.test.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(clubs): surface a 403/404 club-access error from the session refresh"
```

---

### Task 10: Routing layer in `App.tsx`

**Files:**
- Create: `frontend/src/components/MisClubesPage.tsx`
- Create: `frontend/src/components/ClubAccessErrorPage.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/e2e/multi-club-routing.spec.ts`

**Interfaces:**
- Consumes: `ClubMembership` (Task 8), `clubAccessError` (Task 9), `clubSlugFromPath`/`redirectLegacyClubQueryParam` (Task 5), `migrateUnkeyedDraftToCurrentClub` (Task 7)
- Produces (consumed by plan 4b, which reuses these two components unchanged):
  - `MisClubesPage({ clubes, onLogout }: { clubes: ClubMembership[]; onLogout: () => void })`
  - `ClubAccessErrorPage({ status, message, org, onLogout }: { status: 403 | 404; message: string; org: OrganizationBrand | null; onLogout: () => void })`

- [ ] **Step 1: Write `MisClubesPage.tsx`**

Create `frontend/src/components/MisClubesPage.tsx`:

```tsx
// "Mis clubes": se muestra en riala.cl (sin slug) cuando la cuenta tiene más
// de una membresía — ver la tabla de routing en
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
// Alcance de esta PR (4a): funcional y accesible, sin la pulida visual
// (badges de club suspendido con más detalle, animaciones) que PR 4b agrega
// sobre este mismo componente — ver Ruling 4 del plan de PR 4a.
import { LogOut } from 'lucide-react'
import { ClubLogo } from './ClubLogo'
import { Button } from './ui/Button'
import { clubDisplayName } from '../lib/club-brand'
import type { ClubMembership } from '../types/salida'

interface MisClubesPageProps {
  clubes: ClubMembership[]
  onLogout: () => void
}

export function MisClubesPage({ clubes, onLogout }: MisClubesPageProps) {
  return (
    <div className="min-h-screen bg-alpine-canvas flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-headline-lg text-slate-800">Mis clubes</h1>
          <p className="text-sm text-on-surface-variant">Elige a qué club quieres entrar.</p>
        </div>

        <ul className="flex flex-col gap-3">
          {clubes.map((club) => (
            <li key={club.slug}>
              {club.suspendido ? (
                <div
                  className="w-full flex items-center gap-3 rounded-2xl border border-secondary/15 bg-surface-container-low p-4 opacity-60"
                  aria-disabled="true"
                >
                  <ClubLogo org={club} alt="" className="w-11 h-11 object-contain shrink-0" />
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="font-bold text-slate-700 truncate">{clubDisplayName(club)}</span>
                    <span className="text-xs font-semibold text-error">Suspendido</span>
                  </div>
                </div>
              ) : (
                <a
                  href={`/${club.slug}`}
                  className="w-full flex items-center gap-3 rounded-2xl border border-secondary/15 bg-white shadow-sm p-4 hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ClubLogo org={club} alt="" className="w-11 h-11 object-contain shrink-0" />
                  <span className="font-bold text-slate-800 truncate text-left">{clubDisplayName(club)}</span>
                </a>
              )}
            </li>
          ))}
        </ul>

        <Button variant="ghost" onClick={onLogout} className="self-center">
          <LogOut size={16} />
          Cerrar sesión
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `ClubAccessErrorPage.tsx`**

Create `frontend/src/components/ClubAccessErrorPage.tsx`:

```tsx
// Pantalla compartida por los tres casos de la tabla de routing donde la
// sesión existe pero NO puede entrar al club del path: no es socio (403),
// el club no existe (404), o el club está suspendido (403, mismo status que
// "no soy socio" — se distinguen solo por el texto, que es el que el propio
// backend ya devuelve — ver Ruling 5 del plan de PR 4a).
import { AlertCircle, LogOut } from 'lucide-react'
import { ClubLogo } from './ClubLogo'
import { Button } from './ui/Button'
import type { OrganizationBrand } from '../types/salida'

interface ClubAccessErrorPageProps {
  status: 403 | 404
  message: string
  // null si el slug no resolvió ninguna marca pública (p.ej. 404 real) — la
  // pantalla queda con el logo neutral.
  org: OrganizationBrand | null
  onLogout: () => void
  onMisClubes: () => void
}

export function ClubAccessErrorPage({ status, message, org, onLogout, onMisClubes }: ClubAccessErrorPageProps) {
  return (
    <div className="min-h-screen bg-alpine-canvas flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-secondary/15 p-6 text-center flex flex-col items-center gap-4">
        <ClubLogo org={org} alt="" className="w-14 h-14 object-contain" />
        <AlertCircle size={32} className="text-error" />
        <p className="text-sm text-slate-700" role="alert">{message}</p>
        <div className="flex flex-col gap-2 w-full">
          <Button fullWidth onClick={onMisClubes}>Mis clubes</Button>
          <Button variant="ghost" fullWidth onClick={onLogout}>
            <LogOut size={16} />
            Cerrar sesión
          </Button>
        </div>
        {/* status se usa solo para el test/lector de errores futuro — el
            texto ya lo explica todo a la persona. */}
        <span className="sr-only">Código {status}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the routing layer into `App.tsx`**

In `frontend/src/App.tsx`, add the imports:

```ts
import { useState, useEffect, useMemo } from 'react'
import { MotionConfig } from 'motion/react'
import { useAuth } from './hooks/useAuth'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { NavPreferencesProvider } from './contexts/NavPreferencesContext'
import { documentTitle, esSocioDelClub } from './lib/club-brand'
import { clubSlugFromPath, redirectLegacyClubQueryParam } from './lib/club-path'
import { migrateUnkeyedDraftToCurrentClub } from './lib/storage'
import { fetchMarcaClub } from './lib/api'
import { MisClubesPage } from './components/MisClubesPage'
import { ClubAccessErrorPage } from './components/ClubAccessErrorPage'
import { AuthPage } from './components/AuthPage'
```

(`fetchMarcaClub` is already exported by `lib/api.ts`; the rest of the existing imports in `App.tsx` are unchanged.)

Add, right before `AppContent`'s definition, a module-level one-time redirect (runs before React even mounts, exactly like the existing `getQueryParam` helper is used):

```ts
// Corre una sola vez, antes del primer render: reescribe un link legacy
// ?club=<slug> a /<slug> (ver Global Constraints del plan de esta PR) antes
// de que cualquier componente lea window.location.
redirectLegacyClubQueryParam()
```

Inside `AppContent`, add right after the existing `isAuthenticated`/`isAdmin`/... derived consts (after line 91, before the `shell` object):

```ts
  const pathSlug = useMemo(() => clubSlugFromPath(), [])
  const activeClubSlug = user?.organization?.slug ?? null
  const clubes = user?.clubes ?? null

  // Migración de una sola vez del draft sin club — antes de que cualquier
  // pantalla del wizard pueda leerlo. Solo tiene sentido una vez resuelto un
  // club activo real (nunca en la raíz sin slug, donde "el club actual"
  // todavía no existe).
  useEffect(() => {
    if (activeClubSlug) migrateUnkeyedDraftToCurrentClub(undefined, activeClubSlug)
  }, [activeClubSlug])

  // Redirección transparente: una sola membresía y sin slug en el path →
  // /<slug>, preservando el resto de la URL (query/hash ya se consumieron
  // arriba en los efectos de inviteToken/qrToken, así que no hace falta
  // reenviarlos acá). No se dispara mientras clubes todavía no se conoce
  // (Ruling 3: undefined es "no se sabe todavía", nunca "cero clubes").
  useEffect(() => {
    if (!isAuthenticated || pathSlug || !clubes) return
    if (clubes.length === 1) window.location.replace(`/${clubes[0]!.slug}`)
  }, [isAuthenticated, pathSlug, clubes])
```

Add the "org brand for a slug we don't yet have a session for" lookup, used only by the not-a-member/club-not-found screen (fetched via the existing public `fetchMarcaClub`, exactly like `AuthPage` already does):

```ts
  const [pathSlugOrg, setPathSlugOrg] = useState<OrganizationBrand | null>(null)
  useEffect(() => {
    if (!pathSlug || !clubAccessError) return
    let cancelled = false
    fetchMarcaClub(pathSlug)
      .then((org) => { if (!cancelled) setPathSlugOrg(org) })
      .catch(() => { /* club-not-found ya cubre esto con org: null */ })
    return () => { cancelled = true }
  }, [pathSlug, clubAccessError])
```

(Add `import type { OrganizationBrand } from './types/salida'` to the imports, and destructure `clubAccessError` from the `useAuth` result passed into `AppContent` — extend `AppContent`'s prop list and the `App()` call site exactly like every other `useAuth()` field already flows through `ReturnType<typeof useAuth>`, so this is automatic once Task 9 adds the field to the hook's return type: `AppContent`'s signature already destructures `ReturnType<typeof useAuth>`, so `clubAccessError` becomes available with zero signature changes.)

Add the two new top-level branches, placed after the existing `isLoading`/`Spinner` branch and BEFORE the existing `!isAuthenticated` branch's `AuthPage` render (so an authenticated club-access problem is resolved before falling through to any dashboard logic), and after the existing `inviteToken` interstitial (so a signed-in person opening an invite link for ANOTHER club still sees that interstitial first, unchanged):

```ts
  if (isAuthenticated && clubAccessError) {
    return (
      <ClubAccessErrorPage
        status={clubAccessError.status}
        message={clubAccessError.message}
        org={pathSlugOrg}
        onLogout={logout}
        onMisClubes={() => window.location.assign('/')}
      />
    )
  }

  if (isAuthenticated && !pathSlug && clubes && clubes.length > 1) {
    return <MisClubesPage clubes={clubes} onLogout={logout} />
  }
```

Place both branches immediately after the existing `if (inviteToken) { ... }` interstitial block and before the existing `if ((route === 'nueva-salida' ...` dashboard routing — this keeps every existing dashboard branch's preconditions (`isAuthenticated`, no pending `inviteToken`) exactly as they are today, and only intercepts the two new cases.

- [ ] **Step 4: Update `App()`'s top-level composition to keep `OrganizationProvider` correct while `clubAccessError`/Mis-clubes render**

No change needed here: `OrganizationProvider` already reads `auth.user?.organization ?? null`, which during a `clubAccessError` or "Mis clubes" render is still the STALE previous organization (or `null`) — acceptable, since neither new screen reads from `useOrganization()` (both take their branding explicitly as props: `org`/`clubes`), so a stale/neutral provider value during these two screens causes no visible bug. Confirm this by grepping both new components for `useOrganization`: `grep -n useOrganization frontend/src/components/MisClubesPage.tsx frontend/src/components/ClubAccessErrorPage.tsx` must return nothing.

- [ ] **Step 5: Manual verification**

```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173/no-such-club` while signed out — expect the normal login screen (unauthenticated branch is untouched by this task; branding-by-path-slug is Task 11). This step only confirms nothing crashes before Task 11 lands; full manual verification of the authenticated branches happens after Task 12's E2E tests are green (they exercise these branches against a mocked backend, which is more reliable than manual clicking through real login).

- [ ] **Step 6: Write the E2E tests**

Create `frontend/e2e/multi-club-routing.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { setAuth, mockMe, mockHasIntegrante, mockSalidas, MOCK_USER, MOCK_ADMIN_MONTANISTA, PAMIR_ORG, EL_MONTANISTA_ORG } from './helpers'

test.describe('Redirección transparente — una sola membresía', () => {
  test('riala.cl sin slug redirige a /<slug> cuando la cuenta tiene una sola membresía', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/')
    await expect(page).toHaveURL(/\/pamir$/)
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })
})

test.describe('Mis clubes — varias membresías', () => {
  test('riala.cl sin slug muestra Mis clubes con ambos clubes, uno suspendido y deshabilitado', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: true },
      ],
    }
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()
    await expect(page.getByRole('link', { name: PAMIR_ORG.name })).toBeVisible()
    await expect(page.getByText('Suspendido')).toBeVisible()
    await expect(page.getByRole('link', { name: EL_MONTANISTA_ORG.name })).toHaveCount(0)
  })
})

test.describe('No perteneces a este club / club no encontrado', () => {
  test('un club del que no soy socio muestra el mensaje del backend, no el dashboard de la sesión previa', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 403, json: { error: 'No perteneces a este club' } })
    })
    await page.route('**/api/clubes/el-montanista/marca', (route) => {
      void route.fulfill({ status: 200, json: EL_MONTANISTA_ORG })
    })

    await page.goto('/el-montanista')
    await expect(page.getByText('No perteneces a este club')).toBeVisible()
    await expect(page.getByText('Mis Salidas')).toHaveCount(0)
  })

  test('un slug desconocido muestra club no encontrado', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 404, json: { error: 'Club no encontrado' } })
    })
    await page.route('**/api/clubes/no-existe/marca', (route) => {
      void route.fulfill({ status: 404, json: { error: 'Club no encontrado' } })
    })

    await page.goto('/no-existe')
    await expect(page.getByText('Club no encontrado')).toBeVisible()
  })
})
```

- [ ] **Step 7: Run and confirm the expected failures, then implement until PASS**

```bash
cd frontend
npx playwright test e2e/multi-club-routing.spec.ts
```

Iterate on Steps 1-4 until all five tests pass. Then run the full existing E2E suite to catch any regression:

```bash
npx playwright test
```

Expected: `e2e/navegacion.spec.ts`/`e2e/invitaciones.spec.ts`/`e2e/qr-invitaciones.spec.ts`/others still pass unmodified — every existing test's `page.goto('/')` continues to work because every existing mock user (`MOCK_USER`, `MOCK_ADMIN`, etc., in `helpers.ts`) has no `clubes` field, so `clubes` is `null`/`undefined` and none of the new branches fire (Ruling 3 covers exactly this: unknown `clubes` never redirects or shows a new screen). If any existing test fails, it is because that test's mock user needs a `clubes: [{ ...ORG, rol: '...', suspendido: false }]` array added to `helpers.ts` to match the now-typed contract — add it there rather than special-casing the test.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/MisClubesPage.tsx frontend/src/components/ClubAccessErrorPage.tsx frontend/e2e/multi-club-routing.spec.ts frontend/e2e/helpers.ts
git commit -m "feat(clubs): route riala.cl/<slug> through the club-resolution table"
```

---

### Task 11: `AuthPage.tsx` — branding by path slug

**Files:**
- Modify: `frontend/src/components/AuthPage.tsx` (lines 92-115, 199-204)

**Interfaces:**
- Consumes: `clubSlugFromPath` (Task 5)
- Produces: no new exports — `AuthPage`'s pre-login logo/name now prefers the path slug's own club over `clubPreferido()`'s guess.

- [ ] **Step 1: Replace the `preferredOrg` effect**

In `frontend/src/components/AuthPage.tsx`, replace lines 92-115:

```ts
  // Club preferido (ver club-preferido.ts): ?club=<slug> en la URL, o si no
  // viene, el último club con el que se inició sesión en este navegador.
  // Gobierna SOLO la marca del login — nunca antes de resolver una invitación
  // en curso, que ya trae su propio club (inviteOrg más abajo tiene
  // prioridad). Si no hay slug o la consulta falla, queda el neutral de hoy.
  const [preferredOrg, setPreferredOrg] = useState<OrganizationBrand | null>(null)

  useEffect(() => {
    if (inviteToken) return
    const slug = clubPreferido()
    if (!slug) return
    let cancelled = false
    fetchMarcaClub(slug)
      .then((org) => {
        if (cancelled) return
        setPreferredOrg(org)
      })
      .catch(() => {
        // Sin conexión, club borrado, etc.: queda el neutral de hoy
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])
```

with:

```ts
  // Marca del login (nunca antes de resolver una invitación en curso, que ya
  // trae su propio club — inviteOrg más abajo tiene prioridad):
  // 1. El slug del PATH (riala.cl/<slug>) — es el club exacto que la persona
  //    está visitando, más confiable que cualquier preferencia recordada.
  // 2. Si no hay slug en el path, el club preferido de siempre (ver
  //    club-preferido.ts): ?club=<slug> o el último club con el que se
  //    inició sesión en este navegador.
  // Si ninguno resuelve (o la consulta falla), queda el neutral de hoy.
  const [preferredOrg, setPreferredOrg] = useState<OrganizationBrand | null>(null)

  useEffect(() => {
    if (inviteToken) return
    const slug = clubSlugFromPath() ?? clubPreferido()
    if (!slug) return
    let cancelled = false
    fetchMarcaClub(slug)
      .then((org) => {
        if (cancelled) return
        setPreferredOrg(org)
      })
      .catch(() => {
        // Sin conexión, club borrado, etc.: queda el neutral de hoy
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])
```

Add the import:

```ts
import { clubPreferido } from '../lib/club-preferido'
import { clubSlugFromPath } from '../lib/club-path'
```

- [ ] **Step 2: Write the unit/component coverage**

There is no existing `AuthPage.test.ts` (this component is exercised through E2E only). Add the coverage as an E2E case instead, in `frontend/e2e/multi-club-routing.spec.ts` (Task 10), appended to the file:

```ts
test.describe('Branding pre-login por slug del path', () => {
  test('riala.cl/el-montanista sin sesión pinta el logo/nombre de El Montañista', async ({ page }) => {
    await page.route('**/api/clubes/el-montanista/marca', (route) => {
      void route.fulfill({ status: 200, json: EL_MONTANISTA_ORG })
    })
    await page.goto('/el-montanista')
    await expect(page.getByText(EL_MONTANISTA_ORG.name)).toBeVisible()
  })
})
```

- [ ] **Step 3: Run and confirm PASS**

```bash
cd frontend
npx playwright test e2e/multi-club-routing.spec.ts
```

- [ ] **Step 4: Run the full frontend typecheck and lint**

```bash
cd frontend
npx tsc --noEmit
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AuthPage.tsx frontend/e2e/multi-club-routing.spec.ts
git commit -m "feat(clubs): prefer the URL path's club for pre-login branding"
```

---

### Task 12: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend — full unit suite, isolation suite, typecheck, lint**

```bash
cd backend
npm run build
npm test
npm run test:isolation
npm run lint
```

- [ ] **Step 2: Frontend — full unit suite, typecheck, lint, build, full E2E**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
npm run test
npx playwright test
```

- [ ] **Step 3: Confirm no unrelated files were touched**

```bash
cd /Users/rodrigocontrerasrubio/proyectos/pamirv2
git status --porcelain
```

Expected: only the files listed in this plan's File Structure table (plus `frontend/package.json`/`package-lock.json` if Task 9 added `@testing-library/react`) appear as staged/committed changes across this plan's commits — the pre-existing uncommitted `.DS_Store`, `docs/de-pamir-a-riala.html`, `docs/manual-*`, `.claude/skills/alta-de-club/references/alta-de-club.md`, and `.atl/`/`.gitignore` stay exactly as they were (untouched by this plan; the docs edits are plan 4b's Task 5).

---

## Self-Review

**1. Spec coverage.** Design §3 "The path selects the club" → Tasks 5, 6, 10. "Invitation and QR links carry the club" → Task 3 (legacy no-slug format explicitly preserved, Global Constraints). "Legacy links redirect" → Task 5/10. "Reserved slugs grow" → Task 2. Routing table (all four Address × Signed-in/out outcomes) → Tasks 10, 11 (the "Signed out" column's `/<slug>` and unknown-slug rows are AuthPage's existing behavior plus Task 11's branding change; no code change is needed for "Club no encontrado" while signed out, since `AuthPage` already shows a neutral or org-branded login regardless of whether the slug is real — the unauthenticated "unknown slug" case intentionally still shows a login form, matching the design table's own "Signed out: Login with that club's logo and name" cell, which does not carry a not-found branch for signed-out visitors). "X-Club on every request" → Task 6. "Browser storage per club + one-time migration" → Task 7. Error table's 403/404/400 → Task 9/10 (400 is the existing backend behavior, deliberately never triggered by the frontend per Ruling 2). Testing list (unit: routing/path parsing, X-Club, storage keying+migration) → Tasks 5, 6 (build-verified), 7. `clubes[].suspendido` product decision → Task 1 (backend) + Task 10 (frontend). `cuentaExistente` groundwork → Task 4 (backend only; the UI that consumes it is plan 4b's Task 3, out of this plan's scope by design). Gaps: none — "Mis clubes"/"Cambiar de club" *polish* and the *join-screen* UX are explicitly plan 4b's scope (see the split note at the top of this document).

**2. Placeholder scan.** No "TBD"/"handle appropriately"/uncoded steps. Two steps (Task 1's `invitaciones.service.test.ts` edit in Task 3/4, and Task 3's `postJsonWithClub` helper) ask the implementer to match an existing file's established naming/helper convention rather than inventing a name from scratch — this is a deliberate choice (the exact helper/constant names are only visible once the file is open, and are already fully specified by their existing neighbors in the same file, e.g. `getJsonWithClub`'s exact 12-line body is given as the template) rather than a gap; every new function this plan introduces (`clubSlugFromPath`, `redirectLegacyClubQueryParam`, `migrateUnkeyedDraftToCurrentClub`, `draftKey`/`draftStepKey`/`integrantesKey`, `MisClubesPage`, `ClubAccessErrorPage`) is given in full.

**3. Type consistency.** `ClubMembership` (Task 8) matches the backend's `clubes[]` shape exactly (`slug`/`name`/`shortName`/`hasLogo`/`logoVersion`/`rol`/`suspendido`, Task 1) — checked key-for-key against the `test-isolation.ts` `deepEqual` assertion in Task 1 Step 1. `clubAccessError`'s `{status: 403 | 404; message: string}` shape (Task 9) matches exactly what `ClubAccessErrorPage` (Task 10) destructures. `saveDraft`/`loadDraft`/etc.'s new trailing `clubSlug?: string` parameter (Task 7) is used identically at every caller found by Task 7 Step 6's grep. `organizationSlug` (Task 3) is spelled identically across `InvitacionesDeps`, `CodigosQrDeps`, both controllers' `buildDeps`, and `tenant.ts`.

**4. Review Focus.** All five items (multi-membership bare-domain 400, stale-session data mismatch on 403, unknown-slug 404 vs not-a-member 403, cross-club draft bleed, `?club=` redirect loop/timing) map to a task with a test: #1→Ruling 2 + Task 10 Step 6/7 test, #2→Task 9 test + Task 10 Step 6/7 test, #3→Task 10 Step 6/7 test, #4→Task 7 Step 1 test, #5→Task 5 Step 1 test.

## Execution Handoff

Plan 4a complete and saved to `docs/superpowers/plans/2026-09-24-multi-club-04a-frontend-routing.md`. Plan 4b (`docs/superpowers/plans/2026-09-24-multi-club-04b-join-screens.md`) builds on it and should not be started until 4a is reviewed, merged, and deployed — its `AuthPage`/`QrInvitacionPage` edits assume `cuentaExistente` (Task 4) and the slug-carrying links (Task 3) are already live. Please review this plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — implement every task in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**: Tasks 9 and 10 both hinge on `clubAccessError`'s exact semantics (when it fires, when it's cleared) and Task 10's routing branches are easy to get subtly wrong (branch ordering relative to the existing `inviteToken`/`qrToken`/`Spinner` gates) in a way a same-session implementer is likely to only notice much later; a fresh reviewer after each task catches an ordering mistake before the next task builds on it, rather than after all twelve tasks are written.

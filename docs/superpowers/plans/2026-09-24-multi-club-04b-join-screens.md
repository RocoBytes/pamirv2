# Multi-Club Membership — PR 4b: Cambiar de Club, Join Screens, Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** `docs/superpowers/plans/2026-09-24-multi-club-04a-frontend-routing.md` (PR 4a), deployed. This plan reuses 4a's `MisClubesPage`/`ClubAccessErrorPage` components, `clubSlugFromPath`/`clubAccessError` plumbing, the slug-carrying invite/QR links (backend Task 3), and `ConsultarInvitacionResponse.cuentaExistente` (backend Task 4) as already-shipped contracts — it does not re-derive or duplicate any of them.

**Goal:** A person with an existing RIALA account can join a second club from an invitation email or a QR-directo scan without creating a duplicate account, lands signed in on `/<the-new-club>`, and — from inside the app — can reach "Mis clubes" any time via a "Cambiar de club" entry, not only as a bare-domain redirect target. Docs catch up to the shipped design.

**Architecture:** Two join screens (`AuthPage`'s accept-invite view, `QrInvitacionPage`'s DIRECTO mode) each grow an "I already have an account" branch that swaps password-confirmation/name fields for a single password field and calls the exact same backend endpoints PR 3 already ships (`aceptarInvitacion`/`registrarConQrDirecto`, both already accept an existing account's password as ownership proof) — no new backend endpoint. The one non-obvious wrinkle this plan has to work around: neither `aceptarInvitacion`'s existing-account response nor the subsequent `POST /api/auth/login` call carries the *newly joined* club — `login` always resolves `user.organization` from `User.organizationId` (the account's **primary** club, untouched by joining a second one; see PR 2's Global Constraints, unchanged by PR 3), so the existing-account join branches of both screens explicitly navigate to `/<the-invitation's-or-QR's-own-slug>` after login succeeds, rather than trusting `user.organization` from that login response (see Ruling 1). "Cambiar de club" is a one-line addition once 4a's `MisClubesPage` exists: a new field on `ShellContext` (built once in `App.tsx`, already threaded through every screen that renders `AppShell`) and one new button in `AppHeader`.

**Tech Stack:** React 19 + Vite + Tailwind CSS + TypeScript (frontend), Express 5 + Prisma 7 (backend — no backend changes in this plan; every endpoint it uses shipped in PR 3/4a), Vitest, Playwright (mocked backend).

**Spec:** `docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` (Design §3 "Joining with an existing account", "Cambiar de club"; §4 testing E2E list; Docs paragraph).

## Global Constraints

- **No new backend code.** Every request this plan's UI makes already has a working, tested endpoint (PR 3's `aceptarInvitacion`/`registrarConQrDirecto` existing-account branches; 4a's slug-carrying links and `cuentaExistente`). If a gap is found during implementation, it belongs in a follow-up plan, not an ad hoc backend edit here.
- **The QR-directo screen never learns, and never asks the backend, whether an arbitrary typed email has an account.** The "already have an account? sign in" affordance is a plain UI toggle the *person* chooses — never a server response driving it (unlike the invitation screen, where `cuentaExistente` is safe precisely because the invitee already owns and knows their own email; see 4a's Global Constraints).
- **The existing-account join branches redirect explicitly to the invitation's/QR's own club slug after login succeeds — never rely on the login response's `user.organization`.** See Ruling 1. This is the one architectural subtlety this plan must get right; get it wrong and a person joining a second club would silently land back in their *first* club after "successfully" joining the second.
- **Password rules differ between "create a new account" and "sign in to an existing one."** The existing-account variant is a single password field with no client-side minimum-length or confirm-match validation (the account's real password already satisfies whatever rules applied when it was created) — client-side validation there would reject a correct password of, say, 6 characters from an account created before any length rule existed.
- Code comments in Spanish, matching the surrounding file; this plan document is in English. Conventional commits, no `Co-Authored-By` or AI attribution.
- UI copy in Spanish (neutral register), mobile-first, matching existing components.
- **`docs/de-pamir-a-riala.html` is untracked (`git status` shows `??`, not `M`) and is the repository owner's own private draft with no committed baseline.** Editing and committing it here would mean committing the owner's *entire* file (there is no prior commit to diff against, so "commit only the hunks this PR adds" is not achievable for an untracked file — see Ruling 4). This plan defers that one edit to a follow-up instead of silently absorbing unrelated owner content into a docs commit.
- `.claude/skills/alta-de-club/references/alta-de-club.md` **is** tracked, with one small uncommitted owner edit already in the working tree (`git diff` shows a 1-line replacement in the `contactName`/`contactEmail` row of its field table). This plan's edit to that file must land in a **separate commit** from the owner's uncommitted hunk, and must not touch the lines the owner already changed — see Task 5.

## Rulings

- **Ruling 1: after an existing-account join succeeds and the frontend calls `onLogin`, the app navigates to `/<inviteInfo.organization.slug>` (invitation) or `/<state.organization.slug>` (QR-directo) — a value already known client-side before the accept/register call, from `consultarInvitacion`/`consultarCodigoQr` — never a value derived from the subsequent login response.** Confirmed by reading `backend/src/controllers/auth.controller.ts`'s `login`: it resolves `user.organization` from `User.organizationId` unconditionally, and does not read `X-Club` at all (unlike `authMiddleware`, which `login` does not go through — `login` is a public, unauthenticated endpoint). `User.organizationId` stays pointed at the account's **primary** club after joining a second one (PR 2 Global Constraints: the existing-account join path — `acceptInvitacionExistente`/`registrarMembresiaQrDirectoExistente`, both from PR 3 — creates only a `Membresia` row, never touches `User.organizationId`). So a plain `onLogin` after an existing-account join would land the person back in their *original* club, not the one they just joined — silently wrong, and easy to miss in manual testing by a developer whose test account's primary club happens to already be the one under test. The fix is a client-side redirect using a slug the screen already has, to a URL whose path segment then drives `X-Club` on the next page load (4a's `authHeaders()`), which correctly resolves the *new* membership via `authMiddleware` (unlike `login`, `authMiddleware` does read `X-Club`).
- **Ruling 2: the "sign in" branch of both join screens sends no `Authorization` header — the submitted password is the proof, exactly like PR 3's `submittedPassword` branch, not the Bearer branch.** Neither screen has an existing session to attach a Bearer token from (a signed-in person opening an invite link for a NEW club already gets the "close your session to accept" interstitial from `App.tsx`, unchanged — they are never signed in while looking at this screen). The Bearer path (`AuthProof.verifiedEmail`) PR 3 built is for a hypothetical always-signed-in join flow this plan does not build; it remains available for a future screen without any change needed here.
- **Ruling 3: the invitation screen's existing-account variant reuses the exact backend success message as the post-accept note (`'Te uniste al club. Ya puedes iniciar sesión.'`, from `aceptarInvitacion`'s response body) instead of the current hardcoded "Tu cuenta fue creada..." fallback text**, which is only correct for the new-account branch. Both branches' fallback note (shown only if the automatic `onLogin` itself fails after a successful accept) now come from `result.message`, so the copy never claims an account was "created" when it was only joined.
- **Ruling 4: `docs/de-pamir-a-riala.html` is deferred to a follow-up (see Global Constraints); this plan's docs work is scoped to `README.md` and the `alta-de-club` skill reference.** A partial, mid-document edit to an untracked file the owner is actively drafting risks committing content the owner never intended to check in yet; the spec's Docs paragraph names three targets, and two of the three are safely achievable here.
- **Ruling 5: E2E for this plan runs entirely against `page.route` mocks, exactly like every existing spec — no real backend, no multi-club database fixtures, no infrastructure change.** `frontend/playwright.config.ts`'s `webServer` only starts `npm run dev` for the frontend (confirmed by reading the config); nothing in the existing E2E suite talks to a real Express process. The spec's E2E list (login at `/el-montanista`, "Mis clubes" with two clubs, "Cambiar de club", the not-a-member screen, joining with an existing account by invitation and by QR-directo) is therefore fully achievable with mocks and needs no scope reduction — the first four items are already covered by 4a's `multi-club-routing.spec.ts`; this plan adds the remaining two (existing-account joins).

## Review Focus

1. **Joining a second club via invitation or QR-directo must land the person on the new club, not silently back in their first one.** The single most likely mistake in this feature (see Ruling 1) — a developer who only tests with a brand-new account never exercises the primary-club mismatch, since a new account's primary club *is* the joined club. Pinned by Task 1/Task 2's explicit-redirect tests.
2. **The QR-directo sign-in toggle must never call the backend to check whether the typed email has an account before the person submits.** A naive implementation might "helpfully" pre-check as the person types (mirroring the invitation screen's `cuentaExistente`) — that would recreate exactly the enumeration leak PR 3's own design explicitly rejected for this public, typed-by-anyone surface. Pinned by Task 2's network-call-count assertion.
3. **A wrong password on the sign-in branch of either screen must show a clear error without ever creating a duplicate account or a stray `Membresia`.** Both backend branches already guarantee this (PR 3); this plan's job is to surface the 401 legibly rather than the current dead 409-handling code path, which no longer fires. Pinned by Task 1/Task 2's wrong-password tests.
4. **"Cambiar de club" must not appear for a single-membership account** (the spec is explicit: "only for people with more than one membership") — showing it unconditionally would offer a dead end for the overwhelming majority of accounts in this release. Pinned by Task 3's visibility test.
5. **The `alta-de-club` skill edit must not silently discard the maintainer's own uncommitted hunk.** A `git add -A`-style commit, or an edit that touches the same lines the owner already changed, would either lose their edit or produce a confusing merge of two unrelated changes in one commit. Pinned by Task 5's explicit `git diff` check before and after editing.

---

## File Structure

| File | Responsibility | Task |
|------|-----------------|------|
| `frontend/src/lib/api.ts` | No signature change — documents call-site usage only | — |
| `frontend/src/components/AuthPage.tsx` | Accept-invite view grows the existing-account branch | 1 |
| `frontend/e2e/invitaciones.spec.ts` | New existing-account-join test; remove nothing (new tests only) | 1 |
| `frontend/src/components/QrInvitacionPage.tsx` | DIRECTO mode grows the sign-in toggle; removes dead `conflicto-directo` handling | 2 |
| `frontend/e2e/qr-invitaciones.spec.ts` | Remove the stale 409 test; add sign-in-toggle tests | 2 |
| `frontend/src/components/shell/AppShell.tsx` | `ShellContext.onCambiarClub` | 3 |
| `frontend/src/components/shell/AppHeader.tsx` | "Cambiar de club" button, gated on `clubes.length > 1` | 3 |
| `frontend/src/App.tsx` | Builds `shell.onCambiarClub`; passes `user.clubes` down | 3 |
| `frontend/e2e/multi-club-routing.spec.ts` | New "Cambiar de club" visibility/navigation tests | 3 |
| `README.md` | "Clubes (multi-tenant)" section: fix the stale one-club-per-account line, document multi-club membership | 4 |
| `.claude/skills/alta-de-club/references/alta-de-club.md` | Note the first admin's email may already have an account | 5 |

---

### Task 1: `AuthPage.tsx` — accept-invite existing-account branch

**Files:**
- Modify: `frontend/src/components/AuthPage.tsx` (accept-invite state, `handleAcceptInvite`, the accept-invite JSX block, lines 59-152 and 269-350)
- Modify: `frontend/e2e/invitaciones.spec.ts`

**Interfaces:**
- Consumes: `ConsultarInvitacionResponse.cuentaExistente` (4a Task 4/8), `aceptarInvitacion` (`lib/api.ts`, unchanged signature `(token, name, password) => Promise<AceptarInvitacionResponse>`)
- Produces: no new exports — `AuthPage`'s accept-invite view branches internally.

- [ ] **Step 1: Write the failing E2E test**

In `frontend/e2e/invitaciones.spec.ts`, add to the `describe('Aceptar invitación (usuario no autenticado)', ...)` block:

```ts
test('cuenta existente: pide solo la contraseña, se une al club y aterriza en /<slug> del club nuevo (no del club primario)', async ({ page }) => {
  await page.route(
    '**/api/auth/invitaciones/consultar',
    mockConsultarInvitacion(200, {
      email: 'existente@example.com',
      rol: 'SOCIO',
      rolLabel: 'Socio',
      invitadoPor: 'Admin Montañista',
      organization: EL_MONTANISTA_ORG,
      cuentaExistente: true,
    }),
  )
  await page.route('**/api/auth/invitaciones/aceptar', (route) => {
    void route.fulfill({
      status: 201,
      json: { message: 'Te uniste al club. Ya puedes iniciar sesión.', email: 'existente@example.com' },
    })
  })
  await page.route('**/api/auth/login', (route) => {
    void route.fulfill({
      status: 200,
      // El login SIEMPRE devuelve el club PRIMARIO de la cuenta (Pamir en
      // este fixture) — nunca el club recién unido (Ruling 1 del plan de
      // esta PR): esto prueba que la pantalla NO confía en este valor para
      // decidir a dónde navegar.
      json: {
        user: { id: 'user-existente-001', email: 'existente@example.com', name: 'Existente', rol: 'SOCIO', gestorCategorias: [], organization: PAMIR_ORG, clubes: [] },
        token: 'mock-jwt-existente',
      },
    })
  })

  await page.goto('/el-montanista#invite=tokExistente')

  await expect(page.getByText('Ya tienes una cuenta RIALA')).toBeVisible()
  await expect(page.getByLabel('Nombre completo')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Confirmar contraseña', exact: true })).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('miClaveDeSiempre')
  await page.getByRole('button', { name: 'Iniciar sesión y unirme' }).click()

  await expect(page).toHaveURL(/\/el-montanista$/)
})

test('cuenta existente: contraseña incorrecta muestra el error del backend sin crear nada', async ({ page }) => {
  await page.route(
    '**/api/auth/invitaciones/consultar',
    mockConsultarInvitacion(200, {
      email: 'existente@example.com',
      rol: 'SOCIO',
      rolLabel: 'Socio',
      invitadoPor: 'Admin Montañista',
      organization: EL_MONTANISTA_ORG,
      cuentaExistente: true,
    }),
  )
  await page.route('**/api/auth/invitaciones/aceptar', (route) => {
    void route.fulfill({
      status: 401,
      json: { error: 'Ya tienes una cuenta con este correo. Verifica tu contraseña e inténtalo de nuevo.' },
    })
  })

  await page.goto('/el-montanista#invite=tokExistente')
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('claveIncorrecta')
  await page.getByRole('button', { name: 'Iniciar sesión y unirme' }).click()

  await expect(page.getByText('Ya tienes una cuenta con este correo. Verifica tu contraseña e inténtalo de nuevo.')).toBeVisible()
})
```

Add `EL_MONTANISTA_ORG` to the existing `import { ... } from './helpers'` line at the top of the file if not already imported (it is defined in `helpers.ts`, confirmed).

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx playwright test e2e/invitaciones.spec.ts -g "cuenta existente"
```

Expected: fails — today's accept-invite view always shows the "create account" form regardless of `cuentaExistente`.

- [ ] **Step 3: Add existing-account state and branch `handleAcceptInvite`**

In `frontend/src/components/AuthPage.tsx`, replace the accept-invite state block (lines 59-67):

```ts
  // Aceptar invitación
  const [inviteInfo, setInviteInfo] = useState<ConsultarInvitacionResponse | null>(null)
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken))
  const [inviteLoadError, setInviteLoadError] = useState<string | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
```

with:

```ts
  // Aceptar invitación
  const [inviteInfo, setInviteInfo] = useState<ConsultarInvitacionResponse | null>(null)
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken))
  const [inviteLoadError, setInviteLoadError] = useState<string | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  // Rama "cuenta existente" (inviteInfo.cuentaExistente): un solo campo de
  // contraseña, sin nombre ni confirmación — ver Global Constraints del plan
  // de esta PR.
  const [existingPassword, setExistingPassword] = useState('')
```

Replace `handleAcceptInvite` (lines 119-152):

```ts
  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)

    if (!inviteName.trim()) {
      setInviteError('El nombre es requerido')
      return
    }
    if (invitePassword.length < 8) {
      setInviteError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (invitePassword !== inviteConfirmPassword) {
      setInviteError('Las contraseñas no coinciden')
      return
    }

    setInviteSubmitting(true)
    try {
      const { email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, inviteName.trim(), invitePassword)
      try {
        // Cuenta recién creada, sin checkbox de "recordar" en esta vista:
        // se recuerda por defecto, igual que el comportamiento de siempre.
        await onLogin(aceptadoEmail, invitePassword, true)
      } catch {
        setLoginNote('Tu cuenta fue creada. Inicia sesión con tu nueva contraseña.')
        setView('login')
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    } finally {
      setInviteSubmitting(false)
    }
  }
```

with:

```ts
  // Rama "cuenta nueva": comportamiento de siempre.
  async function handleAcceptInviteNueva(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)

    if (!inviteName.trim()) {
      setInviteError('El nombre es requerido')
      return
    }
    if (invitePassword.length < 8) {
      setInviteError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (invitePassword !== inviteConfirmPassword) {
      setInviteError('Las contraseñas no coinciden')
      return
    }

    setInviteSubmitting(true)
    try {
      const { message, email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, inviteName.trim(), invitePassword)
      try {
        // Cuenta recién creada, sin checkbox de "recordar" en esta vista:
        // se recuerda por defecto, igual que el comportamiento de siempre.
        // El club primario de una cuenta NUEVA ES el club de la invitación
        // (se crea así), así que el login normal ya aterriza en el lugar
        // correcto — a diferencia de la rama de cuenta existente, ver
        // handleAcceptInviteExistente y Ruling 1 del plan de esta PR.
        await onLogin(aceptadoEmail, invitePassword, true)
      } catch {
        setLoginNote(message)
        setView('login')
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    } finally {
      setInviteSubmitting(false)
    }
  }

  // Rama "cuenta existente" (Ruling 1, 2 y 3 del plan de esta PR): un solo
  // campo de contraseña, sin Authorization (nunca hay sesión abierta acá —
  // ver Ruling 2), y tras el login SIEMPRE navega explícitamente al club de
  // ESTA invitación, nunca al que devuelva el login (que es el club PRIMARIO
  // de la cuenta, no el recién unido).
  async function handleAcceptInviteExistente(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)

    if (!existingPassword) {
      setInviteError('La contraseña es requerida')
      return
    }

    setInviteSubmitting(true)
    try {
      const { message, email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, '', existingPassword)
      const targetSlug = inviteInfo?.organization?.slug
      try {
        await onLogin(aceptadoEmail, existingPassword, true)
        if (targetSlug) {
          window.location.assign(`/${targetSlug}`)
          return
        }
      } catch {
        setLoginNote(message)
        setView('login')
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    } finally {
      setInviteSubmitting(false)
    }
  }
```

- [ ] **Step 4: Branch the accept-invite JSX**

In `frontend/src/components/AuthPage.tsx`, replace the accept-invite success block (lines 288-348, the `{!inviteLoading && !inviteLoadError && inviteInfo && (...)}` branch):

```tsx
                {!inviteLoading && !inviteLoadError && inviteInfo && (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-secondary">
                        <UserPlus size={18} />
                        <h1 className="text-xl font-bold text-slate-800">Crea tu cuenta</h1>
                      </div>
                      <p className="text-on-surface-variant text-sm">
                        <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                        unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                        como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>.
                      </p>
                    </div>

                    <form onSubmit={(e) => void handleAcceptInvite(e)} className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-primary">Email</span>
                        <p
                          className="w-full rounded-xl border border-secondary/40 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
                          aria-label="Email de la invitación"
                        >
                          {inviteInfo.email}
                        </p>
                      </div>

                      <Input
                        type="text"
                        label="Nombre completo"
                        value={inviteName}
                        onChange={(e) => { setInviteName(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="name"
                      />

                      <PasswordInput
                        label="Contraseña"
                        hint="Mínimo 8 caracteres"
                        value={invitePassword}
                        onChange={(e) => { setInvitePassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      <PasswordInput
                        label="Confirmar contraseña"
                        value={inviteConfirmPassword}
                        onChange={(e) => { setInviteConfirmPassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      {inviteError && <p className="text-xs text-error" role="alert">{inviteError}</p>}

                      <Button type="submit" fullWidth disabled={inviteSubmitting}>
                        {inviteSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Crear cuenta'}
                      </Button>
                    </form>
                  </>
                )}
```

with:

```tsx
                {!inviteLoading && !inviteLoadError && inviteInfo && inviteInfo.cuentaExistente && (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-secondary">
                        <ShieldCheck size={18} />
                        <h1 className="text-xl font-bold text-slate-800">Ya tienes una cuenta RIALA</h1>
                      </div>
                      <p className="text-on-surface-variant text-sm">
                        <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                        unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                        como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>. Inicia sesión
                        con tu correo y tu contraseña de siempre para unirte.
                      </p>
                    </div>

                    <form onSubmit={(e) => void handleAcceptInviteExistente(e)} className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-primary">Email</span>
                        <p
                          className="w-full rounded-xl border border-secondary/40 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
                          aria-label="Email de la invitación"
                        >
                          {inviteInfo.email}
                        </p>
                      </div>

                      <PasswordInput
                        label="Contraseña"
                        value={existingPassword}
                        onChange={(e) => { setExistingPassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="current-password"
                        leftIcon={<Lock size={16} />}
                      />

                      {inviteError && <p className="text-xs text-error" role="alert">{inviteError}</p>}

                      <Button type="submit" fullWidth disabled={inviteSubmitting}>
                        {inviteSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Iniciar sesión y unirme'}
                      </Button>
                    </form>
                  </>
                )}

                {!inviteLoading && !inviteLoadError && inviteInfo && !inviteInfo.cuentaExistente && (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-secondary">
                        <UserPlus size={18} />
                        <h1 className="text-xl font-bold text-slate-800">Crea tu cuenta</h1>
                      </div>
                      <p className="text-on-surface-variant text-sm">
                        <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                        unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                        como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>.
                      </p>
                    </div>

                    <form onSubmit={(e) => void handleAcceptInviteNueva(e)} className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-primary">Email</span>
                        <p
                          className="w-full rounded-xl border border-secondary/40 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
                          aria-label="Email de la invitación"
                        >
                          {inviteInfo.email}
                        </p>
                      </div>

                      <Input
                        type="text"
                        label="Nombre completo"
                        value={inviteName}
                        onChange={(e) => { setInviteName(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="name"
                      />

                      <PasswordInput
                        label="Contraseña"
                        hint="Mínimo 8 caracteres"
                        value={invitePassword}
                        onChange={(e) => { setInvitePassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      <PasswordInput
                        label="Confirmar contraseña"
                        value={inviteConfirmPassword}
                        onChange={(e) => { setInviteConfirmPassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      {inviteError && <p className="text-xs text-error" role="alert">{inviteError}</p>}

                      <Button type="submit" fullWidth disabled={inviteSubmitting}>
                        {inviteSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Crear cuenta'}
                      </Button>
                    </form>
                  </>
                )}
```

- [ ] **Step 5: Run and confirm PASS**

```bash
cd frontend
npx playwright test e2e/invitaciones.spec.ts
```

Expected: the two new tests pass, and the existing "flujo feliz" (new account) test still passes unmodified (it never sets `cuentaExistente`, so `mockConsultarInvitacion`'s fixture there needs `cuentaExistente: false` added — update that one line in the existing test's fixture object; `ConsultarInvitacionResponse` now requires the field, so `tsc --noEmit` will already have flagged every fixture missing it).

- [ ] **Step 6: Typecheck and fix every other fixture flagged by the new required field**

```bash
cd frontend
npx tsc --noEmit
```

Add `cuentaExistente: false` (or `true`, matching the scenario) to every `mockConsultarInvitacion(...)` call in `e2e/invitaciones.spec.ts` that the compiler or a failing test flags.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AuthPage.tsx frontend/e2e/invitaciones.spec.ts
git commit -m "feat(clubs): accept an invitation with an existing RIALA account"
```

---

### Task 2: `QrInvitacionPage.tsx` — DIRECTO mode sign-in toggle

**Files:**
- Modify: `frontend/src/components/QrInvitacionPage.tsx`
- Modify: `frontend/e2e/qr-invitaciones.spec.ts`

**Interfaces:**
- Consumes: `registrarConQrDirecto` (`lib/api.ts`, unchanged signature)
- Produces: no new exports.

- [ ] **Step 1: Remove the stale 409 test, write the failing sign-in-toggle tests**

In `frontend/e2e/qr-invitaciones.spec.ts`, delete the existing test at line ~342 (`'409 (correo ya registrado) ofrece iniciar sesión'`) — it asserts a response shape (`409`) `registrarConQrDirecto`'s existing-account branch no longer returns since PR 3 (it now returns `201`); the scenario it was covering is superseded by the tests below.

Add:

```ts
test('modo DIRECTO: alterna a "ya tengo cuenta", pide solo email y contraseña, y aterriza en /<slug> del club del QR', async ({ page }) => {
  await page.route('**/api/qr/consultar', (route) => {
    void route.fulfill({ status: 200, json: { organization: EL_MONTANISTA_ORG, expiresAt: new Date(Date.now() + 3600_000).toISOString(), modo: 'DIRECTO' } })
  })
  let registrarBody: unknown = null
  await page.route('**/api/qr/registrar', (route) => {
    registrarBody = route.request().postDataJSON()
    void route.fulfill({ status: 201, json: { ok: true } })
  })
  await page.route('**/api/auth/login', (route) => {
    void route.fulfill({
      status: 200,
      json: {
        // Mismo fixture que en invitaciones.spec.ts: login devuelve el club
        // PRIMARIO (Pamir), nunca el del QR — prueba que la pantalla no
        // confía en este valor (Ruling 1 del plan de esta PR).
        user: { id: 'user-existente-002', email: 'socio@elmontanista.example.com', name: 'Existente', rol: 'SOCIO', gestorCategorias: [], organization: PAMIR_ORG, clubes: [] },
        token: 'mock-jwt-existente-2',
      },
    })
  })

  await page.goto('/#qr=tokDirecto')
  await page.getByRole('button', { name: /Ya tienes cuenta RIALA/ }).click()

  await expect(page.getByLabel('Nombre completo')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Confirmar contraseña', exact: true })).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('socio@elmontanista.example.com')
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('miClaveDeSiempre')
  await page.getByRole('button', { name: 'Iniciar sesión y unirme' }).click()

  await expect(page).toHaveURL(/\/el-montanista$/)
  expect(registrarBody).toMatchObject({ email: 'socio@elmontanista.example.com', password: 'miClaveDeSiempre' })
})

test('modo DIRECTO, "ya tengo cuenta": contraseña incorrecta muestra el error del backend', async ({ page }) => {
  await page.route('**/api/qr/consultar', (route) => {
    void route.fulfill({ status: 200, json: { organization: EL_MONTANISTA_ORG, expiresAt: new Date(Date.now() + 3600_000).toISOString(), modo: 'DIRECTO' } })
  })
  await page.route('**/api/qr/registrar', (route) => {
    void route.fulfill({ status: 401, json: { error: 'Ya existe una cuenta con ese correo. Inicia sesión.' } })
  })

  await page.goto('/#qr=tokDirecto')
  await page.getByRole('button', { name: /Ya tienes cuenta RIALA/ }).click()
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('socio@elmontanista.example.com')
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('claveIncorrecta')
  await page.getByRole('button', { name: 'Iniciar sesión y unirme' }).click()

  await expect(page.getByText('Ya existe una cuenta con ese correo. Inicia sesión.')).toBeVisible()
})

test('modo DIRECTO: "ya tengo cuenta" nunca consulta al backend si el email escrito tiene cuenta', async ({ page }) => {
  await page.route('**/api/qr/consultar', (route) => {
    void route.fulfill({ status: 200, json: { organization: EL_MONTANISTA_ORG, expiresAt: new Date(Date.now() + 3600_000).toISOString(), modo: 'DIRECTO' } })
  })
  let solicitudesDeConsulta = 0
  await page.route('**/api/**', (route) => {
    if (route.request().url().includes('/marca') || route.request().url().includes('existe')) solicitudesDeConsulta += 1
    void route.continue()
  })

  await page.goto('/#qr=tokDirecto')
  await page.getByRole('button', { name: /Ya tienes cuenta RIALA/ }).click()
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('cualquiera@example.com')

  expect(solicitudesDeConsulta).toBe(0)
})
```

Add `PAMIR_ORG`/`EL_MONTANISTA_ORG` to the file's existing `import { ... } from './helpers'` if missing.

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx playwright test e2e/qr-invitaciones.spec.ts -g "modo DIRECTO"
```

Expected: fails — there is no "Ya tienes cuenta RIALA" toggle today.

- [ ] **Step 3: Add the toggle state and its submit handler**

In `frontend/src/components/QrInvitacionPage.tsx`, remove the `'conflicto-directo'` member from `ViewState` (line 21) and its rendering branch (lines 266-279) — this state is unreachable since PR 3 (the backend's existing-account DIRECTO path no longer 409s; it now succeeds with `201` through the same sign-in proof this task adds).

Replace the DIRECTO-mode state block (lines 88-92):

```ts
  // Modo DIRECTO
  const [directoName, setDirectoName] = useState('')
  const [directoEmail, setDirectoEmail] = useState('')
  const [directoPassword, setDirectoPassword] = useState('')
  const [directoConfirmPassword, setDirectoConfirmPassword] = useState('')
```

with:

```ts
  // Modo DIRECTO — crear cuenta (comportamiento de siempre)
  const [directoName, setDirectoName] = useState('')
  const [directoEmail, setDirectoEmail] = useState('')
  const [directoPassword, setDirectoPassword] = useState('')
  const [directoConfirmPassword, setDirectoConfirmPassword] = useState('')

  // Modo DIRECTO — "ya tengo cuenta" (Global Constraints del plan de esta
  // PR: nunca se consulta al backend si el email escrito tiene cuenta; es
  // una elección de la persona, no una respuesta del servidor).
  const [directoModo, setDirectoModo] = useState<'crear' | 'iniciar-sesion'>('crear')
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
```

Replace `handleSubmitDirecto` (lines 148-197):

```ts
  async function handleSubmitDirecto(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form-directo') return
    setSubmitError(null)

    if (!directoName.trim()) {
      setSubmitError('El nombre es requerido')
      return
    }
    if (directoPassword.length < 8) {
      setSubmitError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (directoPassword !== directoConfirmPassword) {
      setSubmitError('Las contraseñas no coinciden')
      return
    }

    const organization = state.organization
    const emailValor = directoEmail.trim()

    setSubmitting(true)
    try {
      await registrarConQrDirecto(token, { name: directoName.trim(), email: emailValor, password: directoPassword })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization })
        return
      }
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: 'conflicto-directo', organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo completar el registro')
      return
    }

    // Cuenta creada: inicia sesión con las mismas credenciales, igual que el
    // flujo de aceptar una invitación (AuthPage.handleAcceptInvite). Este
    // componente puede desmontarse apenas onIrALaApp() actualiza el estado
    // del padre, así que ningún setState corre después de eso.
    try {
      await onLogin(emailValor, directoPassword, true)
      onIrALaApp()
    } catch {
      setSubmitting(false)
      setState({ kind: 'creado-sin-sesion', organization })
    }
  }
```

with:

```ts
  // Rama "crear cuenta" — comportamiento de siempre. El club PRIMARIO de una
  // cuenta NUEVA ES el club del QR (se crea así), así que el login normal ya
  // aterriza en el lugar correcto — a diferencia de handleSubmitDirectoIniciarSesion.
  async function handleSubmitDirecto(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form-directo') return
    setSubmitError(null)

    if (!directoName.trim()) {
      setSubmitError('El nombre es requerido')
      return
    }
    if (directoPassword.length < 8) {
      setSubmitError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (directoPassword !== directoConfirmPassword) {
      setSubmitError('Las contraseñas no coinciden')
      return
    }

    const organization = state.organization
    const emailValor = directoEmail.trim()

    setSubmitting(true)
    try {
      await registrarConQrDirecto(token, { name: directoName.trim(), email: emailValor, password: directoPassword })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo completar el registro')
      return
    }

    try {
      await onLogin(emailValor, directoPassword, true)
      onIrALaApp()
    } catch {
      setSubmitting(false)
      setState({ kind: 'creado-sin-sesion', organization })
    }
  }

  // Rama "ya tengo cuenta" (Ruling 1 y 2 del plan de esta PR): un solo campo
  // de contraseña, sin nombre ni confirmación, sin Authorization (nunca hay
  // sesión abierta acá). registrarConQrDirecto ya trata la contraseña
  // enviada como prueba de titularidad de una cuenta existente (backend PR
  // 3) — este handler solo cambia qué campos pide y a dónde navega después.
  async function handleSubmitDirectoIniciarSesion(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form-directo') return
    setSubmitError(null)

    const emailValor = signInEmail.trim()
    if (!emailValor) {
      setSubmitError('El email es obligatorio')
      return
    }
    if (!signInPassword) {
      setSubmitError('La contraseña es requerida')
      return
    }

    const organization = state.organization

    setSubmitting(true)
    try {
      await registrarConQrDirecto(token, { name: '', email: emailValor, password: signInPassword })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo completar el registro')
      return
    }

    try {
      await onLogin(emailValor, signInPassword, true)
      // A diferencia de la rama "crear cuenta": el club PRIMARIO de esta
      // cuenta puede ser OTRO club (se estaba uniendo a un SEGUNDO club) —
      // navega explícitamente al club del QR, nunca al que devuelva el
      // login (ver Ruling 1 del plan de esta PR).
      window.location.assign(`/${organization.slug}`)
    } catch {
      setSubmitting(false)
      setState({ kind: 'creado-sin-sesion', organization })
    }
  }
```

- [ ] **Step 4: Delete the `conflicto-directo` branch, add the toggle UI**

In `frontend/src/components/QrInvitacionPage.tsx`, delete the `if (state.kind === 'conflicto-directo') { ... }` block (lines 266-279).

Replace the `form-directo` render block (lines 296-383) to add the toggle link and branch the form itself:

```tsx
  if (state.kind === 'form-directo') {
    return (
      <Shell org={state.organization}>
        {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}

        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
            <UserPlus size={14} />
            Registro directo
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {directoModo === 'crear' ? `Únete a ${clubDisplayName(state.organization)}` : `Inicia sesión para unirte a ${clubDisplayName(state.organization)}`}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {directoModo === 'crear'
              ? 'Completa tus datos y quedarás adentro al instante — este código sirve una sola vez.'
              : 'Ya tienes una cuenta RIALA: inicia sesión con tu correo y tu contraseña de siempre para unirte a este club.'}
          </p>
        </div>

        {directoModo === 'crear' ? (
          <form
            onSubmit={(e) => void handleSubmitDirecto(e)}
            className="flex flex-col gap-4 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 sm:p-6"
          >
            <Input
              type="text"
              label="Nombre completo"
              value={directoName}
              onChange={(e) => { setDirectoName(e.target.value); setSubmitError(null) }}
              required
              autoComplete="name"
              disabled={submitting}
            />

            <Input
              type="email"
              label="Correo electrónico"
              value={directoEmail}
              onChange={(e) => { setDirectoEmail(e.target.value); setSubmitError(null) }}
              placeholder="persona@ejemplo.com"
              required
              autoComplete="email"
              disabled={submitting}
              leftIcon={<AtSign size={16} />}
            />

            <PasswordInput
              label="Contraseña"
              hint="Mínimo 8 caracteres"
              value={directoPassword}
              onChange={(e) => { setDirectoPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="new-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            <PasswordInput
              label="Confirmar contraseña"
              value={directoConfirmPassword}
              onChange={(e) => { setDirectoConfirmPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="new-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            {submitError && <p className="text-xs text-error" role="alert">{submitError}</p>}

            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? 'Creando cuenta...' : 'Unirme ahora'}
            </Button>

            <button
              type="button"
              onClick={() => { setDirectoModo('iniciar-sesion'); setSubmitError(null) }}
              className="text-sm text-secondary text-center hover:underline underline-offset-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ¿Ya tienes cuenta RIALA? Inicia sesión para unirte a {clubDisplayName(state.organization)}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitDirectoIniciarSesion(e)}
            className="flex flex-col gap-4 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 sm:p-6"
          >
            <Input
              type="email"
              label="Correo electrónico"
              value={signInEmail}
              onChange={(e) => { setSignInEmail(e.target.value); setSubmitError(null) }}
              placeholder="persona@ejemplo.com"
              required
              autoComplete="email"
              disabled={submitting}
              leftIcon={<AtSign size={16} />}
            />

            <PasswordInput
              label="Contraseña"
              value={signInPassword}
              onChange={(e) => { setSignInPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="current-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            {submitError && <p className="text-xs text-error" role="alert">{submitError}</p>}

            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? 'Iniciando sesión...' : 'Iniciar sesión y unirme'}
            </Button>

            <button
              type="button"
              onClick={() => { setDirectoModo('crear'); setSubmitError(null) }}
              className="text-sm text-secondary text-center hover:underline underline-offset-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ¿Aún no tienes cuenta? Crea una
            </button>
          </form>
        )}
      </Shell>
    )
  }
```

- [ ] **Step 5: Run and confirm PASS**

```bash
cd frontend
npx playwright test e2e/qr-invitaciones.spec.ts
```

Expected: the three new tests pass; the rest of the file's existing tests (the `form-directo` "crear cuenta" happy path, rate-limit handling) still pass unmodified.

- [ ] **Step 6: Typecheck, lint**

```bash
cd frontend
npx tsc --noEmit
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/QrInvitacionPage.tsx frontend/e2e/qr-invitaciones.spec.ts
git commit -m "feat(clubs): join a second club via QR directo with an existing account"
```

---

### Task 3: "Cambiar de club"

**Files:**
- Modify: `frontend/src/components/shell/AppShell.tsx` (`ShellContext`, line 17)
- Modify: `frontend/src/components/shell/AppHeader.tsx`
- Modify: `frontend/src/App.tsx` (`shell` object construction, lines 96-101)
- Modify: `frontend/e2e/multi-club-routing.spec.ts` (4a's file — new tests only, no removals)

**Interfaces:**
- Consumes: `MisClubesPage` (4a Task 10, unchanged), `ClubMembership` (4a Task 8)
- Produces: `ShellContext.onCambiarClub?: () => void` (new optional field; every existing consumer of `ShellContext` — 11+ components — needs no change, since they all pass the whole object through untouched)

- [ ] **Step 1: Write the failing E2E test**

Append to `frontend/e2e/multi-club-routing.spec.ts`:

```ts
test.describe('Cambiar de club', () => {
  test('con dos membresías, el header ofrece Cambiar de club y navega a Mis clubes', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false },
      ],
    }
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/el-montanista')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.getByRole('button', { name: 'Cambiar de club' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()
  })

  test('con una sola membresía, el header NO ofrece Cambiar de club', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/pamir')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cambiar de club' })).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run and confirm the expected failure**

```bash
cd frontend
npx playwright test e2e/multi-club-routing.spec.ts -g "Cambiar de club"
```

- [ ] **Step 3: Add `onCambiarClub` to `ShellContext`**

In `frontend/src/components/shell/AppShell.tsx`, extend the interface (lines 17-22):

```ts
export interface ShellContext {
  userName: string
  canSeeDocumentos: boolean
  onLogout: () => void
  onNavigate: (key: NavKey) => void
  // undefined = la cuenta tiene una sola membresía (o clubes todavía no se
  // conoce) — AppHeader no muestra el botón. Navega con una recarga completa
  // a propósito (window.location.assign), igual que cualquier cambio de club:
  // reinicia el árbol de React contra el nuevo club en vez de intentar
  // reconciliar el estado de la sesión anterior en el cliente.
  onCambiarClub?: () => void
}
```

Pass it through to `AppHeader` (in `AppShell`'s render, alongside the other `shell.*` props):

```tsx
      <AppHeader
        userName={shell.userName}
        active={active}
        onNavigate={shell.onNavigate}
        canSeeDocumentos={shell.canSeeDocumentos}
        onLogout={shell.onLogout}
        onCambiarClub={shell.onCambiarClub}
        isDesktop={isDesktop}
        showNav={showNav}
        title={title}
        onBack={onBack}
      />
```

- [ ] **Step 4: Add the button to `AppHeader`**

In `frontend/src/components/shell/AppHeader.tsx`, add `RefreshCw` to the `lucide-react` import (line 1) and extend `AppHeaderProps` (after `onLogout: () => void`, line 15):

```ts
  onLogout: () => void
  onCambiarClub?: () => void
```

Destructure it in the function signature and render it just before the existing "Salir" button (inside the final `<div className="flex items-center gap-2 sm:gap-3 shrink-0">`, lines 140-156):

```tsx
export function AppHeader({
  userName,
  active,
  onNavigate,
  canSeeDocumentos,
  onLogout,
  onCambiarClub,
  isDesktop,
  showNav,
  title,
  onBack,
}: AppHeaderProps) {
```

```tsx
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isDesktop && (
            <span className="text-body-sm font-bold text-on-surface leading-none max-w-[14rem] truncate">
              {userName}
            </span>
          )}
          <span
            aria-hidden="true"
            className="w-9 h-9 rounded-full bg-primary-fixed text-on-primary-fixed border border-primary/15 flex items-center justify-center font-bold text-body-sm shrink-0"
          >
            {initials}
          </span>
          {onCambiarClub && (
            <Button variant="ghost" size="sm" onClick={onCambiarClub} aria-label="Cambiar de club">
              <RefreshCw size={16} />
              <span className="hidden sm:inline">Cambiar de club</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Cerrar sesion">
            <LogOut size={16} />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
```

(The visible label is "Cambiar de club" on `sm:` and up, matching the existing "Salir" pattern; `aria-label` covers the icon-only mobile rendering.)

- [ ] **Step 5: Build `shell.onCambiarClub` in `App.tsx`**

In `frontend/src/App.tsx`, extend the `shell` object (lines 96-101):

```ts
  const shell: ShellContext = {
    userName: user?.name ?? '',
    canSeeDocumentos: esSocioClubActual || isAdmin,
    onLogout: logout,
    onNavigate: (key) => setRoute(key === 'inicio' ? 'dashboard' : key),
    // Solo ofrece "Cambiar de club" con MÁS de una membresía — spec Design §3
    // ("solo para gente con más de una membresía"). Navega a la raíz sin
    // slug: AppContent (ver el bloque de Mis clubes agregado en 4a) ya
    // decide ahí mismo mostrar el picker en vez de redirigir, porque
    // clubes.length > 1.
    onCambiarClub: (user?.clubes?.length ?? 0) > 1 ? () => window.location.assign('/') : undefined,
  }
```

- [ ] **Step 6: Run and confirm PASS**

```bash
cd frontend
npx playwright test e2e/multi-club-routing.spec.ts
```

- [ ] **Step 7: Run the full E2E suite (regression check across every other screen using `ShellContext`)**

```bash
cd frontend
npx playwright test
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/shell/AppShell.tsx frontend/src/components/shell/AppHeader.tsx frontend/src/App.tsx frontend/e2e/multi-club-routing.spec.ts
git commit -m "feat(clubs): add Cambiar de club to the app header"
```

---

### Task 4: `README.md` — "Clubes (multi-tenant)"

**Files:**
- Modify: `README.md` (lines 164, and the "Frontend: branding y sesión por club" section starting at line 288)

**Interfaces:** none (documentation only)

- [ ] **Step 1: Fix the stale one-account-one-club claim**

In `README.md`, replace line 164:

```md
La app nació para un solo club (Andino Club Pamir) y sirve varios. Cada tabla
de negocio lleva una columna `organization_id` (modelo `Organization` en
`backend/prisma/schema.prisma`, tabla `organizations`), y una prueba estática
(`backend/src/lib/schema-organization.test.ts`) falla si se agrega un modelo
nuevo sin ella. Una cuenta (`User.email`) pertenece a exactamente un club — no
hay cuentas compartidas entre clubes. `numeroSalida` es un correlativo por
```

with:

```md
La app nació para un solo club (Andino Club Pamir) y sirve varios. Cada tabla
de negocio lleva una columna `organization_id` (modelo `Organization` en
`backend/prisma/schema.prisma`, tabla `organizations`), y una prueba estática
(`backend/src/lib/schema-organization.test.ts`) falla si se agrega un modelo
nuevo sin ella. Una cuenta (`User.email`, único en toda la plataforma) puede
pertenecer a varios clubes a la vez, una `Membresia` por club con su propio
rol (`backend/prisma/schema.prisma`, modelo `Membresia`) — ver "Membresías
multi-club" más abajo. `numeroSalida` es un correlativo por
```

- [ ] **Step 2: Add a "Membresías multi-club" subsection**

In `README.md`, after the existing "### Frontend: branding y sesión por club" section (find its end — the section that follows it, before the next `###` heading), add a new subsection:

```md
### Membresías multi-club

Una cuenta (`User`) es una identidad de plataforma: un email, una contraseña,
un nombre. A qué club pertenece y con qué rol es la tabla `Membresia`
(`organizationId`, `usuarioId`, `rol`), una fila por club del que es socia.
`User.organizationId`/`User.rol` siguen existiendo (el club "primario" de la
cuenta — el que resuelve un login normal, sin `X-Club`) pero ya no son la
única pertenencia posible.

- **Resolución del club activo por request**: el frontend manda el slug del
  club actual en el header `X-Club` (derivado del path — ver "Frontend:
  branding y sesión por club" arriba); `authMiddleware` busca la `Membresia`
  de esa cuenta en ese club y arma `req.user` con ella. Sin `X-Club` y una
  sola membresía, usa esa (compatibilidad); sin `X-Club` y varias, `400`
  "Selecciona un club".
- **Unirse a un segundo club** requiere consentimiento: una invitación o un
  QR de ese club, y quien ya tiene cuenta la confirma con su contraseña de
  siempre (o una sesión ya verificada) — nunca una segunda cuenta con el
  mismo email. Solo se crea la `Membresia`; el perfil compartido (nombre,
  contraseña) nunca se toca. Ver
  `docs/superpowers/specs/2026-09-23-multi-club-membership-design.md`.
- **`login`/`GET /api/me`** devuelven `clubes[]`: todas las membresías de la
  cuenta (`slug`, `name`, `shortName`, `hasLogo`, `logoVersion`, `rol`,
  `suspendido`), ordenadas de la más antigua a la más nueva — alimenta "Mis
  clubes" y "Cambiar de club" en el frontend. `login` sigue resolviendo el
  club PRIMARIO (`User.organizationId`) sin importar `X-Club` — no confundir
  con el club activo de una request autenticada normal, que sí lo respeta.
```

- [ ] **Step 3: Read the rendered section back**

```bash
sed -n '158,340p' README.md
```

Confirm the new prose reads correctly in context (no dangling heading levels, no orphaned sentence from the old line 164 wording).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document multi-club membership in README"
```

---

### Task 5: `alta-de-club` skill — first admin may already have an account

**Files:**
- Modify: `.claude/skills/alta-de-club/references/alta-de-club.md`

**Interfaces:** none (documentation only)

- [ ] **Step 1: Confirm the owner's uncommitted hunk before touching the file**

```bash
cd /Users/rodrigocontrerasrubio/proyectos/pamirv2
git diff -- .claude/skills/alta-de-club/references/alta-de-club.md
```

Expected (already confirmed during planning): a single-line replacement in the `contactName`/`contactEmail` row of the file's field table (around line 20), unrelated to this task. Do not touch that line, and do not run `git add -A`/`git commit -a` for this file — stage only this task's own hunk in Step 4.

- [ ] **Step 2: Read the `tenant:create --admin-email` section**

```bash
sed -n '1,60p' .claude/skills/alta-de-club/references/alta-de-club.md
```

(Read enough of the file to find where it currently describes `--admin-email` and the first-ADMIN invitation flow — the exact line numbers depend on the owner's already-uncommitted edit above it, so this plan does not assume a fixed line number for this step's target; find the paragraph by content, e.g. a `## Alta de un club` or `--admin-email` heading.)

- [ ] **Step 3: Add the note**

Add, immediately after the paragraph that explains `--admin-email` mints an invitation for the first `ADMIN` (wording matched to whatever that paragraph already says — do not restate it, append to it):

```md
Si el correo de `--admin-email` ya tiene una cuenta RIALA (de otro club), la
invitación de plataforma igual se emite: la persona la acepta iniciando
sesión con su contraseña de siempre en vez de crear una cuenta nueva, y se le
agrega la membresía `ADMIN` de este club sin tocar su perfil compartido — ver
`docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` y el plan
`docs/superpowers/plans/2026-09-24-multi-club-03-joining.md` (Ruling 7).
```

- [ ] **Step 4: Stage and commit only this task's hunk**

```bash
cd /Users/rodrigocontrerasrubio/proyectos/pamirv2
git diff -- .claude/skills/alta-de-club/references/alta-de-club.md
```

Confirm the diff now shows exactly two separate hunks: the owner's pre-existing 1-line `contactName`/`contactEmail` change, and this task's new paragraph. If the diff tool/editor merged them into one indistinguishable hunk, use `git add -p` and select only the new paragraph's hunk; if the two are adjacent enough that `git add -p` cannot split them cleanly, stop and report this rather than committing the owner's line under this task's message.

```bash
git add -p .claude/skills/alta-de-club/references/alta-de-club.md
git commit -m "docs(alta-de-club): note the first admin's email may already have an account"
```

- [ ] **Step 5: Confirm the owner's original hunk is still uncommitted**

```bash
git diff -- .claude/skills/alta-de-club/references/alta-de-club.md
```

Expected: shows exactly the owner's original 1-line change, untouched, still uncommitted — confirming this task's commit did not absorb it.

---

### Task 6: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Frontend — full suite**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
npm run test
npx playwright test
```

- [ ] **Step 2: Backend — confirm untouched (no backend files in this plan's diff)**

```bash
cd /Users/rodrigocontrerasrubio/proyectos/pamirv2
git diff --stat main -- backend/
```

Expected: empty (this plan makes no backend changes; everything it uses shipped in PR 3 and plan 4a).

- [ ] **Step 3: Confirm no unrelated files were touched**

```bash
git status --porcelain
```

Expected: only this plan's File Structure table entries appear across its commits; `docs/de-pamir-a-riala.html` remains untracked and untouched (Ruling 4); the owner's `.DS_Store`/`docs/manual-*`/`.atl/`/`.gitignore` stay exactly as they were.

- [ ] **Step 4: Post-deploy checks (after CI ships this alongside 4a)**

- An existing single-club account still lands in its own club with no visible change.
- A club-invite/QR link minted before this PR (no path slug, `riala.cl/#invite=...`) still works.
- A club-invite/QR link minted after 4a (with a path slug) resolves branding and accept/register correctly.
- "Mis clubes" and "Cambiar de club" are invisible to every single-club account (the overwhelming majority in production today).
- No migration runs as part of this deploy (plan 4a already noted none is needed; this plan needs none either).

---

## Self-Review

**1. Spec coverage.** "Joining with an existing account" (both invitation and QR-directo) → Tasks 1, 2. "Cambiar de club... only for people with more than one membership" → Task 3. Docs paragraph → Tasks 4, 5 (the third target, `docs/de-pamir-a-riala.html`, is explicitly deferred — Ruling 4 — since it is untracked and not cleanly splittable). Testing list's remaining two E2E items (join by invitation with existing account, join by QR-directo with existing account) → Tasks 1, 2; the other four items (login at a slug, Mis clubes, Cambiar de club, not-a-member) were already covered by plan 4a (login-at-slug/Mis-clubes/not-a-member in 4a Task 10/11; Cambiar de club is this plan's own Task 3, which also covers its own E2E). Error table: no new errors are introduced by this plan (401/403/409-for-other-cases were all already pinned in PR 3's isolation suite); this plan's job is presentation only.

**2. Placeholder scan.** No "TBD"/unstated logic. Task 5's Step 2 deliberately does not hardcode a line number (the owner's uncommitted edit shifts it) — it specifies exactly what to search for and how to verify the target paragraph, which is a concrete instruction, not a placeholder.

**3. Type consistency.** `ShellContext.onCambiarClub?: () => void` (Task 3) matches `AppHeader`'s new `onCambiarClub?: () => void` prop exactly. `handleAcceptInviteExistente`/`handleSubmitDirectoIniciarSesion` (Tasks 1, 2) both call `aceptarInvitacion`/`registrarConQrDirecto` with the exact same parameter shapes those functions already have in `lib/api.ts` (no `lib/api.ts` change in this plan — confirmed against 4a's already-typed `ConsultarInvitacionResponse.cuentaExistente` and the existing `AceptarInvitacionResponse`/`RegistrarConQrDirectoResponse`).

**4. Review Focus.** #1 (land on the new club, not the primary one) → Ruling 1 + Task 1/2's explicit-redirect assertions (`toHaveURL(/\/el-montanista$/)`). #2 (no enumeration probe on the QR screen) → Task 2's network-call-count test. #3 (wrong password surfaces cleanly) → Task 1/2's 401 tests. #4 (Cambiar de club hidden for single-membership) → Task 3's second test. #5 (owner's uncommitted hunk survives) → Task 5 Steps 1, 4, 5.

## Execution Handoff

Plan 4b complete and saved to `docs/superpowers/plans/2026-09-24-multi-club-04b-join-screens.md`. It must not start before plan 4a (`docs/superpowers/plans/2026-09-24-multi-club-04a-frontend-routing.md`) is reviewed, merged, and deployed. Please review this plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — implement every task in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**, for the same reason as plan 4a: Ruling 1's "redirect explicitly, never trust the login response" is the kind of mistake that looks correct in a quick manual check (a fresh test account's primary club always happens to match) and only breaks for a real second-club join — a fresh reviewer checking Task 1 before Task 2 is written the same way catches the pattern once instead of twice.

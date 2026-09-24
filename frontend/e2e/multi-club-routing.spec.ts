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

test.describe('Legacy ?club= redirige a /<slug>', () => {
  test('riala.cl/?club=<slug> reescribe la URL a /<slug> antes del primer render, sin sesión', async ({ page }) => {
    await page.goto('/?club=el-montanista')
    // redirectLegacyClubQueryParam corre antes de montar React (llamada a
    // nivel de módulo en App.tsx) — la URL ya quedó reescrita para cuando
    // Playwright puede observarla, y no perdió el resto de la navegación
    // (login sigue disponible, sin sesión).
    await expect(page).toHaveURL(/\/el-montanista$/)
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
  })
})

test.describe('Invitación en el dominio raíz (sin slug) sigue funcionando', () => {
  test('riala.cl/#invite=<token> sin sesión llega a la pantalla de invitación, sin slug en el path', async ({ page }) => {
    await page.route('**/api/auth/invitaciones/consultar', (route) => {
      void route.fulfill({
        status: 200,
        json: {
          email: 'nuevo@example.com',
          rol: 'SOCIO',
          rolLabel: 'Socio',
          invitadoPor: 'Admin Seguridad',
          organization: PAMIR_ORG,
        },
      })
    })

    await page.goto('/#invite=tok123')

    await expect(page.getByText('Admin Seguridad')).toBeVisible()
    await expect(page.getByText('nuevo@example.com')).toBeVisible()
  })
})

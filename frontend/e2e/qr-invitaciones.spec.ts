import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import {
  setAuth,
  mockHasIntegrante,
  mockSalidas,
  MOCK_ADMIN,
  MOCK_LIDER,
  PAMIR_ORG,
} from './helpers'

const MENSAJE_GENERICO =
  'Si el correo puede recibir una invitación, te llegará en unos minutos. Revisa también la carpeta de spam. ' +
  'Si ya tienes cuenta, inicia sesión.'

// Forma real de PublicOrganizationBrand (ver serializers/organization.ts en
// el backend) — distinta de PAMIR_ORG de helpers.ts, que trae id/membresiaPropia
// (para una sesión autenticada) en vez de hasLogo/logoVersion.
const QR_BRAND = { slug: 'pamir', name: PAMIR_ORG.name, shortName: PAMIR_ORG.shortName, hasLogo: false, logoVersion: null }

function mockCodigo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'qr-001',
    etiqueta: null,
    rol: 'SOCIO',
    maxUsos: 50,
    usos: 0,
    usosRestantes: 50,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    revocadoAt: null,
    createdAt: new Date().toISOString(),
    estado: 'ACTIVO',
    creadoPor: { id: MOCK_ADMIN.id, name: MOCK_ADMIN.name },
    ...overrides,
  }
}

test.describe('QR del club — ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await page.route('**/api/invitaciones', (route: Route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({ status: 200, json: { invitaciones: [] } })
      } else {
        void route.continue()
      }
    })
  })

  test('genera un código con los valores por defecto, lo reabre, descarga el SVG y lo revoca', async ({ page }) => {
    let codigos: unknown[] = []
    let creacionBody: unknown = null

    await page.route('**/api/invitaciones/qr', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, json: { codigos } })
        return
      }
      if (req.method() === 'POST') {
        creacionBody = req.postDataJSON()
        const codigo = mockCodigo()
        codigos = [codigo]
        await route.fulfill({
          status: 201,
          json: { codigo, qrUrl: 'http://localhost:5174/#qr=abcdef123456' },
        })
        return
      }
      await route.continue()
    })

    await page.route('**/api/invitaciones/qr/qr-001', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: { codigo: mockCodigo(), qrUrl: 'http://localhost:5174/#qr=abcdef123456' },
      })
    })

    let revocarLlamado = false
    await page.route('**/api/invitaciones/qr/qr-001/revocar', (route: Route) => {
      revocarLlamado = true
      codigos = [mockCodigo({ estado: 'REVOCADO', revocadoAt: new Date().toISOString() })]
      void route.fulfill({
        status: 200,
        json: { codigo: mockCodigo({ estado: 'REVOCADO', revocadoAt: new Date().toISOString() }) },
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Invitar al club' }).click()
    await page.getByRole('tab', { name: 'QR del club' }).click()

    await page.getByRole('button', { name: 'Generar código QR' }).click()

    await expect.poll(() => creacionBody).toEqual({ duracion: '24h', maxUsos: 50 })
    await expect(page.getByAltText('Código QR del club')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar SVG' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^riala-qr-.*\.svg$/)

    // La lista ya muestra el código recién creado.
    await expect(page.getByRole('listitem').filter({ hasText: 'Sin etiqueta' })).toBeVisible()

    await page.getByRole('button', { name: 'Ver QR' }).click()
    await expect(page.getByAltText('Código QR del club')).toBeVisible()

    await page.getByRole('button', { name: 'Revocar' }).click()
    await page.getByRole('button', { name: 'Sí, revocar' }).click()
    await expect.poll(() => revocarLlamado).toBe(true)
    await expect(page.getByText('Revocado')).toBeVisible()
  })
})

test.describe('QR del club — LIDER', () => {
  test('la lista no muestra la columna de creador', async ({ page }) => {
    await setAuth(page, MOCK_LIDER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await page.route('**/api/invitaciones', (route: Route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({ status: 200, json: { invitaciones: [] } })
      } else {
        void route.continue()
      }
    })
    await page.route('**/api/invitaciones/qr', (route: Route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          json: { codigos: [mockCodigo({ creadoPor: { id: MOCK_LIDER.id, name: MOCK_LIDER.name } })] },
        })
      } else {
        void route.continue()
      }
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Invitar al club' }).click()
    await page.getByRole('tab', { name: 'QR del club' }).click()

    await expect(page.getByRole('listitem').filter({ hasText: 'Sin etiqueta' })).toBeVisible()
    await expect(page.getByText(`Creado por: ${MOCK_LIDER.name}`)).toHaveCount(0)
    await expect(page.getByText(/Creado por:/)).toHaveCount(0)
  })
})

test.describe('QR del club — landing pública', () => {
  test('camino feliz: consulta la marca, envía la solicitud y muestra el mensaje genérico', async ({ page }) => {
    await page.route('**/api/qr/consultar', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: { organization: QR_BRAND, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
      })
    })
    let solicitarBody: unknown = null
    await page.route('**/api/qr/solicitar', (route: Route) => {
      solicitarBody = route.request().postDataJSON()
      void route.fulfill({ status: 202, json: { message: MENSAJE_GENERICO } })
    })

    await page.goto('/#qr=tokFeliz')

    // La única imagen de esta pantalla es el logo del club, en el encabezado.
    await expect(page.locator('img')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: PAMIR_ORG.name })).toBeVisible()
    // El fragmento se limpia de la URL apenas se lee (espera a que el fetch
    // y el re-render ya hayan corrido, para no competir con el efecto).
    await expect.poll(() => page.url()).not.toContain('qr=')

    await page.getByLabel('Email').fill('nuevo@example.com')
    await page.getByRole('button', { name: 'Enviar invitación' }).click()

    await expect(page.getByText(MENSAJE_GENERICO)).toBeVisible()
    await expect.poll(() => solicitarBody).toEqual({ token: 'tokFeliz', email: 'nuevo@example.com' })
  })

  test('un código no disponible (410) muestra el mensaje del backend', async ({ page }) => {
    await page.route('**/api/qr/consultar', (route: Route) => {
      void route.fulfill({
        status: 410,
        json: { error: 'Este código QR ya no está disponible. Pide uno nuevo a quien organiza.' },
      })
    })

    await page.goto('/#qr=tokVencido')

    await expect(page.getByText('Este código QR ya no está disponible. Pide uno nuevo a quien organiza.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ir a iniciar sesión' })).toBeVisible()
  })

  test('demasiados intentos (429) muestra el mensaje de límite de tasa', async ({ page }) => {
    await page.route('**/api/qr/consultar', (route: Route) => {
      void route.fulfill({ status: 429, json: { error: 'Demasiadas solicitudes, intenta más tarde' } })
    })

    await page.goto('/#qr=tokLimitado')

    await expect(page.getByText('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')).toBeVisible()
  })
})

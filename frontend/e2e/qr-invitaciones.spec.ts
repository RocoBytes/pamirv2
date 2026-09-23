import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import {
  setAuth,
  mockHasIntegrante,
  mockNoIntegrante,
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
    modo: 'CORREO',
    registrado: null,
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

  test('QR directo: panel con QR y cuenta regresiva, cambia solo a AGOTADO con quien se registró, y "Generar otro" crea uno nuevo', async ({ page }) => {
    let crearCount = 0
    let estadoCount = 0

    await page.route('**/api/invitaciones/qr', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, json: { codigos: [] } })
        return
      }
      if (req.method() === 'POST') {
        crearCount += 1
        expect(req.postDataJSON()).toEqual({ modo: 'DIRECTO' })
        const codigo = mockCodigo({
          id: `qr-directo-${crearCount}`,
          modo: 'DIRECTO',
          maxUsos: 1,
          usosRestantes: 1,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        await route.fulfill({
          status: 201,
          json: { codigo, qrUrl: `http://localhost:5174/#qr=directo-token-${crearCount}` },
        })
        return
      }
      await route.continue()
    })

    // El primer código pasa a AGOTADO con "registrado" en su primer poll (a
    // los 4s); el segundo (creado por "Generar otro") se mantiene ACTIVO.
    await page.route('**/api/invitaciones/qr/qr-directo-1/estado', (route: Route) => {
      estadoCount += 1
      void route.fulfill({
        status: 200,
        json: {
          estado: 'AGOTADO',
          registrado: { name: 'Persona Nueva', email: 'nueva@example.com' },
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      })
    })
    await page.route('**/api/invitaciones/qr/qr-directo-2/estado', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          estado: 'ACTIVO',
          registrado: null,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Invitar al club' }).click()
    await page.getByRole('tab', { name: 'QR del club' }).click()

    await page.getByRole('button', { name: 'QR directo (1 persona)' }).click()
    await expect(page.getByAltText('QR directo')).toBeVisible()
    await expect(page.getByText(/Vence en \d{2}:\d{2}/)).toBeVisible()

    // Poleado cada 4s — se detecta el cambio a AGOTADO sin recargar ni hacer clic.
    await expect(page.getByText('¡Listo! Persona Nueva se unió a')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('nueva@example.com')).toBeVisible()
    await expect.poll(() => estadoCount).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Generar otro QR directo' }).click()
    await expect(page.getByAltText('QR directo')).toBeVisible()
    await expect.poll(() => crearCount).toBe(2)
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

test.describe('QR directo — landing pública (registro en el acto)', () => {
  function mockConsultarDirecto() {
    return (route: Route) => {
      void route.fulfill({
        status: 200,
        json: { organization: QR_BRAND, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), modo: 'DIRECTO' },
      })
    }
  }

  async function llenarFormulario(page: import('@playwright/test').Page) {
    await page.getByLabel('Nombre completo').fill('Persona Directa')
    await page.getByLabel('Correo electrónico').fill('nueva-directo@example.com')
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('password123')
    await page.getByRole('textbox', { name: 'Confirmar contraseña', exact: true }).fill('password123')
  }

  test('camino feliz: se registra, inicia sesión y entra a la app', async ({ page }) => {
    await page.route('**/api/qr/consultar', mockConsultarDirecto())
    let registrarBody: unknown = null
    await page.route('**/api/qr/registrar', (route: Route) => {
      registrarBody = route.request().postDataJSON()
      void route.fulfill({ status: 201, json: { ok: true } })
    })
    await page.route('**/api/auth/login', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          user: {
            id: 'user-directo-001',
            email: 'nueva-directo@example.com',
            name: 'Persona Directa',
            rol: 'SOCIO',
            gestorCategorias: [],
            organization: PAMIR_ORG,
          },
          token: 'mock-jwt-directo',
        },
      })
    })
    await mockNoIntegrante(page)
    await mockSalidas(page)

    await page.goto('/#qr=tokDirecto')

    await expect(page.getByRole('heading', { name: /Únete a/ })).toBeVisible()
    await llenarFormulario(page)
    await page.getByRole('button', { name: 'Unirme ahora' }).click()

    await expect.poll(() => registrarBody).toEqual({
      token: 'tokDirecto',
      name: 'Persona Directa',
      email: 'nueva-directo@example.com',
      password: 'password123',
    })

    // Login automático con las mismas credenciales, sin token de sesión en la
    // respuesta de /registrar — aterriza directo en la app (dashboard).
    await expect(page.getByText('Completa tu registro').first()).toBeVisible()
  })

  test('409 (correo ya registrado) ofrece iniciar sesión', async ({ page }) => {
    await page.route('**/api/qr/consultar', mockConsultarDirecto())
    await page.route('**/api/qr/registrar', (route: Route) => {
      void route.fulfill({ status: 409, json: { error: 'Ya existe una cuenta con ese correo. Inicia sesión.' } })
    })

    await page.goto('/#qr=tokConflicto')
    await llenarFormulario(page)
    await page.getByRole('button', { name: 'Unirme ahora' }).click()

    await expect(page.getByText('Ya existe una cuenta con ese correo')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
  })

  test('las contraseñas que no coinciden se detectan sin llamar al backend', async ({ page }) => {
    await page.route('**/api/qr/consultar', mockConsultarDirecto())
    let registrarLlamado = false
    await page.route('**/api/qr/registrar', (route: Route) => {
      registrarLlamado = true
      void route.fulfill({ status: 201, json: { ok: true } })
    })

    await page.goto('/#qr=tokMismatch')
    await page.getByLabel('Nombre completo').fill('Alguien')
    await page.getByLabel('Correo electrónico').fill('alguien@example.com')
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('password123')
    await page.getByRole('textbox', { name: 'Confirmar contraseña', exact: true }).fill('otraClave123')
    await page.getByRole('button', { name: 'Unirme ahora' }).click()

    await expect(page.getByText('Las contraseñas no coinciden')).toBeVisible()
    expect(registrarLlamado).toBe(false)
  })
})

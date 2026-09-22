import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import {
  setAuth,
  mockNoIntegrante,
  mockHasIntegrante,
  mockSalidas,
  MOCK_USER,
  MOCK_ADMIN,
  MOCK_LIDER,
} from './helpers'

function mockConsultarInvitacion(status: number, json: unknown) {
  return (route: Route) => {
    void route.fulfill({ status, json })
  }
}

test.describe('Aceptar invitación (usuario no autenticado)', () => {
  test('flujo feliz: acepta, se loguea automáticamente y el token desaparece de la URL', async ({ page }) => {
    await page.route(
      '**/api/auth/invitaciones/consultar',
      mockConsultarInvitacion(200, {
        email: 'nuevo@example.com',
        rol: 'SOCIO',
        rolLabel: 'Socio',
        invitadoPor: 'Admin Seguridad',
      }),
    )
    await page.route('**/api/auth/invitaciones/aceptar', (route) => {
      void route.fulfill({
        status: 201,
        json: { message: 'Cuenta creada. Ya puedes iniciar sesión.', email: 'nuevo@example.com' },
      })
    })
    await page.route('**/api/auth/login', (route) => {
      void route.fulfill({
        status: 200,
        json: {
          user: {
            id: 'user-nuevo-001',
            email: 'nuevo@example.com',
            name: 'Nuevo Socio',
            rol: 'SOCIO',
            gestorCategorias: [],
          },
          token: 'mock-jwt-nuevo',
        },
      })
    })
    await mockNoIntegrante(page)
    await mockSalidas(page)

    await page.goto('/#invite=tok123')

    await expect(page.getByText('Admin Seguridad')).toBeVisible()
    await expect(page.getByText('nuevo@example.com')).toBeVisible()
    await expect(page.getByText('Socio', { exact: true })).toBeVisible()

    await page.getByPlaceholder('Nombre completo').fill('Nuevo Socio')
    await page.getByPlaceholder('Contraseña (mín. 8 caracteres)').fill('password123')
    await page.getByPlaceholder('Confirmar contraseña').fill('password123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()

    await expect(page.getByText('Completa tu registro').first()).toBeVisible()
    expect(page.url()).not.toContain('invite=')
  })

  test('invitación inválida o expirada muestra el mensaje del backend y permite volver al login', async ({ page }) => {
    await page.route(
      '**/api/auth/invitaciones/consultar',
      mockConsultarInvitacion(410, { error: 'La invitación expiró. Pide a quien te invitó que la reenvíe.' }),
    )

    await page.goto('/#invite=tokExpirado')

    await expect(page.getByText('La invitación expiró. Pide a quien te invitó que la reenvíe.')).toBeVisible()
    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
  })

  test('las contraseñas que no coinciden se detectan sin llamar al backend', async ({ page }) => {
    await page.route(
      '**/api/auth/invitaciones/consultar',
      mockConsultarInvitacion(200, {
        email: 'nuevo@example.com',
        rol: 'SOCIO',
        rolLabel: 'Socio',
        invitadoPor: 'Admin Seguridad',
      }),
    )
    let aceptarLlamado = false
    await page.route('**/api/auth/invitaciones/aceptar', (route) => {
      aceptarLlamado = true
      void route.fulfill({ status: 201, json: { message: 'ok', email: 'nuevo@example.com' } })
    })

    await page.goto('/#invite=tok123')
    await expect(page.getByText('Admin Seguridad')).toBeVisible()

    await page.getByPlaceholder('Nombre completo').fill('Nuevo Socio')
    await page.getByPlaceholder('Contraseña (mín. 8 caracteres)').fill('password123')
    await page.getByPlaceholder('Confirmar contraseña').fill('otraClave123')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()

    await expect(page.getByText('Las contraseñas no coinciden')).toBeVisible()
    expect(aceptarLlamado).toBe(false)
  })
})

test.describe('Sesión activa + enlace de invitación', () => {
  test('muestra el interstitial y permite continuar con la sesión actual', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/#invite=tokXYZ')

    await expect(page.getByText(new RegExp(`Ya iniciaste sesión como ${MOCK_USER.email}`))).toBeVisible()
    const cerrarYContinuar = page.getByRole('button', { name: 'Cerrar sesión y continuar' })
    const seguirConSesion = page.getByRole('button', { name: 'Seguir con mi sesión' })
    await expect(cerrarYContinuar).toBeVisible()
    await expect(seguirConSesion).toBeVisible()

    await seguirConSesion.click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })
})

test.describe('Invitar — LIDER', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_LIDER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('ve el botón Invitar y su rol de destino no es elegible', async ({ page }) => {
    await page.route('**/api/invitaciones', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({ status: 200, json: { invitaciones: [] } })
      } else {
        void route.continue()
      }
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Invitar al club' })).toBeVisible()
    await page.getByRole('button', { name: 'Invitar al club' }).click()

    await expect(page.getByRole('heading', { name: 'Invitar al club' })).toBeVisible()
    await expect(page.getByLabel('Rol')).toHaveCount(0)
    await expect(page.getByText('Se invitará como Socio.')).toBeVisible()
  })

  test('invita por email; cuando el correo no se envía, ofrece copiar el enlace y la invitación queda en la lista', async ({ page }) => {
    let invitaciones: unknown[] = []
    await page.route('**/api/invitaciones', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, json: { invitaciones } })
        return
      }
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as { email: string; rol?: string }
        const nueva = {
          id: 'inv-001',
          email: body.email,
          rol: body.rol ?? 'SOCIO',
          estado: 'PENDIENTE',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          aceptadaAt: null,
          revocadaAt: null,
          invitadoPor: { id: MOCK_LIDER.id, name: MOCK_LIDER.name },
        }
        invitaciones = [nueva, ...invitaciones]
        await route.fulfill({
          status: 201,
          json: { invitacion: nueva, inviteUrl: 'http://localhost:5173/#invite=abcdef', emailEnviado: false },
        })
        return
      }
      await route.continue()
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Invitar al club' }).click()

    await page.getByLabel('Email').fill('candidato@example.com')
    await page.getByRole('button', { name: 'Enviar invitación' }).click()

    await expect(
      page.getByText('No se pudo enviar el correo. Comparte el enlace manualmente.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar enlace' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'candidato@example.com', exact: true })).toBeVisible()
  })
})

test.describe('Invitar — SOCIO', () => {
  test('no ve el botón Invitar', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invitar al club' })).toHaveCount(0)
  })
})

test.describe('Panel de Administración — usuarios e invitaciones', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.route('**/api/admin/stats', (route) => {
      void route.fulfill({
        status: 200,
        json: {
          totalSalidas: 0,
          salidasAbiertas: 0,
          salidasCompletadas: 0,
          totalCierres: 0,
          pctConCierre: 0,
          incidentes: 0,
          accidentes: 0,
          porMes: [],
          topDisciplinas: [],
        },
      })
    })
    await page.route('**/api/documentos/admin', (route) => {
      void route.fulfill({ status: 200, json: [] })
    })
    await page.route('**/api/invitaciones', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({ status: 200, json: { invitaciones: [] } })
      } else {
        void route.continue()
      }
    })
  })

  test('lista usuarios, deshabilita el rol propio y actualiza el rol de otro usuario', async ({ page }) => {
    await page.route('**/api/admin/users', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          json: [
            {
              id: MOCK_ADMIN.id,
              email: MOCK_ADMIN.email,
              name: MOCK_ADMIN.name,
              rol: 'ADMIN',
              emailVerified: true,
              createdAt: new Date().toISOString(),
            },
            {
              id: 'user-socio-002',
              email: 'socio2@example.com',
              name: 'Socio Dos',
              rol: 'SOCIO',
              emailVerified: true,
              createdAt: new Date().toISOString(),
            },
          ],
        })
      } else {
        void route.continue()
      }
    })

    let patchBody: unknown = null
    await page.route('**/api/admin/users/user-socio-002/rol', (route) => {
      patchBody = route.request().postDataJSON()
      void route.fulfill({
        status: 200,
        json: {
          id: 'user-socio-002',
          email: 'socio2@example.com',
          name: 'Socio Dos',
          rol: 'LIDER',
          emailVerified: true,
          createdAt: new Date().toISOString(),
        },
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir panel de administración' }).click()

    await expect(page.getByText('Usuarios e invitaciones')).toBeVisible()
    await expect(page.getByText('Socio Dos')).toBeVisible()
    await expect(page.getByLabel(`Rol de ${MOCK_ADMIN.name}`)).toBeDisabled()

    await page.getByLabel('Rol de Socio Dos').selectOption('LIDER')

    await expect.poll(() => patchBody).toEqual({ rol: 'LIDER' })
  })
})

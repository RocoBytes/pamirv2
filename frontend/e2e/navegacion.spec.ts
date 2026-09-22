import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { setAuth, mockMe, mockHasIntegrante, mockSalidas, MOCK_ADMIN, MOCK_USER } from './helpers'

interface NavPreferences {
  tabs: string[]
  quick: string[]
}

/**
 * Monta la sesión con unas preferencias iniciales y captura lo que el cliente
 * intente guardar, para poder afirmar sobre el payload exacto.
 */
async function mockNav(page: Page, initial: NavPreferences | null) {
  const guardado: NavPreferences[] = []
  await setAuth(page, MOCK_ADMIN)
  await mockMe(page, MOCK_ADMIN)
  await mockHasIntegrante(page)
  await mockSalidas(page, [])
  await page.route('**/api/eventos*', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
  await page.route('**/api/me/nav-preferences', (route: Route) => {
    const method = route.request().method()
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as NavPreferences
      guardado.push(body)
      void route.fulfill({ status: 200, json: { preferences: body } })
      return
    }
    if (method === 'DELETE') {
      void route.fulfill({ status: 200, json: { preferences: null } })
      return
    }
    void route.fulfill({ status: 200, json: { preferences: initial } })
  })
  return guardado
}

test.describe('Personalizar navegación', () => {
  test('el diálogo lista los destinos y marca como fijos los que no se pueden quitar', async ({
    page,
  }) => {
    await mockNav(page, null)
    await page.goto('/')
    await page.getByRole('button', { name: 'Personalizar' }).click()

    const dialogo = page.getByRole('dialog', { name: 'Personalizar navegación' })
    await expect(dialogo).toBeVisible()
    // Inicio y Contacto SOS llevan la marca "Fijo": la interfaz no ofrece
    // sacarlos, igual que el servidor no deja guardarlo.
    await expect(dialogo.getByText('Fijo')).toHaveCount(2)
  })

  test('reordenar con los botones guarda el orden nuevo', async ({ page }) => {
    const guardado = await mockNav(page, null)
    await page.goto('/')
    await page.getByRole('button', { name: 'Personalizar' }).click()

    const dialogo = page.getByRole('dialog', { name: 'Personalizar navegación' })
    // Acotado a la región de la barra: "Eventos" también existe entre los
    // accesos rápidos, y sin acotar el selector sería ambiguo.
    const barra = dialogo.getByRole('region', { name: 'Barra de navegación' })
    await barra.getByRole('button', { name: 'Subir Eventos' }).click()
    await dialogo.getByRole('button', { name: 'Guardar' }).click()

    await expect(dialogo).toHaveCount(0)
    expect(guardado).toHaveLength(1)
    // Eventos quedó antes que Inicio, que es lo que pidió el usuario.
    expect(guardado[0].tabs.indexOf('eventos')).toBeLessThan(guardado[0].tabs.indexOf('inicio'))
    // Y el acceso a emergencias sigue en la lista.
    expect(guardado[0].tabs).toContain('contactos')
  })

  test('el orden guardado se aplica a la barra inferior', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockNav(page, { tabs: ['contactos', 'inicio', 'eventos', 'documentos'], quick: [] })
    await page.goto('/')

    const barra = page.getByRole('navigation', { name: 'Navegación principal' })
    await expect(barra.getByRole('button').first()).toHaveAccessibleName(/Contacto SOS/i)
  })

  test('el orden guardado decide qué accesos quedan a un toque', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    // "Invitar al club" normalmente cae dentro de "Ver más"; puesto primero,
    // tiene que aparecer en el mosaico.
    await mockNav(page, { tabs: [], quick: ['invitar', 'contactos', 'eventos'] })
    await page.goto('/')

    await expect(page.getByLabel('Invitar al club')).toBeVisible()
  })

  test('una preferencia no puede mostrar un destino que el socio no puede abrir', async ({
    page,
  }) => {
    // Documentación es exclusiva de socios del club (o de un admin, que la ve
    // siempre): este usuario es SOCIO sin ficha, así que no la puede abrir.
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockSalidas(page, [])
    await page.route('**/api/eventos*', (r: Route) => void r.fulfill({ status: 200, json: [] }))
    await page.route('**/api/integrantes/me', (r: Route) =>
      void r.fulfill({ status: 404, json: { error: 'no existe' } }),
    )
    await page.route('**/api/me/nav-preferences', (r: Route) =>
      void r.fulfill({
        status: 200,
        json: { preferences: { tabs: ['documentos', 'inicio', 'contactos'], quick: ['documentos'] } },
      }),
    )
    await page.goto('/')

    // El gate manda sobre la preferencia: no basta con tenerlo guardado.
    await expect(page.getByLabel('Abrir documentación del club')).toHaveCount(0)
  })
})

import { test, expect } from './fixtures'
import type { Page, Route } from '@playwright/test'
import { setAuth, mockHasIntegrante, mockSalidas, MOCK_ADMIN } from './helpers'
import { PRELOAD_RELOAD_KEY } from '../src/lib/preload-recovery'

// El panel de administración es una pantalla lazy (ver App.tsx): su código viaja
// en un chunk aparte. En el servidor de desarrollo ese chunk es el módulo
// /src/components/AdminPanel.tsx; en el build de producción, /assets/AdminPanel-<hash>.js.
const ADMIN_PANEL_CHUNK = /\/(src\/components\/AdminPanel\.tsx|assets\/AdminPanel-[^/]+\.js)(\?.*)?$/

async function adminSession(page: Page) {
  await setAuth(page, MOCK_ADMIN)
  await mockHasIntegrante(page)
  await mockSalidas(page, [])
  // Lo que lee el panel cuando SÍ carga.
  await page.route('**/api/admin/stats', (route: Route) => {
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
  await page.route('**/api/admin/users', (route: Route) => void route.fulfill({ status: 200, json: [] }))
  await page.route('**/api/documentos/admin', (route: Route) => void route.fulfill({ status: 200, json: [] }))
  await page.route('**/api/invitaciones', (route: Route) => {
    void route.fulfill({ status: 200, json: { invitaciones: [] } })
  })
}

/** Cuenta cuántas veces carga el documento: una recarga completa suma una. */
function countPageLoads(page: Page) {
  const counter = { loads: 0 }
  page.on('load', () => {
    counter.loads++
  })
  return counter
}

async function isProductionBuild(page: Page) {
  return page.evaluate(() => document.querySelector('script[type="module"][src^="/assets/"]') !== null)
}

test.describe('Pantalla lazy que no carga', () => {
  test('sin señal: avisa, no recarga la app, vuelve al inicio y las pantallas de terreno siguen abiertas', async ({
    page,
    context,
  }) => {
    await adminSession(page)
    const page_ = countPageLoads(page)
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    expect(page_.loads).toBe(1)

    await context.setOffline(true)
    await page.getByLabel('Abrir panel de administración').click()

    await expect(page.getByRole('alert')).toContainText('Sin conexión: esta pantalla no se pudo cargar')
    // Recargar sin red reemplazaría la app por la página de "sin conexión" del navegador.
    await expect(page.getByRole('button', { name: 'Recargar la app' })).toHaveCount(0)
    expect(page_.loads).toBe(1)

    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    // Una pantalla de terreno (en el bundle de entrada) abre sin red.
    await page.getByLabel('Abrir contactos esenciales de emergencia').click()
    await expect(page.getByText('Contactos esenciales')).toBeVisible()
    expect(page_.loads).toBe(1)
  })

  test('al volver la señal aparece "Recargar la app", y recargar trae la pantalla', async ({ page, context }) => {
    await adminSession(page)
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await context.setOffline(true)
    await page.getByLabel('Abrir panel de administración').click()
    await expect(page.getByRole('alert')).toContainText('Sin conexión')
    await expect(page.getByRole('button', { name: 'Recargar la app' })).toHaveCount(0)

    await context.setOffline(false)
    await expect(page.getByRole('alert')).toContainText('No se pudo cargar esta pantalla')
    await page.getByRole('button', { name: 'Recargar la app' }).click()

    // La recarga vuelve al dashboard (la ruta vive en memoria); el chunk ya llega.
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await page.getByLabel('Abrir panel de administración').click()
    await expect(page.getByText('Panel de Administración')).toBeVisible()
  })

  // `vite:preloadError` solo existe en el build de producción: en el servidor de
  // desarrollo no hay chunks con hash que se queden viejos.
  test('con red y un hash viejo (404 una vez): recarga UNA vez y luego la pantalla abre', async ({ page }) => {
    await adminSession(page)
    let hits = 0
    await page.route(ADMIN_PANEL_CHUNK, (route: Route) => {
      hits++
      if (hits === 1) void route.fulfill({ status: 404, body: 'gone' })
      else void route.fallback()
    })
    const counter = countPageLoads(page)
    await page.goto('/')
    test.skip(!(await isProductionBuild(page)), 'vite:preloadError solo existe en el build de producción')

    await expect(page.getByText('Mis Salidas')).toBeVisible()
    expect(counter.loads).toBe(1)
    await page.getByLabel('Abrir panel de administración').click()
    await expect.poll(() => counter.loads, { timeout: 10_000 }).toBe(2)

    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await page.getByLabel('Abrir panel de administración').click()
    await expect(page.getByText('Panel de Administración')).toBeVisible()
    expect(counter.loads).toBe(2)
  })

  test('con red y un chunk que nunca llega: una sola recarga y luego el aviso, sin bucle', async ({ page }) => {
    await adminSession(page)
    await page.route(ADMIN_PANEL_CHUNK, (route: Route) => void route.fulfill({ status: 404, body: 'gone' }))
    const counter = countPageLoads(page)
    await page.goto('/')
    test.skip(!(await isProductionBuild(page)), 'vite:preloadError solo existe en el build de producción')

    await page.getByLabel('Abrir panel de administración').click()
    await expect.poll(() => counter.loads, { timeout: 10_000 }).toBe(2)

    await page.getByLabel('Abrir panel de administración').click()
    await expect(page.getByRole('alert')).toContainText('No se pudo cargar esta pantalla')
    await expect(page.getByRole('button', { name: 'Recargar la app' })).toBeVisible()
    // El aviso aparece porque este segundo fallo NO volvió a recargar. Se comprueba
    // sin esperar a ver si "pasa algo": la recarga quedó registrada y, dentro de su
    // ventana, un nuevo fallo ya no la pide (el handler deja el evento sin cancelar).
    expect(await page.evaluate((key) => sessionStorage.getItem(key), PRELOAD_RELOAD_KEY)).not.toBeNull()
    const volveriaARecargar = await page.evaluate(() => {
      const evento = new Event('vite:preloadError', { cancelable: true })
      window.dispatchEvent(evento)
      return evento.defaultPrevented
    })
    expect(volveriaARecargar).toBe(false)
    expect(counter.loads).toBe(2) // sin bucle de recargas

    await page.getByRole('button', { name: 'Volver al inicio' }).click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    expect(counter.loads).toBe(2)
  })
})

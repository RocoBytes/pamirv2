import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import {
  setAuth,
  mockNoIntegrante,
  mockHasIntegrante,
  mockSalidas,
  MOCK_USER,
  MOCK_ADMIN,
  MOCK_SALIDA,
} from './helpers'

test.describe('Dashboard – estado bloqueado (sin integrante)', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockNoIntegrante(page)
    await mockSalidas(page)
  })

  test('muestra alerta de completar registro', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Completa tu registro').first()).toBeVisible()
    await expect(
      page.getByText('Debes completar tu ficha de integrante para registrar salidas y cierres.'),
    ).toBeVisible()
  })

  test('muestra card de Formulario de Salida bloqueado con ícono de candado', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('Formulario de salida bloqueado')).toBeVisible()
    await expect(
      page.getByText('Completa tu ficha de integrante para desbloquear'),
    ).toBeVisible()
  })

  test('muestra botón de acción rápida para completar ficha', async ({ page }) => {
    await page.goto('/')
    const btn = page.getByRole('button', { name: /Completar mi Ficha/i })
    await expect(btn).toBeVisible()
    await expect(page.getByText('Completa tu registro para usar la aplicación')).toBeVisible()
  })

  test('el botón Completar de la alerta navega al formulario de integrante', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Completar', exact: true }).click()
    // El título del paso 1 aparece SOLO en su encabezado — el indicador de
    // progreso de arriba solo dice "Paso 1 de 4" (ver RegistroIntegrante.tsx).
    await expect(page.getByRole('heading', { name: 'Información Personal y de Contacto' })).toBeVisible()
  })

  test('el botón Completar mi Ficha navega al formulario de integrante', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Completar mi Ficha/i }).click()
    await expect(page.getByRole('heading', { name: 'Información Personal y de Contacto' })).toBeVisible()
  })
})

test.describe('Dashboard – estado desbloqueado (tiene integrante)', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('NO muestra alerta de completar registro', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Completa tu registro')).not.toBeVisible()
  })

  test('muestra card de Formulario de Salida como botón activo', async ({ page }) => {
    await page.goto('/')
    const salidaBtn = page.getByRole('button', { name: /Formulario de Salida/i })
    await expect(salidaBtn).toBeVisible()
    await expect(salidaBtn).toBeEnabled()
  })

  test('NO muestra el botón Completar mi Ficha', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Completar mi Ficha/i })).not.toBeVisible()
  })

  test('muestra sección Mis Salidas vacía', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Sin salidas activas en curso')).toBeVisible()
  })

  test('muestra lista de salidas cuando existen', async ({ page }) => {
    await mockSalidas(page, [MOCK_SALIDA])
    await page.goto('/')
    await expect(page.getByText('Ascenso al Plomo')).toBeVisible()
    await expect(page.getByText('Cajón del Maipo')).toBeVisible()
    await expect(page.getByText('N° 7')).toBeVisible()
  })
})

test.describe('Dashboard – estado administrador', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('muestra botón Registrar Integrante (admin con ficha propia)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(
      page.getByText('Crear ficha sin necesidad de asociar una salida'),
    ).toBeVisible()
  })
})

test.describe('Dashboard – sesión no autenticada', () => {
  test('muestra pantalla de login sin auth en localStorage', async ({ page }) => {
    await page.goto('/')
    // No auth state set — should show the AuthPage
    await expect(page.getByRole('button', { name: /Iniciar sesión|Ingresar|Login/i }).first()).toBeVisible({ timeout: 5000 })
  })

  test('el nombre del usuario aparece en el header', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await page.goto('/')
    await expect(page.getByText(MOCK_USER.name)).toBeVisible()
  })
})

test.describe('Detalle de salida – descarga de GPX y pronóstico', () => {
  const MOCK_SALIDA_DETALLE = {
    ...MOCK_SALIDA,
    tipoSalida: 'OFICIAL_CLUB',
    temporada: 'estival',
    fechaInicio: MOCK_SALIDA.fechaInicio,
    fechaRetornoEstimada: MOCK_SALIDA.fechaInicio,
    horaAlerta: '20:00',
    avisosExternos: [],
    liderCordada: 'Test Alpinista',
    coordinacionGrupal: true,
    matrizRiesgos: true,
    mediosComunicacion: ['CELULAR'],
    equipoColectivo: [],
    riesgosIdentificados: [],
    planEvacuacion: 'Descenso por la misma ruta',
    gpxFileId: 'gcs-gpx-001',
    gpxFileName: 'ruta.gpx',
    pronosticoFileId: 'gcs-pronostico-001',
    pronosticoFileName: 'pronostico.pdf',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: MOCK_USER.id,
  }

  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page, [MOCK_SALIDA])
    await page.route('**/api/salidas/salida-001', (route: Route) => {
      void route.fulfill({ status: 200, json: MOCK_SALIDA_DETALLE })
    })
    await page.route('https://storage.googleapis.com/**', (route: Route) => {
      const url = route.request().url()
      const filename = url.includes('gpx') ? 'ruta.gpx' : 'pronostico.pdf'
      void route.fulfill({
        status: 200,
        headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
        body: 'contenido-fake',
      })
    })
  })

  test('descarga el GPX vía URL firmada de GCS', async ({ page }) => {
    await page.route('**/api/salidas/salida-001/archivos/gpx/url', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          url: 'https://storage.googleapis.com/pamirv2-files-dev/orgs/x/gpx/gcs-gpx-001.gpx?sig=abc',
          expiresInSeconds: 600,
        },
      })
    })
    await page.goto('/')
    await page.getByText('Ascenso al Plomo').click()

    const boton = page.getByRole('button', { name: /Descargar GPX/ })
    await expect(boton).toBeVisible()
    const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()])
    expect(descarga.suggestedFilename()).toBe('ruta.gpx')
  })

  test('descarga el pronóstico vía URL firmada de GCS', async ({ page }) => {
    await page.route('**/api/salidas/salida-001/archivos/pronostico/url', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          url: 'https://storage.googleapis.com/pamirv2-files-dev/orgs/x/pronostico/gcs-pronostico-001.pdf?sig=abc',
          expiresInSeconds: 600,
        },
      })
    })
    await page.goto('/')
    await page.getByText('Ascenso al Plomo').click()

    const boton = page.getByRole('button', { name: /Ver archivo subido/ })
    await expect(boton).toBeVisible()
    const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()])
    expect(descarga.suggestedFilename()).toBe('pronostico.pdf')
  })
})

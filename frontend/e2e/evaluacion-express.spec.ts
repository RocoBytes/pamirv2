import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { setAuth, mockHasIntegrante, mockSalidas, MOCK_ADMIN, MOCK_SALIDA } from './helpers'

const TOKEN = 'token-eval-001'

const MOCK_EVALUACION_INFO = {
  nombreActividad: 'Ascenso al Plomo',
  fechaInicio: new Date().toISOString(),
  used: false,
}

function mockGetEvaluacion(page: Page, info: unknown = MOCK_EVALUACION_INFO, status = 200) {
  return page.route(`**/api/evaluaciones/${TOKEN}`, (route: Route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({ status, json: info })
    } else {
      void route.continue()
    }
  })
}

test.describe('Evaluación Express – página pública (sin sesión)', () => {
  test('carga el formulario con las tres preguntas y el aviso de anonimato', async ({ page }) => {
    await mockGetEvaluacion(page)
    await page.goto(`/?evaluacion=${TOKEN}`)

    await expect(page.getByText('Ascenso al Plomo')).toBeVisible()
    await expect(page.getByText(/¿Se cumplieron tus objetivos y expectativas\?/)).toBeVisible()
    await expect(page.getByText(/¿Consideras que se cumplió el itinerario\?/)).toBeVisible()
    await expect(page.getByText(/¿Cómo evalúas al líder\/responsable de la salida\?/)).toBeVisible()
    await expect(page.getByText(/tu respuesta no queda asociada a tu/)).toBeVisible()
  })

  test('valida que las tres notas sean obligatorias', async ({ page }) => {
    await mockGetEvaluacion(page)
    await page.goto(`/?evaluacion=${TOKEN}`)

    await page.getByRole('button', { name: 'Enviar evaluación anónima' }).click()
    await expect(page.getByText('Selecciona una calificación').first()).toBeVisible()
  })

  test('envía la evaluación y muestra pantalla de éxito', async ({ page }) => {
    await mockGetEvaluacion(page)
    let submittedBody: Record<string, unknown> | null = null
    await page.route(`**/api/evaluaciones/${TOKEN}`, (route: Route) => {
      if (route.request().method() === 'POST') {
        submittedBody = route.request().postDataJSON() as Record<string, unknown>
        void route.fulfill({ status: 201, json: { ok: true } })
      } else {
        void route.fulfill({ status: 200, json: MOCK_EVALUACION_INFO })
      }
    })

    await page.goto(`/?evaluacion=${TOKEN}`)

    // Cada pregunta tiene botones 1-5: elegir 5, 4 y 5
    const fieldsets = page.locator('fieldset')
    await fieldsets.nth(0).getByRole('button', { name: '5', exact: true }).click()
    await fieldsets.nth(1).getByRole('button', { name: '4', exact: true }).click()
    await fieldsets.nth(2).getByRole('button', { name: '5', exact: true }).click()
    await page.getByLabel(/comentarios que quieras dar/i).fill('Excelente coordinación del grupo')

    await page.getByRole('button', { name: 'Enviar evaluación anónima' }).click()

    await expect(page.getByText('¡Gracias por tu evaluación!')).toBeVisible()
    expect(submittedBody).toMatchObject({
      notaObjetivos: 5,
      notaItinerario: 4,
      notaLider: 5,
      comentario: 'Excelente coordinación del grupo',
    })
  })

  test('muestra mensaje cuando el enlace ya fue usado', async ({ page }) => {
    await mockGetEvaluacion(page, { ...MOCK_EVALUACION_INFO, used: true })
    await page.goto(`/?evaluacion=${TOKEN}`)

    await expect(page.getByText('Esta evaluación ya fue respondida')).toBeVisible()
  })

  test('muestra error con token inválido', async ({ page }) => {
    await mockGetEvaluacion(page, { error: 'Evaluación no encontrada' }, 404)
    await page.goto(`/?evaluacion=${TOKEN}`)

    await expect(page.getByText('Enlace no válido')).toBeVisible()
  })
})

test.describe('Evaluación Express – resultados (admin)', () => {
  test('el admin ve el botón y el modal de resultados', async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page, [MOCK_SALIDA])
    await page.route('**/api/evaluaciones/resultados/**', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          totalTokens: 3,
          totalRespuestas: 2,
          promedios: { objetivos: 4.5, itinerario: 4.0, lider: 5.0 },
          comentarios: ['Muy buena salida', 'Faltó tiempo en cumbre'],
        },
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Ver evaluaciones de Ascenso al Plomo/ }).click()

    await expect(page.getByText('Evaluaciones anónimas')).toBeVisible()
    await expect(page.getByText(/2.*de.*3/)).toBeVisible()
    await expect(page.getByText('Evaluación del líder')).toBeVisible()
    await expect(page.getByText('Muy buena salida')).toBeVisible()
    await expect(page.getByText('Faltó tiempo en cumbre')).toBeVisible()
  })
})

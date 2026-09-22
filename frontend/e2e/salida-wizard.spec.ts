import { test, expect, type Page } from '@playwright/test'
import {
  setAuth,
  mockHasIntegrante,
  mockSalidas,
  mockIntegranteByRut,
} from './helpers'

// Draft válido para los pasos 1-4: permite entrar directo al paso guardado
// vía el banner "Continuar borrador" sin completar todo el wizard.
const DRAFT_BASE = {
  tipoSalida: 'NO_OFICIAL',
  disciplina: 'TREKKING',
  temporada: 'estival',
  nombreActividad: 'Salida E2E',
  ubicacionGeografica: 'Cajón del Maipo',
  fechaInicio: '2026-07-01',
  fechaRetornoEstimada: '2026-07-02',
  horaRetornoEstimada: '18:00',
  horaAlerta: '20:00',
  avisosExternos: [],
  retenCarabineros: '',
  nombreFamiliar: '',
  telefonoFamiliar: '',
  liderCordada: 'Test Alpinista',
  participantes: [
    { rut: '12.345.678-9', nombre: 'Test Alpinista', membresiaClub: 'SOCIO_ANDINO_PAMIR' },
  ],
  coordinacionGrupal: true,
  matrizRiesgos: true,
  mediosComunicacion: ['CELULAR'],
  idDispositivoFrecuencia: '',
  equipoColectivo: ['GPS'],
  equipoColectivoOtro: '',
  pronosticoMeteorologico: '',
  riesgosIdentificados: ['CRUCE_RIOS'],
  riesgosOtro: '',
  planEvacuacion: '',
  status: 'EN_CURSO',
  incidentReport: '',
}

async function seedDraft(page: Page, draft: Record<string, unknown>, step: number) {
  await page.addInitScript(
    ({ draft, step }) => {
      localStorage.setItem('pamir_draft', JSON.stringify(draft))
      localStorage.setItem('pamir_draft_step', String(step))
    },
    { draft, step },
  )
}

async function openWizardAtDraft(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Formulario de Salida/i }).click()
  await page.getByRole('button', { name: 'Continuar borrador' }).click()
}

test.describe('Wizard de Salida – badge de club en participantes', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('al agregar un participante por RUT se muestra su badge de club', async ({ page }) => {
    await mockIntegranteByRut(page)
    await seedDraft(page, { ...DRAFT_BASE, participantes: [], liderCordada: '' }, 3)
    await openWizardAtDraft(page)

    await page.getByLabel('RUT del participante').fill('12.345.678-9')
    await page.getByRole('button', { name: 'Agregar' }).click()

    await expect(page.getByText('Test Alpinista').first()).toBeVisible()
    await expect(page.getByText('ACP')).toBeVisible()
  })

  test('participante de draft legacy sin club se muestra sin badge', async ({ page }) => {
    await seedDraft(
      page,
      { ...DRAFT_BASE, participantes: [{ rut: '12.345.678-9', nombre: 'Test Alpinista' }] },
      3,
    )
    await openWizardAtDraft(page)

    await expect(page.getByText('Test Alpinista').first()).toBeVisible()
    await expect(page.getByText('ACP')).toHaveCount(0)
  })
})

test.describe('Wizard de Salida – clima obligatorio, archivo opcional', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('no permite guardar sin descripción del pronóstico y no llama a la API', async ({ page }) => {
    let postFired = false
    await page.route('**/api/salidas', (route) => {
      if (route.request().method() === 'POST') {
        postFired = true
        void route.fulfill({ status: 201, json: { id: 'salida-new' } })
      } else {
        void route.fulfill({ status: 200, json: [] })
      }
    })
    await seedDraft(page, DRAFT_BASE, 5)
    await openWizardAtDraft(page)

    await page.getByRole('button', { name: 'Guardar salida' }).click()

    await expect(page.getByText('Describe el pronóstico meteorológico')).toBeVisible()
    expect(postFired).toBe(false)
  })

  test('guarda con descripción del clima y sin archivo de pronóstico', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null
    await page.route('**/api/salidas', (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>
        void route.fulfill({
          status: 201,
          json: { ...capturedBody, id: 'salida-new', numeroSalida: 42 },
        })
      } else {
        void route.fulfill({ status: 200, json: [] })
      }
    })
    await seedDraft(page, DRAFT_BASE, 5)
    await openWizardAtDraft(page)

    const clima = 'Despejado en la mañana, viento de 40 km/h en altura desde las 14:00'
    await page.getByLabel(/Pronóstico Meteorológico/).fill(clima)
    await page.getByRole('button', { name: 'Guardar salida' }).click()

    await expect(page.getByText('Salida N° 42 registrada')).toBeVisible()
    expect(capturedBody).not.toBeNull()
    expect(capturedBody!.pronosticoMeteorologico).toBe(clima)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Salvavidas de la onda de confirmación
//
// La onda tapa la pantalla entera, así que cualquier estado del que no salga
// sola deja la app inusable. El botón de escape es la red para eso, y solo
// sirve si cumple las dos mitades: aparecer cuando hace falta, y no asomarse
// nunca cuando no.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Wizard de Salida – salvavidas de la confirmación', () => {
  const volver = (page: Page) => page.getByRole('button', { name: 'Volver al inicio' })

  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page)
    await mockSalidas(page, [])
  })

  test('en el camino feliz no se asoma ni un cuadro', async ({ page }) => {
    await page.route('**/api/salidas', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({ status: 201, json: { id: 'salida-new', numeroSalida: 42 } })
      } else {
        void route.fulfill({ status: 200, json: [] })
      }
    })
    await seedDraft(page, DRAFT_BASE, 5)
    await openWizardAtDraft(page)
    await page.getByLabel(/Pronóstico Meteorológico/).fill('Despejado')

    // Un MutationObserver y no un sondeo: si el botón parpadeara un instante
    // entre dos muestras, un sondeo no lo vería y el test mentiría.
    await page.evaluate(() => {
      const w = window as unknown as { __escapeVisto: boolean }
      w.__escapeVisto = false
      const hayBoton = () =>
        [...document.querySelectorAll('button')].some((b) =>
          b.textContent?.includes('Volver al inicio'),
        )
      new MutationObserver(() => {
        if (hayBoton()) w.__escapeVisto = true
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })

    await page.getByRole('button', { name: 'Guardar salida' }).click()
    await expect(page.getByText('Salida N° 42 registrada')).toBeVisible()
    // Más allá del retardo del salvavidas: para entonces ya se fue solo.
    await page.waitForTimeout(3000)

    const visto = await page.evaluate(
      () => (window as unknown as { __escapeVisto: boolean }).__escapeVisto,
    )
    expect(visto).toBe(false)
  })

  test('con la petición colgada aparece y devuelve al inicio', async ({ page }) => {
    await page.route('**/api/salidas', (route) => {
      // El POST nunca se responde: la onda se queda esperando para siempre,
      // que es exactamente el encierro que este botón tiene que romper.
      if (route.request().method() !== 'POST') {
        void route.fulfill({ status: 200, json: [] })
      }
    })
    await seedDraft(page, DRAFT_BASE, 5)
    await openWizardAtDraft(page)
    await page.getByLabel(/Pronóstico Meteorológico/).fill('Despejado')
    await page.getByRole('button', { name: 'Guardar salida' }).click()

    await expect(page.getByText('Guardando salida…')).toBeVisible()
    await expect(volver(page)).toBeVisible({ timeout: 4000 })

    await volver(page).click()

    // Vuelve al inicio y la onda se fue: la app queda usable otra vez.
    await expect(page.getByText('Guardando salida…')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Crear Nueva Salida/i })).toBeVisible()
  })
})

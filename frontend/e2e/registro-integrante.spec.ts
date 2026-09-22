import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  setAuth,
  mockNoIntegrante,
  mockSalidas,
  mockCreateIntegrante,
  MOCK_INTEGRANTE,
} from './helpers'

async function goToRegistroIntegrante(page: Page) {
  await setAuth(page)
  await mockNoIntegrante(page)
  await mockSalidas(page)
  await mockCreateIntegrante(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Completar mi Ficha/i }).click()
  // El título del paso vive SOLO en su encabezado (getByRole('heading', ...)),
  // nunca duplicado en el indicador de progreso — así esta aserción no se
  // rompe si ese indicador cambia de texto en el futuro.
  await expect(page.getByRole('heading', { name: 'Información Personal y de Contacto' })).toBeVisible()
}

// ─── Helpers de llenado por paso ─────────────────────────────────────────────
// Cada paso renderiza solo sus propios campos (los del resto ni están en el
// DOM), así que estos helpers avanzan un paso a la vez.

async function fillStep1(page: Page, overrides: { nombreCompleto?: string } = {}) {
  await page.getByPlaceholder('Ej: Juan Andrés Pérez González').fill(overrides.nombreCompleto ?? 'María Paz López')
  await page.getByPlaceholder('12.345.678-K').fill('12345678K')
  await page.getByPlaceholder('Ej: Chilena').fill('Chilena')
  await page.getByRole('button', { name: 'Femenino' }).click()
  await page.locator('input[type="date"]').first().fill('1990-05-15')
  await page.getByPlaceholder('Calle, número, depto...').fill('Av. Las Condes 1234')
  await page.getByPlaceholder('Ej: Las Condes').fill('Las Condes')
  await page.getByLabel('Región').selectOption('Metropolitana de Santiago')
  await page.getByPlaceholder('+56 9 1234 5678').fill('+56912345678')
  await page.getByLabel('Previsión de Salud').selectOption('Fonasa')
}

async function fillStep2(page: Page) {
  await page.getByPlaceholder('Nombre completo').fill('Juan López')
  await page.getByPlaceholder('Ej: Madre, Cónyuge, Hermano...').fill('Hermano')
  await page.getByPlaceholder('+56 9 1234 5678').fill('+56987654321')
}

async function fillStep3(page: Page, { alergiasSi = false }: { alergiasSi?: boolean } = {}) {
  await page.getByRole('button', { name: 'O+' }).click()
  const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
  await alergiasSection.getByRole('button', { name: alergiasSi ? 'Sí' : 'No' }).click()
  const enfermedadesSection = page.getByText('Enfermedades Crónicas').locator('..')
  await enfermedadesSection.getByRole('button', { name: 'No' }).click()
  const medicamentosSection = page.getByText('¿Toma medicamentos de forma regular?').locator('..')
  await medicamentosSection.getByRole('button', { name: 'No' }).click()
  const cirugiasSection = page.getByText('Cirugías o Lesiones').locator('..')
  await cirugiasSection.getByRole('button', { name: 'No' }).click()
  const fumaSection = page.getByText('¿Fuma?').locator('..')
  await fumaSection.getByRole('button', { name: 'No' }).click()
  const lentesSection = page.getByText('¿Usa lentes ópticos?').locator('..')
  await lentesSection.getByRole('button', { name: 'No' }).click()
}

async function checkAllClauses(page: Page) {
  const checkboxes = page.getByRole('checkbox')
  // `.count()` NO espera a nada: devuelve lo que haya en el DOM en ese
  // instante. Llamándolo apenas se toca "Siguiente", el paso 4 todavía no se
  // montó (el anterior se está yendo) y devuelve 0 — el bucle no marca nada,
  // el submit queda bloqueado por validación y el test falla mucho después,
  // con un mensaje que no tiene nada que ver. Esperar a que exista la primera
  // casilla ancla el conteo al momento en que el paso ya está en pantalla.
  await expect(checkboxes.first()).toBeVisible()
  const count = await checkboxes.count()
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check()
  }
}

async function siguiente(page: Page) {
  await page.getByRole('button', { name: 'Siguiente' }).click()
}

// El rótulo "Paso N de 4" vive en el indicador de progreso, FUERA del
// contenedor que anima el cambio de paso, así que cambia en cuanto se toca
// "Siguiente" — mientras el paso anterior todavía se está yendo y el nuevo ni
// siquiera se montó. Esperar solo ese rótulo dejaba seguir con el formulario
// vacío: medido, `getByRole('checkbox').count()` devolvía 0 en ese instante y
// 4 unos 400ms después, así que `checkAllClauses` no marcaba nada y el submit
// quedaba bloqueado por validación sin que el test se enterara.
//
// Por eso cada llegada espera además el ENCABEZADO del paso, que sí vive
// dentro del contenido: es la señal de que el paso está montado y se puede
// interactuar con él. La aserción del rótulo se conserva porque sigue siendo
// verdad y vale la pena; lo que se agrega es la garantía que faltaba.
const STEP_HEADINGS = [
  'Información Personal y de Contacto',
  'Contacto de Emergencia',
  'Perfil Médico y Antecedentes',
  'Cláusulas Legales y Consentimiento Informado',
] as const

async function expectAtStep(page: Page, step: 1 | 2 | 3 | 4) {
  await expect(page.getByText(`Paso ${step} de 4`)).toBeVisible()
  await expect(page.getByRole('heading', { name: STEP_HEADINGS[step - 1] })).toBeVisible()
}

async function arriveAtStep2(page: Page) {
  await fillStep1(page)
  await siguiente(page)
  await expectAtStep(page, 2)
}

async function arriveAtStep3(page: Page) {
  await arriveAtStep2(page)
  await fillStep2(page)
  await siguiente(page)
  await expectAtStep(page, 3)
}

async function arriveAtStep4(page: Page) {
  await arriveAtStep3(page)
  await fillStep3(page)
  await siguiente(page)
  await expectAtStep(page, 4)
}

test.describe('RegistroIntegrante – navegación del wizard', () => {
  test('abre en el paso 1 con "Paso 1 de 4" y solo los campos de la Sección I', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await expect(page.getByText('Paso 1 de 4')).toBeVisible()
    await expect(page.getByPlaceholder('Ej: Juan Andrés Pérez González')).toBeVisible()
    // Campos de los pasos 2-4: ni siquiera están montados todavía.
    await expect(page.getByPlaceholder('Nombre completo')).toHaveCount(0)
    await expect(page.getByText('Grupo Sanguíneo y Factor RH')).toHaveCount(0)
    await expect(page.getByText('Cláusulas Legales y Consentimiento Informado')).toHaveCount(0)
  })

  test('el botón Volver regresa al dashboard', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: /Volver/i }).click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })

  test('avanzar y luego Atrás conserva los datos escritos', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await fillStep1(page, { nombreCompleto: 'Dato Que No Se Pierde' })
    await siguiente(page)
    await expect(page.getByText('Paso 2 de 4')).toBeVisible()

    await page.getByRole('button', { name: 'Atrás' }).click()
    await expect(page.getByText('Paso 1 de 4')).toBeVisible()
    await expect(page.getByPlaceholder('Ej: Juan Andrés Pérez González')).toHaveValue('Dato Que No Se Pierde')
  })

  test('aria-current="step" se mueve al indicador del paso activo al avanzar', async ({ page }) => {
    await goToRegistroIntegrante(page)
    const active = page.locator('[aria-current="step"]')
    await expect(active).toHaveAttribute('aria-label', /Paso 1/)
    await fillStep1(page)
    await siguiente(page)
    await expect(active).toHaveAttribute('aria-label', /Paso 2/)
  })
})

test.describe('RegistroIntegrante – sin pregunta de membresía', () => {
  test('la pregunta de membresía y "Nombre del Club" no existen en ningún paso', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await expect(page.getByText('Membresía en Club de Montaña')).toHaveCount(0)
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).toHaveCount(0)

    await arriveAtStep2(page)
    await expect(page.getByText('Membresía en Club de Montaña')).toHaveCount(0)

    await fillStep2(page)
    await siguiente(page)
    await expect(page.getByText('Paso 3 de 4')).toBeVisible()
    await expect(page.getByText('Membresía en Club de Montaña')).toHaveCount(0)

    await fillStep3(page)
    await siguiente(page)
    await expect(page.getByText('Paso 4 de 4')).toBeVisible()
    await expect(page.getByText('Membresía en Club de Montaña')).toHaveCount(0)
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).toHaveCount(0)
  })
})

test.describe('RegistroIntegrante – paso 1: validaciones', () => {
  test('"Siguiente" en el paso 1 vacío muestra errores y no avanza', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await siguiente(page)
    await expect(page.getByText('Campo requerido').first()).toBeVisible()
    await expect(page.getByText('Paso 1 de 4')).toBeVisible()
  })

  test('valida formato de RUT', async ({ page }) => {
    await goToRegistroIntegrante(page)
    // Short input "12K" formats to "12-K" which fails the regex
    await page.getByPlaceholder('12.345.678-K').fill('12K')
    await siguiente(page)
    await expect(page.getByText('Formato inválido. Ej: 12.345.678-K')).toBeVisible()
  })

  test('formatea automáticamente el RUT al escribir', async ({ page }) => {
    await goToRegistroIntegrante(page)
    const rutInput = page.getByPlaceholder('12.345.678-K')
    await rutInput.fill('12345678K')
    await expect(rutInput).toHaveValue('12.345.678-K')
  })
})

test.describe('RegistroIntegrante – paso 3: perfil médico y antecedentes', () => {
  test('muestra campo de detalle cuando alergias es Sí', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await arriveAtStep3(page)
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'Sí' }).click()
    await expect(page.getByPlaceholder(/Penicilina/i)).toBeVisible()
  })

  test('oculta campo de detalle cuando alergias es No', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await arriveAtStep3(page)
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'Sí' }).click()
    await alergiasSection.getByRole('button', { name: 'No' }).click()
    await expect(page.getByPlaceholder(/Penicilina/i)).not.toBeVisible()
  })

  test('alergias con Sí exige detalle antes de avanzar al paso 4', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await arriveAtStep3(page)
    await fillStep3(page, { alergiasSi: true })
    await siguiente(page)
    await expect(page.getByText('Describe las alergias conocidas')).toBeVisible()
    await expect(page.getByText('Paso 3 de 4')).toBeVisible()
  })
})

test.describe('RegistroIntegrante – paso 4: cláusulas legales', () => {
  test('requiere aceptar todas las cláusulas para registrar', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await arriveAtStep4(page)
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()
    await expect(page.getByText('Debes aceptar esta declaración para continuar')).toBeVisible()
    await expect(page.getByText('Paso 4 de 4')).toBeVisible()
  })
})

test.describe('RegistroIntegrante – flujo de éxito', () => {
  test('completa los 4 pasos, termina en la pantalla de éxito y el body no lleva membresiaClub/nombreClub', async ({
    page,
  }) => {
    await goToRegistroIntegrante(page)

    let capturedBody: Record<string, unknown> | null = null
    await page.route('**/api/integrantes', (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>
        void route.fulfill({ status: 201, json: MOCK_INTEGRANTE })
      } else {
        void route.continue()
      }
    })

    await fillStep1(page)
    await siguiente(page)
    await fillStep2(page)
    await siguiente(page)
    await fillStep3(page)
    await siguiente(page)
    await checkAllClauses(page)
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()

    await expect(page.getByText('Integrante registrado')).toBeVisible({ timeout: 5000 })
    expect(capturedBody).not.toBeNull()
    expect(capturedBody).not.toHaveProperty('membresiaClub')
    expect(capturedBody).not.toHaveProperty('nombreClub')
  })
})

test.describe('RegistroIntegrante – error del servidor', () => {
  test('un POST fallido deja al usuario en el wizard con el mensaje visible y sus datos intactos', async ({
    page,
  }) => {
    await goToRegistroIntegrante(page)
    await page.route('**/api/integrantes', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({ status: 500, json: { error: 'No se pudo registrar el integrante' } })
      } else {
        void route.continue()
      }
    })

    await fillStep1(page, { nombreCompleto: 'Dato Que No Se Pierde' })
    await siguiente(page)
    await fillStep2(page)
    await siguiente(page)
    await fillStep3(page)
    await siguiente(page)
    await checkAllClauses(page)
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()

    await expect(page.getByText('No se pudo registrar el integrante')).toBeVisible()
    await expect(page.getByText('Integrante registrado')).toHaveCount(0)

    // Los datos del paso 1 siguen ahí, tres "Atrás" más tarde.
    await page.getByRole('button', { name: 'Atrás' }).click()
    await page.getByRole('button', { name: 'Atrás' }).click()
    await page.getByRole('button', { name: 'Atrás' }).click()
    await expect(page.getByText('Paso 1 de 4')).toBeVisible()
    await expect(page.getByPlaceholder('Ej: Juan Andrés Pérez González')).toHaveValue('Dato Que No Se Pierde')
  })
})

test.describe('RegistroIntegrante – advertencia antes de salir', () => {
  test('con datos sin guardar, "Volver" pide confirmación antes de salir', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByPlaceholder('Ej: Juan Andrés Pérez González').fill('Alguien Escribiendo')

    let dialogMessage = ''
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message()
      void dialog.dismiss()
    })
    await page.getByRole('button', { name: /Volver/i }).click()
    await expect.poll(() => dialogMessage).not.toBe('')
    // Se quedó en el formulario: el dialog se rechazó.
    await expect(page.getByPlaceholder('Ej: Juan Andrés Pérez González')).toHaveValue('Alguien Escribiendo')
  })
})

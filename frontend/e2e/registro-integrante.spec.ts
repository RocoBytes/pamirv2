import { test, expect } from '@playwright/test'
import {
  setAuth,
  mockNoIntegrante,
  mockSalidas,
  mockCreateIntegrante,
} from './helpers'

async function goToRegistroIntegrante(page: import('@playwright/test').Page) {
  await setAuth(page)
  await mockNoIntegrante(page)
  await mockSalidas(page)
  await mockCreateIntegrante(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Completar mi Ficha/i }).click()
  await expect(page.getByText('Información Personal y de Contacto')).toBeVisible()
}

test.describe('RegistroIntegrante – navegación', () => {
  test('muestra formulario con todas las secciones', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await expect(page.getByText('Información Personal y de Contacto')).toBeVisible()
    await expect(page.getByText('Contacto de Emergencia')).toBeVisible()
    await expect(page.getByText('Perfil Médico y Antecedentes')).toBeVisible()
    await expect(page.getByText('Cláusulas Legales y Consentimiento Informado')).toBeVisible()
  })

  test('el botón Volver regresa al dashboard', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: /Volver/i }).click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })
})

test.describe('RegistroIntegrante – validaciones de formulario', () => {
  test('muestra errores al enviar formulario vacío', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()
    await expect(page.getByText('Campo requerido').first()).toBeVisible()
  })

  test('valida formato de RUT', async ({ page }) => {
    await goToRegistroIntegrante(page)
    // Short input "12K" formats to "12-K" which fails the regex
    await page.getByPlaceholder('12.345.678-K').fill('12K')
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()
    await expect(page.getByText('Formato inválido. Ej: 12.345.678-K')).toBeVisible()
  })

  test('formatea automáticamente el RUT al escribir', async ({ page }) => {
    await goToRegistroIntegrante(page)
    const rutInput = page.getByPlaceholder('12.345.678-K')
    await rutInput.fill('12345678K')
    // After auto-format, should show formatted value
    await expect(rutInput).toHaveValue('12.345.678-K')
  })

  test('muestra campo de detalle cuando alergias es Sí', async ({ page }) => {
    await goToRegistroIntegrante(page)
    // Find the alergias section and click Sí
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'Sí' }).click()
    await expect(page.getByPlaceholder(/Penicilina/i)).toBeVisible()
  })

  test('oculta campo de detalle cuando alergias es No', async ({ page }) => {
    await goToRegistroIntegrante(page)
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'Sí' }).click()
    await alergiasSection.getByRole('button', { name: 'No' }).click()
    await expect(page.getByPlaceholder(/Penicilina/i)).not.toBeVisible()
  })

  test('muestra campo de nombre de club cuando es Socio otro Club', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: 'Socio otro Club' }).click()
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).toBeVisible()
  })

  test('muestra campo de nombre de club cuando es Postulante', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: 'Postulante a un club' }).click()
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).toBeVisible()
  })

  test('oculta campo de nombre de club para socios Andino Pamir', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: 'Socio Andino Club Pamir' }).click()
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).not.toBeVisible()
  })

  test('oculta campo de nombre de club para socios El Montañista', async ({ page }) => {
    await goToRegistroIntegrante(page)
    await page.getByRole('button', { name: 'Socio Club El Montañista' }).click()
    await expect(page.getByPlaceholder('Ej: Club Andino de Chile')).not.toBeVisible()
  })

  test('valida que alergias con Sí requiere detalle', async ({ page }) => {
    await goToRegistroIntegrante(page)

    // Fill all required fields so superRefine can run for alergias
    await page.getByPlaceholder('Ej: Juan Andrés Pérez González').fill('Test User')
    await page.getByPlaceholder('12.345.678-K').fill('12345678K')
    await page.getByPlaceholder('Ej: Chilena').fill('Chilena')
    await page.getByRole('button', { name: 'Femenino' }).click()
    await page.locator('input[type="date"]').first().fill('1990-01-01')
    await page.getByPlaceholder('Calle, número, depto...').fill('Calle 123')
    await page.getByPlaceholder('Ej: Las Condes').fill('Ñuñoa')
    await page.getByLabel('Región').selectOption('Metropolitana de Santiago')
    await page.getByPlaceholder('+56 9 1234 5678').first().fill('+56912345678')
    await page.getByLabel('Previsión de Salud').selectOption('Fonasa')
    await page.getByRole('button', { name: 'Socio Andino Club Pamir' }).click()
    await page.getByPlaceholder('Nombre completo').fill('Contacto')
    await page.getByPlaceholder('Ej: Madre, Cónyuge, Hermano...').fill('Madre')
    await page.getByPlaceholder('+56 9 1234 5678').nth(1).fill('+56987654321')
    await page.getByRole('button', { name: 'O+' }).click()

    // Alergias: Sí — leave detail empty to trigger superRefine
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'Sí' }).click()

    // Rest to No
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

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const checkboxes = page.getByRole('checkbox')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check()
    }

    await page.getByRole('button', { name: /Registrar Integrante/i }).click()
    await expect(page.getByText('Describe las alergias conocidas')).toBeVisible()
  })
})

test.describe('RegistroIntegrante – cláusulas legales', () => {
  test('requiere aceptar todas las cláusulas', async ({ page }) => {
    await goToRegistroIntegrante(page)
    // Submit without checking clauses
    await page.getByRole('button', { name: /Registrar Integrante/i }).click()
    await expect(
      page.getByText('Debes aceptar esta declaración para continuar'),
    ).toBeVisible()
  })
})

test.describe('RegistroIntegrante – flujo de éxito', () => {
  test('muestra pantalla de éxito al enviar formulario completo', async ({ page }) => {
    await goToRegistroIntegrante(page)

    // Sección I
    await page.getByPlaceholder('Ej: Juan Andrés Pérez González').fill('María Paz López')
    await page.getByPlaceholder('12.345.678-K').fill('12345678K')
    await page.getByPlaceholder('Ej: Chilena').fill('Chilena')
    await page.getByRole('button', { name: 'Femenino' }).click()
    await page.locator('input[type="date"]').first().fill('1990-05-15')
    await page.getByPlaceholder('Calle, número, depto...').fill('Av. Las Condes 1234')
    await page.getByPlaceholder('Ej: Las Condes').fill('Las Condes')
    await page.getByLabel('Región').selectOption('Metropolitana de Santiago')
    await page.getByPlaceholder('+56 9 1234 5678').first().fill('+56912345678')
    // Email is readonly — pre-filled from user session (test@example.com)
    await page.getByLabel('Previsión de Salud').selectOption('Fonasa')
    await page.getByRole('button', { name: 'Socio Andino Club Pamir' }).click()

    // Sección II
    await page.getByPlaceholder('Nombre completo').fill('Juan López')
    await page.getByPlaceholder('Ej: Madre, Cónyuge, Hermano...').fill('Hermano')
    await page.getByPlaceholder('+56 9 1234 5678').nth(1).fill('+56987654321')

    // Sección III — grupo sanguíneo
    await page.getByRole('button', { name: 'O+' }).click()

    // Alergias: No
    const alergiasSection = page.getByText('Alergias Conocidas').locator('..')
    await alergiasSection.getByRole('button', { name: 'No' }).click()

    // Enfermedades: No
    const enfermedadesSection = page.getByText('Enfermedades Crónicas').locator('..')
    await enfermedadesSection.getByRole('button', { name: 'No' }).click()

    // Medicamentos: No
    const medicamentosSection = page.getByText('¿Toma medicamentos de forma regular?').locator('..')
    await medicamentosSection.getByRole('button', { name: 'No' }).click()

    // Cirugías: No
    const cirugiasSection = page.getByText('Cirugías o Lesiones').locator('..')
    await cirugiasSection.getByRole('button', { name: 'No' }).click()

    // Fuma: No
    const fumaSection = page.getByText('¿Fuma?').locator('..')
    await fumaSection.getByRole('button', { name: 'No' }).click()

    // Lentes: No
    const lentesSection = page.getByText('¿Usa lentes ópticos?').locator('..')
    await lentesSection.getByRole('button', { name: 'No' }).click()

    // Sección IV — cláusulas (scroll and check all)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const checkboxes = page.getByRole('checkbox')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check()
    }

    await page.getByRole('button', { name: /Registrar Integrante/i }).click()

    await expect(page.getByText('Integrante registrado')).toBeVisible({ timeout: 5000 })
  })
})

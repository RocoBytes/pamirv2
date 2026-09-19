import { test, expect } from '@playwright/test'
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
    await expect(page.getByText('Información Personal y de Contacto')).toBeVisible()
  })

  test('el botón Completar mi Ficha navega al formulario de integrante', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Completar mi Ficha/i }).click()
    await expect(page.getByText('Información Personal y de Contacto')).toBeVisible()
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
    await expect(page.getByText('Sin salidas aun')).toBeVisible()
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

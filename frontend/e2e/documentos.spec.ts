import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { setAuth, mockHasIntegrante, mockSalidas, MOCK_INTEGRANTE } from './helpers'

function mockIntegranteNoSocio(page: Page) {
  return page.route('**/api/integrantes/me', (route: Route) => {
    void route.fulfill({ status: 200, json: { ...MOCK_INTEGRANTE, membresiaClub: 'NO_PERTENECE' } })
  })
}

function mockDocumentos(page: Page, docs: unknown[]) {
  return page.route('**/api/documentos', (route: Route) => {
    void route.fulfill({ status: 200, json: docs })
  })
}

test.describe('Documentación del Club – visibilidad por membresía', () => {
  test('un socio ACP ve la tarjeta de documentación', async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page) // MOCK_INTEGRANTE es SOCIO_ANDINO_PAMIR
    await mockSalidas(page)
    await page.goto('/')

    const card = page.getByRole('button', { name: 'Abrir documentación del club' })
    await expect(card).toBeVisible()
    await expect(page.getByText('Documentación del Club')).toBeVisible()
    await expect(page.getByText('Socios ACP')).toBeVisible()
  })

  test('un usuario que no es socio ACP NO ve la tarjeta', async ({ page }) => {
    await setAuth(page)
    await mockIntegranteNoSocio(page)
    await mockSalidas(page)
    await page.goto('/')

    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abrir documentación del club' })).toHaveCount(0)
  })
})

test.describe('Documentación del Club – página', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  test('sin documentos muestra el estado "en preparación"', async ({ page }) => {
    await mockDocumentos(page, [])
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir documentación del club' }).click()

    await expect(page.getByText('Documentos en preparación')).toBeVisible()
    await expect(page.getByText(/retenes de.*Carabineros/)).toBeVisible()
  })

  test('lista documentos agrupados por categoría con link de descarga', async ({ page }) => {
    await mockDocumentos(page, [
      { id: 'd1', categoria: 'AVISO_EXPEDICION', nombre: 'Aviso Retén San José de Maipo', descripcion: 'Formulario PDF', driveFileUrl: 'https://drive.google.com/file/d/test1' },
      { id: 'd2', categoria: 'CHECKLIST', nombre: 'Check-list Alta Montaña', driveFileUrl: 'https://drive.google.com/file/d/test2' },
      { id: 'd3', categoria: 'MATRIZ_RIESGO', nombre: 'Matriz de Riesgo 3x3', driveFileUrl: null },
    ])
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir documentación del club' }).click()

    await expect(page.getByText('Formularios de Aviso de Expedición — Retenes de Carabineros')).toBeVisible()
    await expect(page.getByText('Check-lists de Salidas')).toBeVisible()
    await expect(page.getByText('Aviso Retén San José de Maipo')).toBeVisible()
    await expect(page.getByRole('link', { name: /Aviso Retén San José de Maipo/ })).toHaveAttribute('href', 'https://drive.google.com/file/d/test1')
    // Documento sin archivo aún: visible pero deshabilitado
    await expect(page.getByRole('link', { name: /Matriz de Riesgo 3x3/ })).toHaveAttribute('aria-disabled', 'true')
  })

  test('el botón Volver regresa al dashboard', async ({ page }) => {
    await mockDocumentos(page, [])
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir documentación del club' }).click()
    await expect(page.getByText('Documentos en preparación')).toBeVisible()
    await page.getByRole('button', { name: /Volver/ }).click()
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })
})

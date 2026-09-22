import type { Page, Route } from '@playwright/test'

// ─── Clubes (fixtures multi-tenant) ──────────────────────────────────────────
// Dos clubes para poder probar branding/aislamiento sin copiar-pegar: Pamir es
// el club "de siempre" (mantiene sus asserts históricos, p.ej. "Socios ACP"),
// El Montañista es el segundo club usado por branding.spec.ts para probar que
// nada de Pamir se filtra a la sesión de otro club.

export const PAMIR_ORG = {
  id: 'org-pamir',
  slug: 'pamir',
  name: 'Andino Club Pamir',
  shortName: 'Pamir',
  membresiaPropia: 'SOCIO_ANDINO_PAMIR',
}

export const EL_MONTANISTA_ORG = {
  id: 'org-el-montanista',
  slug: 'el-montanista',
  name: 'Club Andino El Montañista',
  shortName: 'El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
}

interface MockUser {
  id: string
  email: string
  name: string
  rol: 'SOCIO' | 'LIDER' | 'ADMIN'
  gestorCategorias: { categoriaId: number; slug: string }[]
  organization: typeof PAMIR_ORG | typeof EL_MONTANISTA_ORG
}

function mockUser(org: MockUser['organization'], overrides: Omit<MockUser, 'organization' | 'gestorCategorias'> & { gestorCategorias?: MockUser['gestorCategorias'] }): MockUser {
  return { gestorCategorias: [], ...overrides, organization: org }
}

// ─── Usuarios de Pamir ────────────────────────────────────────────────────────

export const MOCK_USER = mockUser(PAMIR_ORG, {
  id: 'user-test-001',
  email: 'test@example.com',
  name: 'Test Alpinista',
  rol: 'SOCIO',
})

export const MOCK_ADMIN = mockUser(PAMIR_ORG, {
  id: 'user-admin-001',
  email: 'seguridad.acp.cl@gmail.com',
  name: 'Admin Seguridad',
  rol: 'ADMIN',
})

/** Líder: socio al que además se le permite invitar a otros socios */
export const MOCK_LIDER = mockUser(PAMIR_ORG, {
  id: 'user-lider-001',
  email: 'lider@example.com',
  name: 'Lider Cordada',
  rol: 'LIDER',
})

/** Gestor de eventos: socio con una categoría asignada (montanismo-n1) */
export const MOCK_GESTOR = mockUser(PAMIR_ORG, {
  id: 'user-gestor-001',
  email: 'gestor@example.com',
  name: 'Gestora Montaña',
  rol: 'SOCIO',
  gestorCategorias: [{ categoriaId: 1, slug: 'montanismo-n1' }],
})

export const MOCK_INTEGRANTE = {
  id: 'integrante-001',
  nombreCompleto: 'Test Alpinista',
  rut: '12.345.678-9',
  email: 'test@example.com',
  membresiaClub: 'SOCIO_ANDINO_PAMIR',
  nombreClub: null,
  createdAt: new Date().toISOString(),
}

export const MOCK_SALIDA = {
  id: 'salida-001',
  numeroSalida: 7,
  nombreActividad: 'Ascenso al Plomo',
  ubicacionGeografica: 'Cajón del Maipo',
  disciplina: 'ALPINISMO',
  fechaInicio: new Date().toISOString(),
  horaRetornoEstimada: '18:00',
  status: 'EN_CURSO',
  participantes: [
    { rut: '12.345.678-9', nombre: 'Test Alpinista', membresiaClub: 'SOCIO_ANDINO_PAMIR' },
  ],
}

// ─── Usuarios de El Montañista (segundo club) ────────────────────────────────

export const MOCK_ADMIN_MONTANISTA = mockUser(EL_MONTANISTA_ORG, {
  id: 'user-admin-montanista-001',
  email: 'admin@elmontanista.example.com',
  name: 'Admin Montañista',
  rol: 'ADMIN',
})

export const MOCK_USER_MONTANISTA = mockUser(EL_MONTANISTA_ORG, {
  id: 'user-socio-montanista-001',
  email: 'socio@elmontanista.example.com',
  name: 'Socio Montañista',
  rol: 'SOCIO',
})

export const MOCK_INTEGRANTE_MONTANISTA = {
  id: 'integrante-montanista-001',
  nombreCompleto: 'Socio Montañista',
  rut: '9.876.543-2',
  email: 'socio@elmontanista.example.com',
  membresiaClub: 'SOCIO_EL_MONTANISTA',
  nombreClub: null,
  createdAt: new Date().toISOString(),
}

/** Injects a valid auth session into localStorage before page load */
export async function setAuth(page: Page, user = MOCK_USER, token = 'mock-jwt-token') {
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem('pamir_auth', JSON.stringify({ user, token }))
    },
    { user, token },
  )
}

/** Mocks GET /api/me — returns the given user (self-heal de rol en useAuth) */
export async function mockMe(page: Page, user: Record<string, unknown> = MOCK_USER) {
  await page.route('**/api/me', (route: Route) => {
    void route.fulfill({ status: 200, json: { user } })
  })
}

/** Mocks GET /api/integrantes/me — returns 404 (no integrante) */
export async function mockNoIntegrante(page: Page) {
  await page.route('**/api/integrantes/me', (route: Route) => {
    void route.fulfill({ status: 404, json: { error: 'Sin ficha de integrante' } })
  })
}

/** Mocks GET /api/integrantes/me — returns an existing integrante */
export async function mockHasIntegrante(page: Page, integrante: unknown = MOCK_INTEGRANTE) {
  await page.route('**/api/integrantes/me', (route: Route) => {
    void route.fulfill({ status: 200, json: integrante })
  })
}

/** Mocks GET /api/salidas */
export async function mockSalidas(page: Page, salidas: unknown[] = []) {
  await page.route('**/api/salidas', (route: Route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({ status: 200, json: salidas })
    } else {
      void route.continue()
    }
  })
}

/** Mocks GET /api/integrantes/by-rut/:rut — returns the mock integrante */
export async function mockIntegranteByRut(page: Page, integrante: unknown = MOCK_INTEGRANTE) {
  await page.route('**/api/integrantes/by-rut/**', (route: Route) => {
    void route.fulfill({ status: 200, json: integrante })
  })
}

/** Mocks POST /api/integrantes */
export async function mockCreateIntegrante(page: Page) {
  await page.route('**/api/integrantes', (route: Route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({ status: 201, json: MOCK_INTEGRANTE })
    } else {
      void route.continue()
    }
  })
}

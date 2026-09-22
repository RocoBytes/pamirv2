import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import {
  setAuth,
  mockMe,
  mockHasIntegrante,
  mockSalidas,
  MOCK_USER,
  MOCK_ADMIN_MONTANISTA,
  MOCK_USER_MONTANISTA,
  MOCK_INTEGRANTE_MONTANISTA,
  EL_MONTANISTA_ORG,
} from './helpers'

// ─── Mocks compartidos por las pantallas de El Montañista ────────────────────
// Un solo beforeEach cablea TODO lo que cualquier pantalla principal podría
// pedir: más simple y más robusto que mockear pantalla por pantalla, y una
// ruta sin uso no rompe nada.
async function mockMontanistaScreens(page: Page) {
  await setAuth(page, MOCK_ADMIN_MONTANISTA)
  await mockMe(page, MOCK_ADMIN_MONTANISTA)
  await mockHasIntegrante(page, { ...MOCK_INTEGRANTE_MONTANISTA, membresiaClub: 'SOCIO_EL_MONTANISTA' })
  await mockSalidas(page, [])
  await page.route('**/api/eventos/categorias', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
  await page.route('**/api/eventos*', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
  await page.route('**/api/documentos', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
  await page.route('**/api/documentos/admin', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
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
  await page.route('**/api/admin/users', (route: Route) => {
    void route.fulfill({ status: 200, json: [] })
  })
  await page.route('**/api/invitaciones', (route: Route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({ status: 200, json: { invitaciones: [] } })
    } else {
      void route.continue()
    }
  })
  await page.route('**/api/admin/dashboard-layout', (route: Route) => {
    void route.fulfill({ status: 200, json: { layout: null } })
  })
  // Regex exacto (no glob): "**/api/admin/dashboard*" también matchearía
  // /api/admin/dashboard-layout (el "-layout" no tiene "/", así que el "*"
  // del glob lo cubriría), pisando el mock de arriba.
  await page.route(/\/api\/admin\/dashboard(\?.*)?$/, (route: Route) => {
    void route.fulfill({
      status: 200,
      json: {
        // totalSalidas > 0 a propósito: con 0, AdminDashboard.tsx muestra el
        // banner "No hay salidas..." en vez del estado realmente cargado, y
        // el test no podría distinguir "cargando" de "cargado y vacío".
        metrics: {
          totalSalidas: 3,
          pendientesCierre: 1,
          conCierre: 2,
          canceladas: 0,
          totalParticipantes: 5,
          promedioParticipantes: 1.7,
          totalExpress: 0,
          pctConCierre: 66,
          incidentes: 0,
          accidentes: 0,
          promedioCalidad: 4.5,
          salidasEvalBaja: 0,
        },
        porEstado: [{ estado: 'COMPLETADA', total: 2 }],
        porMes: [{ mes: '2026-08', total: 3 }],
        incidentesPorMes: [],
        participantesPorTipo: { registrados: 5, express: 0 },
        calidad: { promedio: 4.5, totalRespuestas: 2, distribucion: [], porMes: [] },
        porLider: [{ lider: 'Admin Montañista', total: 3 }],
        tiposIncidente: [],
        tiposAccidente: [],
        salidaVsCierre: { conCierre: 2, sinCierre: 1, conCambiosRoster: 0, conIncidentes: 0, conAccidentes: 0 },
        filtros: { lideres: ['Admin Montañista'], disciplinas: [], tipos: [], temporadas: [] },
      },
    })
  })
}

// ─── Invariante: nada de Pamir se filtra a la sesión de otro club ────────────
// EXCEPCIÓN DOCUMENTADA: el filtro "Club" de AdminDashboard ofrece
// legítimamente "Socio Andino Club Pamir" como afiliación de un PARTICIPANTE
// — es dato cruzado entre clubes, no branding del tenant (ver el comentario
// junto a él en el código fuente). Lleva `data-cross-club-options="true"` en
// su contenedor: este helper lo quita del DOM antes de leer el texto, así que
// el barrido queda acotado a esa excepción exacta y a nada más. RegistroIntegrante
// ya NO tiene esta excepción: el formulario pertenece al club donde se crea la
// ficha y el servidor asigna su membresía, así que dejó de listar clubes. Si
// algún día se agrega una lista nueva de este tipo sin el atributo, este test
// debe fallar y forzar a marcarla explícitamente en vez de excluirla en silencio.
async function expectNoPamirLeak(page: Page) {
  const bodyText = await page.evaluate(() => {
    // Muta el DOM vivo (no un clon: innerText en un nodo desconectado no
    // calcula layout y devuelve resultados vacíos/no confiables en Chromium).
    // Cada test llama esto como su último paso, así que no afecta pasos
    // posteriores dentro del mismo test.
    document.querySelectorAll('[data-cross-club-options]').forEach((el) => el.remove())
    return document.body.innerText
  })
  expect(bodyText).not.toMatch(/pamir/i)

  const title = await page.title()
  expect(title).not.toMatch(/pamir/i)

  const imgs = page.locator('img')
  const count = await imgs.count()
  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i)
    const src = (await img.getAttribute('src')) ?? ''
    const alt = (await img.getAttribute('alt')) ?? ''
    expect(src.toLowerCase()).not.toContain('pamir')
    expect(alt.toLowerCase()).not.toContain('pamir')
  }
}

test.describe('Branding por club — El Montañista nunca ve nada de Pamir', () => {
  test.beforeEach(async ({ page }) => {
    await mockMontanistaScreens(page)
  })

  // Cada test espera primero un elemento que SOLO existe una vez que los
  // datos mockeados llegaron (nunca el título estático de la pantalla, que
  // renderiza igual durante la carga): expectNoPamirLeak lee el DOM una sola
  // vez, sin reintentos, así que si corriera contra el estado "Cargando..."
  // un filtrado real pasaría inadvertido.
  test('dashboard: muestra el nombre del club, la insignia CAEM, y ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Cargando salidas...')).toHaveCount(0)
    await expect(page.getByText('Sin salidas activas en curso')).toBeVisible()
    await expect(page.getByText('El Montañista', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Socios CAEM')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('eventos del club: muestra el nombre del club y ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir eventos del club').click()
    await expect(page.getByText('Eventos del club')).toBeVisible()
    // La pantalla abre en vista "Calendario": el estado cargado se reconoce por
    // la navegación de mes (el calendario solo se monta cuando terminó la
    // carga). "Sin eventos próximos" pertenece a la vista "Lista", que se
    // revisa después para cubrir ambos estados cargados.
    await expect(page.getByText('Cargando eventos...')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mes anterior' })).toBeVisible()
    await expect(page.getByText('El Montañista', { exact: true }).first()).toBeVisible()
    await expectNoPamirLeak(page)
    await page.getByRole('button', { name: 'Lista' }).click()
    await expect(page.getByText('Sin eventos próximos')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('documentación del club: muestra la insignia CAEM y ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir documentación del club').click()
    await expect(page.getByText('Documentación del Club')).toBeVisible()
    await expect(page.getByText('Documentos en preparación')).toBeVisible()
    await expect(page.getByText('Exclusivo socios CAEM')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('contactos esenciales: ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir contactos esenciales de emergencia').click()
    await expect(page.getByText('Contactos esenciales')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('panel de administración: menciona el nombre del club y ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir panel de administración').click()
    await expect(page.getByText('Panel de Administración')).toBeVisible()
    // Gatea por !isLoading (el mismo bloque que la sección de invitaciones),
    // más los dos indicadores de carga independientes de esta pantalla.
    await expect(page.getByText(/Club Andino El Montañista es un sistema cerrado/)).toBeVisible()
    await expect(page.getByText('Cargando métricas...')).toHaveCount(0)
    await expect(page.getByText('Todavía no has enviado invitaciones')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('dashboard analítico (admin): ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir panel de administración').click()
    await page.getByRole('button', { name: /Ver Dashboard analítico/ }).click()
    await expect(page.getByText('Dashboard analítico')).toBeVisible()
    // El fetch corre tras un debounce de 300ms (AdminDashboard.tsx): esperar
    // solo el título estático no alcanza, hay que esperar a que el spinner
    // desaparezca y a que el mock (con datos no vacíos) reemplace el banner
    // de "sin salidas".
    await expect(page.getByText('Cargando dashboard...')).toHaveCount(0)
    await expect(page.getByText('No hay salidas que coincidan con los filtros seleccionados.')).toHaveCount(0)
    await expectNoPamirLeak(page)
  })

  test('invitar al club: ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Invitar al club').click()
    await expect(page.getByRole('heading', { name: 'Invitar al club' })).toBeVisible()
    await expect(page.getByText('Todavía no has enviado invitaciones')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('wizard de nueva salida: ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir formulario de salida').click()
    await expect(page.getByText('Nueva Salida')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('crear evento (evento admin): ningún rastro de Pamir', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Abrir eventos del club').click()
    await page.getByRole('button', { name: 'Crear evento' }).click()
    await expect(page.getByText('Crear evento')).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('sin logo propio subido: cae al logo neutral por defecto, sin imagen rota', async ({ page }) => {
    await page.goto('/')
    // El Montañista no tiene /logos/el-montanista.png en este entorno: el
    // <img> debe terminar apuntando al SVG neutral tras el evento onError.
    const logo = page.locator('header img').first()
    await expect(logo).toHaveAttribute('src', /_default\.svg$/)
  })
})

test.describe('Branding por club — el fixture de Pamir sigue mostrando su propia marca', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page, [])
  })

  test('el logo de Pamir carga desde /logos/pamir.png, su nombre es visible y la insignia es ACP', async ({ page }) => {
    await page.goto('/')
    const logo = page.locator('header img').first()
    await expect(logo).toHaveAttribute('src', '/logos/pamir.png')
    await expect(page.getByText('Pamir', { exact: true }).first()).toBeVisible()
    // "Socios ACP" es la insignia de la propia tarjeta del dashboard (no un
    // texto de DocumentosPage) — no hace falta navegar para verla.
    await expect(page.getByText('Socios ACP')).toBeVisible()
  })
})

test.describe('Branding por club — semántica "socio de ESTE club", no "es Pamir"', () => {
  test('un socio de El Montañista con ficha SOCIO_ANDINO_PAMIR no ve la tarjeta de Documentación del Club', async ({ page }) => {
    await setAuth(page, MOCK_USER_MONTANISTA)
    await mockMe(page, MOCK_USER_MONTANISTA)
    // Ficha "de otro club" a propósito: prueba que el gate depende de la
    // membresía PROPIA del club que consulta, no de si el usuario "es Pamir".
    await mockHasIntegrante(page, { ...MOCK_INTEGRANTE_MONTANISTA, membresiaClub: 'SOCIO_ANDINO_PAMIR' })
    await mockSalidas(page, [])
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(page.getByLabel('Abrir documentación del club')).toHaveCount(0)
  })
})

test.describe('Branding por club — pantallas sin sesión', () => {
  test('login: sin nombre ni logo de ningún club, título genérico', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByText('© 2026 RIALA · Seguridad en Montaña')).toBeVisible()
    await expect(page.title()).resolves.toBe('Registro de Salidas de Montaña')
    await expectNoPamirLeak(page)
  })

  test('aceptar invitación: muestra el club que invita (El Montañista), nunca Pamir', async ({ page }) => {
    await page.route('**/api/auth/invitaciones/consultar', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          email: 'nuevo@elmontanista.example.com',
          rol: 'SOCIO',
          rolLabel: 'Socio',
          invitadoPor: 'Admin Montañista',
          organization: EL_MONTANISTA_ORG,
        },
      })
    })
    await page.goto('/#invite=tok-montanista')
    await expect(page.getByText('Club Andino El Montañista', { exact: false })).toBeVisible()
    await expectNoPamirLeak(page)
  })

  test('evaluación express: muestra el club dueño del token (El Montañista), nunca Pamir', async ({ page }) => {
    const token = 'tok-eval-montanista'
    await page.route(`**/api/evaluaciones/${token}`, (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          nombreActividad: 'Travesía El Montañista',
          fechaInicio: new Date().toISOString(),
          used: false,
          organization: EL_MONTANISTA_ORG,
        },
      })
    })
    await page.goto(`/?evaluacion=${token}`)
    await expect(page.getByText('El Montañista', { exact: true }).first()).toBeVisible()
    await expectNoPamirLeak(page)
  })
})

test.describe('Ownership del borrador — un mismo navegador, más de un usuario', () => {
  test('un usuario de OTRO club que inicia sesión en el mismo navegador purga el borrador previo', async ({ page }) => {
    let currentUser: unknown = MOCK_USER // Pamir
    await page.route('**/api/me', (route: Route) => {
      void route.fulfill({ status: 200, json: { user: currentUser } })
    })
    await setAuth(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page, [])
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.evaluate(() =>
      localStorage.setItem('pamir_draft', JSON.stringify({ nombreActividad: 'Borrador de Alpinista A' })),
    )

    await page.getByRole('button', { name: 'Cerrar sesion' }).click()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).not.toBeNull()

    // Usuario B (El Montañista) inicia sesión en el MISMO navegador. La ficha
    // de integrante sigue siendo la de A (mockHasIntegrante ya registrado
    // arriba fulfilla primero) — no importa para este test: solo interesa
    // pamir_draft, que decide establishSession antes de que nada de ficha entre en juego.
    currentUser = MOCK_ADMIN_MONTANISTA
    await page.evaluate(
      ({ user, token }) => localStorage.setItem('pamir_auth', JSON.stringify({ user, token })),
      { user: MOCK_ADMIN_MONTANISTA, token: 'mock-jwt-montanista' },
    )
    await page.reload()
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).toBeNull()
  })

  test('el mismo usuario que cierra sesión y vuelve a entrar conserva su borrador', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page, [])
    await page.goto('/')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.evaluate(() =>
      localStorage.setItem('pamir_draft', JSON.stringify({ nombreActividad: 'Borrador de Alpinista A' })),
    )

    await page.getByRole('button', { name: 'Cerrar sesion' }).click()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()

    // El mismo usuario vuelve a entrar en el mismo navegador
    await page.evaluate(
      ({ user, token }) => localStorage.setItem('pamir_auth', JSON.stringify({ user, token })),
      { user: MOCK_USER, token: 'mock-jwt-otra-vez' },
    )
    await page.reload()
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).not.toBeNull()
  })
})

// ─── Club preferido en el login (?club=<slug>) y logo propio subido ─────────
// Fixture local (no PAMIR_ORG/EL_MONTANISTA_ORG de helpers.ts a propósito):
// esos dos no traen hasLogo, así que el resto de este archivo sigue probando
// el comportamiento de hoy sin tocarlos (ver el comentario del backend en
// este mismo cambio: "los fixtures no tienen hasLogo").
test.describe('Branding por club — club preferido pre-login y logo propio subido', () => {
  test('login con ?club=<slug>: pinta el logo propio subido de ESE club, sin sesión', async ({ page }) => {
    await page.route('**/api/clubes/el-montanista/marca', (route: Route) => {
      void route.fulfill({
        status: 200,
        json: {
          slug: 'el-montanista',
          name: 'Club Andino El Montañista',
          shortName: 'El Montañista',
          hasLogo: true,
          logoVersion: 'v1test',
        },
      })
    })
    await page.goto('/?club=el-montanista')
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    const logo = page.locator('img').first()
    await expect(logo).toHaveAttribute('src', '/api/clubes/el-montanista/logo?v=v1test')
  })

  test('login sin ?club= y sin club recordado: logo neutral (comportamiento de hoy, sin llamar a /api/clubes)', async ({ page }) => {
    let marcaCalled = false
    await page.route('**/api/clubes/**/marca', (route: Route) => {
      marcaCalled = true
      void route.fulfill({ status: 404, json: { error: 'not found' } })
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    expect(marcaCalled).toBe(false)
  })
})

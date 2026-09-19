import { test, expect, type Page, type Route } from '@playwright/test'
import {
  setAuth,
  mockMe,
  mockHasIntegrante,
  mockSalidas,
  MOCK_USER,
  MOCK_ADMIN,
  MOCK_GESTOR,
} from './helpers'

const MOCK_CATEGORIA = {
  id: 3,
  slug: 'senderismo',
  nombre: 'Senderismo',
  color: '#4E805D',
  orden: 3,
  activa: true,
}

// Fechas relativas: el evento siempre es futuro y las inscripciones están abiertas
const DIA = 86_400_000
const inicioIso = `${new Date(Date.now() + 10 * DIA).toISOString().slice(0, 10)}T00:00:00.000Z`
const corteIso = new Date(Date.now() + 5 * DIA).toISOString()

const MOCK_EVENTO = {
  id: 'evento-001',
  titulo: 'Trekking Cerro Provincia',
  categoriaId: 4,
  estado: 'PUBLICADO',
  fechaInicio: inicioIso,
  horaInicio: '07:30',
  fechaFin: inicioIso,
  duracionTexto: '1 día',
  ubicacion: 'Cajón del Maipo',
  reunionCoordinacion: 'Jueves, 20:00, online',
  organizadorNombre: 'María Organizadora',
  alturaMaximaMsnm: 2750,
  dificultad: 3,
  cupos: 12,
  fechaCorte: corteIso,
  objetivo: 'Cumbre del Cerro Provincia',
  itinerario: 'Salida 07:30 desde el club',
  itinerarioFileId: 'drive-itin-001',
  itinerarioFileName: 'itinerario.pdf',
  itinerarioFileUrl: 'https://drive.google.com/file/d/drive-itin-001/view',
  incluye: null,
  noIncluye: null,
  recomendaciones: null,
  avisoDestacado: null,
  creadoPor: 'user-admin-001',
  creadoAt: new Date().toISOString(),
  actualizadoAt: new Date().toISOString(),
  publicadoAt: new Date().toISOString(),
  finalizadoAt: null,
  finalizadoPor: null,
  canceladoAt: null,
  motivoCancelacion: null,
  categoria: MOCK_CATEGORIA,
  totalPostulantes: 3,
  miInscripcion: null,
}

const MOCK_DECLARACION = {
  id: 1,
  version: '2026-08',
  titulo: 'DECLARACIÓN JURADA DEL PARTICIPANTE — Declaro bajo mi responsabilidad que:',
  items: [
    'Punto uno de la declaración.',
    'Punto dos de la declaración.',
    'Punto tres de la declaración.',
    'Punto cuatro de la declaración.',
    'Punto cinco de la declaración.',
    'Punto seis de la declaración.',
    'Punto siete de la declaración.',
  ],
}

type MiEstado = 'ninguna' | 'postulado' | 'retirado'

/** Mocks del detalle + inscripción con estado mutable entre requests */
async function mockDetalleConInscripcion(page: Page, inicial: MiEstado) {
  const estado: { mi: MiEstado; lastPayload: unknown } = { mi: inicial, lastPayload: null }

  await page.route('**/api/eventos/evento-001', (route: Route) => {
    void route.fulfill({
      status: 200,
      json: {
        ...MOCK_EVENTO,
        declaracionVigente: MOCK_DECLARACION,
        miInscripcion:
          estado.mi === 'ninguna'
            ? null
            : { estado: estado.mi === 'postulado' ? 'POSTULADO' : 'RETIRADO' },
      },
    })
  })

  await page.route('**/api/eventos/evento-001/inscripcion', (route: Route) => {
    const method = route.request().method()
    if (method === 'POST') {
      estado.lastPayload = route.request().postDataJSON()
      estado.mi = 'postulado'
      void route.fulfill({ status: 201, json: { inscripcion: { id: 'insc-001', estado: 'POSTULADO' } } })
    } else if (method === 'DELETE') {
      estado.mi = 'retirado'
      void route.fulfill({ status: 200, json: { inscripcion: { id: 'insc-001', estado: 'RETIRADO' } } })
    } else {
      void route.continue()
    }
  })

  return estado
}

async function mockEventosApi(page: Page) {
  await page.route('**/api/eventos/categorias', (route: Route) => {
    void route.fulfill({ status: 200, json: [MOCK_CATEGORIA] })
  })
  // La lista puede pedirse con o sin query string
  await page.route('**/api/eventos', (route: Route) => {
    void route.fulfill({ status: 200, json: [MOCK_EVENTO] })
  })
  await page.route('**/api/eventos?*', (route: Route) => {
    void route.fulfill({ status: 200, json: [MOCK_EVENTO] })
  })
}

test.describe('Eventos del club – socio', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await mockEventosApi(page)
  })

  test('el Dashboard muestra la tarjeta de Eventos del club', async ({ page }) => {
    await page.goto('/')
    const card = page.getByRole('button', { name: 'Abrir eventos del club' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Eventos del club')
    await expect(card).toContainText('Calendario de actividades e inscripciones')
  })

  test('abre Eventos y ve la tarjeta publicada con badge de categoría e inscripciones abiertas', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()

    await expect(page.getByRole('heading', { name: 'Eventos del club' })).toBeVisible()
    await expect(page.getByText('Trekking Cerro Provincia')).toBeVisible()
    // Badge de categoría dentro de la tarjeta (el chip de filtro también dice Senderismo)
    const card = page.locator('button', { hasText: 'Trekking Cerro Provincia' })
    await expect(card.getByText('Senderismo', { exact: true })).toBeVisible()
    await expect(card.getByText(/Inscripciones abiertas/)).toBeVisible()
    await expect(card.getByText('12 cupos · 3 postulantes')).toBeVisible()
  })

  test('un socio NO ve el botón Crear evento ni Gestionar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()

    await expect(page.getByRole('heading', { name: 'Eventos del club' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Crear evento/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Gestionar/ })).toHaveCount(0)
  })
})

test.describe('Eventos del club – inscripción (socio)', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await mockEventosApi(page)
  })

  async function abrirDetalle(page: Page) {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()
    await page.getByText('Trekking Cerro Provincia').click()
  }

  test('flujo SÍ: vehículo → cupos → declaración 7/7 → payload correcto y estado postulado', async ({ page }) => {
    const estado = await mockDetalleConInscripcion(page, 'ninguna')
    await abrirDetalle(page)

    await page.getByRole('button', { name: 'Inscribirme' }).click()
    const modal = page.getByRole('dialog', { name: /Inscripción/ })
    await expect(modal.getByText('¿Cuento con vehículo propio?')).toBeVisible()

    await modal.getByRole('button', { name: 'SÍ' }).click()
    await expect(
      modal.getByText('¿Cuántos cupos puedo entregar para otros participantes?'),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Sumar un cupo' }).click()
    await modal.getByRole('button', { name: 'Sumar un cupo' }).click()
    await modal.getByRole('button', { name: 'Continuar' }).click()

    await expect(modal.getByText(/DECLARACIÓN JURADA DEL PARTICIPANTE/)).toBeVisible()
    const checks = modal.locator('input[type="checkbox"]')
    await expect(checks).toHaveCount(7)
    const confirmar = modal.getByRole('button', { name: 'Confirmar inscripción' })
    await expect(confirmar).toBeDisabled()
    for (let i = 0; i < 7; i++) {
      await checks.nth(i).check()
    }
    await expect(confirmar).toBeEnabled()
    await confirmar.click()

    await expect(page.getByText(/Estás postulado\/a/)).toBeVisible()
    expect(estado.lastPayload).toEqual({
      tieneVehiculo: true,
      cuposVehiculo: 2,
      declaracionVersionId: 1,
      itemsAceptados: [true, true, true, true, true, true, true],
    })
  })

  test('flujo NO: salta el paso de cupos directo a la declaración', async ({ page }) => {
    await mockDetalleConInscripcion(page, 'ninguna')
    await abrirDetalle(page)

    await page.getByRole('button', { name: 'Inscribirme' }).click()
    const modal = page.getByRole('dialog', { name: /Inscripción/ })
    await modal.getByRole('button', { name: 'NO', exact: true }).click()

    await expect(modal.getByText('Paso 3 de 3')).toBeVisible()
    await expect(
      modal.getByText('¿Cuántos cupos puedo entregar para otros participantes?'),
    ).toHaveCount(0)
    await expect(modal.getByText(/DECLARACIÓN JURADA DEL PARTICIPANTE/)).toBeVisible()
  })

  test('el detalle enlaza al adjunto del itinerario en una pestaña nueva', async ({ page }) => {
    await mockDetalleConInscripcion(page, 'ninguna')
    await abrirDetalle(page)

    const link = page.getByRole('link', { name: /Ver itinerario adjunto/ })
    await expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-itin-001/view')
    await expect(link).toHaveAttribute('target', '_blank')
  })

  test('postulado: puede retirar la postulación con confirmación inline', async ({ page }) => {
    await mockDetalleConInscripcion(page, 'postulado')
    await abrirDetalle(page)

    await expect(page.getByText(/Estás postulado\/a/)).toBeVisible()
    await page.getByRole('button', { name: 'Retirar postulación' }).click()
    await expect(page.getByText('¿Retirar tu postulación?')).toBeVisible()
    await page.getByRole('button', { name: 'Confirmar retiro' }).click()

    await expect(page.getByText('Retiraste tu postulación.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Inscribirme nuevamente' })).toBeVisible()
  })
})

test.describe('Eventos del club – admin (rol ADMIN)', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockMe(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await mockEventosApi(page)
  })

  test('el admin ve Crear evento y Gestionar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()

    await expect(page.getByRole('heading', { name: 'Eventos del club' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Crear evento/ })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Gestionar Trekking Cerro Provincia' }),
    ).toBeVisible()
  })
})

// ─── Postulantes (Fase 5) ────────────────────────────────────────────────────

const ANA_ID = '11111111-1111-4111-8111-111111111111'
const BENITO_ID = '22222222-2222-4222-8222-222222222222'
const CARLA_ID = '33333333-3333-4333-8333-333333333333'

const MOCK_POSTULANTES = {
  evento: {
    id: 'evento-001',
    titulo: 'Trekking Cerro Provincia',
    cupos: 2,
    estado: 'PUBLICADO',
    fechaCorte: corteIso,
  },
  postulantes: [
    {
      id: ANA_ID,
      usuario: { nombre: 'Ana Postulante', email: 'ana@example.com' },
      telefono: '+56 9 1111 1111',
      membresiaClub: 'SOCIO_ANDINO_PAMIR',
      tieneVehiculo: true,
      cuposVehiculo: 3,
      estado: 'POSTULADO',
      postuladoAt: new Date().toISOString(),
      retiradoAt: null,
      notificaciones: [
        { tipo: 'INSCRIPCION_CONFIRMADA', estado: 'ENVIADA', intentos: 0, ultimoError: null },
      ],
    },
    {
      id: BENITO_ID,
      usuario: { nombre: 'Benito Sinauto', email: 'benito@example.com' },
      telefono: null,
      membresiaClub: null,
      tieneVehiculo: false,
      cuposVehiculo: null,
      estado: 'POSTULADO',
      postuladoAt: new Date().toISOString(),
      retiradoAt: null,
      notificaciones: [
        { tipo: 'INSCRIPCION_CONFIRMADA', estado: 'ERROR', intentos: 1, ultimoError: 'invalid_grant' },
      ],
    },
    {
      id: CARLA_ID,
      usuario: { nombre: 'Carla Retirada', email: 'carla@example.com' },
      telefono: null,
      membresiaClub: 'SOCIO_OTRO_CLUB',
      tieneVehiculo: false,
      cuposVehiculo: null,
      estado: 'RETIRADO',
      postuladoAt: new Date().toISOString(),
      retiradoAt: new Date().toISOString(),
      notificaciones: [
        { tipo: 'INSCRIPCION_CONFIRMADA', estado: 'ENVIADA', intentos: 0, ultimoError: null },
      ],
    },
  ],
}

async function mockPostulantesApi(page: Page) {
  const capturado: { finalizarPayload: unknown } = { finalizarPayload: null }

  await page.route('**/api/eventos/evento-001/postulantes', (route: Route) => {
    void route.fulfill({ status: 200, json: MOCK_POSTULANTES })
  })
  await page.route('**/api/eventos/evento-001/finalizar', (route: Route) => {
    capturado.finalizarPayload = route.request().postDataJSON()
    void route.fulfill({ status: 200, json: { seleccionados: 1, noSeleccionados: 1 } })
  })
  await page.route('**/api/eventos/evento-001/notificaciones/reenviar', (route: Route) => {
    void route.fulfill({ status: 200, json: { despachadas: 1, fallidas: 0, pendientes: 0 } })
  })
  return capturado
}

test.describe('Eventos del club – postulantes (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_ADMIN)
    await mockMe(page, MOCK_ADMIN)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await mockEventosApi(page)
    await mockDetalleConInscripcion(page, 'ninguna')
  })

  async function abrirPostulantes(page: Page) {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()
    await page.getByRole('button', { name: 'Gestionar Trekking Cerro Provincia' }).click()
    await page.getByRole('button', { name: 'Postulantes' }).click()
  }

  test('la tabla muestra los postulantes con estados y resumen de transporte', async ({ page }) => {
    await mockPostulantesApi(page)
    await abrirPostulantes(page)

    await expect(page.getByText('Ana Postulante')).toBeVisible()
    await expect(page.getByText('Benito Sinauto')).toBeVisible()
    await expect(page.getByText('Carla Retirada')).toBeVisible()
    await expect(page.getByText('Retirado', { exact: true })).toBeVisible()
    await expect(page.getByText('Seleccionados 0 / 2 cupos')).toBeVisible()
  })

  test('la fila RETIRADO no es seleccionable', async ({ page }) => {
    await mockPostulantesApi(page)
    await abrirPostulantes(page)

    await expect(page.getByRole('checkbox', { name: 'Seleccionar a Ana Postulante' })).toBeEnabled()
    await expect(page.getByRole('checkbox', { name: 'Seleccionar a Carla Retirada' })).toBeDisabled()
  })

  test('finalizar: gating, diálogo con N/M y payload con seleccionadosIds', async ({ page }) => {
    const capturado = await mockPostulantesApi(page)
    await abrirPostulantes(page)

    const finalizar = page.getByRole('button', { name: 'Finalizar evento' })
    await expect(finalizar).toBeDisabled()

    await page.getByRole('checkbox', { name: 'Seleccionar a Ana Postulante' }).check()
    await expect(finalizar).toBeEnabled()
    await expect(page.getByText('Seleccionados 1 / 2 cupos')).toBeVisible()
    await expect(page.getByText('transporte cubierto')).toBeVisible()

    await finalizar.click()
    await expect(
      page.getByText(
        'Se confirmarán 1 participantes y se notificará a 1 no seleccionados. Esto cierra las inscripciones y no se puede deshacer.',
      ),
    ).toBeVisible()
    await expect(
      page.getByText('Aún no se cumple la fecha de corte; las inscripciones se cerrarán ahora.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Finalizar', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Finalizar evento' })).toHaveCount(0)
    expect(capturado.finalizarPayload).toEqual({ seleccionadosIds: [ANA_ID] })
  })

  test('Reenviar pendientes es visible con una notificación en ERROR y muestra el resultado', async ({ page }) => {
    await mockPostulantesApi(page)
    await abrirPostulantes(page)

    const reenviar = page.getByRole('button', { name: 'Reenviar pendientes' })
    await expect(reenviar).toBeVisible()
    await reenviar.click()
    await expect(page.getByText(/Reenvío completado: 1 enviadas · 0 fallidas · 0 pendientes/)).toBeVisible()
  })
})

// ─── Gestores por categoría ──────────────────────────────────────────────────

const CAT_M1 = {
  id: 1,
  slug: 'montanismo-n1',
  nombre: 'Montañismo N°1',
  color: '#E8862E',
  orden: 1,
  activa: true,
}

const EV_M1 = {
  ...MOCK_EVENTO,
  id: 'evento-m1-001',
  titulo: 'Salida Montaña Uno',
  categoriaId: 1,
  categoria: CAT_M1,
}

/** Lista con dos eventos de categorías distintas (montanismo-n1 + senderismo) */
async function mockEventosDosCategorias(page: Page) {
  await page.route('**/api/eventos/categorias', (route: Route) => {
    void route.fulfill({ status: 200, json: [CAT_M1, MOCK_CATEGORIA] })
  })
  const responder = (route: Route) => {
    void route.fulfill({ status: 200, json: [EV_M1, MOCK_EVENTO] })
  }
  await page.route('**/api/eventos', responder)
  await page.route('**/api/eventos?*', responder)
}

test.describe('Eventos del club – gestor de categoría', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_GESTOR)
    await mockMe(page, MOCK_GESTOR)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await mockEventosDosCategorias(page)
  })

  test('el gestor ve Crear evento y Gestionar solo en su categoría', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: 'Lista' }).click()

    await expect(page.getByRole('button', { name: /Crear evento/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Gestionar Salida Montaña Uno' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Gestionar Trekking Cerro Provincia' }),
    ).toHaveCount(0)
  })

  test('el formulario de creación solo ofrece sus categorías y la exige', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await page.getByRole('button', { name: /Crear evento/ }).click()

    await expect(page.getByRole('heading', { name: 'Crear evento' })).toBeVisible()
    const opciones = page.locator('#categoría option')
    await expect(opciones).toHaveCount(2)
    await expect(opciones.nth(0)).toHaveText('— Selecciona —')
    await expect(opciones.nth(1)).toHaveText('Montañismo N°1')

    // Sin categoría el guardado se bloquea client-side
    await page.getByLabel(/Título/).fill('Prueba gestor')
    await page.getByRole('button', { name: 'Guardar borrador' }).click()
    await expect(page.getByText('Selecciona la categoría')).toBeVisible()
  })
})

// ─── Calendario (Fase 6) ─────────────────────────────────────────────────────

const MES_CAL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' })
  .format(new Date())
  .slice(0, 7)

function shiftMesCal(mes: string, delta: number): string {
  const [anio = 0, mesNum = 1] = mes.split('-').map(Number)
  return new Date(Date.UTC(anio, mesNum - 1 + delta, 1)).toISOString().slice(0, 7)
}

const MESES_LABEL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function labelMesCal(mes: string): string {
  const [anio = 0, mesNum = 1] = mes.split('-').map(Number)
  const nombre = MESES_LABEL[mesNum - 1] ?? ''
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de ${anio}`
}

const CAT_CURSOS = {
  id: 5,
  slug: 'cursos-talleres',
  nombre: 'Cursos y talleres',
  color: '#29A8DF',
  orden: 4,
  activa: true,
}

const EV_MULTI = {
  ...MOCK_EVENTO,
  id: 'evento-cal-1',
  titulo: 'Travesía Multi',
  fechaInicio: `${MES_CAL}-10T00:00:00.000Z`,
  fechaFin: `${MES_CAL}-12T00:00:00.000Z`,
}

const EV_CURSO = {
  ...MOCK_EVENTO,
  id: 'evento-cal-2',
  titulo: 'Curso Nudos',
  categoriaId: 5,
  categoria: CAT_CURSOS,
  fechaInicio: `${MES_CAL}-15T00:00:00.000Z`,
  fechaFin: `${MES_CAL}-15T00:00:00.000Z`,
}

/** Mock de calendario: respeta ?categoria= y registra las URLs pedidas */
async function mockCalendarioApi(page: Page) {
  const urls: string[] = []
  const eventos = [EV_MULTI, EV_CURSO]

  await page.route('**/api/eventos/categorias', (route: Route) => {
    void route.fulfill({ status: 200, json: [MOCK_CATEGORIA, CAT_CURSOS] })
  })
  const responder = (route: Route) => {
    const url = new URL(route.request().url())
    urls.push(url.pathname + url.search)
    const cats = url.searchParams.getAll('categoria')
    const items = cats.length ? eventos.filter((e) => cats.includes(e.categoria.slug)) : eventos
    void route.fulfill({ status: 200, json: items })
  }
  await page.route('**/api/eventos', responder)
  await page.route('**/api/eventos?*', responder)
  await page.route('**/api/eventos/evento-cal-1', (route: Route) => {
    void route.fulfill({
      status: 200,
      json: { ...EV_MULTI, declaracionVigente: MOCK_DECLARACION, miInscripcion: null },
    })
  })
  return urls
}

test.describe('Eventos del club – calendario', () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await mockMe(page, MOCK_USER)
    await mockHasIntegrante(page)
    await mockSalidas(page)
  })

  async function abrirCalendario(page: Page) {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir eventos del club' }).click()
    await expect(page.getByRole('heading', { name: 'Eventos del club' })).toBeVisible()
  }

  test('un evento multi-día se dibuja como chip que abarca sus 3 días', async ({ page }) => {
    await mockCalendarioApi(page)
    await abrirCalendario(page)

    const chips = page.locator(`button[title="Travesía Multi"]`)
    const total = await chips.count()
    expect(total).toBeGreaterThanOrEqual(1)
    let sumaSpans = 0
    for (let i = 0; i < total; i++) {
      const style = (await chips.nth(i).getAttribute('style')) ?? ''
      const m = /span (\d+)/.exec(style)
      sumaSpans += m ? Number(m[1]) : 1
    }
    // 10, 11 y 12 del mes: 3 días en total, en 1 o 2 segmentos según la semana
    expect(sumaSpans).toBe(3)
  })

  test('dos categorías → dos chips con su color; filtrar por una oculta la otra', async ({ page }) => {
    await mockCalendarioApi(page)
    await abrirCalendario(page)

    const curso = page.locator('button[title="Curso Nudos"]').first()
    await expect(curso).toBeVisible()
    const bg = await curso.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(41, 168, 223)') // #29A8DF
    await expect(page.locator('button[title="Travesía Multi"]').first()).toBeVisible()

    // Chip de filtro 'Senderismo' (exact para no matchear los chips del calendario)
    await page.getByRole('button', { name: 'Senderismo', exact: true }).click()
    await expect(page.locator('button[title="Curso Nudos"]')).toHaveCount(0)
    await expect(page.locator('button[title="Travesía Multi"]').first()).toBeVisible()
  })

  test('la navegación de mes pide ?mes= del mes siguiente y actualiza el título', async ({ page }) => {
    const urls = await mockCalendarioApi(page)
    await abrirCalendario(page)

    await expect(page.getByText(labelMesCal(MES_CAL))).toBeVisible()
    const siguiente = shiftMesCal(MES_CAL, 1)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()

    await expect(page.getByText(labelMesCal(siguiente))).toBeVisible()
    await expect
      .poll(() => urls.some((u) => u.includes(`mes=${siguiente}`)))
      .toBe(true)
  })

  test('clic en un chip abre el detalle del evento', async ({ page }) => {
    await mockCalendarioApi(page)
    await abrirCalendario(page)

    await page.locator('button[title="Travesía Multi"]').first().click()
    await expect(page.getByRole('dialog', { name: /Travesía Multi/ })).toBeVisible()
  })
})

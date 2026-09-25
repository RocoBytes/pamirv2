import { test, expect } from '@playwright/test'
import {
  setAuth,
  mockMe,
  mockHasIntegrante,
  mockSalidas,
  MOCK_USER,
  MOCK_ADMIN_MONTANISTA,
  MOCK_INTEGRANTE,
  PAMIR_ORG,
  EL_MONTANISTA_ORG,
} from './helpers'

test.describe('Redirección transparente — una sola membresía', () => {
  test('riala.cl sin slug redirige a /<slug> cuando la cuenta tiene una sola membresía', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/')
    await expect(page).toHaveURL(/\/pamir$/)
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })
})

test.describe('Mis clubes — varias membresías', () => {
  test('riala.cl sin slug muestra Mis clubes con ambos clubes, uno suspendido y deshabilitado', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: true },
      ],
    }
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()
    await expect(page.getByRole('link', { name: PAMIR_ORG.name })).toBeVisible()
    await expect(page.getByText('Suspendido')).toBeVisible()
    await expect(page.getByRole('link', { name: EL_MONTANISTA_ORG.name })).toHaveCount(0)
  })

  test('con 2+ membresías y sin slug en el path, ninguna llamada que requiera X-Club sale antes de elegir club (Ruling 2)', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false },
      ],
    }
    let integranteLlamado = false
    await page.route('**/api/integrantes/me', (route) => {
      integranteLlamado = true
      void route.fulfill({ status: 200, json: MOCK_INTEGRANTE })
    })
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()
    // authHeaders() no manda X-Club sin slug en el path: pedir la ficha acá
    // sería el 400 "Selecciona un club" garantizado que Ruling 2 prohíbe.
    expect(integranteLlamado).toBe(false)
  })
})

test.describe('No perteneces a este club / club no encontrado', () => {
  test('un club del que no soy socio muestra el mensaje del backend, no el dashboard de la sesión previa', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 403, json: { error: 'No perteneces a este club' } })
    })
    await page.route('**/api/clubes/el-montanista/marca', (route) => {
      void route.fulfill({ status: 200, json: EL_MONTANISTA_ORG })
    })

    await page.goto('/el-montanista')
    await expect(page.getByText('No perteneces a este club')).toBeVisible()
    await expect(page.getByText('Mis Salidas')).toHaveCount(0)
  })

  test('un slug desconocido muestra club no encontrado', async ({ page }) => {
    await setAuth(page, MOCK_USER)
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 404, json: { error: 'Club no encontrado' } })
    })
    await page.route('**/api/clubes/no-existe/marca', (route) => {
      void route.fulfill({ status: 404, json: { error: 'Club no encontrado' } })
    })

    await page.goto('/no-existe')
    await expect(page.getByText('Club no encontrado')).toBeVisible()
  })
})

test.describe('Legacy ?club= redirige a /<slug>', () => {
  test('riala.cl/?club=<slug> reescribe la URL a /<slug> antes del primer render, sin sesión', async ({ page }) => {
    await page.goto('/?club=el-montanista')
    // redirectLegacyClubQueryParam corre antes de montar React (llamada a
    // nivel de módulo en App.tsx) — la URL ya quedó reescrita para cuando
    // Playwright puede observarla, y no perdió el resto de la navegación
    // (login sigue disponible, sin sesión).
    await expect(page).toHaveURL(/\/el-montanista$/)
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
  })
})

test.describe('Invitación en el dominio raíz (sin slug) sigue funcionando', () => {
  test('riala.cl/#invite=<token> sin sesión llega a la pantalla de invitación, sin slug en el path', async ({ page }) => {
    await page.route('**/api/auth/invitaciones/consultar', (route) => {
      void route.fulfill({
        status: 200,
        json: {
          email: 'nuevo@example.com',
          rol: 'SOCIO',
          rolLabel: 'Socio',
          invitadoPor: 'Admin Seguridad',
          organization: PAMIR_ORG,
        },
      })
    })

    await page.goto('/#invite=tok123')

    await expect(page.getByText('Admin Seguridad')).toBeVisible()
    await expect(page.getByText('nuevo@example.com')).toBeVisible()
  })

  test('con sesión ya iniciada (un solo club) el #invite= de OTRO club muestra el interstitial, no el redirect a /<slug>', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/#invite=tok-otro-club')

    // El redirect transparente de una sola membresía NUNCA debe ganarle a
    // este interstitial: si lo hiciera, window.location.replace('/pamir')
    // sería una navegación completa que se llevaría puesto el estado en
    // memoria del token, y la persona nunca vería esta pantalla.
    await expect(page.getByText(/Ya iniciaste sesión como/)).toBeVisible()
    await expect(page.getByText(userConUnClub.email)).toBeVisible()
    await expect(page.getByText('Mis Salidas')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('Club suspendido — única membresía: sin callejón sin salida', () => {
  test('cuenta con una sola membresía y está suspendida: sin "Mis clubes" (sería un loop de vuelta acá), "Cerrar sesión" como salida', async ({ page }) => {
    const userClubSuspendido = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: true }] }
    await setAuth(page, userClubSuspendido)
    await page.route('**/api/me', (route) => {
      void route.fulfill({
        status: 403,
        json: { error: 'El club está suspendido. Contacta al equipo de la plataforma.' },
      })
    })

    await page.goto('/')
    // El redirect transparente de una sola membresía la manda a /pamir
    // igual (no distingue suspendida ahí — ver App.tsx), y desde /pamir el
    // backend rechaza con el mensaje de club suspendido.
    await expect(page).toHaveURL(/\/pamir$/)
    await expect(page.getByText('El club está suspendido')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mis clubes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  })

  test('caché dice suspendido:false pero el servidor rechazó la única membresía (revocada/suspendida desde el login): tampoco "Mis clubes"', async ({ page }) => {
    // El caché miente a propósito en este test (suspendido: false): lo que
    // importa es que clubAccessError diga que el /me de montaje para este
    // path YA falló — el caché nunca es la fuente de verdad una vez hay un
    // error de acceso confirmado por el servidor (Ruling del round 2).
    const userClubCacheDesactualizado = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userClubCacheDesactualizado)
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 403, json: { error: 'No perteneces a este club' } })
    })

    await page.goto('/')
    // El redirect transparente la manda a /pamir igual (confía en el caché
    // para decidir A DÓNDE ir, no en si puede quedarse), y ahí el servidor
    // la rechaza.
    await expect(page).toHaveURL(/\/pamir$/)
    await expect(page.getByText('No perteneces a este club')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mis clubes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  })
})

test.describe('Migración del draft sin club — solo si la cuenta puede abrir ESE club', () => {
  test('visitar un club del que no soy socio NO migra el draft sin club (queda accesible, no se esconde)', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript(() => {
      localStorage.setItem('pamir_draft', JSON.stringify({ nombreActividad: 'Borrador previo' }))
    })
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 403, json: { error: 'No perteneces a este club' } })
    })
    await page.route('**/api/clubes/el-montanista/marca', (route) => {
      void route.fulfill({ status: 200, json: EL_MONTANISTA_ORG })
    })

    await page.goto('/el-montanista')
    await expect(page.getByText('No perteneces a este club')).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).not.toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:el-montanista'))).toBeNull()
  })

  test('visitar el club propio (no suspendido) SÍ migra el draft sin club a la clave de ese club', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript(() => {
      localStorage.setItem('pamir_draft', JSON.stringify({ nombreActividad: 'Borrador previo' }))
    })
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/pamir')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:pamir'))).not.toBeNull()
  })

  test('el caché dice que puedo abrir el club, pero el servidor rechaza /me: NO migra (la membresía pudo revocarse/suspenderse desde el login)', async ({ page }) => {
    // Caché "abierto" a propósito (slug del path presente, sin suspender):
    // bajo el gate viejo (solo caché) esto migraría de inmediato, antes de
    // que /me confirmara nada. El gate correcto espera la verificación.
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript(() => {
      localStorage.setItem('pamir_draft', JSON.stringify({ nombreActividad: 'Borrador previo' }))
    })
    await page.route('**/api/me', (route) => {
      void route.fulfill({ status: 403, json: { error: 'No perteneces a este club' } })
    })

    await page.goto('/pamir')
    await expect(page.getByText('No perteneces a este club')).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).not.toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:pamir'))).toBeNull()
  })
})

// Draft válido para llegar directo al paso 3 (participantes) vía el banner
// "Continuar borrador", igual que e2e/salida-wizard.spec.ts. Restaurar en el
// paso 1 (el default) nunca remonta Step1General (su key={currentStep} no
// cambia) — su useForm(defaultValues) es una foto de una sola vez, así que
// el campo no reflejaría el valor restaurado aunque formData sí lo tuviera:
// el paso 3 fuerza el remount que sí lo hace, exactamente como los tests
// existentes que restauran participantes.
const DRAFT_PARA_PASO_3 = {
  tipoSalida: 'NO_OFICIAL',
  disciplina: 'TREKKING',
  temporada: 'estival',
  nombreActividad: 'Salida con borrador migrado',
  ubicacionGeografica: 'Cajón del Maipo',
  fechaInicio: '2026-07-01',
  fechaRetornoEstimada: '2026-07-02',
  horaRetornoEstimada: '18:00',
  horaAlerta: '20:00',
  avisosExternos: [],
  retenCarabineros: '',
  nombreFamiliar: '',
  telefonoFamiliar: '',
  liderCordada: 'Alpinista Migrado',
  participantes: [
    { rut: '12.345.678-9', nombre: 'Alpinista Migrado', membresiaClub: 'SOCIO_ANDINO_PAMIR' },
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

test.describe('El wizard nunca monta antes de que la migración del draft haya corrido', () => {
  test('con /api/integrantes/me rápido y /api/me demorado, el wizard igual muestra el borrador migrado', async ({ page }) => {
    // /api/integrantes/me contesta casi de inmediato (mockHasIntegrante) —
    // sin el gate de draftMigrationDone, integranteChecked se asentaría
    // solo y el dashboard (y desde ahí el wizard) quedarían accesibles
    // antes de que /me (y con él, la migración) hubiera corrido.
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript((draft) => {
      localStorage.setItem('pamir_draft', JSON.stringify(draft))
      localStorage.setItem('pamir_draft_step', '3')
    }, DRAFT_PARA_PASO_3)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    await page.route('**/api/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      void route.fulfill({ status: 200, json: { user: userConUnClub } })
    })

    await page.goto('/pamir')
    // Playwright espera a que cada botón sea clickeable: si el gate fallara
    // (dashboard/wizard accesibles antes de la migración), este click al
    // wizard entraría ANTES de que la clave con club tuviera el borrador, y
    // el banner de "Continuar borrador" nunca aparecería (WizardLayout lee
    // hasDraft() una sola vez, en su useState inicial).
    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    await page.getByRole('button', { name: 'Continuar borrador' }).click()

    await expect(page.getByText('Alpinista Migrado').first()).toBeVisible()
  })

  test('sin conexión (/api/me aborta): la sesión cacheada sigue siendo usable, wizard y borrador incluidos', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript((draft) => {
      localStorage.setItem('pamir_draft', JSON.stringify(draft))
      localStorage.setItem('pamir_draft_step', '3')
    }, DRAFT_PARA_PASO_3)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    // Sin conectividad: fetch() rechaza con un error de red (no un
    // ApiError) — deriveClubAccessError lo ignora (nunca pone
    // clubAccessError), y sessionChecked igual se asienta en true vía el
    // .finally() del efecto de montaje de useAuth.ts.
    await page.route('**/api/me', (route) => {
      void route.abort('internetdisconnected')
    })

    await page.goto('/pamir')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    await page.getByRole('button', { name: 'Continuar borrador' }).click()
    await expect(page.getByText('Alpinista Migrado').first()).toBeVisible()
  })
})

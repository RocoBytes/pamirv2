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

  // Regresión: `riala` (el club casa) está en SLUGS_RESERVADOS del backend y
  // el frontend lo trataba como ruta reservada → / → /riala → / sin fin.
  test('una cuenta cuyo único club es riala (el club casa) entra a /riala sin bucle de redirección', async ({ page }) => {
    const rialaOrg = { ...PAMIR_ORG, slug: 'riala', name: 'RIALA', shortName: 'RIALA' }
    const userRiala = {
      ...MOCK_USER,
      organization: { ...MOCK_USER.organization, slug: 'riala', name: 'RIALA', shortName: 'RIALA' },
      clubes: [{ ...rialaOrg, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false }],
    }
    await setAuth(page, userRiala)
    await mockMe(page, userRiala)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    let navegaciones = 0
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navegaciones++ })
    await page.goto('/')
    await expect(page).toHaveURL(/\/riala$/)
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    // / y el único redirect a /riala; un bucle seguiría navegando.
    await page.waitForTimeout(1500)
    expect(navegaciones).toBeLessThanOrEqual(2)
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

test.describe('Club no encontrado antes de iniciar sesión (visitante sin sesión)', () => {
  test('un slug desconocido con la marca en 404 muestra Club no encontrado, no el login neutral', async ({ page }) => {
    await page.route('**/api/clubes/no-existe/marca', (route) => {
      void route.fulfill({ status: 404, json: { error: 'Club no encontrado' } })
    })

    await page.goto('/no-existe')
    await expect(page.getByText('Club no encontrado')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0)
  })

  test('un slug desconocido sin conexión (la marca aborta) sigue mostrando el login neutral', async ({ page }) => {
    // Distingue 404 confirmado (club-not-found real) de un fallo de
    // red/servidor: alguien sin conexión en la montaña debe poder seguir
    // iniciando sesión con lo que tenga cacheado, no quedar atrapado en una
    // pantalla de error que ni siquiera pudo confirmar.
    await page.route('**/api/clubes/no-existe/marca', (route) => {
      void route.abort('internetdisconnected')
    })

    await page.goto('/no-existe')
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByText('Club no encontrado')).toHaveCount(0)
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

test.describe('La migración también corre en un login fresco, no solo en una sesión ya guardada', () => {
  test('sin pamir_auth guardado, con un pamir_draft sin club: iniciar sesión por el formulario migra el borrador y lo muestra en el wizard', async ({ page }) => {
    // Reproduce el finding A del round 4 de review: draftMigrationSessionKey
    // (antes, un booleano llamado draftMigrationDone) se decidía apenas
    // sessionChecked fuera true — y sessionChecked arranca en true en
    // CUALQUIER pestaña sin sesión guardada (nada que verificar). Sin el
    // fix, ese primer render (sin sesión, antes de loguearse) ya consumía
    // el latch para siempre, y el login que sigue nunca volvía a evaluar la
    // migración.
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    // addInitScript corre en el navegador: no puede cerrar sobre
    // userConUnClub (una variable del lado de Node) — se pasa serializado
    // como segundo argumento, igual que draft.
    await page.addInitScript(({ draft, ownerId }) => {
      localStorage.setItem('pamir_draft', JSON.stringify(draft))
      localStorage.setItem('pamir_draft_step', '3')
      // pamir_owner ya apunta a esta cuenta (p.ej. una sesión anterior cuyo
      // pamir_auth expiró/se limpió, pero el navegador es el mismo): así
      // establishSession() decide 'keep', no 'purge', al loguearse — la
      // política de dueño del borrador es de Task 7/storage.ts, no de este
      // finding, así que el test la deja en el escenario que NO purga para
      // aislar exactamente lo que este fix corrige.
      localStorage.setItem('pamir_owner', ownerId)
    }, { draft: DRAFT_PARA_PASO_3, ownerId: userConUnClub.id })
    await page.route('**/api/auth/login', (route) => {
      void route.fulfill({ status: 200, json: { user: userConUnClub, token: 'mock-jwt-fresh-login' } })
    })
    await mockHasIntegrante(page)
    await mockSalidas(page)

    // Sin pamir_auth: la app arranca sin sesión, así que /pamir muestra el
    // login (isAuthenticated es false hasta que el form resuelva).
    await page.goto('/pamir')
    await page.getByLabel('Correo electrónico').fill(userConUnClub.email)
    // getByRole en vez de getByLabel: 'Contraseña' por substring también
    // matchea el botón "Mostrar contraseña", y por label exacto no matchea
    // NADA (el <label> del campo incluye el asterisco visual de requerido
    // en su texto crudo — "Contraseña*" —, aunque el nombre accesible del
    // input, vía aria-hidden en el asterisco, sí sea "Contraseña" exacto).
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('cualquier-clave')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()

    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    await page.getByRole('button', { name: 'Continuar borrador' }).click()
    await expect(page.getByText('Alpinista Migrado').first()).toBeVisible()

    expect(await page.evaluate(() => localStorage.getItem('pamir_draft'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:pamir'))).not.toBeNull()
  })

  test('/api/me de montaje colgado (nunca responde): la sesión cacheada igual queda usable en ~8s, wizard y borrador incluidos', async ({ page }) => {
    // Reproduce el finding B del round 4 de review: fetchMe() (el /me de
    // montaje de useAuth.ts) no tenía timeout — un pedido que ni resuelve
    // ni falla (una conexión de montaña que cuelga en silencio, no un error
    // rápido) dejaba sessionChecked sin asentar nunca, y con él el Spinner
    // de App.tsx (que desde el round 3 espera sessionChecked para decidir
    // si mostrar el dashboard) girando para siempre.
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await page.addInitScript((draft) => {
      localStorage.setItem('pamir_draft', JSON.stringify(draft))
      localStorage.setItem('pamir_draft_step', '3')
    }, DRAFT_PARA_PASO_3)
    await mockHasIntegrante(page)
    await mockSalidas(page)
    // Nunca llama a fulfill/continue/abort: el pedido queda colgado de
    // verdad, sin resolver jamás por sí solo — solo el timeout del lado del
    // cliente (AbortController en useAuth.ts) puede destrabarlo.
    await page.route('**/api/me', () => {})

    await page.goto('/pamir')
    // 15s de margen sobre el timeout de 8s de useAuth.ts (no se toca el
    // bound de producción, solo la espera del test, para no flakear bajo
    // carga cuando la máquina de CI/local anda lenta).
    await expect(page.getByText('Mis Salidas')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    await page.getByRole('button', { name: 'Continuar borrador' }).click()
    await expect(page.getByText('Alpinista Migrado').first()).toBeVisible()
  })
})

test.describe('Branding pre-login por slug del path', () => {
  test('riala.cl/el-montanista sin sesión pinta el logo de El Montañista', async ({ page }) => {
    await page.route('**/api/clubes/el-montanista/marca', (route) => {
      void route.fulfill({ status: 200, json: EL_MONTANISTA_ORG })
    })
    // EL_MONTANISTA_ORG no trae hasLogo/logoVersion (fixture compartido con
    // el resto del archivo), así que el candidato que ClubLogo pinta es la
    // convención estática /logos/<slug>.png — nunca el emblema neutral de
    // RIALA que se ve sin ningún club resuelto. Se mockea la ruta del logo
    // estático para que la respuesta 200 sea inmediata y determinística: sin
    // este mock, vite responde 404 a esa ruta antes que el navegador termine
    // de pintar, y ClubLogo (onError) baja un escalón al emblema neutral
    // antes de que la aserción alcance a leer el `src` original — un falso
    // negativo, no un fallo real de la marca del path.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    await page.route('**/logos/el-montanista.png', (route) => {
      void route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng })
    })
    await page.goto('/el-montanista')
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    // Mismo criterio de assertion que branding.spec.ts:408 (logo propio
    // subido vía ?club=), adaptado al slug del PATH en vez del query param
    // legacy.
    const logo = page.locator('img').first()
    await expect(logo).toHaveAttribute('src', '/logos/el-montanista.png')
  })
})

test.describe('Cambiar de club', () => {
  test('con dos membresías, el header ofrece Cambiar de club y navega a Mis clubes', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false },
      ],
    }
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/el-montanista')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.getByRole('button', { name: 'Cambiar de club' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()
  })

  test('con una sola membresía, el header NO ofrece Cambiar de club', async ({ page }) => {
    const userConUnClub = { ...MOCK_USER, clubes: [{ ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false }] }
    await setAuth(page, userConUnClub)
    await mockMe(page, userConUnClub)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/pamir')
    await expect(page.getByText('Mis Salidas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cambiar de club' })).toHaveCount(0)
  })

  test('elegir el otro club en Mis clubes navega a su propio slug (recarga completa, no en memoria)', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false },
      ],
    }
    await setAuth(page, userConDosClubes)
    await mockMe(page, userConDosClubes)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/el-montanista')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    await page.getByRole('button', { name: 'Cambiar de club' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Mis clubes' })).toBeVisible()

    await page.getByRole('link', { name: PAMIR_ORG.name }).click()
    await expect(page).toHaveURL(/\/pamir$/)
    await expect(page.getByText('Mis Salidas')).toBeVisible()
  })

  test('un borrador guardado en un club no queda visible al cambiar al otro club', async ({ page }) => {
    const userConDosClubes = {
      ...MOCK_ADMIN_MONTANISTA,
      clubes: [
        { ...PAMIR_ORG, hasLogo: false, logoVersion: null, rol: 'SOCIO', suspendido: false },
        { ...EL_MONTANISTA_ORG, hasLogo: false, logoVersion: null, rol: 'ADMIN', suspendido: false },
      ],
    }
    await setAuth(page, userConDosClubes)
    // Borrador dejado en El Montañista, con clave propia del club (Ruling de
    // aislamiento de 4a — ver lib/storage.ts draftKey). "Cambiar de club" es
    // una navegación completa (window.location.assign), así que el árbol de
    // React se remonta contra /pamir sin arrastrar nada en memoria; lo único
    // que podría filtrarse sería la clave de localStorage, y esa ya vive
    // aislada por slug.
    await page.addInitScript(() => {
      localStorage.setItem(
        'pamir_draft:el-montanista',
        JSON.stringify({ nombreActividad: 'Borrador de El Montañista' }),
      )
    })
    await mockMe(page, userConDosClubes)
    await mockHasIntegrante(page)
    await mockSalidas(page)

    await page.goto('/el-montanista')
    await expect(page.getByText('Mis Salidas')).toBeVisible()

    // Control: en el club DUEÑO del borrador, el wizard sí lo ofrece — esto
    // prueba que el borrador de verdad existe (no que "Continuar borrador"
    // está ausente en todos lados por alguna otra razón, p.ej. un texto que
    // cambió). Sin este control, el assert de ausencia de más abajo sería
    // vacuamente cierto incluso si el aislamiento por club estuviera roto.
    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    await expect(page.getByRole('button', { name: 'Cancelar y volver' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar borrador' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar y volver' }).click()

    await page.getByRole('button', { name: 'Cambiar de club' }).click()
    await page.getByRole('link', { name: PAMIR_ORG.name }).click()
    await expect(page).toHaveURL(/\/pamir$/)

    await page.getByRole('button', { name: /Formulario de Salida/i }).click()
    // El wizard SÍ montó en el club nuevo (no un click que se perdió contra
    // una pantalla vacía) — recién sobre esa base tiene sentido afirmar que
    // el banner del borrador ajeno está ausente.
    await expect(page.getByRole('button', { name: 'Cancelar y volver' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar borrador' })).toHaveCount(0)

    // El borrador de El Montañista sigue ahí (no se perdió ni se migró) —
    // simplemente no es visible desde el club nuevo.
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:el-montanista'))).not.toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('pamir_draft:pamir'))).toBeNull()
  })
})

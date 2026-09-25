import { useState, useEffect, useMemo } from 'react'
import { MotionConfig } from 'motion/react'
import { useAuth } from './hooks/useAuth'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { NavPreferencesProvider } from './contexts/NavPreferencesContext'
import { documentTitle, esSocioDelClub } from './lib/club-brand'
import { clubSlugFromPath, redirectLegacyClubQueryParam, redirectSignedOutClubPath, puedeAbrirClub } from './lib/club-path'
import { migrateUnkeyedDraftToCurrentClub, loadAuth } from './lib/storage'
import { AuthPage } from './components/AuthPage'
import { Dashboard } from './components/Dashboard'
import { WizardLayout } from './components/wizard/WizardLayout'
import { RegistroIntegrante } from './components/RegistroIntegrante'
import { FichaCierre } from './components/FichaCierre'
import { EvaluacionExpress } from './components/EvaluacionExpress'
import type { ShellContext } from './components/shell/AppShell'
import { DocumentosPage } from './components/DocumentosPage'
import { ContactosPage } from './components/ContactosPage'
import { EventosPage } from './components/EventosPage'
import { EventoAdminPage } from './components/EventoAdminPage'
import { AdminPanel } from './components/AdminPanel'
import { AdminDashboard } from './components/AdminDashboard'
import { SalidaEditForm } from './components/SalidaEditForm'
import { InvitarPage } from './components/invitaciones/InvitarPage'
import { QrInvitacionPage } from './components/QrInvitacionPage'
import { MisClubesPage } from './components/MisClubesPage'
import { ClubAccessErrorPage } from './components/ClubAccessErrorPage'
import { Button } from './components/ui/Button'
import { fetchMyIntegrante, fetchMarcaClub } from './lib/api'
import type { IntegranteRecord, OrganizationBrand } from './types/salida'
import { parseInviteToken, parseQrToken } from './lib/invite-token'
import { puedeInvitar } from './lib/roles'

type Route = 'dashboard' | 'nueva-salida' | 'nuevo-integrante' | 'nueva-cierre' | 'nuevo-integrante-standalone' | 'documentos' | 'contactos' | 'admin-panel' | 'admin-dashboard' | 'editar-salida' | 'eventos' | 'crear-evento' | 'gestionar-evento' | 'invitar'

function getQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

const Spinner = () => (
  <div className="min-h-screen bg-alpine-canvas flex items-center justify-center">
    <div className="flex flex-col items-center gap-3 text-slate-500">
      <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm">Cargando...</p>
    </div>
  </div>
)

// Corre una sola vez, antes del primer render: reescribe un link legacy
// ?club=<slug> a /<slug> (ver Global Constraints del plan de esta PR) antes
// de que cualquier componente lea window.location.
redirectLegacyClubQueryParam()

// Decisión del 2026-09-25 (login único): sin sesión guardada, CUALQUIER path
// que no sea la raíz (y sin token de invitación/QR pendiente en el
// fragmento) vuelve a / — login único, siempre con marca RIALA. hasSession se
// resuelve acá (loadAuth(), síncrono, sin red) para que la función se quede
// pura y testeable — ver lib/club-path.ts.
redirectSignedOutClubPath({ hasSession: !!loadAuth()?.token })

// Recibe la sesión ya resuelta por App() en vez de llamar useAuth() de nuevo
// (crearía un segundo estado independiente): así App() puede envolver todo
// este árbol en OrganizationProvider con el club de la MISMA sesión.
function AppContent({ user, token, isLoading, loginWithCredentials, logout, refreshSession, clubAccessError, sessionChecked }: ReturnType<typeof useAuth>) {
  const [route, setRoute] = useState<Route>('dashboard')
  const [actionSalidaId, setActionSalidaId] = useState<string | null>(null)
  const [actionEventoId, setActionEventoId] = useState<string | null>(null)
  const [integranteChecked, setIntegranteChecked] = useState(false)
  const [integrante, setIntegrante] = useState<IntegranteRecord | null>(null)

  // Token de invitación (sistema cerrado): viaja en el fragmento de la URL
  // (`#invite=<token>`) a propósito, para que nunca llegue al servidor ni a
  // los logs del proxy. Se lee una sola vez al montar.
  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    parseInviteToken(window.location.hash),
  )
  // Token del QR reusable del club (`#qr=<token>`): #invite= tiene prioridad
  // si por algún motivo llegaran ambos en el mismo fragmento.
  const [qrToken, setQrToken] = useState<string | null>(() =>
    parseInviteToken(window.location.hash) ? null : parseQrToken(window.location.hash),
  )

  useEffect(() => {
    if (!inviteToken) return
    // Limpia el fragmento de la URL para que el token no quede en el
    // historial ni sobreviva a un refresh accidental.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [inviteToken])

  useEffect(() => {
    if (!qrToken) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [qrToken])

  const isAuthenticated = !!(user && token)
  // Autorización por rol en DB (no por email): promover o degradar un admin
  // es un UPDATE en la base, sin redeploy.
  const isAdmin = user?.rol === 'ADMIN'
  // Autorización del módulo de eventos: por rol/gestores en DB, no por email
  const esAdminEventos = user?.rol === 'ADMIN'
  const gestorCategoriaIds = user?.gestorCategorias?.map((g) => g.categoriaId) ?? []
  const puedeGestionarEventos = esAdminEventos || gestorCategoriaIds.length > 0
  const hasIntegrante = integrante !== null
  // Socio del club QUE CONSULTA (no "es Pamir"): compara contra la
  // membresiaPropia de la organización de la sesión — ver lib/club-brand.ts.
  const esSocioClubActual = esSocioDelClub(integrante, user?.organization ?? null)
  // Sistema cerrado por invitación: solo ADMIN y LIDER pueden invitar.
  const puedeInvitarUsuario = puedeInvitar(user?.rol)

  const pathSlug = useMemo(() => clubSlugFromPath(), [])
  const clubes = user?.clubes ?? null
  // Ruling 2 (ampliada por la Decisión del 2026-09-25: Mis clubes se muestra
  // SIEMPRE en la raíz sin slug cuando `clubes` es un array CONOCIDO, sea
  // cual sea su longitud — ya no hay redirect automático de una sola
  // membresía): sin slug en el path Y con `clubes` conocido, authHeaders()
  // (ver lib/api.ts) no manda X-Club — pedir la ficha de integrante ahí
  // nunca hace falta, porque esa pantalla es Mis Clubes, no el dashboard de
  // ningún club. `!clubes` (undefined/null: Ruling 3, "no se sabe todavía")
  // sigue pidiendo la ficha en la raíz — compatibilidad con una sesión sin
  // `clubes` en la respuesta del servidor, donde el backend igual resuelve
  // sin X-Club por tener una sola membresía. Se usa tanto para gatear el
  // fetch como para no bloquear el Spinner esperando una respuesta que nunca
  // sale.
  const debePedirIntegrante = !!pathSlug || !clubes

  // Migración de una sola vez del draft sin club — antes de que cualquier
  // pantalla del wizard pueda leerlo. Migra a la clave que WizardLayout
  // (único lector/escritor del draft) realmente usa: clubSlugFromPath(), NO
  // user.organization.slug — son distintos en la raíz sin slug (Decisión del
  // 2026-09-25: ahí SIEMPRE se muestra Mis clubes, sin importar el número de
  // membresías, nunca un salto automático a /<slug>), y migrar contra el
  // slug de la SESIÓN ahí borraría pamir_draft antes de que exista ningún
  // lector con ese mismo path.
  // Gateado por puedeAbrirClub, no solo por pathSlug: un /<slug> con un
  // typo, de un club ajeno, o de un club suspendido NUNCA mueve el draft
  // ahí — lo dejaría escondido en una clave que nadie puede abrir. Y
  // gateado por sessionChecked && !clubAccessError, no solo por clubes: al
  // montar, `clubes` es el caché sincrónico de pamir_auth — si la
  // membresía se revocó o suspendió del lado del servidor desde el login,
  // el caché todavía dice "sí" en la ventana antes de que el /me de
  // montaje (para ESTE path) resuelva. Recién una vez sessionChecked es
  // true Y no llegó clubAccessError, `clubes` refleja lo que el servidor
  // confirmó para este path — ver Ruling del round 2 de review de esta PR.
  //
  // draftMigrationSessionKey: guarda el TOKEN de la sesión para la que la
  // decisión de migración YA TUVO SU OPORTUNIDAD de correr (haya migrado o
  // no) — nunca un simple booleano. Se ajusta DURANTE EL RENDER (no en un
  // useEffect, mismo patrón que prevAuthenticated más abajo), a propósito:
  // un efecto corre DESPUÉS de confirmado el render/commit, así que en el
  // mismo render donde la sesión queda lista para decidir, un efecto
  // todavía no habría corrido — la decisión de qué pintar en ESE MISMO
  // render (dashboard, y sobre todo WizardLayout) necesita la migración YA
  // resuelta, no una promesa de que correrá en el próximo ciclo.
  //
  // Por qué el token y no un booleano con reset manual (como
  // integranteChecked/prevAuthenticated más abajo): en el mismo render
  // donde isAuthenticated pasa a true (un login fresco), el ORDEN entre
  // "resetear el booleano" y "decidir la migración" importaría — si el
  // reset corriera después en el código fuente, su setState(false) pisaría
  // el setState(true) de esta misma decisión (mismo setter, misma pasada de
  // render: gana la última llamada), y la migración recién correría en un
  // render extra. Comparar contra el token evita el problema de raíz: cada
  // login (o el estado inicial, sin sesión) trae un token DISTINTO, así que
  // "¿ya decidí para ESTE token?" se resetea solo, sin ningún bloque de
  // reset aparte que pueda desordenarse con este.
  //
  // Y por qué también exige isAuthenticated && user, no solo
  // sessionChecked: sessionChecked arranca en true en CUALQUIER pestaña sin
  // sesión guardada (nada que verificar — ver useAuth.ts), incluida la
  // primera visita de alguien sin sesión que recién va a iniciarla. Con el
  // gate viejo (solo sessionChecked), ese primer render sin sesión ya
  // consumía el latch — clubes era null, así que puedeAbrirClub daba false
  // y no migraba nada, pero el latch quedaba en true para siempre. Un login
  // fresco después nunca volvía a evaluar la migración: el draft legacy
  // quedaba huérfano — finding A del round 4 de review de esta PR. Exigir
  // isAuthenticated && user hace que ese primer render sin sesión NUNCA
  // toque el latch, dejándolo listo para la decisión real en el render del
  // login.
  const [draftMigrationSessionKey, setDraftMigrationSessionKey] = useState<string | null>(null)
  const draftMigrationDone = draftMigrationSessionKey === token
  if (isAuthenticated && user && sessionChecked && !draftMigrationDone) {
    setDraftMigrationSessionKey(token)
    if (!clubAccessError && puedeAbrirClub(pathSlug, clubes)) {
      migrateUnkeyedDraftToCurrentClub(undefined, pathSlug!)
    }
  }

  // Marca pública del club del path cuando la sesión NO puede entrar a él
  // (clubAccessError): la única pantalla que sigue necesitando branding de un
  // club ajeno a la sesión activa (login único ya no lo hace — Decisión del
  // 2026-09-25), resuelta vía el fetchMarcaClub público.
  const [pathSlugOrg, setPathSlugOrg] = useState<OrganizationBrand | null>(null)
  useEffect(() => {
    if (!pathSlug || !clubAccessError) return
    let cancelled = false
    fetchMarcaClub(pathSlug)
      .then((org) => { if (!cancelled) setPathSlugOrg(org) })
      .catch(() => { /* club-not-found ya cubre esto con org: null */ })
    return () => { cancelled = true }
  }, [pathSlug, clubAccessError])

  // Contexto del chrome compartido (header, barra inferior, pie). Se arma una
  // sola vez acá y cada pantalla que usa AppShell lo recibe entero, para que
  // agregar un destino no obligue a cambiar la firma de cada componente.
  const shell: ShellContext = {
    userName: user?.name ?? '',
    canSeeDocumentos: esSocioClubActual || isAdmin,
    onLogout: logout,
    onNavigate: (key) => setRoute(key === 'inicio' ? 'dashboard' : key),
    // Solo ofrece "Cambiar de club" con MÁS de una membresía — spec Design §3
    // ("solo para gente con más de una membresía"): con una sola, mostraría
    // el mismo picker con la misma única opción, así que no aporta nada.
    // Navega a la raíz sin slug: la raíz SIEMPRE muestra Mis clubes ahora
    // (Decisión del 2026-09-25), así que este link nunca es un callejón.
    onCambiarClub: (user?.clubes?.length ?? 0) > 1 ? () => window.location.assign('/') : undefined,
  }

  // document.title sigue al club de la sesión; sin sesión (o mientras /me no
  // resolvió el club) queda en el título genérico — nunca el de otro club.
  useEffect(() => {
    document.title = documentTitle(user?.organization ?? null)
  }, [user?.organization])

  // Reset al cambiar la sesión, ajustando estado durante el render
  // (evita el setState síncrono dentro del effect)
  const [prevAuthenticated, setPrevAuthenticated] = useState(isAuthenticated)
  if (prevAuthenticated !== isAuthenticated) {
    setPrevAuthenticated(isAuthenticated)
    setIntegranteChecked(false)
    setIntegrante(null)
    // Una transición false → true consume el token de invitación (login
    // normal o login automático tras aceptar una invitación). Si la app ya
    // estaba autenticada al montar, el token se conserva para el interstitial.
    if (isAuthenticated) setInviteToken(null)
  }

  useEffect(() => {
    // Ruling 2 (ver debePedirIntegrante más arriba): sin esto, nada que
    // pedir — Mis Clubes no lee la ficha de integrante.
    if (!isAuthenticated || !debePedirIntegrante) return
    // `cancelled` descarta respuestas que lleguen después de un logout
    let cancelled = false
    fetchMyIntegrante()
      .then(result => {
        if (cancelled) return
        setIntegrante(result)
        setIntegranteChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        setIntegrante(null)
        setIntegranteChecked(true)
      })
    return () => { cancelled = true }
  }, [isAuthenticated, debePedirIntegrante])

  const verifiedParam = getQueryParam('verified')
  const resetToken = getQueryParam('reset')
  const evaluacionToken = getQueryParam('evaluacion')

  // Página pública: el formulario anónimo de evaluación no requiere sesión.
  // `!== null` cubre el caso de link cortado (?evaluacion= sin token):
  // EvaluacionExpress muestra "Enlace no válido" en vez de caer al login.
  if (evaluacionToken !== null) {
    return <EvaluacionExpress token={evaluacionToken} />
  }

  // Página pública: se muestra ANTES del gate de sesión a propósito — aunque
  // ya haya sesión iniciada es inofensivo mostrarla (ofrece "Ir a la
  // aplicación" en ese caso), y quien escanea el QR sin sesión no debe
  // esperar a que resuelva /me.
  if (qrToken) {
    return (
      <QrInvitacionPage
        token={qrToken}
        isAuthenticated={isAuthenticated}
        onIrALaApp={() => setQrToken(null)}
        onLogin={loginWithCredentials}
      />
    )
  }

  // debePedirIntegrante: si no se va a pedir (Ruling 2, Mis Clubes), no hay
  // nada por lo que esperar — el Spinner no debe bloquear por una respuesta
  // que el efecto de arriba decidió no pedir.
  //
  // pathSlug && !draftMigrationDone: en una sesión autenticada CON slug en
  // el path, ninguna pantalla de club (el dashboard, y sobre todo
  // WizardLayout) puede montar antes de que la migración del draft haya
  // corrido de verdad — fetchMyIntegrante() y el /me de montaje son dos
  // pedidos independientes en carrera; si /api/integrantes/me contesta
  // primero, integranteChecked se pone true solo, y sin este gate el
  // dashboard (y desde ahí el wizard) quedarían accesibles ANTES de la
  // migración: WizardLayout lee `hasDraft()` una sola vez al montar (su
  // useState inicial), contra la clave con club todavía vacía — el banner
  // de "continuar borrador" nunca aparecería, la persona empezaría a
  // escribir en esa clave, y cuando la migración por fin corriera
  // encontraría el destino ocupado y haría no-op: el borrador viejo
  // quedaría huérfano, invisible para siempre en la UI. No se aplica sin
  // slug en el path (Mis Clubes, Ruling 2): ahí sessionChecked ya se
  // asienta en true de inmediato (sin red) y la migración no aplica de
  // todos modos (puedeAbrirClub exige un slug) — Ruling del round 3 de
  // review de esta PR.
  if (
    isLoading ||
    (isAuthenticated && debePedirIntegrante && !integranteChecked) ||
    (isAuthenticated && !!pathSlug && !draftMigrationDone)
  ) {
    return <Spinner />
  }

  if (!isAuthenticated) {
    return (
      <AuthPage
        onLogin={loginWithCredentials}
        isLoading={isLoading}
        verifiedStatus={verifiedParam === '1' ? 'success' : verifiedParam === 'error' ? 'error' : undefined}
        resetToken={resetToken ?? undefined}
        inviteToken={inviteToken ?? undefined}
      />
    )
  }

  // Sesión ya iniciada pero se abrió un enlace de invitación: no se ignora en
  // silencio, se ofrece cerrar sesión para aceptarla o seguir con la actual.
  if (inviteToken) {
    return (
      <div className="min-h-screen bg-alpine-canvas flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-secondary/15 p-6 text-center">
          <p className="text-sm text-slate-700 mb-5">
            Ya iniciaste sesión como <span className="font-semibold">{user?.email}</span>. Para
            aceptar esta invitación debes cerrar sesión.
          </p>
          <div className="flex flex-col gap-2">
            <Button fullWidth onClick={logout}>Cerrar sesión y continuar</Button>
            <Button variant="ghost" fullWidth onClick={() => setInviteToken(null)}>
              Seguir con mi sesión
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // La sesión existe pero el backend acaba de rechazarla para el club del
  // path (no es socio, club suspendido, o el club no existe) — Tabla de
  // routing (Design §3). Se resuelve antes que cualquier ruta del dashboard.
  if (isAuthenticated && clubAccessError) {
    // "Mis clubes" (ir a la raíz) es SIEMPRE una salida real desde la
    // Decisión del 2026-09-25: la raíz sin slug ya no redirige
    // transparentemente de vuelta a /<slug> con una sola membresía (ese
    // efecto se eliminó), así que nunca es un callejón sin salida — se
    // ofrece siempre, junto a Cerrar sesión.
    return (
      <ClubAccessErrorPage
        status={clubAccessError.status}
        message={clubAccessError.message}
        org={pathSlugOrg}
        onLogout={logout}
        onMisClubes={() => window.location.assign('/')}
      />
    )
  }

  // Raíz sin slug: nunca hay "el club actual" todavía (Ruling 2), así que se
  // muestra siempre el selector "Mis clubes" en vez de cualquier ruta — sea
  // cual sea el número de membresías (Decisión del 2026-09-25: ya no hay
  // salto automático a /<slug> con una sola).
  if (isAuthenticated && !pathSlug && clubes) {
    return <MisClubesPage clubes={clubes} onLogout={logout} />
  }

  if ((route === 'nueva-salida' || route === 'nuevo-integrante') && user) {
    return (
      <>
        <div className={route === 'nueva-salida' ? undefined : 'hidden'}>
          <WizardLayout
            user={user}
            isAdmin={isAdmin}
            onDone={() => setRoute('dashboard')}
            onCancel={() => setRoute('dashboard')}
            onCreateIntegrante={() => setRoute('nuevo-integrante')}
          />
        </div>
        {route === 'nuevo-integrante' && (
          <RegistroIntegrante onBack={() => setRoute('nueva-salida')} />
        )}
      </>
    )
  }

  if (route === 'nuevo-integrante-standalone' && (!hasIntegrante || isAdmin)) {
    return (
      <RegistroIntegrante
        onBack={() => setRoute('dashboard')}
        defaultEmail={!hasIntegrante ? user?.email : undefined}
        onComplete={!hasIntegrante ? () => {
          // Refetch para conocer la membresía recién registrada (gate de documentos)
          fetchMyIntegrante().then(setIntegrante).catch(() => {})
          setRoute('dashboard')
        } : undefined}
      />
    )
  }

  if (route === 'documentos' && (esSocioClubActual || isAdmin)) {
    return <DocumentosPage onBack={() => setRoute('dashboard')} shell={shell} isAdmin={isAdmin} />
  }

  // Contactos de emergencia: visible para todos los usuarios logueados (sin gate).
  if (route === 'contactos') {
    return <ContactosPage onBack={() => setRoute('dashboard')} shell={shell} />
  }

  // Eventos del club: visible para todos los usuarios logueados (sin gate).
  if (route === 'eventos') {
    return (
      <EventosPage
        puedeGestionar={puedeGestionarEventos}
        esAdminEventos={esAdminEventos}
        gestorCategoriaIds={gestorCategoriaIds}
        onBack={() => setRoute('dashboard')}
        onCrearEvento={() => setRoute('crear-evento')}
        onGestionarEvento={(id) => { setActionEventoId(id); setRoute('gestionar-evento') }}
        shell={shell}
      />
    )
  }

  if (route === 'crear-evento' && puedeGestionarEventos) {
    return (
      <EventoAdminPage
        shell={shell}
        eventoId={null}
        esAdminEventos={esAdminEventos}
        gestorCategoriaIds={gestorCategoriaIds}
        onDone={() => setRoute('eventos')}
        onCancel={() => setRoute('eventos')}
      />
    )
  }

  if (route === 'gestionar-evento' && puedeGestionarEventos && actionEventoId) {
    return (
      <EventoAdminPage
        shell={shell}
        eventoId={actionEventoId}
        esAdminEventos={esAdminEventos}
        gestorCategoriaIds={gestorCategoriaIds}
        onDone={() => { setActionEventoId(null); setRoute('eventos') }}
        onCancel={() => { setActionEventoId(null); setRoute('eventos') }}
      />
    )
  }

  if (route === 'admin-panel' && isAdmin && user) {
    return (
      <AdminPanel
        shell={shell}
        onBack={() => setRoute('dashboard')}
        onDashboard={() => setRoute('admin-dashboard')}
        currentUserId={user.id}
        refreshSession={refreshSession}
      />
    )
  }

  if (route === 'admin-dashboard' && isAdmin) {
    return <AdminDashboard
        shell={shell} onBack={() => setRoute('admin-panel')} />
  }

  if (route === 'invitar' && user && puedeInvitarUsuario) {
    // Rol garantizado LIDER o ADMIN por puedeInvitarUsuario; el `?? 'SOCIO'`
    // solo satisface el tipo (User.rol es opcional por sesiones antiguas).
    return <InvitarPage
        shell={shell} rolActual={user.rol ?? 'SOCIO'} onBack={() => setRoute('dashboard')} />
  }

  if (route === 'editar-salida' && isAdmin && actionSalidaId) {
    return (
      <SalidaEditForm
        shell={shell}
        salidaId={actionSalidaId}
        onDone={() => { setActionSalidaId(null); setRoute('dashboard') }}
        onCancel={() => { setActionSalidaId(null); setRoute('dashboard') }}
      />
    )
  }

  if (route === 'nueva-cierre' && user) {
    return (
      <FichaCierre
        user={user}
        isAdmin={isAdmin}
        salidaId={actionSalidaId ?? undefined}
        onDone={() => { setActionSalidaId(null); setRoute('dashboard') }}
        onCancel={() => { setActionSalidaId(null); setRoute('dashboard') }}
      />
    )
  }

  return (
    <Dashboard
      user={user!}
      shell={shell}
      locked={!hasIntegrante}
      isAdmin={isAdmin}
      esSocioDelClub={esSocioClubActual}
      onNewSalida={() => setRoute('nueva-salida')}
      onNewCierre={() => setRoute('nueva-cierre')}
      onNewIntegrante={() => setRoute('nuevo-integrante-standalone')}
      onDocumentos={() => setRoute('documentos')}
      onContactos={() => setRoute('contactos')}
      onEventos={() => setRoute('eventos')}
      onAdminPanel={() => setRoute('admin-panel')}
      onEditSalida={(id) => { setActionSalidaId(id); setRoute('editar-salida') }}
      onCloseSalida={(id) => { setActionSalidaId(id); setRoute('nueva-cierre') }}
      puedeInvitar={puedeInvitarUsuario}
      onInvitar={() => setRoute('invitar')}
    />
  )
}

export default function App() {
  const auth = useAuth()
  // El club de la sesión se conoce recién cuando /me responde; hasta entonces
  // (o sin sesión) el árbol entero renderiza con branding neutral — nunca con
  // el club de la sesión anterior en este mismo navegador.
  return (
    // reducedMotion="user" es el único interruptor de accesibilidad del
    // movimiento en toda la app: con "reducir movimiento" activado en el
    // sistema, motion anula transform y layout y deja solo la opacidad, sin
    // que cada componente tenga que preguntarlo por su cuenta.
    <MotionConfig reducedMotion="user">
      <OrganizationProvider organization={auth.user?.organization ?? null}>
        {/* enabled sigue a la sesión: sin token no hay a quién consultarle sus
            preferencias, y al cerrar sesión se descartan para que el próximo
            usuario de este navegador no herede la navegación del anterior. */}
        <NavPreferencesProvider enabled={!!(auth.user && auth.token)}>
          <AppContent {...auth} />
        </NavPreferencesProvider>
      </OrganizationProvider>
    </MotionConfig>
  )
}

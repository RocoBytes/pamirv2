import { useState, useEffect, useMemo } from 'react'
import { MotionConfig } from 'motion/react'
import { useAuth } from './hooks/useAuth'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { NavPreferencesProvider } from './contexts/NavPreferencesContext'
import { documentTitle, esSocioDelClub } from './lib/club-brand'
import { clubSlugFromPath, redirectLegacyClubQueryParam, puedeAbrirClub } from './lib/club-path'
import { migrateUnkeyedDraftToCurrentClub } from './lib/storage'
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
  // Ruling 2: con 2+ membresías YA CONOCIDAS y sin slug en el path,
  // authHeaders() (ver lib/api.ts) no manda X-Club — pedir la ficha de
  // integrante ahí sería un 400 "Selecciona un club" garantizado (silencioso,
  // pero real e inútil). clubes desconocido (undefined/null — incluida una
  // sesión guardada de antes de esta fase) NUNCA cuenta como "2+": mismo
  // criterio que el propio efecto de montaje de useAuth.ts para su
  // fetchMe() (`(clubes?.length ?? 0) > 1`), para no dejar de pedir la
  // ficha en el caso de siempre. Se usa tanto para gatear el fetch como
  // para no bloquear el Spinner esperando una respuesta que nunca sale
  // (Mis Clubes no la necesita).
  const debePedirIntegrante = !!pathSlug || (clubes?.length ?? 0) <= 1

  // Migración de una sola vez del draft sin club — antes de que cualquier
  // pantalla del wizard pueda leerlo. Migra a la clave que WizardLayout
  // (único lector/escritor del draft) realmente usa: clubSlugFromPath(), NO
  // user.organization.slug — son distintos hasta que corre el redirect
  // transparente de más abajo (bare domain con una sola membresía todavía
  // sin slug en el path), y migrar contra el slug de la SESIÓN ahí borraría
  // pamir_draft antes de que exista ningún lector con ese mismo path.
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
  useEffect(() => {
    if (sessionChecked && !clubAccessError && puedeAbrirClub(pathSlug, clubes)) {
      migrateUnkeyedDraftToCurrentClub(undefined, pathSlug!)
    }
  }, [sessionChecked, clubAccessError, pathSlug, clubes])

  // Redirección transparente: una sola membresía y sin slug en el path →
  // /<slug>, preservando el resto de la URL (query/hash ya se consumieron
  // arriba en los efectos de inviteToken/qrToken, así que no hace falta
  // reenviarlos acá). No se dispara mientras clubes todavía no se conoce
  // (Ruling 3: undefined es "no se sabe todavía", nunca "cero clubes"), ni
  // mientras haya un token de invitación/QR pendiente en el fragmento: un
  // signed-in de un solo club que abre un link legacy de OTRO club necesita
  // ver el interstitial correspondiente antes que nada — un replace() acá
  // tira la navegación entera (y con ella el estado en memoria del token)
  // antes de que React llegue a pintarlo.
  useEffect(() => {
    if (!isAuthenticated || pathSlug || !clubes || inviteToken || qrToken) return
    if (clubes.length === 1) window.location.replace(`/${clubes[0]!.slug}`)
  }, [isAuthenticated, pathSlug, clubes, inviteToken, qrToken])

  // Marca pública del club del path cuando la sesión NO puede entrar a él
  // (clubAccessError): la única pantalla que necesita branding de un club
  // ajeno a la sesión activa, resuelta vía el mismo fetchMarcaClub público
  // que ya usa AuthPage.
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
  if (isLoading || (isAuthenticated && debePedirIntegrante && !integranteChecked)) {
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
    // "Mis clubes" (ir a la raíz) es una salida real salvo en un caso: la
    // cuenta tiene una única membresía cacheada y es justo esta — la raíz
    // sin slug la redirige transparentemente de vuelta a /<slug> (el efecto
    // de arriba), que vuelve a mostrar esta misma pantalla: un callejón sin
    // salida. NO se condiciona a clubes[0].suspendido: clubAccessError
    // implica que el /me de montaje para este path ya falló, así que
    // `clubes` es el caché SIN VERIFICAR (pudo suspenderse o revocarse del
    // lado del servidor después del login) — el suspendido cacheado podría
    // seguir en false y el loop sería igual de real (Ruling del round 2 de
    // review de esta PR). Ahí no se ofrece el botón; Cerrar sesión pasa a
    // ser la única (y primaria) acción.
    const misClubesEsUnaSalida = !(clubes && clubes.length === 1 && clubes[0]!.slug === pathSlug)
    return (
      <ClubAccessErrorPage
        status={clubAccessError.status}
        message={clubAccessError.message}
        org={pathSlugOrg}
        onLogout={logout}
        onMisClubes={misClubesEsUnaSalida ? () => window.location.assign('/') : undefined}
      />
    )
  }

  // Raíz sin slug y varias membresías: nunca hay "el club actual" todavía
  // (Ruling 2), así que se muestra el selector en vez de cualquier ruta.
  if (isAuthenticated && !pathSlug && clubes && clubes.length > 1) {
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

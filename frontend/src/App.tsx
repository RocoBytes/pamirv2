import { useState, useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { AuthPage } from './components/AuthPage'
import { Dashboard } from './components/Dashboard'
import { WizardLayout } from './components/wizard/WizardLayout'
import { RegistroIntegrante } from './components/RegistroIntegrante'
import { FichaCierre } from './components/FichaCierre'
import { EvaluacionExpress } from './components/EvaluacionExpress'
import { DocumentosPage } from './components/DocumentosPage'
import { ContactosPage } from './components/ContactosPage'
import { EventosPage } from './components/EventosPage'
import { EventoAdminPage } from './components/EventoAdminPage'
import { AdminPanel } from './components/AdminPanel'
import { AdminDashboard } from './components/AdminDashboard'
import { SalidaEditForm } from './components/SalidaEditForm'
import { InvitarPage } from './components/invitaciones/InvitarPage'
import { Button } from './components/ui/Button'
import { fetchMyIntegrante } from './lib/api'
import type { IntegranteRecord } from './types/salida'
import { parseInviteToken } from './lib/invite-token'
import { puedeInvitar } from './lib/roles'

type Route = 'dashboard' | 'nueva-salida' | 'nuevo-integrante' | 'nueva-cierre' | 'nuevo-integrante-standalone' | 'documentos' | 'contactos' | 'admin-panel' | 'admin-dashboard' | 'editar-salida' | 'eventos' | 'crear-evento' | 'gestionar-evento' | 'invitar'

function getQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

const Spinner = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <div className="flex flex-col items-center gap-3 text-slate-500">
      <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm">Cargando...</p>
    </div>
  </div>
)

export default function App() {
  const { user, token, isLoading, loginWithCredentials, logout } = useAuth()
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

  useEffect(() => {
    if (!inviteToken) return
    // Limpia el fragmento de la URL para que el token no quede en el
    // historial ni sobreviva a un refresh accidental.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [inviteToken])

  const isAuthenticated = !!(user && token)
  // Autorización por rol en DB (no por email): promover o degradar un admin
  // es un UPDATE en la base, sin redeploy.
  const isAdmin = user?.rol === 'ADMIN'
  // Autorización del módulo de eventos: por rol/gestores en DB, no por email
  const esAdminEventos = user?.rol === 'ADMIN'
  const gestorCategoriaIds = user?.gestorCategorias?.map((g) => g.categoriaId) ?? []
  const puedeGestionarEventos = esAdminEventos || gestorCategoriaIds.length > 0
  const hasIntegrante = integrante !== null
  const isSocioPamir = integrante?.membresiaClub === 'SOCIO_ANDINO_PAMIR'
  // Sistema cerrado por invitación: solo ADMIN y LIDER pueden invitar.
  const puedeInvitarUsuario = puedeInvitar(user?.rol)

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
    if (!isAuthenticated) return
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
  }, [isAuthenticated])

  const verifiedParam = getQueryParam('verified')
  const resetToken = getQueryParam('reset')
  const evaluacionToken = getQueryParam('evaluacion')

  // Página pública: el formulario anónimo de evaluación no requiere sesión.
  // `!== null` cubre el caso de link cortado (?evaluacion= sin token):
  // EvaluacionExpress muestra "Enlace no válido" en vez de caer al login.
  if (evaluacionToken !== null) {
    return <EvaluacionExpress token={evaluacionToken} />
  }

  if (isLoading || (isAuthenticated && !integranteChecked)) {
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-[#4a6fad]/15 p-6 text-center">
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

  if (route === 'documentos' && (isSocioPamir || isAdmin)) {
    return <DocumentosPage onBack={() => setRoute('dashboard')} />
  }

  // Contactos de emergencia: visible para todos los usuarios logueados (sin gate).
  if (route === 'contactos') {
    return <ContactosPage onBack={() => setRoute('dashboard')} />
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
      />
    )
  }

  if (route === 'crear-evento' && puedeGestionarEventos) {
    return (
      <EventoAdminPage
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
        onBack={() => setRoute('dashboard')}
        onDashboard={() => setRoute('admin-dashboard')}
        currentUserId={user.id}
      />
    )
  }

  if (route === 'admin-dashboard' && isAdmin) {
    return <AdminDashboard onBack={() => setRoute('admin-panel')} />
  }

  if (route === 'invitar' && user && puedeInvitarUsuario) {
    // Rol garantizado LIDER o ADMIN por puedeInvitarUsuario; el `?? 'SOCIO'`
    // solo satisface el tipo (User.rol es opcional por sesiones antiguas).
    return <InvitarPage rolActual={user.rol ?? 'SOCIO'} onBack={() => setRoute('dashboard')} />
  }

  if (route === 'editar-salida' && isAdmin && actionSalidaId) {
    return (
      <SalidaEditForm
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
      locked={!hasIntegrante}
      isAdmin={isAdmin}
      isSocioPamir={isSocioPamir}
      onNewSalida={() => setRoute('nueva-salida')}
      onNewCierre={() => setRoute('nueva-cierre')}
      onNewIntegrante={() => setRoute('nuevo-integrante-standalone')}
      onDocumentos={() => setRoute('documentos')}
      onContactos={() => setRoute('contactos')}
      onEventos={() => setRoute('eventos')}
      onAdminPanel={() => setRoute('admin-panel')}
      onEditSalida={(id) => { setActionSalidaId(id); setRoute('editar-salida') }}
      onCloseSalida={(id) => { setActionSalidaId(id); setRoute('nueva-cierre') }}
      onLogout={logout}
      puedeInvitar={puedeInvitarUsuario}
      onInvitar={() => setRoute('invitar')}
    />
  )
}

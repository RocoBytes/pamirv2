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
import { fetchMyIntegrante } from './lib/api'
import type { IntegranteRecord } from './types/salida'

type Route = 'dashboard' | 'nueva-salida' | 'nuevo-integrante' | 'nueva-cierre' | 'nuevo-integrante-standalone' | 'documentos' | 'contactos' | 'admin-panel' | 'admin-dashboard' | 'editar-salida' | 'eventos' | 'crear-evento' | 'gestionar-evento'

const ADMIN_EMAIL = 'seguridad.acp.cl@gmail.com'

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
  const { user, token, isLoading, loginWithCredentials, register, logout } = useAuth()
  const [route, setRoute] = useState<Route>('dashboard')
  const [actionSalidaId, setActionSalidaId] = useState<string | null>(null)
  const [actionEventoId, setActionEventoId] = useState<string | null>(null)
  const [integranteChecked, setIntegranteChecked] = useState(false)
  const [integrante, setIntegrante] = useState<IntegranteRecord | null>(null)

  const isAuthenticated = !!(user && token)
  const isAdmin = user?.email === ADMIN_EMAIL
  // Autorización del módulo de eventos: por rol/gestores en DB, no por email
  const esAdminEventos = user?.rol === 'ADMIN'
  const gestorCategoriaIds = user?.gestorCategorias?.map((g) => g.categoriaId) ?? []
  const puedeGestionarEventos = esAdminEventos || gestorCategoriaIds.length > 0
  const hasIntegrante = integrante !== null
  const isSocioPamir = integrante?.membresiaClub === 'SOCIO_ANDINO_PAMIR'

  // Reset al cambiar la sesión, ajustando estado durante el render
  // (evita el setState síncrono dentro del effect)
  const [prevAuthenticated, setPrevAuthenticated] = useState(isAuthenticated)
  if (prevAuthenticated !== isAuthenticated) {
    setPrevAuthenticated(isAuthenticated)
    setIntegranteChecked(false)
    setIntegrante(null)
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
        onRegister={register}
        isLoading={isLoading}
        verifiedStatus={verifiedParam === '1' ? 'success' : verifiedParam === 'error' ? 'error' : undefined}
        resetToken={resetToken ?? undefined}
      />
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

  if (route === 'admin-panel' && isAdmin) {
    return (
      <AdminPanel
        onBack={() => setRoute('dashboard')}
        onDashboard={() => setRoute('admin-dashboard')}
      />
    )
  }

  if (route === 'admin-dashboard' && isAdmin) {
    return <AdminDashboard onBack={() => setRoute('admin-panel')} />
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
    />
  )
}

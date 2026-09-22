import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Satellite } from 'lucide-react'
import type { SalidaRecord, User } from '../types/salida'
import { fetchSalidas, fetchEventos } from '../lib/api'
import { useOrganization } from '../hooks/useOrganization'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { AppShell, type ShellContext } from './shell/AppShell'
import { userInitials } from './shell/userInitials'
import { HeroSalidaCard } from './dashboard/HeroSalidaCard'
import { HeroCierreCard } from './dashboard/HeroCierreCard'
import { QuickAccess } from './dashboard/QuickAccess'
import { MisSalidasPanel } from './dashboard/MisSalidasPanel'
import { SalidaDetailModal } from './SalidaDetailModal'
import { EvaluacionResultadosModal } from './EvaluacionResultadosModal'

interface DashboardProps {
  user: User
  shell: ShellContext
  locked?: boolean
  isAdmin?: boolean
  // Socio del club QUE CONSULTA (ver esSocioDelClub en lib/club-brand.ts),
  // no "es socio de Pamir": gatea la tarjeta de Documentación del Club.
  esSocioDelClub?: boolean
  onNewSalida: () => void
  onNewCierre: () => void
  onNewIntegrante: () => void
  onDocumentos: () => void
  onContactos: () => void
  onEventos: () => void
  onAdminPanel: () => void
  onEditSalida: (id: string) => void
  onCloseSalida: (id: string) => void
  puedeInvitar: boolean
  onInvitar: () => void
}

export function Dashboard({
  user,
  shell,
  locked = false,
  isAdmin = false,
  esSocioDelClub = false,
  onNewSalida,
  onNewCierre,
  onNewIntegrante,
  onDocumentos,
  onContactos,
  onEventos,
  onAdminPanel,
  onEditSalida,
  onCloseSalida,
  puedeInvitar,
  onInvitar,
}: DashboardProps) {
  const { memberBadge } = useOrganization()
  const isDesktop = useIsDesktop()
  const isOnline = useOnlineStatus()

  const [salidas, setSalidas] = useState<SalidaRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSalidaId, setSelectedSalidaId] = useState<string | null>(null)
  const [evaluacionSalida, setEvaluacionSalida] = useState<SalidaRecord | null>(null)
  const [eventosProximos, setEventosProximos] = useState<number | null>(null)

  const canSeeDocumentos = esSocioDelClub || isAdmin

  const loadSalidas = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchSalidas()
      setSalidas(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las salidas')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSalidas()
  }, [loadSalidas])

  // Contador de eventos próximos para la insignia del acceso rápido.
  // fetchEventos() sin parámetros ya excluye los pasados, así que su largo ES
  // el número de próximos. Es información accesoria: si falla, la insignia
  // simplemente no aparece — nunca un estado de error en el Inicio.
  useEffect(() => {
    let cancelled = false
    void fetchEventos()
      .then((eventos) => {
        if (!cancelled) setEventosProximos(eventos.length)
      })
      .catch(() => {
        if (!cancelled) setEventosProximos(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const puedeCerrar = !locked && salidas.some((s) => s.userId === user.id)

  return (
    <AppShell shell={shell} active="inicio">
      <div className="flex flex-col gap-6 sm:gap-8">
        {/* Encabezado: saludo en mobile, título de centro de operaciones en desktop. */}
        {isDesktop ? (
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-display-lg font-extrabold tracking-tight text-on-surface">
                Centro de Salidas &amp; Expediciones
              </h1>
              <p className="text-body-base text-on-surface-variant mt-1">
                Registra tu actividad antes de partir y confirma tu regreso seguro a la cordada.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-start sm:self-auto shrink-0 bg-surface-container-lowest border border-outline-variant/40 px-3 py-1.5 rounded-lg text-body-sm text-on-surface-variant">
              <Satellite
                size={15}
                className={isOnline ? 'text-pine' : 'text-amber-600'}
                aria-hidden="true"
              />
              {isOnline ? 'Red operativa' : 'Sin conexión a la red'}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-headline-lg font-extrabold tracking-tight text-on-surface truncate">
                Hola, {user.name.split(' ')[0]}
              </h1>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                {isOnline ? 'Todo listo para registrar tu salida' : 'Sin conexión — revisa tu señal'}
              </p>
            </div>
            <span
              aria-hidden="true"
              className="w-10 h-10 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-bold text-title-md shrink-0"
            >
              {userInitials(user.name)}
            </span>
          </div>
        )}

        {/* Aviso de ficha incompleta: bloquea el registro de salidas y cierres. */}
        {locked && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">
            <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-body-medium font-semibold text-amber-800">Completa tu registro</p>
              <p className="text-body-sm text-amber-700 mt-0.5">
                Debes completar tu ficha de integrante para registrar salidas y cierres.
              </p>
            </div>
            <button
              type="button"
              onClick={onNewIntegrante}
              className="shrink-0 text-body-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
            >
              Completar
            </button>
          </div>
        )}

        {/* Las dos acciones centrales: declarar la salida y cerrar el retorno. */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
          <HeroSalidaCard locked={locked} isDesktop={isDesktop} onClick={onNewSalida} />
          <HeroCierreCard
            available={puedeCerrar}
            locked={locked}
            isDesktop={isDesktop}
            onClick={onNewCierre}
          />
        </section>

        <QuickAccess
          isDesktop={isDesktop}
          isAdmin={isAdmin}
          locked={locked}
          canSeeDocumentos={canSeeDocumentos}
          puedeInvitar={puedeInvitar}
          memberBadge={memberBadge}
          eventosProximos={eventosProximos}
          onContactos={onContactos}
          onEventos={onEventos}
          onDocumentos={onDocumentos}
          onAdminPanel={onAdminPanel}
          onInvitar={onInvitar}
          onNewIntegrante={onNewIntegrante}
        />

        <MisSalidasPanel
          salidas={salidas}
          isLoading={isLoading}
          error={error}
          onRetry={() => void loadSalidas()}
          currentUserId={user.id}
          isAdmin={isAdmin}
          isDesktop={isDesktop}
          onSelectSalida={setSelectedSalidaId}
          onVerEvaluaciones={setEvaluacionSalida}
          onNewSalida={onNewSalida}
        />
      </div>

      {selectedSalidaId && (
        <SalidaDetailModal
          salidaId={selectedSalidaId}
          onClose={() => setSelectedSalidaId(null)}
          isAdmin={isAdmin}
          currentUserId={user.id}
          onEdit={() => {
            const id = selectedSalidaId
            setSelectedSalidaId(null)
            onEditSalida(id)
          }}
          onCerrar={() => {
            const id = selectedSalidaId
            setSelectedSalidaId(null)
            onCloseSalida(id)
          }}
        />
      )}

      {evaluacionSalida && (
        <EvaluacionResultadosModal
          salidaId={evaluacionSalida.id}
          nombreActividad={evaluacionSalida.nombreActividad}
          onClose={() => setEvaluacionSalida(null)}
        />
      )}
    </AppShell>
  )
}

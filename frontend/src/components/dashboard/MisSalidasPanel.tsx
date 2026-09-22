import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import {
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  Backpack,
  MapPin,
  Footprints,
  History,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  Star,
} from 'lucide-react'
import type { SalidaRecord } from '../../types/salida'
import { STATUS_LABELS, STATUS_COLORS, DISCIPLINA_LABELS } from '../../types/salida'
import { fetchHistoricos } from '../../lib/api'
import { Button } from '../ui/Button'
import { cardSurface, cardInteractive } from '../ui/Card'
import { SalidasLoadingList } from '../ui/Skeleton'
import { listContainer, listItem, pressable } from '../ui/motion'
import { SectionLabel } from '../ui/SectionLabel'

interface MisSalidasPanelProps {
  salidas: SalidaRecord[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  currentUserId: string
  isAdmin: boolean
  isDesktop: boolean
  onSelectSalida: (id: string) => void
  onVerEvaluaciones: (salida: SalidaRecord) => void
  onNewSalida: () => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function SalidaCard({
  salida,
  currentUserId,
  onClick,
}: {
  salida: SalidaRecord
  currentUserId: string
  onClick: (id: string) => void
}) {
  const isOwner = salida.userId === currentUserId
  return (
    <motion.button
      type="button"
      onClick={() => onClick(salida.id)}
      whileTap={pressable.whileTap}
      transition={pressable.transition}
      className={`${cardSurface} ${cardInteractive} w-full text-left overflow-hidden`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {typeof salida.numeroSalida === 'number' && (
                <span className="shrink-0 text-label-caps font-bold text-primary bg-primary-fixed px-2 py-0.5 rounded-md tabular-nums">
                  N° {salida.numeroSalida}
                </span>
              )}
              <h3 className="text-title-md font-semibold text-on-surface leading-tight truncate">
                {salida.nombreActividad}
              </h3>
              <span
                className={`shrink-0 text-label-caps font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-md border ${
                  isOwner
                    ? 'bg-primary-fixed text-on-primary-fixed border-primary/20'
                    : 'bg-surface-container text-on-surface-variant border-outline-variant/50'
                }`}
              >
                {isOwner ? 'Líder' : 'Participante'}
              </span>
            </div>
            <p className="text-body-sm text-on-surface-variant mt-1 flex items-center gap-1 min-w-0">
              <MapPin size={12} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{salida.ubicacionGeografica}</span>
            </p>
          </div>
          <span
            className={`shrink-0 text-body-sm font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[salida.status]}`}
          >
            {STATUS_LABELS[salida.status]}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-body-sm text-on-surface-variant">
          <span className="flex items-center gap-1.5">
            <Calendar size={13} className="text-outline shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{formatDate(salida.fechaInicio)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={13} className="text-outline shrink-0" aria-hidden="true" />
            <span className="tabular-nums">Retorno {salida.horaRetornoEstimada}</span>
          </span>
          {/* Una disciplina fuera del enum (dato viejo) no tiene etiqueta: en vez
              de dejar un icono suelto sin texto, la fila entera no se pinta. */}
          {DISCIPLINA_LABELS[salida.disciplina] && (
            <span className="flex items-center gap-1.5 col-span-2">
              <Backpack size={13} className="text-outline shrink-0" aria-hidden="true" />
              <span className="font-medium text-secondary">
                {DISCIPLINA_LABELS[salida.disciplina]}
              </span>
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

export function MisSalidasPanel({
  salidas,
  isLoading,
  error,
  onRetry,
  currentUserId,
  isAdmin,
  isDesktop,
  onSelectSalida,
  onVerEvaluaciones,
  onNewSalida,
}: MisSalidasPanelProps) {
  // Históricos: salidas cerradas (COMPLETADA) en las que el usuario participó.
  // Se cargan de forma diferida la primera vez que se abre el desplegable.
  const [expanded, setExpanded] = useState(false)
  const [historicos, setHistoricos] = useState<SalidaRecord[]>([])
  const [historicosLoading, setHistoricosLoading] = useState(false)
  const [historicosError, setHistoricosError] = useState<string | null>(null)
  const [historicosLoaded, setHistoricosLoaded] = useState(false)

  const loadHistoricos = useCallback(async () => {
    setHistoricosLoading(true)
    setHistoricosError(null)
    try {
      const data = await fetchHistoricos()
      setHistoricos(data)
      setHistoricosLoaded(true)
    } catch (err) {
      setHistoricosError(err instanceof Error ? err.message : 'Error al cargar los históricos')
    } finally {
      setHistoricosLoading(false)
    }
  }, [])

  const toggleHistoricos = useCallback(() => {
    const willExpand = !expanded
    setExpanded(willExpand)
    if (willExpand && !historicosLoaded && !historicosLoading) {
      void loadHistoricos()
    }
  }, [expanded, historicosLoaded, historicosLoading, loadHistoricos])

  const listado = (
    <>
      {isLoading && <SalidasLoadingList />}

      {error && !isLoading && (
        <div className="flex flex-col items-center py-10 gap-4 text-center">
          <AlertCircle size={32} className="text-error" aria-hidden="true" />
          <div>
            <p className="text-title-md font-semibold text-on-surface">Error al cargar</p>
            <p className="text-body-base text-on-surface-variant mt-1">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      )}

      {!isLoading && !error && salidas.length === 0 && (
        <div className="py-10 text-center flex flex-col items-center justify-center max-w-md mx-auto">
          <span className="w-12 h-12 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center mb-3">
            <Footprints size={24} aria-hidden="true" />
          </span>
          <p className="text-title-md font-bold text-on-surface mb-1">Sin salidas activas en curso</p>
          <p className="text-body-sm text-on-surface-variant mb-5 leading-relaxed">
            No tienes avisos de expedición pendientes de retorno. Cuando salgas a la montaña, usa el
            formulario de arriba para habilitar el seguimiento de seguridad.
          </p>
          <Button variant="primary" size="sm" onClick={onNewSalida}>
            <Plus size={16} aria-hidden="true" />
            Crear Nueva Salida
          </Button>
        </div>
      )}

      {!isLoading && !error && salidas.length > 0 && (
        <motion.div
          className="grid gap-3"
          variants={listContainer}
          initial="hidden"
          animate="visible"
        >
          {salidas.map((salida) => (
            <motion.div key={salida.id} variants={listItem} className="min-w-0">
              <SalidaCard salida={salida} currentUserId={currentUserId} onClick={onSelectSalida} />
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onVerEvaluaciones(salida)}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-body-sm font-semibold text-secondary hover:text-primary px-2 py-1 rounded-lg hover:bg-primary-fixed/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Ver evaluaciones de ${salida.nombreActividad}`}
                >
                  <Star size={13} aria-hidden="true" />
                  Ver evaluaciones
                </button>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}
    </>
  )

  // El historial es una lista secundaria: se carga solo si el usuario la pide.
  // Oculto para admin, que gestiona el historial completo desde el AdminPanel.
  // El disparador vive en sitios distintos según el ancho (tarjeta desplegable
  // en desktop, enlace "Historial" en el rótulo de sección en mobile), así que
  // la lista se define por separado y cada variante la coloca donde le sirve.
  const historialToggle = !isAdmin && (
    <button
      type="button"
      onClick={toggleHistoricos}
      aria-expanded={expanded}
      className={`${cardSurface} ${cardInteractive} w-full flex items-center justify-between gap-3 p-4 mt-6`}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">
          <History size={20} aria-hidden="true" />
        </span>
        <span className="text-left min-w-0">
          <span className="block text-title-md font-semibold text-on-surface leading-tight">
            Histórico de Salidas
          </span>
          <span className="block text-body-sm text-on-surface-variant">
            Salidas cerradas en las que participaste
          </span>
        </span>
      </span>
      {expanded ? (
        <ChevronUp size={18} className="text-on-surface-variant shrink-0" aria-hidden="true" />
      ) : (
        <ChevronDown size={18} className="text-on-surface-variant shrink-0" aria-hidden="true" />
      )}
    </button>
  )

  const historialList = !isAdmin && expanded && (
        <div className="mt-3">
          {historicosLoading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-on-surface-variant">
              <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
              <p className="text-body-base">Cargando históricos...</p>
            </div>
          )}

          {historicosError && !historicosLoading && (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <AlertCircle size={28} className="text-error" aria-hidden="true" />
              <p className="text-body-base text-on-surface-variant">{historicosError}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadHistoricos()}>
                Reintentar
              </Button>
            </div>
          )}

          {!historicosLoading && !historicosError && historicos.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <span className="w-12 h-12 rounded-2xl bg-surface-container text-on-surface-variant flex items-center justify-center">
                <History size={20} aria-hidden="true" />
              </span>
              <p className="text-body-base text-on-surface-variant">
                No participaste en salidas cerradas todavía
              </p>
            </div>
          )}

          {!historicosLoading && !historicosError && historicos.length > 0 && (
            <div className="grid gap-3">
              {historicos.map((salida) => (
                <div key={salida.id} className="min-w-0">
                  <SalidaCard
                    salida={salida}
                    currentUserId={currentUserId}
                    onClick={onSelectSalida}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
  )

  if (isDesktop) {
    return (
      <section>
        <div className={`${cardSurface} p-6 sm:p-7`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-outline-variant/40 mb-2">
            <div>
              <h2 className="text-headline-md font-bold text-on-surface">Mis Salidas y Registros</h2>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                {salidas.length === 0
                  ? 'Expediciones activas asignadas a tu cordada o creadas por ti'
                  : `${salidas.length} ${salidas.length === 1 ? 'salida registrada' : 'salidas registradas'}`}
              </p>
            </div>
          </div>
          {listado}
        </div>
        {historialToggle}
        {historialList}
      </section>
    )
  }

  return (
    <section>
      <SectionLabel
        action={
          !isAdmin ? (
            <button
              type="button"
              onClick={toggleHistoricos}
              aria-expanded={expanded}
              className="inline-flex items-center gap-0.5 text-body-sm font-semibold text-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Historial
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : undefined
        }
      >
        Mis Salidas
      </SectionLabel>
      {listado}
      {historialList}
    </section>
  )
}

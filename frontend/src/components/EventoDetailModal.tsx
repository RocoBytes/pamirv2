import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Megaphone,
  Paperclip,
  Settings2,
  Undo2,
  X,
} from 'lucide-react'
import type { EventoDetail } from '../types/evento'
import {
  DIFICULTAD_LABELS,
  ESTADO_VISIBLE_COLORS,
  categoriaChipStyle,
  deriveEstadoVisible,
  formatCorteSantiago,
  formatRangoFechas,
  puedeGestionarCategoria,
} from '../types/evento'
import { fetchEvento, retirarseEvento } from '../lib/api'
import { Button } from './ui/Button'
import { InscripcionModal } from './InscripcionModal'

interface EventoDetailModalProps {
  eventoId: string
  onClose: () => void
  /** Habilitan el botón Gestionar (admin o gestor de la categoría del evento). */
  esAdminEventos?: boolean
  gestorCategoriaIds?: number[]
  onGestionar?: (id: string) => void
  /** Notifica inscripción/retiro para que la lista se refresque. */
  onChanged?: () => void
}

function FilaFicha({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-2 border-b border-slate-50">
      <span className="text-[#757874] shrink-0">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value}</span>
    </div>
  )
}

function SeccionTexto({
  titulo,
  texto,
  children,
}: {
  titulo: string
  texto?: string
  children?: ReactNode
}) {
  return (
    <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-[#264c99] mb-2">{titulo}</h3>
      {texto && <p className="text-sm text-slate-900 whitespace-pre-line">{texto}</p>}
      {children}
    </section>
  )
}

export function EventoDetailModal({
  eventoId,
  onClose,
  esAdminEventos = false,
  gestorCategoriaIds = [],
  onGestionar,
  onChanged,
}: EventoDetailModalProps) {
  const [evento, setEvento] = useState<EventoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInscripcion, setShowInscripcion] = useState(false)
  const [confirmandoRetiro, setConfirmandoRetiro] = useState(false)
  const [retirando, setRetirando] = useState(false)
  const [accionError, setAccionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchEvento(eventoId)
      setEvento(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el evento')
    } finally {
      setLoading(false)
    }
  }, [eventoId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  function handleInscripcionSuccess() {
    setShowInscripcion(false)
    void load().then(() => onChanged?.())
  }

  async function handleRetirar() {
    setRetirando(true)
    setAccionError(null)
    try {
      await retirarseEvento(eventoId)
      setConfirmandoRetiro(false)
      await load()
      onChanged?.()
    } catch (err) {
      setAccionError(err instanceof Error ? err.message : 'No se pudo retirar la postulación')
    } finally {
      setRetirando(false)
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-[#264c99]" size={32} />
          <p className="text-sm font-medium text-slate-700">Cargando evento...</p>
        </div>
      </div>
    )
  }

  if (error || !evento) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-xl">
          <AlertCircle size={40} className="text-[#A4636E] mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">Error</h3>
          <p className="text-sm text-[#757874] mb-6">{error || 'No se encontró el evento'}</p>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    )
  }

  const visible = deriveEstadoVisible(evento)
  const rango = formatRangoFechas(evento.fechaInicio, evento.fechaFin)
  const inscripcionesAbiertas =
    evento.estado === 'PUBLICADO' &&
    !!evento.fechaCorte &&
    new Date(evento.fechaCorte).getTime() > Date.now()
  const miEstado = evento.miInscripcion?.estado ?? null
  const corteTexto = evento.fechaCorte ? formatCorteSantiago(new Date(evento.fechaCorte)) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle del evento ${evento.titulo}`}
    >
      <div className="bg-[#f0f4fb] sm:rounded-3xl w-full h-full sm:h-[85vh] max-w-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <header className="bg-white border-b border-[#4a6fad]/15 px-4 sm:px-6 h-14 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays size={20} className="text-[#264c99] shrink-0" />
            <span className="font-semibold text-slate-900 truncate pr-4">Evento del club</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 sm:p-6 mb-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {evento.categoria && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                  style={categoriaChipStyle(evento.categoria.color, 'solid')}
                >
                  {evento.categoria.nombre}
                </span>
              )}
              <span
                className={`text-xs font-semibold px-3 py-1 rounded-full ${ESTADO_VISIBLE_COLORS[visible.tone]}`}
              >
                {visible.badge}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 leading-tight">
              {evento.titulo}
            </h1>

            {evento.avisoDestacado && (
              <p className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm font-medium text-amber-800 mb-2">
                <Megaphone size={15} className="shrink-0 mt-0.5" />
                {evento.avisoDestacado}
              </p>
            )}

            {evento.estado === 'CANCELADO' && evento.motivoCancelacion && (
              <p className="text-sm text-[#8b3a44] bg-[#f5e8ea] border border-[#A4636E]/20 rounded-xl px-3 py-2 mb-2">
                Motivo de la cancelación: {evento.motivoCancelacion}
              </p>
            )}

            {/* Ficha (estilo DAV: etiqueta / valor) */}
            <div className="text-sm mt-4 pt-2 border-t border-slate-100">
              {rango && (
                <FilaFicha
                  label="Fecha"
                  value={evento.horaInicio ? `${rango} · ${evento.horaInicio} h` : rango}
                />
              )}
              {evento.duracionTexto && <FilaFicha label="Duración" value={evento.duracionTexto} />}
              {evento.ubicacion && <FilaFicha label="Ubicación" value={evento.ubicacion} />}
              {evento.reunionCoordinacion && (
                <FilaFicha label="Reunión de coordinación" value={evento.reunionCoordinacion} />
              )}
              {evento.organizadorNombre && (
                <FilaFicha label="Organizador" value={evento.organizadorNombre} />
              )}
              {evento.dificultad !== null && (
                <FilaFicha
                  label="Dificultad"
                  value={`${evento.dificultad} — ${DIFICULTAD_LABELS[evento.dificultad] ?? ''}`}
                />
              )}
              {evento.alturaMaximaMsnm !== null && (
                <FilaFicha
                  label="Altura máxima"
                  value={`${evento.alturaMaximaMsnm.toLocaleString('es-CL')} msnm`}
                />
              )}
              {evento.cupos !== null && (
                <FilaFicha
                  label="Cupos"
                  value={`${evento.cupos} cupos · ${evento.totalPostulantes} ${evento.totalPostulantes === 1 ? 'postulante' : 'postulantes'}`}
                />
              )}
              {evento.fechaCorte && (
                <FilaFicha
                  label="Cierre de inscripciones"
                  value={formatCorteSantiago(new Date(evento.fechaCorte))}
                />
              )}
            </div>
          </div>

          <div className="grid gap-4">
            {evento.objetivo && <SeccionTexto titulo="Objetivo" texto={evento.objetivo} />}
            {(evento.itinerario || evento.itinerarioFileUrl) && (
              <SeccionTexto titulo="Itinerario" texto={evento.itinerario ?? undefined}>
                {evento.itinerarioFileUrl && (
                  <a
                    href={evento.itinerarioFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-2 px-3 py-2 bg-[#e8eef7] text-[#1e3c7a] rounded-xl hover:bg-[#dde6f7] transition-colors text-sm font-medium"
                  >
                    <Paperclip size={16} /> Ver itinerario adjunto
                    {evento.itinerarioFileName ? ` (${evento.itinerarioFileName})` : ''}
                  </a>
                )}
              </SeccionTexto>
            )}
            {evento.cupos !== null && (
              <p className="text-xs text-[#757874] px-1">
                El organizador selecciona entre los postulantes al cierre de inscripciones.
              </p>
            )}
            {evento.incluye && <SeccionTexto titulo="Incluye" texto={evento.incluye} />}
            {evento.noIncluye && <SeccionTexto titulo="No incluye" texto={evento.noIncluye} />}
            {evento.recomendaciones && (
              <SeccionTexto titulo="Recomendaciones" texto={evento.recomendaciones} />
            )}
          </div>

          {/* Bloque de inscripción */}
          <div className="mt-4 bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-3">
            {miEstado === 'SELECCIONADO' && (
              <p className="flex items-start gap-2 text-sm font-semibold text-[#2c6e49] bg-[#e9f3ec] border border-[#2c6e49]/20 rounded-xl px-3 py-2.5">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                ¡Quedaste seleccionado/a! El organizador se pondrá en contacto con los detalles.
              </p>
            )}

            {miEstado === 'NO_SELECCIONADO' && (
              <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                Esta vez no quedaste dentro del cupo. ¡Gracias por postular!
              </p>
            )}

            {miEstado === 'POSTULADO' && (
              <>
                <p className="text-sm font-medium text-[#264c99] bg-[#e8eef7] border border-[#264c99]/20 rounded-xl px-3 py-2.5">
                  Estás postulado/a{corteTexto ? ` · resultado después del ${corteTexto}` : ''}
                </p>
                {evento.estado === 'PUBLICADO' && !confirmandoRetiro && (
                  <div className="flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setConfirmandoRetiro(true)}>
                      <Undo2 size={15} />
                      Retirar postulación
                    </Button>
                  </div>
                )}
                {confirmandoRetiro && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <p className="text-sm text-slate-700">¿Retirar tu postulación?</p>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmandoRetiro(false)}
                        disabled={retirando}
                      >
                        Volver
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={retirando}
                        onClick={() => void handleRetirar()}
                      >
                        Confirmar retiro
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {miEstado === 'RETIRADO' && (
              <>
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                  Retiraste tu postulación.
                </p>
                {inscripcionesAbiertas && evento.declaracionVigente && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setShowInscripcion(true)}>
                      Inscribirme nuevamente
                    </Button>
                  </div>
                )}
              </>
            )}

            {miEstado === null && inscripcionesAbiertas && evento.declaracionVigente && (
              <Button fullWidth onClick={() => setShowInscripcion(true)}>
                Inscribirme
              </Button>
            )}

            {miEstado === null && evento.estado === 'PUBLICADO' && !inscripcionesAbiertas && (
              <p className="text-sm text-center font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                Inscripciones cerradas
              </p>
            )}

            {accionError && (
              <p
                className="flex items-start gap-2 text-sm text-[#8b3a44] bg-[#f5e8ea] border border-[#A4636E]/30 rounded-xl px-3 py-2.5"
                role="alert"
              >
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                {accionError}
              </p>
            )}

            <p className="text-center text-xs font-medium text-[#4a6fad]">{visible.badge}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-[#4a6fad]/15 p-4 sm:p-6 shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Cerrar
          </Button>
          {puedeGestionarCategoria(esAdminEventos, gestorCategoriaIds, evento.categoriaId) && onGestionar && (
            <Button variant="secondary" onClick={() => onGestionar(evento.id)} className="w-full sm:w-auto">
              <Settings2 size={16} />
              Gestionar
            </Button>
          )}
        </div>
      </div>

      {showInscripcion && evento.declaracionVigente && (
        <InscripcionModal
          evento={evento}
          declaracion={evento.declaracionVigente}
          onClose={() => setShowInscripcion(false)}
          onSuccess={handleInscripcionSuccess}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  Users,
  X,
} from 'lucide-react'

import type { PostulantesResponse, PostulanteRow } from '../types/evento'
import {
  ESTADO_INSCRIPCION_COLORS,
  ESTADO_INSCRIPCION_LABELS,
  TIPO_NOTIFICACION_LABELS,
} from '../types/evento'
import type { MembresiaClub } from '../types/salida'
import { CLUB_BADGE_LABELS } from '../types/salida'
import { fetchPostulantes, finalizarEvento, reenviarNotificaciones } from '../lib/api'
import { Button } from './ui/Button'
import { ConfirmDialog } from './EventoAdminPage'

interface PostulantesTabProps {
  eventoId: string
  /** El evento cambió de estado (finalización): el padre debe refrescarlo. */
  onFinalizado: () => void
}

// Instante de postulación en hora de Santiago, formato compacto dd/mm HH:MM
function formatPostulacion(iso: string): string {
  const d = new Date(iso)
  const fecha = d.toLocaleDateString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
  })
  const hora = d.toLocaleTimeString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${fecha} ${hora}`
}

function DeliveryIcons({ postulante }: { postulante: PostulanteRow }) {
  if (postulante.notificaciones.length === 0) {
    return <span className="text-xs text-[#757874]">—</span>
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {postulante.notificaciones.map((n, i) => {
        const label = `${TIPO_NOTIFICACION_LABELS[n.tipo]}: ${n.estado.toLowerCase()}${n.ultimoError ? ` — ${n.ultimoError}` : ''}`
        if (n.estado === 'ENVIADA') {
          return <CheckCircle2 key={i} size={15} className="text-[#2c6e49]" aria-label={label} />
        }
        if (n.estado === 'ERROR') {
          return (
            <span key={i} title={label}>
              <AlertTriangle size={15} className="text-amber-600" aria-label={label} />
            </span>
          )
        }
        return <Clock key={i} size={15} className="text-[#757874]" aria-label={label} />
      })}
    </span>
  )
}

export function PostulantesTab({ eventoId, onFinalizado }: PostulantesTabProps) {
  const [data, setData] = useState<PostulantesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [resultadoReenvio, setResultadoReenvio] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetchPostulantes(eventoId)
      setData(response)
      setError(null)
      // La selección solo puede contener filas que sigan POSTULADO
      setSeleccion((prev) => {
        const validos = new Set(
          response.postulantes.filter((p) => p.estado === 'POSTULADO').map((p) => p.id),
        )
        return new Set([...prev].filter((id) => validos.has(id)))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar los postulantes')
    } finally {
      setLoading(false)
    }
  }, [eventoId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#757874]">
        <Loader2 className="animate-spin text-[#264c99]" size={28} />
        <p className="text-sm">Cargando postulantes...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center py-12 gap-4 text-center">
        <AlertCircle size={32} className="text-[#A4636E]" />
        <p className="text-sm text-[#757874]">{error ?? 'Error al cargar los postulantes'}</p>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    )
  }

  const { evento, postulantes } = data
  const cupos = evento.cupos ?? 0
  const esPublicado = evento.estado === 'PUBLICADO'
  const postulados = postulantes.filter((p) => p.estado === 'POSTULADO')
  const sel = seleccion.size
  const noSeleccionados = Math.max(0, postulados.length - sel)

  // Resumen de transporte de la selección actual
  const seleccionados = postulantes.filter((p) => seleccion.has(p.id))
  const conductores = seleccionados.filter((p) => p.tieneVehiculo)
  const asientos = conductores.reduce((sum, p) => sum + (p.cuposVehiculo ?? 0), 0)
  const pasajeros = seleccionados.length - conductores.length

  const hayPendientes = postulantes.some((p) =>
    p.notificaciones.some((n) => n.estado === 'PENDIENTE' || n.estado === 'ERROR'),
  )
  const antesDelCorte = !!evento.fechaCorte && new Date(evento.fechaCorte).getTime() > Date.now()

  function toggleSeleccion(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleFinalizar() {
    setFinalizando(true)
    setActionError(null)
    try {
      await finalizarEvento(eventoId, [...seleccion])
      setConfirmando(false)
      setSeleccion(new Set())
      await load()
      onFinalizado()
    } catch (err) {
      setConfirmando(false)
      setActionError(err instanceof Error ? err.message : 'No se pudo finalizar el evento')
      // Un 409 (retiro entremedio / ya finalizado) exige ver la lista fresca
      await load()
    } finally {
      setFinalizando(false)
    }
  }

  async function handleReenviar() {
    setReenviando(true)
    setActionError(null)
    setResultadoReenvio(null)
    try {
      const r = await reenviarNotificaciones(eventoId)
      setResultadoReenvio(
        `${r.despachadas} enviadas · ${r.fallidas} fallidas · ${r.pendientes} pendientes`,
      )
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo reenviar')
    } finally {
      setReenviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {postulantes.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-3 text-center">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[#e8eef7]">
            <Users size={24} className="text-[#264c99]" />
          </div>
          <p className="text-sm text-[#757874]">Aún no hay postulaciones para este evento.</p>
        </div>
      ) : (
        <>
          {/* Tabla por orden de llegada */}
          <div className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-[#757874] uppercase tracking-wide border-b border-[#4a6fad]/15">
                  <th className="px-3 py-2.5 w-8"></th>
                  <th className="px-3 py-2.5">Postulante</th>
                  <th className="px-3 py-2.5">Teléfono</th>
                  <th className="px-3 py-2.5">Vehículo</th>
                  <th className="px-3 py-2.5">Postulación</th>
                  <th className="px-3 py-2.5">Estado</th>
                  <th className="px-3 py-2.5">Correos</th>
                </tr>
              </thead>
              <tbody>
                {postulantes.map((p) => {
                  const seleccionable = esPublicado && p.estado === 'POSTULADO'
                  const clubBadge = p.membresiaClub
                    ? (CLUB_BADGE_LABELS[p.membresiaClub as MembresiaClub] ?? null)
                    : null
                  return (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={seleccion.has(p.id)}
                          disabled={!seleccionable}
                          onChange={() => toggleSeleccion(p.id)}
                          aria-label={`Seleccionar a ${p.usuario.nombre}`}
                          className="w-4 h-4 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99] disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{p.usuario.nombre}</span>
                          {clubBadge && (
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-[#264c99]/10 text-[#264c99] px-1.5 py-0.5 rounded-md">
                              {clubBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#757874]">{p.usuario.email}</p>
                      </td>
                      <td className="px-3 py-2.5 text-[#757874]">{p.telefono ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {p.tieneVehiculo ? (
                          <span className="inline-flex items-center gap-1 text-[#2c6e49]">
                            <Check size={14} />
                            <Car size={14} />
                            <span className="text-xs">ofrece {p.cuposVehiculo ?? 0}</span>
                          </span>
                        ) : (
                          <X size={14} className="text-[#757874]" aria-label="Sin vehículo" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#757874] whitespace-nowrap">
                        {formatPostulacion(p.postuladoAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${ESTADO_INSCRIPCION_COLORS[p.estado]}`}
                        >
                          {ESTADO_INSCRIPCION_LABELS[p.estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <DeliveryIcons postulante={p} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Resumen de selección + transporte */}
          {esPublicado && (
            <div className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-slate-900">
                Seleccionados {sel} / {cupos} cupos
              </p>
              <p className="text-xs text-[#757874]">
                {conductores.length}{' '}
                {conductores.length === 1 ? 'conductor seleccionado' : 'conductores seleccionados'} ·{' '}
                {asientos} asientos ofrecidos · {pasajeros}{' '}
                {pasajeros === 1 ? 'pasajero' : 'pasajeros'} sin vehículo —{' '}
                {asientos >= pasajeros ? (
                  <span className="font-semibold text-[#2c6e49]">transporte cubierto</span>
                ) : (
                  <span className="font-semibold text-[#A4636E]">
                    faltan {pasajeros - asientos} asientos
                  </span>
                )}
              </p>
            </div>
          )}
        </>
      )}

      {actionError && (
        <div
          className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 px-4 py-3 text-sm text-[#8b3a44]"
          role="alert"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p>{actionError}</p>
        </div>
      )}

      {resultadoReenvio && (
        <p className="text-xs font-medium text-[#264c99] bg-[#e8eef7] border border-[#264c99]/20 rounded-xl px-3 py-2">
          Reenvío completado: {resultadoReenvio}
        </p>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        {hayPendientes && (
          <Button
            variant="secondary"
            size="sm"
            loading={reenviando}
            onClick={() => void handleReenviar()}
          >
            <Send size={15} />
            Reenviar pendientes
          </Button>
        )}
        {esPublicado && postulantes.length > 0 && (
          <Button
            size="sm"
            disabled={sel < 1 || sel > cupos}
            onClick={() => setConfirmando(true)}
          >
            Finalizar evento
          </Button>
        )}
      </div>

      {confirmando && (
        <ConfirmDialog
          title="Finalizar evento"
          message={`Se confirmarán ${sel} participantes y se notificará a ${noSeleccionados} no seleccionados. Esto cierra las inscripciones y no se puede deshacer.`}
          warning={
            antesDelCorte
              ? 'Aún no se cumple la fecha de corte; las inscripciones se cerrarán ahora.'
              : undefined
          }
          confirmLabel="Finalizar"
          busy={finalizando}
          onConfirm={() => void handleFinalizar()}
          onClose={() => setConfirmando(false)}
        />
      )}
    </div>
  )
}

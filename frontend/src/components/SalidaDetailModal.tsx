import { useEffect, useState } from 'react'
import { Mountain, X, Loader2, MapPin, Calendar, Clock, AlertCircle, FileImage, Pencil, ClipboardCheck, UserCog, Lock } from 'lucide-react'
import type { SalidaRecord } from '../types/salida'
import { getSalida } from '../lib/api'
import { isIntegrantesEditable } from '../lib/date'
import { EditarIntegrantesModal } from './EditarIntegrantesModal'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  CLUB_BADGE_LABELS,
  TIPO_SALIDA_LABELS,
  DISCIPLINA_LABELS,
  TEMPORADA_LABELS,
  AVISO_EXTERNO_LABELS,
  MEDIO_COMUNICACION_LABELS,
  EQUIPO_COLECTIVO_LABELS,
  RIESGO_IDENTIFICADO_LABELS,
} from '../types/salida'
import { Button } from './ui/Button'

interface SalidaDetailModalProps {
  salidaId: string
  onClose: () => void
  /** Acciones de administrador, solo disponibles sobre salidas EN_CURSO. */
  isAdmin?: boolean
  /** Id del usuario actual: habilita al dueño a editar integrantes. */
  currentUserId?: string
  onEdit?: () => void
  onCerrar?: () => void
}

function formatDateFull(iso: string): string {
  try {
    const datePart = iso.split('T')[0].split(' ')[0]
    const [year, month, day] = datePart.split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function SalidaDetailModal({ salidaId, onClose, isAdmin = false, currentUserId, onEdit, onCerrar }: SalidaDetailModalProps) {
  const [salida, setSalida] = useState<SalidaRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    async function fetchDetalle() {
      try {
        setLoading(true)
        const data = await getSalida(salidaId)
        setSalida(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar el detalle')
      } finally {
        setLoading(false)
      }
    }
    void fetchDetalle()
  }, [salidaId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-[#264c99]" size={32} />
          <p className="text-sm font-medium text-slate-700">Cargando detalles...</p>
        </div>
      </div>
    )
  }

  if (error || !salida) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-xl">
          <AlertCircle size={40} className="text-[#A4636E] mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">Error</h3>
          <p className="text-sm text-[#757874] mb-6">{error || 'No se encontró la salida'}</p>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    )
  }

  const isOwner = !!currentUserId && salida.userId === currentUserId
  const canManageIntegrantes = isAdmin || isOwner
  const integrantesEditable = canManageIntegrantes && isIntegrantesEditable(salida)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
      <div className="bg-[#f0f4fb] sm:rounded-3xl w-full h-full sm:h-[85vh] max-w-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <header className="bg-white border-b border-[#4a6fad]/15 px-4 sm:px-6 h-14 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Mountain size={20} className="text-[#264c99]" />
            <span className="font-semibold text-slate-900 truncate pr-4">
              Detalle de Salida
            </span>
            {typeof salida.numeroSalida === 'number' && (
              <span className="shrink-0 text-[10px] font-bold text-[#4a6fad] bg-[#e8eef7] px-2 py-0.5 rounded-md">
                N° {salida.numeroSalida}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 sm:p-6 mb-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <span
                className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_COLORS[salida.status]}`}
              >
                {STATUS_LABELS[salida.status]}
              </span>
              <span className="text-xs font-medium text-[#757874] bg-slate-100 px-3 py-1 rounded-full">
                {TIPO_SALIDA_LABELS[salida.tipoSalida]}
              </span>
              {salida.esRegistroHistorico && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                  Registro histórico
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 leading-tight">
              {salida.nombreActividad}
            </h1>
            
            <p className="flex items-center gap-1.5 text-[#4a6fad] font-medium mb-6">
              <MapPin size={16} />
              {salida.ubicacionGeografica}
            </p>

            <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
              <div>
                <p className="text-xs font-semibold text-[#757874] uppercase tracking-wider mb-1">
                  Disciplina
                </p>
                <p className="text-sm text-slate-900 font-medium">
                  {DISCIPLINA_LABELS[salida.disciplina]}
                  {salida.temporada && ` • ${TEMPORADA_LABELS[salida.temporada]}`}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#757874] uppercase tracking-wider mb-1">
                  Líder de Cordada
                </p>
                <p className="text-sm text-slate-900 font-medium">
                  {salida.liderCordada}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            {/* Fechas */}
            <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm">
              <h3 className="text-sm font-bold text-[#264c99] mb-4 flex items-center gap-2">
                <Calendar size={16} /> Cronología
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-[#757874]">Inicio</span>
                  <span className="font-medium text-slate-900 capitalize">{formatDateFull(salida.fechaInicio)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-[#757874]">Retorno Estimado</span>
                  <span className="font-medium text-slate-900 capitalize">{formatDateFull(salida.fechaRetornoEstimada)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-[#757874] flex items-center gap-1"><Clock size={14} /> Hora Alerta</span>
                  <span className="font-semibold text-[#A4636E]">{salida.horaAlerta}</span>
                </div>
              </div>
            </section>

            {/* Participantes */}
            <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-sm font-bold text-[#264c99]">Equipo Humano ({salida.participantes.length})</h3>
                {integrantesEditable && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#264c99] hover:text-[#1e3c7a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] rounded px-1 transition-colors"
                  >
                    <UserCog size={15} />
                    Editar integrantes
                  </button>
                )}
              </div>
              {salida.participantes.length > 0 ? (
                <ul className="space-y-2">
                  {salida.participantes.map((p, idx) => (
                    <li key={idx} className="bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap">
                      {p.esExpress ? (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] px-1.5 py-0.5 rounded-md">
                          Express
                        </span>
                      ) : (
                        p.membresiaClub && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-[#264c99]/10 text-[#264c99] px-1.5 py-0.5 rounded-md">
                            {CLUB_BADGE_LABELS[p.membresiaClub]}
                          </span>
                        )
                      )}
                      <span className="text-sm font-medium text-slate-900">{p.nombre}</span>
                      {p.esExpress && p.telefono && (
                        <span className="w-full text-xs text-[#757874] pl-0.5">
                          Sin ficha · Tel: {p.telefono}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#757874] italic">Sin participantes adicionales</p>
              )}
              {canManageIntegrantes && salida.status === 'EN_CURSO' && !integrantesEditable && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-[#8b3a44] bg-[#f5e8ea] border border-[#A4636E]/20 rounded-lg px-3 py-2">
                  <Lock size={13} className="shrink-0 mt-0.5" />
                  La edición de integrantes ya no está disponible porque la salida ya comenzó o la
                  hora programada de salida ya fue alcanzada.
                </p>
              )}
            </section>

            {/* Equipamiento y Seguridad */}
            <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#264c99] mb-2">Comunicaciones</h3>
                <div className="flex flex-wrap gap-2">
                  {salida.mediosComunicacion.map((m) => (
                    <span key={m} className="bg-[#e8eef7] text-[#1e3c7a] text-xs font-medium px-2.5 py-1 rounded-lg">
                      {MEDIO_COMUNICACION_LABELS[m]}
                    </span>
                  ))}
                </div>
                {salida.idDispositivoFrecuencia && (
                  <p className="text-xs text-[#757874] mt-2">
                    ID / Frecuencia: <span className="font-medium text-slate-900">{salida.idDispositivoFrecuencia}</span>
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <h3 className="text-sm font-bold text-[#264c99] mb-2">Equipo Crítico (Colectivo)</h3>
                <div className="flex flex-wrap gap-2">
                  {salida.equipoColectivo.length > 0 ? (
                    salida.equipoColectivo.map((e) => (
                      <span key={e} className="bg-[#e8eef7] text-[#1e3c7a] text-xs font-medium px-2.5 py-1 rounded-lg">
                        {EQUIPO_COLECTIVO_LABELS[e]}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#757874]">Ninguno</span>
                  )}
                </div>
                {salida.equipoColectivoOtro && (
                  <p className="text-xs text-[#757874] mt-2">
                    Otro: <span className="font-medium text-slate-900">{salida.equipoColectivoOtro}</span>
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <h3 className="text-sm font-bold text-[#264c99] mb-2">Avisos Externos</h3>
                <div className="flex flex-wrap gap-2">
                  {salida.avisosExternos.length > 0 ? (
                    salida.avisosExternos.map((a) => (
                      <span key={a} className="bg-amber-50 text-amber-700 text-xs font-medium px-2.5 py-1 rounded-lg border border-amber-200/50">
                        {AVISO_EXTERNO_LABELS[a]}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#757874]">Ninguno</span>
                  )}
                </div>
              </div>
            </section>

            {/* Planificación Técnica */}
            <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-[#264c99] mb-4">Planificación Técnica</h3>
              
              <div>
                <h4 className="text-xs font-semibold text-[#757874] uppercase tracking-wider mb-1">Riesgos Identificados</h4>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(salida.riesgosIdentificados || []).length > 0 ? (
                    salida.riesgosIdentificados!.map((r) => (
                      <span key={r} className="bg-[#f5e8ea] text-[#A4636E] text-xs font-medium px-2.5 py-1 rounded-lg border border-[#A4636E]/20">
                        {RIESGO_IDENTIFICADO_LABELS[r]}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#757874]">Ninguno documentado</span>
                  )}
                </div>
                {salida.riesgosOtro && (
                  <p className="text-xs text-[#757874] mt-2">
                    Otro: <span className="font-medium text-slate-900">{salida.riesgosOtro}</span>
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-[#757874] uppercase tracking-wider mb-1">Plan de Evacuación</h4>
                <p className="text-sm text-slate-900 bg-slate-50 p-3 rounded-xl border border-slate-100 whitespace-pre-wrap">
                  {salida.planEvacuacion || <span className="text-[#757874] italic">No especificado</span>}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-[#757874] uppercase tracking-wider mb-1">Pronóstico Meteorológico</h4>
                {/* Registros viejos pueden tener solo archivo, solo texto, o nada */}
                {(salida.pronosticoMeteorologico || !salida.pronosticoFileUrl) && (
                  <p className="text-sm text-slate-900 bg-slate-50 p-3 rounded-xl border border-slate-100 whitespace-pre-wrap">
                    {salida.pronosticoMeteorologico || <span className="text-[#757874] italic">No especificado</span>}
                  </p>
                )}
                {salida.pronosticoFileUrl && (
                  <a href={salida.pronosticoFileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-2 px-3 py-2 bg-[#e8eef7] text-[#1e3c7a] rounded-xl hover:bg-[#dde6f7] transition-colors text-sm font-medium">
                    <FileImage size={16} /> Ver archivo subido ({salida.pronosticoFileName || 'Documento'})
                  </a>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-[#4a6fad]/15 p-4 sm:p-6 shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {isAdmin && salida.status === 'EN_CURSO' ? (
            <>
              <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
                Volver
              </Button>
              <Button variant="secondary" onClick={onEdit} className="w-full sm:w-auto">
                <Pencil size={16} />
                Editar
              </Button>
              <Button variant="primary" onClick={onCerrar} className="w-full sm:w-auto">
                <ClipboardCheck size={16} />
                Cerrar salida
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onClose} className="w-full sm:w-auto">
              Cerrar
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <EditarIntegrantesModal
          salidaId={salida.id}
          initialParticipantes={salida.participantes}
          initialLiderCordada={salida.liderCordada}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setSalida(updated)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

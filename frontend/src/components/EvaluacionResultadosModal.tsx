import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle, Star, MessageSquareText, Users } from 'lucide-react'

import { fetchResultadosEvaluacion } from '../lib/api'
import type { EvaluacionResultados } from '../lib/api'

interface EvaluacionResultadosModalProps {
  salidaId: string
  nombreActividad: string
  onClose: () => void
}

function PromedioRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[#4a6fad]/10 last:border-b-0">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="flex" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={14}
              className={n <= Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
            />
          ))}
        </span>
        <span className="text-sm font-bold text-[#264c99] tabular-nums">{value.toFixed(1)}</span>
      </span>
    </div>
  )
}

export function EvaluacionResultadosModal({ salidaId, nombreActividad, onClose }: EvaluacionResultadosModalProps) {
  const [resultados, setResultados] = useState<EvaluacionResultados | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchResultadosEvaluacion(salidaId)
      .then(setResultados)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los resultados')
      })
  }, [salidaId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Evaluaciones de ${nombreActividad}`}
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#4a6fad]/10 px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6fad]">
              Evaluaciones anónimas
            </p>
            <h2 className="text-base font-bold text-slate-900 truncate">{nombreActividad}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 p-1.5 rounded-lg text-[#757874] hover:bg-[#f0f4fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-5">
          {!resultados && !error && (
            <div className="flex flex-col items-center py-10 gap-3 text-[#757874]">
              <Loader2 className="animate-spin text-[#264c99]" size={24} />
              <p className="text-sm">Cargando resultados...</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44]">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {resultados && (
            <>
              <div className="flex items-center gap-2 rounded-xl bg-[#e8eef7] border border-[#264c99]/15 px-3 py-2.5 mb-4 text-sm text-[#264c99]">
                <Users size={16} className="shrink-0" />
                <span>
                  <strong>{resultados.totalRespuestas}</strong> de{' '}
                  <strong>{resultados.totalTokens}</strong>{' '}
                  {resultados.totalTokens === 1 ? 'participante respondió' : 'participantes respondieron'}
                </span>
              </div>

              {resultados.totalRespuestas === 0 ? (
                <p className="text-sm text-[#757874] text-center py-6">
                  Aún no hay respuestas para esta salida.
                </p>
              ) : (
                <>
                  <div className="rounded-xl border border-[#4a6fad]/15 px-4 mb-5">
                    <PromedioRow label="Objetivos y expectativas" value={resultados.promedios.objetivos} />
                    <PromedioRow label="Cumplimiento del itinerario" value={resultados.promedios.itinerario} />
                    <PromedioRow label="Evaluación del líder" value={resultados.promedios.lider} />
                  </div>

                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-[#264c99]">
                    <MessageSquareText size={16} />
                    Comentarios anónimos ({resultados.comentarios.length})
                  </div>
                  {resultados.comentarios.length === 0 ? (
                    <p className="text-sm text-[#757874]">No se dejaron comentarios.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {resultados.comentarios.map((c, i) => (
                        <li
                          key={i}
                          className="rounded-xl bg-[#f8fafc] border border-[#4a6fad]/10 px-3 py-2.5 text-sm text-slate-700 whitespace-pre-wrap"
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

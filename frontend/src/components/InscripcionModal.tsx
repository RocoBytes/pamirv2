import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Car, CarFront, ChevronLeft, Minus, Plus, ScrollText, X } from 'lucide-react'

import type { DeclaracionVigente, EventoDetail } from '../types/evento'
import { inscribirseEvento } from '../lib/api'
import { Button } from './ui/Button'

interface InscripcionModalProps {
  evento: EventoDetail
  declaracion: DeclaracionVigente
  onClose: () => void
  onSuccess: () => void
}

export function InscripcionModal({ evento, declaracion, onClose, onSuccess }: InscripcionModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [tieneVehiculo, setTieneVehiculo] = useState<boolean | null>(null)
  const [cupos, setCupos] = useState(0)
  const [aceptados, setAceptados] = useState<boolean[]>(declaracion.items.map(() => false))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todosAceptados = aceptados.length > 0 && aceptados.every(Boolean)

  function elegirVehiculo(valor: boolean) {
    setTieneVehiculo(valor)
    if (valor) {
      setStep(2)
    } else {
      setCupos(0)
      setStep(3)
    }
  }

  function toggleItem(index: number) {
    setAceptados((prev) => prev.map((v, i) => (i === index ? !v : v)))
  }

  async function confirmar() {
    if (tieneVehiculo === null || !todosAceptados) return
    setSubmitting(true)
    setError(null)
    try {
      await inscribirseEvento(evento.id, {
        tieneVehiculo,
        cuposVehiculo: tieneVehiculo ? cupos : null,
        declaracionVersionId: declaracion.id,
        itemsAceptados: aceptados,
      })
      onSuccess()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar la inscripción'
      // Doble submit / pestaña vieja: ya existe la postulación, refrescar igual
      if (/Ya estás inscrito/i.test(message)) {
        onSuccess()
        return
      }
      setError(message)
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inscripcion-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#4a6fad]/15">
          <div className="min-w-0">
            <h2 id="inscripcion-title" className="text-base font-bold text-slate-900 leading-snug truncate">
              Inscripción — {evento.titulo}
            </h2>
            <p className="text-xs text-[#757874] mt-0.5">Paso {step} de 3</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar inscripción"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 overflow-y-auto">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-slate-900">¿Cuento con vehículo propio?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => elegirVehiculo(true)}
                  className="flex flex-col items-center gap-2 rounded-2xl border-2 border-[#4a6fad]/30 hover:border-[#264c99] hover:bg-[#f0f4fb] px-4 py-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]"
                >
                  <CarFront size={28} className="text-[#264c99]" />
                  <span className="text-sm font-bold text-slate-900">SÍ</span>
                </button>
                <button
                  type="button"
                  onClick={() => elegirVehiculo(false)}
                  className="flex flex-col items-center gap-2 rounded-2xl border-2 border-[#4a6fad]/30 hover:border-[#264c99] hover:bg-[#f0f4fb] px-4 py-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]"
                >
                  <Car size={28} className="text-[#757874]" />
                  <span className="text-sm font-bold text-slate-900">NO</span>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-slate-900">
                ¿Cuántos cupos puedo entregar para otros participantes?
              </p>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => setCupos((c) => Math.max(0, c - 1))}
                  aria-label="Restar un cupo"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e8eef7] text-[#264c99] hover:bg-[#dde6f7] transition-colors disabled:opacity-40"
                  disabled={cupos <= 0}
                >
                  <Minus size={18} />
                </button>
                <span className="text-3xl font-bold text-slate-900 w-14 text-center" aria-live="polite">
                  {cupos}
                </span>
                <button
                  type="button"
                  onClick={() => setCupos((c) => Math.min(30, c + 1))}
                  aria-label="Sumar un cupo"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-[#e8eef7] text-[#264c99] hover:bg-[#dde6f7] transition-colors disabled:opacity-40"
                  disabled={cupos >= 30}
                >
                  <Plus size={18} />
                </button>
              </div>
              <p className="text-xs text-[#757874] text-center">
                Sin contar al conductor. Puedes dejarlo en 0.
              </p>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ChevronLeft size={15} />
                  Atrás
                </Button>
                <Button size="sm" onClick={() => setStep(3)}>
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2">
                <ScrollText size={18} className="text-[#264c99] shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-slate-900">{declaracion.titulo}</p>
              </div>
              <p className="text-xs text-[#757874] -mt-2">
                Acepta cada punto individualmente: tu aceptación punto por punto queda registrada.
              </p>
              <ul className="flex flex-col gap-2">
                {declaracion.items.map((item, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-3 rounded-xl border border-[#4a6fad]/20 bg-slate-50 px-3 py-2.5 cursor-pointer hover:bg-[#f0f4fb] transition-colors">
                      <input
                        type="checkbox"
                        checked={aceptados[i] ?? false}
                        onChange={() => toggleItem(i)}
                        className="mt-0.5 w-4 h-4 shrink-0 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99]"
                      />
                      <span className="text-xs text-slate-700 leading-relaxed">{item}</span>
                    </label>
                  </li>
                ))}
              </ul>

              {error && (
                <div
                  className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 px-3 py-2.5 text-sm text-[#8b3a44]"
                  role="alert"
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="flex justify-between pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(tieneVehiculo ? 2 : 1)}
                  disabled={submitting}
                >
                  <ChevronLeft size={15} />
                  Atrás
                </Button>
                <Button
                  size="sm"
                  disabled={!todosAceptados || submitting}
                  loading={submitting}
                  onClick={() => void confirmar()}
                >
                  Confirmar inscripción
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle } from 'lucide-react'
import type { Participante, SalidaRecord } from '../types/salida'
import { CLUB_BADGE_LABELS } from '../types/salida'
import { Button } from './ui/Button'
import { ParticipantePicker, LiderPicker } from './wizard/Step3Equipment'
import { updateSalidaIntegrantes } from '../lib/api'

interface EditarIntegrantesModalProps {
  salidaId: string
  initialParticipantes: Participante[]
  initialLiderCordada: string
  onClose: () => void
  onSaved: (salida: SalidaRecord) => void
}

export function EditarIntegrantesModal({
  salidaId,
  initialParticipantes,
  initialLiderCordada,
  onClose,
  onSaved,
}: EditarIntegrantesModalProps) {
  const [participantes, setParticipantes] = useState<Participante[]>(initialParticipantes)
  const [liderCordada, setLiderCordada] = useState(initialLiderCordada)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addParticipante(p: Participante) {
    setParticipantes((prev) => (prev.some((x) => x.rut === p.rut) ? prev : [...prev, p]))
  }

  function removeParticipante(rut: string) {
    setParticipantes((prev) => {
      const removed = prev.find((p) => p.rut === rut)
      if (removed && liderCordada === removed.nombre) setLiderCordada('')
      return prev.filter((p) => p.rut !== rut)
    })
  }

  async function handleSave() {
    if (participantes.length === 0) {
      setError('Agrega al menos un participante')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await updateSalidaIntegrantes(salidaId, { participantes, liderCordada })
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios')
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-integrantes-title"
    >
      <div className="bg-surface-container-low sm:rounded-3xl w-full h-full sm:h-auto sm:max-h-[85vh] max-w-lg flex flex-col overflow-hidden shadow-2xl">
        <header className="bg-white border-b border-secondary/15 px-4 sm:px-6 h-14 flex items-center justify-between shrink-0">
          <span id="editar-integrantes-title" className="font-semibold text-slate-900">
            Editar integrantes
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
          <p className="text-xs text-on-surface-variant">
            Agrega, quita o registra participantes express. Los cambios quedan registrados con tu
            usuario y la fecha.
          </p>

          {/* Selected participant chips */}
          {participantes.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-secondary/20 bg-surface-container-low/60">
              {participantes.map((p) => (
                <span
                  key={p.rut}
                  className="inline-flex items-center gap-1.5 bg-primary-fixed text-primary-hover text-sm font-medium px-3 py-1 rounded-full border border-primary/20"
                >
                  {p.esExpress ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] px-1.5 py-0.5 rounded-md">
                      Express
                    </span>
                  ) : (
                    p.membresiaClub && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded-md">
                        {CLUB_BADGE_LABELS[p.membresiaClub]}
                      </span>
                    )
                  )}
                  {p.nombre}
                  <button
                    type="button"
                    onClick={() => removeParticipante(p.rut)}
                    aria-label={`Quitar ${p.nombre}`}
                    className="text-primary hover:text-error transition-colors leading-none"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Searchable picker. isAdmin=false: crear ficha completa no aplica en edición. */}
          <ParticipantePicker
            selected={participantes}
            isAdmin={false}
            onAdd={addParticipante}
            onCreateIntegrante={() => {}}
          />

          {/* Líder de cordada */}
          <LiderPicker
            value={liderCordada}
            participantes={participantes.filter((p) => !p.esExpress).map((p) => p.nombre)}
            onChange={setLiderCordada}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="bg-white border-t border-secondary/15 p-4 sm:p-6 shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} className="w-full sm:w-auto">
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

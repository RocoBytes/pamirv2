import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarDays,
  EyeOff,
  Loader2,
  Megaphone,
  Send,
  Trash2,
} from 'lucide-react'
import logoPamir from '../assets/logo_PAMIR.png'

import type { EventoDetail, EventoRecord } from '../types/evento'
import { ESTADO_EVENTO_COLORS, ESTADO_EVENTO_LABELS } from '../types/evento'
import {
  cancelarEvento,
  deleteEventoBorrador,
  despublicarEvento,
  fetchEvento,
  publicarEvento,
  updateEvento,
} from '../lib/api'
import type { EventoConCategoria } from '../lib/api'
import { Button } from './ui/Button'
import { EventoForm } from './EventoForm'
import { PostulantesTab } from './PostulantesTab'

// ─── Confirmación ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  /** Línea extra de advertencia (caja ámbar) bajo el mensaje. */
  warning?: string
  confirmLabel: string
  danger?: boolean
  withMotivo?: boolean
  motivoRequired?: boolean
  busy?: boolean
  onConfirm: (motivo?: string) => void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  message,
  warning,
  confirmLabel,
  danger = false,
  withMotivo = false,
  motivoRequired = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [motivo, setMotivo] = useState('')
  const [motivoError, setMotivoError] = useState<string | null>(null)

  function handleConfirm() {
    const limpio = motivo.trim()
    if (motivoRequired && !limpio) {
      setMotivoError('Debes indicar el motivo de la cancelación')
      return
    }
    onConfirm(limpio || undefined)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evento-confirm-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#4a6fad]/15">
          <h2 id="evento-confirm-title" className="text-base font-bold text-slate-900 leading-snug">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
          {warning && (
            <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              {warning}
            </p>
          )}
          {withMotivo && (
            <div className="flex flex-col gap-1">
              <label htmlFor="motivo-cancelacion" className="text-sm font-semibold text-[#264c99]">
                Motivo
                {motivoRequired && <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>}
              </label>
              <textarea
                id="motivo-cancelacion"
                rows={3}
                maxLength={1000}
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value)
                  setMotivoError(null)
                }}
                aria-invalid={motivoError ? 'true' : undefined}
                className={[
                  'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900',
                  'transition-colors duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
                  motivoError
                    ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
                    : 'border-[#4a6fad]/40',
                ].join(' ')}
              />
              {motivoError && (
                <p className="text-xs text-[#A4636E]" role="alert">
                  {motivoError}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Volver
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Editor de aviso (único campo editable de un FINALIZADO) ─────────────────

function AvisoEditor({ evento, onSaved }: { evento: EventoDetail; onSaved: (e: EventoConCategoria) => void }) {
  const [aviso, setAviso] = useState(evento.avisoDestacado ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setSaving(true)
    setError(null)
    try {
      const result = await updateEvento(evento.id, { avisoDestacado: aviso.trim() || null })
      onSaved(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el aviso')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-3">
      <h2 className="text-sm font-bold text-[#264c99] flex items-center gap-2">
        <Megaphone size={16} />
        Aviso destacado
      </h2>
      <p className="text-xs text-[#757874]">
        Un evento finalizado solo permite editar el aviso destacado.
      </p>
      <input
        value={aviso}
        maxLength={300}
        onChange={(e) => setAviso(e.target.value)}
        aria-label="Aviso destacado"
        className={[
          'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 border-[#4a6fad]/40',
          'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void guardar()} loading={saving}>
          Guardar aviso
        </Button>
      </div>
    </section>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────

type AccionConfirmable = 'publicar' | 'despublicar' | 'cancelar' | 'eliminar'

interface EventoAdminPageProps {
  /** null = modo creación */
  eventoId?: string | null
  esAdminEventos?: boolean
  gestorCategoriaIds?: number[]
  onDone: () => void
  onCancel: () => void
}

export function EventoAdminPage({
  eventoId = null,
  esAdminEventos = false,
  gestorCategoriaIds = [],
  onDone,
  onCancel,
}: EventoAdminPageProps) {
  const [evento, setEvento] = useState<EventoDetail | null>(null)
  const [loading, setLoading] = useState(eventoId !== null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [confirmando, setConfirmando] = useState<AccionConfirmable | null>(null)
  const [guardado, setGuardado] = useState(false)
  const [tab, setTab] = useState<'ficha' | 'postulantes'>('ficha')

  const reloadEvento = useCallback(async (id: string) => {
    try {
      const data = await fetchEvento(id)
      setEvento(data)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el evento')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!eventoId) return
    setLoading(true)
    void reloadEvento(eventoId)
  }, [eventoId, reloadEvento])

  // El form devuelve el evento sin los agregados de detalle; se preservan
  function mergeSaved(result: EventoConCategoria | EventoRecord): void {
    setEvento((prev) => ({
      ...(result as EventoConCategoria),
      categoria: 'categoria' in result ? result.categoria : (prev?.categoria ?? null),
      totalPostulantes: prev?.totalPostulantes ?? 0,
      miInscripcion: prev?.miInscripcion ?? null,
      declaracionVigente: prev?.declaracionVigente ?? null,
    }))
    setGuardado(true)
  }

  async function ejecutarAccion(accion: AccionConfirmable, motivo?: string): Promise<void> {
    if (!evento) return
    setActionBusy(true)
    setActionError(null)
    try {
      if (accion === 'eliminar') {
        await deleteEventoBorrador(evento.id)
        onDone()
        return
      }
      const result =
        accion === 'publicar'
          ? await publicarEvento(evento.id)
          : accion === 'despublicar'
            ? await despublicarEvento(evento.id)
            : await cancelarEvento(evento.id, motivo)
      mergeSaved(result)
      setGuardado(false)
      setConfirmando(null)
    } catch (err) {
      setConfirmando(null)
      setActionError(err instanceof Error ? err.message : 'No se pudo completar la acción')
    } finally {
      setActionBusy(false)
    }
  }

  const esCreacion = eventoId === null && evento === null

  return (
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
            <span className="font-bold text-slate-900 text-lg">Pamir</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft size={16} />
            Volver
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
            <CalendarDays size={14} />
            Gestión de eventos
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              {esCreacion ? 'Crear evento' : (evento?.titulo ?? 'Evento')}
            </h1>
            {evento && (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ESTADO_EVENTO_COLORS[evento.estado]}`}
              >
                {ESTADO_EVENTO_LABELS[evento.estado]}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#4a6fad]/15 mb-5">
          <button
            type="button"
            onClick={() => setTab('ficha')}
            className={
              tab === 'ficha'
                ? 'px-4 py-2 text-sm font-semibold text-[#264c99] border-b-2 border-[#264c99] -mb-px'
                : 'px-4 py-2 text-sm font-semibold text-[#757874] hover:text-[#264c99] transition-colors'
            }
          >
            Ficha
          </button>
          {evento ? (
            <button
              type="button"
              onClick={() => setTab('postulantes')}
              className={
                tab === 'postulantes'
                  ? 'px-4 py-2 text-sm font-semibold text-[#264c99] border-b-2 border-[#264c99] -mb-px'
                  : 'px-4 py-2 text-sm font-semibold text-[#757874] hover:text-[#264c99] transition-colors'
              }
            >
              Postulantes
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="Guarda el evento primero"
              className="px-4 py-2 text-sm font-semibold text-[#757874]/50 cursor-not-allowed"
            >
              Postulantes
            </button>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#757874]">
            <Loader2 className="animate-spin text-[#264c99]" size={28} />
            <p className="text-sm">Cargando evento...</p>
          </div>
        )}

        {loadError && !loading && (
          <div className="flex flex-col items-center py-12 gap-4 text-center">
            <AlertCircle size={32} className="text-[#A4636E]" />
            <p className="text-sm text-[#757874]">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Volver a eventos
            </Button>
          </div>
        )}

        {!loading && !loadError && tab === 'postulantes' && evento && (
          <PostulantesTab
            eventoId={evento.id}
            onFinalizado={() => void reloadEvento(evento.id)}
          />
        )}

        {!loading && !loadError && tab === 'ficha' && (
          <>
            {/* Ciclo de vida */}
            {evento && (
              <div className="mb-5 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {evento.estado === 'BORRADOR' && (
                    <>
                      <Button size="sm" onClick={() => setConfirmando('publicar')}>
                        <Send size={15} />
                        Publicar
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setConfirmando('eliminar')}>
                        <Trash2 size={15} />
                        Eliminar borrador
                      </Button>
                    </>
                  )}
                  {evento.estado === 'PUBLICADO' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmando('despublicar')}>
                        <EyeOff size={15} />
                        Despublicar
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setConfirmando('cancelar')}>
                        <Ban size={15} />
                        Cancelar evento
                      </Button>
                    </>
                  )}
                  {evento.estado === 'FINALIZADO' && (
                    <Button size="sm" variant="danger" onClick={() => setConfirmando('cancelar')}>
                      <Ban size={15} />
                      Cancelar evento
                    </Button>
                  )}
                </div>

                {actionError && (
                  <div
                    className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 px-4 py-3 text-sm text-[#8b3a44]"
                    role="alert"
                  >
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <p>{actionError}</p>
                  </div>
                )}

                {guardado && (
                  <p className="text-xs font-medium text-[#2c6e49] bg-[#e9f3ec] border border-[#2c6e49]/20 rounded-xl px-3 py-2">
                    Cambios guardados.
                  </p>
                )}
              </div>
            )}

            {evento?.estado === 'CANCELADO' ? (
              <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 px-4 py-3 text-sm text-[#8b3a44]">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Este evento está cancelado y ya no puede editarse.</p>
                  {evento.motivoCancelacion && <p className="mt-1">Motivo: {evento.motivoCancelacion}</p>}
                </div>
              </div>
            ) : evento?.estado === 'FINALIZADO' ? (
              <AvisoEditor evento={evento} onSaved={mergeSaved} />
            ) : (
              // Keyed on the prop, not the loaded record: saving a new evento must not remount the form (it would drop the pending attachment).
              <EventoForm
                key={eventoId ?? 'nuevo'}
                evento={evento}
                esAdminEventos={esAdminEventos}
                gestorCategoriaIds={gestorCategoriaIds}
                onSaved={mergeSaved}
              />
            )}
          </>
        )}
      </main>

      {confirmando === 'publicar' && (
        <ConfirmDialog
          title="Publicar evento"
          message="El evento será visible para todos los socios y se abrirán las postulaciones."
          confirmLabel="Publicar"
          busy={actionBusy}
          onConfirm={() => void ejecutarAccion('publicar')}
          onClose={() => setConfirmando(null)}
        />
      )}
      {confirmando === 'despublicar' && (
        <ConfirmDialog
          title="Despublicar evento"
          message="El evento volverá a borrador y dejará de ser visible para los socios."
          confirmLabel="Despublicar"
          busy={actionBusy}
          onConfirm={() => void ejecutarAccion('despublicar')}
          onClose={() => setConfirmando(null)}
        />
      )}
      {confirmando === 'cancelar' && evento && (
        <ConfirmDialog
          title="Cancelar evento"
          message="El evento quedará cancelado y dejará de aceptar postulaciones. Esta acción no se puede deshacer."
          confirmLabel="Cancelar evento"
          danger
          withMotivo
          motivoRequired={evento.estado === 'FINALIZADO'}
          busy={actionBusy}
          onConfirm={(motivo) => void ejecutarAccion('cancelar', motivo)}
          onClose={() => setConfirmando(null)}
        />
      )}
      {confirmando === 'eliminar' && (
        <ConfirmDialog
          title="Eliminar borrador"
          message="El borrador se eliminará definitivamente. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          danger
          busy={actionBusy}
          onConfirm={() => void ejecutarAccion('eliminar')}
          onClose={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

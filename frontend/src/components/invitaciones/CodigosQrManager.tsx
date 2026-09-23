import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  QrCode as QrCodeIcon,
  Loader2,
  AlertCircle,
  Ban,
  Eye,
  RefreshCw,
  Download,
  Printer,
  Maximize,
  X,
  UserPlus,
  CheckCircle2,
  Clock,
} from 'lucide-react'

import { listarCodigosQr, crearCodigoQr, verCodigoQr, revocarCodigoQr, estadoCodigoQr } from '../../lib/api'
import type { CodigoQr, EstadoCodigoQr, QrDuracion } from '../../types/codigo-qr'
import { QR_DURACION_LABELS, ESTADO_CODIGO_QR_LABELS, MODO_CODIGO_QR_LABELS } from '../../types/codigo-qr'
import type { Rol } from '../../types/invitacion'
import { useOrganization } from '../../hooks/useOrganization'
import { renderQrSvg, renderQrPngDataUrl, buildQrFileName } from '../../lib/qr'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { ClubLogo } from '../ClubLogo'
import { QrCode } from './QrCode'

interface CodigosQrManagerProps {
  rolActual: Rol
}

const ESTADO_BADGE_CLASS: Record<EstadoCodigoQr, string> = {
  ACTIVO: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  EXPIRADO: 'bg-amber-50 text-amber-800 border border-amber-200',
  AGOTADO: 'bg-slate-100 text-slate-500 border border-slate-200',
  REVOCADO: 'bg-slate-100 text-slate-500 border border-slate-200',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function EstadoBadge({ estado }: { estado: EstadoCodigoQr }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${ESTADO_BADGE_CLASS[estado]}`}>
      {ESTADO_CODIGO_QR_LABELS[estado]}
    </span>
  )
}

function ModoBadge({ modo }: { modo: CodigoQr['modo'] }) {
  return (
    <span className="inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-primary-fixed text-primary">
      {MODO_CODIGO_QR_LABELS[modo]}
    </span>
  )
}

// mm:ss — nunca negativo (el servidor decide la vigencia real; esto es solo
// el conteo visual mientras se polea el estado).
function formatCountdown(msRestantes: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRestantes / 1000))
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// ─── Overlay a pantalla completa (Proyectar / Imprimir) ────────────────────────

interface ProyeccionOverlayProps {
  qrUrl: string
  expiresAt: string
  onClose: () => void
}

function ProyeccionOverlay({ qrUrl, expiresAt, onClose }: ProyeccionOverlayProps) {
  const { organization, displayName } = useOrganization()
  const rootRef = useRef<HTMLDivElement>(null)

  // Body class SOLO mientras el overlay está montado: el CSS de impresión de
  // abajo esconde el resto de la app (#root) y deja visible únicamente este
  // portal, tanto para "Imprimir" como para "Proyectar".
  useEffect(() => {
    document.body.classList.add('qr-overlay-open')
    return () => {
      document.body.classList.remove('qr-overlay-open')
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleProyectar() {
    try {
      await rootRef.current?.requestFullscreen()
    } catch {
      // Pantalla completa no disponible (permiso denegado, navegador sin
      // soporte): el overlay ya cubre toda la ventana por CSS, no es fatal.
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      className="qr-overlay fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-6 p-8 text-center"
    >
      {/* Solo el portal de este overlay (fuera de #root) sobrevive a la
          impresión — ver el body.qr-overlay-open agregado arriba. */}
      <style>{'@media print { body.qr-overlay-open #root { display: none !important; } }'}</style>

      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="print:hidden absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:bg-surface-container-low hover:text-slate-700 transition-colors"
      >
        <X size={22} />
      </button>

      <ClubLogo org={organization} alt="" className="w-20 h-20 object-contain" />
      <p className="text-2xl sm:text-3xl font-bold text-slate-900">Escanea para unirte a {displayName}</p>
      <QrCode value={qrUrl} size={320} alt={`Código QR para unirse a ${displayName}`} className="rounded-2xl" />
      <p className="text-sm text-on-surface-variant">Vence: {formatDate(expiresAt)}</p>

      <div className="print:hidden flex flex-wrap items-center justify-center gap-3 mt-2">
        <Button variant="secondary" onClick={() => void handleProyectar()}>
          <Maximize size={16} /> Pantalla completa
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> Imprimir
        </Button>
      </div>
    </div>,
    document.body,
  )
}

// ─── Panel del QR directo (1 persona) ──────────────────────────────────────────
// Poleado (GET .../qr/:id/estado) cada 4s mientras sigue ACTIVO, para que
// quien lo generó vea en vivo el momento exacto en que alguien se registra —
// sin recargar ni volver a hacer clic en nada. Se pausa mientras la pestaña
// está oculta (retoma un poll inmediato al volver a estar visible) y se
// detiene por completo en cualquier estado terminal o al desmontar.

interface QrDirectoPanelProps {
  codigo: CodigoQr
  qrUrl: string
  onGenerarOtro: () => void
  onCerrar: () => void
}

const POLL_INTERVAL_MS = 4000

function QrDirectoPanel({ codigo: codigoInicial, qrUrl, onGenerarOtro, onCerrar }: QrDirectoPanelProps) {
  const { displayName } = useOrganization()
  const expiresAtMs = new Date(codigoInicial.expiresAt).getTime()

  const [estado, setEstado] = useState<EstadoCodigoQr>(codigoInicial.estado)
  const [registrado, setRegistrado] = useState<CodigoQr['registrado']>(codigoInicial.registrado)
  const [msRestantes, setMsRestantes] = useState(() => expiresAtMs - Date.now())
  const [overlay, setOverlay] = useState(false)
  const [confirmCancelar, setConfirmCancelar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Cuenta regresiva visual (1s) — la vigencia real siempre la decide el
  // servidor; esto es puramente cosmético mientras se espera un escaneo.
  useEffect(() => {
    if (estado !== 'ACTIVO') return
    const id = setInterval(() => setMsRestantes(expiresAtMs - Date.now()), 1000)
    return () => clearInterval(id)
  }, [estado, expiresAtMs])

  useEffect(() => {
    if (estado !== 'ACTIVO') return
    let cancelled = false

    async function poll() {
      if (document.visibilityState !== 'visible') return
      try {
        const result = await estadoCodigoQr(codigoInicial.id)
        if (cancelled) return
        setEstado(result.estado)
        setRegistrado(result.registrado)
      } catch {
        // Un fallo de red puntual no corta el polling: se reintenta solo en
        // el siguiente tick.
      }
    }

    const id = setInterval(() => void poll(), POLL_INTERVAL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [estado, codigoInicial.id])

  // Alguien más (otra pestaña, otro ADMIN) revocó este código mientras el
  // panel seguía abierto: se cierra solo, igual que pide el diseño. El
  // cierre por la propia acción "Cancelar" de este panel no pasa por acá —
  // handleCancelar llama a onCerrar() directamente.
  useEffect(() => {
    if (estado === 'REVOCADO') onCerrar()
  }, [estado, onCerrar])

  async function handleCancelar() {
    setCancelando(true)
    setCancelError(null)
    try {
      await revocarCodigoQr(codigoInicial.id)
      onCerrar()
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'No se pudo cancelar el código QR')
      setCancelando(false)
    }
  }

  if (estado === 'AGOTADO' && registrado) {
    return (
      <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-6 mb-5 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={40} className="text-emerald-600" />
        <p className="text-lg font-bold text-slate-900">
          ¡Listo! {registrado.name} se unió a {displayName}
        </p>
        <p className="text-sm text-on-surface-variant">{registrado.email}</p>
        <Button onClick={onGenerarOtro} className="mt-2">
          <UserPlus size={16} /> Generar otro QR directo
        </Button>
      </div>
    )
  }

  if (estado === 'EXPIRADO' || (estado === 'AGOTADO' && !registrado)) {
    return (
      <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-6 mb-5 flex flex-col items-center gap-3 text-center">
        <Clock size={36} className="text-amber-600" />
        <p className="text-sm font-semibold text-slate-700">Este QR venció sin usarse</p>
        <Button onClick={onGenerarOtro} className="mt-2">
          <UserPlus size={16} /> Generar otro QR directo
        </Button>
      </div>
    )
  }

  if (estado === 'REVOCADO') return null

  return (
    <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-5 mb-5 flex flex-col items-center gap-3 text-center">
      {codigoInicial.etiqueta && <p className="text-sm font-semibold text-slate-700">{codigoInicial.etiqueta}</p>}
      <QrCode value={qrUrl} size={240} alt="QR directo" className="rounded-xl bg-white p-2 border border-secondary/10" />
      <p className="text-sm font-semibold text-primary">Vence en {formatCountdown(msRestantes)}</p>
      <p className="text-xs text-on-surface-variant">Sirve una sola vez y se actualiza solo apenas alguien se registre.</p>

      {cancelError && (
        <p className="text-xs text-error" role="alert">
          {cancelError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        <Button size="sm" variant="secondary" onClick={() => setOverlay(true)}>
          <Maximize size={14} /> Proyectar
        </Button>
        {!confirmCancelar && (
          <Button size="sm" variant="secondary" onClick={() => setConfirmCancelar(true)} disabled={cancelando}>
            <X size={14} /> Cancelar
          </Button>
        )}
        {confirmCancelar && (
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-700">¿Confirmar?</p>
            <button
              type="button"
              onClick={() => void handleCancelar()}
              disabled={cancelando}
              className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {cancelando ? <Loader2 size={12} className="animate-spin" /> : 'Sí, cancelar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancelar(false)}
              disabled={cancelando}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Volver
            </button>
          </div>
        )}
      </div>

      {overlay && (
        <ProyeccionOverlay qrUrl={qrUrl} expiresAt={codigoInicial.expiresAt} onClose={() => setOverlay(false)} />
      )}
    </div>
  )
}

// ─── Panel del QR activo (creado o reabierto) ──────────────────────────────────

interface PanelQrProps {
  codigo: CodigoQr
  qrUrl: string
  slug: string
}

function PanelQr({ codigo, qrUrl, slug }: PanelQrProps) {
  const [overlay, setOverlay] = useState<'proyectar' | 'imprimir' | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function handleDescargarSvg() {
    setDownloadError(null)
    try {
      const svg = await renderQrSvg(qrUrl)
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      triggerDownload(url, buildQrFileName(slug, new Date(), 'svg'))
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError('No se pudo generar el archivo SVG')
    }
  }

  async function handleDescargarPng() {
    setDownloadError(null)
    try {
      const dataUrl = await renderQrPngDataUrl(qrUrl, 1024)
      triggerDownload(dataUrl, buildQrFileName(slug, new Date(), 'png'))
    } catch {
      setDownloadError('No se pudo generar el archivo PNG')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-5 mb-5 flex flex-col items-center gap-3 text-center">
      {codigo.etiqueta && <p className="text-sm font-semibold text-slate-700">{codigo.etiqueta}</p>}
      <QrCode value={qrUrl} size={220} alt="Código QR del club" className="rounded-xl bg-white p-2 border border-secondary/10" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-on-surface-variant">Vence: {formatDate(codigo.expiresAt)}</p>
        <p className="text-sm text-on-surface-variant">
          {codigo.usos} / {codigo.maxUsos} usos
        </p>
      </div>

      {downloadError && (
        <p className="text-xs text-error" role="alert">
          {downloadError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        <Button size="sm" variant="secondary" onClick={() => void handleDescargarPng()}>
          <Download size={14} /> Descargar PNG
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void handleDescargarSvg()}>
          <Download size={14} /> Descargar SVG
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOverlay('imprimir')}>
          <Printer size={14} /> Imprimir
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOverlay('proyectar')}>
          <Maximize size={14} /> Proyectar
        </Button>
      </div>

      {overlay && <ProyeccionOverlay qrUrl={qrUrl} expiresAt={codigo.expiresAt} onClose={() => setOverlay(null)} />}
    </div>
  )
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ─── Componente principal ───────────────────────────────────────────────────────

const DURACION_OPTIONS: QrDuracion[] = ['2h', '24h', '7d']

export function CodigosQrManager({ rolActual }: CodigosQrManagerProps) {
  const { organization } = useOrganization()
  const slug = organization?.slug ?? 'club'

  const [duracion, setDuracion] = useState<QrDuracion>('24h')
  const [maxUsos, setMaxUsos] = useState('50')
  const [etiqueta, setEtiqueta] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [panel, setPanel] = useState<{ codigo: CodigoQr; qrUrl: string } | null>(null)

  const [directoPanel, setDirectoPanel] = useState<{ codigo: CodigoQr; qrUrl: string } | null>(null)
  const [creandoDirecto, setCreandoDirecto] = useState(false)
  const [directoError, setDirectoError] = useState<string | null>(null)

  const [codigos, setCodigos] = useState<CodigoQr[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [confirmRevocarId, setConfirmRevocarId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string | null>>({})

  const load = useCallback(async () => {
    setListError(null)
    try {
      const { codigos } = await listarCodigosQr()
      setCodigos(codigos)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudieron cargar los códigos QR')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCrear = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setCreateError(null)
      setPanel(null)

      const maxUsosNum = Number(maxUsos)
      if (!Number.isInteger(maxUsosNum) || maxUsosNum < 1 || maxUsosNum > 200) {
        setCreateError('Los usos máximos deben ser un número entero entre 1 y 200')
        return
      }

      setCreating(true)
      try {
        const result = await crearCodigoQr({
          duracion,
          maxUsos: maxUsosNum,
          etiqueta: etiqueta.trim() || undefined,
        })
        setPanel({ codigo: result.codigo, qrUrl: result.qrUrl })
        setEtiqueta('')
        await load()
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'No se pudo crear el código QR')
      } finally {
        setCreating(false)
      }
    },
    [duracion, maxUsos, etiqueta, load],
  )

  const handleCrearDirecto = useCallback(async () => {
    setDirectoError(null)
    setCreandoDirecto(true)
    try {
      const result = await crearCodigoQr({ modo: 'DIRECTO' })
      setDirectoPanel({ codigo: result.codigo, qrUrl: result.qrUrl })
      await load()
    } catch (err) {
      setDirectoError(err instanceof Error ? err.message : 'No se pudo crear el QR directo')
    } finally {
      setCreandoDirecto(false)
    }
  }, [load])

  const handleVer = useCallback(async (id: string) => {
    setPendingId(id)
    setRowError((prev) => ({ ...prev, [id]: null }))
    try {
      const result = await verCodigoQr(id)
      setPanel({ codigo: result.codigo, qrUrl: result.qrUrl })
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'No se pudo reabrir el código QR',
      }))
    } finally {
      setPendingId(null)
    }
  }, [])

  const handleRevocar = useCallback(
    async (id: string) => {
      setPendingId(id)
      setRowError((prev) => ({ ...prev, [id]: null }))
      try {
        await revocarCodigoQr(id)
        setConfirmRevocarId(null)
        setPanel((prev) => (prev?.codigo.id === id ? null : prev))
        await load()
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : 'No se pudo revocar el código QR',
        }))
      } finally {
        setPendingId(null)
      }
    },
    [load],
  )

  const mostrarCreador = rolActual === 'ADMIN'

  return (
    <div>
      {/* ── QR directo (1 persona) ───────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-slate-900">QR directo (1 persona)</h3>
        </div>
        <p className="text-xs text-on-surface-variant">
          Para registrar a alguien en el momento: sirve una vez y vence en 15 minutos.
        </p>

        {directoError && (
          <p className="text-xs text-error" role="alert">
            {directoError}
          </p>
        )}

        <Button onClick={() => void handleCrearDirecto()} disabled={creandoDirecto} className="self-start">
          {creandoDirecto ? <Loader2 size={16} className="animate-spin" /> : 'QR directo (1 persona)'}
        </Button>
      </div>

      {directoPanel && (
        <QrDirectoPanel
          key={directoPanel.codigo.id}
          codigo={directoPanel.codigo}
          qrUrl={directoPanel.qrUrl}
          onGenerarOtro={() => void handleCrearDirecto()}
          onCerrar={() => setDirectoPanel(null)}
        />
      )}

      {/* ── Formulario de creación (QR reutilizable) ─────────────────────── */}
      <h3 className="text-sm font-bold text-slate-900 mb-3">QR reutilizable</h3>
      <form
        onSubmit={(e) => void handleCrear(e)}
        className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-5 flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <QrCodeIcon size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-slate-900">Nuevo código QR</h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="sm:w-40 shrink-0">
            <Select
              label="Duración"
              value={duracion}
              onChange={(e) => setDuracion(e.target.value as QrDuracion)}
              disabled={creating}
              options={DURACION_OPTIONS.map((d) => ({ value: d, label: QR_DURACION_LABELS[d] }))}
            />
          </div>
          <div className="sm:w-40 shrink-0">
            <Input
              type="number"
              label="Usos máximos"
              min={1}
              max={200}
              value={maxUsos}
              onChange={(e) => setMaxUsos(e.target.value)}
              disabled={creating}
              required
            />
          </div>
          <div className="flex-1">
            <Input
              type="text"
              label="Etiqueta"
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              placeholder="Ej.: Invitación especial de usuarios"
              maxLength={80}
              disabled={creating}
            />
          </div>
        </div>

        {createError && (
          <p className="text-xs text-error" role="alert">
            {createError}
          </p>
        )}

        <Button type="submit" disabled={creating} className="self-start">
          {creating ? <Loader2 size={16} className="animate-spin" /> : 'Generar código QR'}
        </Button>
      </form>

      {panel && <PanelQr codigo={panel.codigo} qrUrl={panel.qrUrl} slug={slug} />}

      {/* ── Lista de códigos ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-900">Códigos del club</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      {listError && (
        <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-4">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{listError}</p>
            <button type="button" onClick={() => void load()} className="mt-1 font-semibold underline text-xs">
              Reintentar
            </button>
          </div>
        </div>
      )}

      {!codigos && !listError && (
        <div className="flex items-center gap-2 text-on-surface-variant py-6">
          <Loader2 className="animate-spin text-primary" size={18} />
          <p className="text-sm">Cargando códigos QR...</p>
        </div>
      )}

      {codigos && codigos.length === 0 && (
        <div className="flex flex-col items-center py-10 gap-3 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-fixed">
            <QrCodeIcon size={22} className="text-primary" />
          </div>
          <p className="text-sm text-on-surface-variant">Todavía no hay códigos QR generados</p>
        </div>
      )}

      {codigos && codigos.length > 0 && (
        <ul className="flex flex-col gap-3">
          {codigos.map((c) => {
            const isPending = pendingId === c.id
            const confirming = confirmRevocarId === c.id
            const puedeVer = c.estado === 'ACTIVO'
            const puedeRevocar = c.estado === 'ACTIVO'
            return (
              <li key={c.id} className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{c.etiqueta ?? 'Sin etiqueta'}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {c.usos} / {c.maxUsos} usos
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ModoBadge modo={c.modo} />
                    <EstadoBadge estado={c.estado} />
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant">Vence: {formatDate(c.expiresAt)}</p>
                {mostrarCreador && (
                  <p className="text-xs text-on-surface-variant">Creado por: {c.creadoPor?.name ?? '—'}</p>
                )}

                {rowError[c.id] && (
                  <p className="text-xs text-error mt-2" role="alert">
                    {rowError[c.id]}
                  </p>
                )}

                {(puedeVer || puedeRevocar) && (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {puedeVer && (
                      <button
                        type="button"
                        onClick={() => void handleVer(c.id)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1.5 bg-primary-fixed text-primary text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-surface-container disabled:opacity-50 transition-colors"
                      >
                        <Eye size={12} /> Ver QR
                      </button>
                    )}
                    {puedeRevocar && !confirming && (
                      <button
                        type="button"
                        onClick={() => setConfirmRevocarId(c.id)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1.5 text-on-error-container text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-error-container disabled:opacity-50 transition-colors"
                      >
                        <Ban size={12} /> Revocar
                      </button>
                    )}
                    {puedeRevocar && confirming && (
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-slate-700">¿Confirmar?</p>
                        <button
                          type="button"
                          onClick={() => void handleRevocar(c.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {isPending ? <Loader2 size={12} className="animate-spin" /> : 'Sí, revocar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevocarId(null)}
                          disabled={isPending}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}


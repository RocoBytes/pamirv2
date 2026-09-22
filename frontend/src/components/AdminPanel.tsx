import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import {
  LayoutDashboard,
  Loader2,
  AlertCircle,
  Clock,
  BellOff,
  CheckCircle2,
  Users,
  BarChart3,
  HeartPulse,
  ChevronDown,
  ChevronUp,
  Send,
  BookOpen,
  FileText,
  Upload,
  Trash2,
  UserCog,
} from 'lucide-react'
import { useOrganization } from '../hooks/useOrganization'
import { AppShell, type ShellContext } from './shell/AppShell'
import {
  fetchSalidas,
  fetchAdminStats,
  fetchSaludSalida,
  enviarSaludSalida,
  fetchDocumentosAdmin,
  uploadDocumento,
  deleteDocumento,
} from '../lib/api'
import type {
  AdminStats,
  SaludSalidaResponse,
  ParticipanteSalud,
  DocumentoRecord,
} from '../lib/api'
import type { SalidaRecord } from '../types/salida'
import { STATUS_LABELS, STATUS_COLORS, DISCIPLINA_LABELS } from '../types/salida'
import { CATEGORIA_LABELS, CATEGORIA_ORDEN } from '../lib/documentos'
import { InvitacionesManager } from './invitaciones/InvitacionesManager'
import { UsuariosManager } from './invitaciones/UsuariosManager'

interface AdminPanelProps {
  shell: ShellContext
  onBack: () => void
  onDashboard: () => void
  currentUserId: string
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/**
 * Derives the UTC offset of America/Santiago for a given calendar date.
 * Chile observes DST, so the offset is computed for the salida's own return
 * date (probing noon UTC of that date) — same logic as the backend cron.
 */
function santiagoOffsetFor(dateStr: string): string {
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'longOffset',
  }).formatToParts(probe)
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-04:00'
  return tzPart.replace('GMT', '')
}

/**
 * Determines whether a salida has exceeded its alert threshold.
 * Uses an explicit Santiago offset (instead of the browser's local timezone)
 * so the result matches the backend cron regardless of the viewer's locale.
 */
function isVencida(salida: SalidaRecord): boolean {
  try {
    // fechaRetornoEstimada arrives as ISO string stored as midnight UTC of
    // the intended calendar date; the UTC date substring IS the return date
    const dateStr = salida.fechaRetornoEstimada.slice(0, 10)
    const offset = santiagoOffsetFor(dateStr)
    const alarmDate = new Date(`${dateStr}T${salida.horaAlerta}:00${offset}`)
    return !isNaN(alarmDate.getTime()) && new Date() >= alarmDate
  } catch {
    return false
  }
}

function isOpenSalida(salida: SalidaRecord): boolean {
  return salida.status === 'EN_CURSO' && (salida._count?.cierres ?? 0) === 0
}

// "2026-06-01T00:00:00.000Z" → "jun 2026" (UTC keeps the month from shifting)
function formatMes(iso: string): string {
  try {
    const formatted = new Date(iso).toLocaleDateString('es-CL', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return formatted === 'Invalid Date' ? '—' : formatted
  } catch {
    return '—'
  }
}

function MetricCard({
  label,
  value,
  subtitle,
  ariaLabel,
}: {
  label: string
  value: string | number
  subtitle?: string
  ariaLabel?: string
}) {
  return (
    <div
      className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4"
      aria-label={ariaLabel}
    >
      <p className="text-2xl font-bold text-primary leading-tight">{value}</p>
      <p className="text-xs text-on-surface-variant mt-1">{label}</p>
      {subtitle && <p className="text-[10px] text-on-surface-variant/70 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-on-surface-variant truncate">{label}</span>
      <div className="flex-1 bg-primary-fixed rounded-full h-2">
        <div
          className="bg-primary rounded-full h-2"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-xs font-semibold text-slate-700 text-right">
        {value}
      </span>
    </div>
  )
}

// ─── Fichas de salud section helpers ─────────────────────────────────────────

function SinFichaBadge() {
  return (
    <span
      className="inline-block bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] text-[10px] font-semibold px-2 py-0.5 rounded-md"
      title="No tiene ficha de salud registrada en este club"
    >
      Sin ficha
    </span>
  )
}

function SaludFlags({ salud }: { salud: NonNullable<ParticipanteSalud['salud']> }) {
  const flags: string[] = []
  if (salud.alergiasTiene) flags.push(`Alergias${salud.alergiasDetalle ? `: ${salud.alergiasDetalle}` : ''}`)
  if (salud.enfermedadesCronicasTiene) flags.push(`Enf. crónicas${salud.enfermedadesCronicasDetalle ? `: ${salud.enfermedadesCronicasDetalle}` : ''}`)
  if (salud.medicamentosTiene) flags.push(`Medicamentos${salud.medicamentosDetalle ? `: ${salud.medicamentosDetalle}` : ''}`)
  if (salud.cirugiasLesionesTiene) flags.push(`Cirugías/lesiones${salud.cirugiasLesionesDetalle ? `: ${salud.cirugiasLesionesDetalle}` : ''}`)
  if (salud.fuma) flags.push('Fuma')
  if (salud.usaLentes) flags.push('Usa lentes')

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {flags.map((f) => (
        <span
          key={f}
          className="inline-block bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-medium px-1.5 py-0.5 rounded"
        >
          {f}
        </span>
      ))}
      {flags.length === 0 && (
        <span className="text-[10px] text-on-surface-variant">Sin alertas médicas</span>
      )}
    </div>
  )
}

// ─── Documentación del Club: gestión admin ──────────────────────────────────

function DocumentosAdminSection() {
  const { memberBadge } = useOrganization()
  const [docs, setDocs] = useState<DocumentoRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [categoria, setCategoria] = useState<string>(CATEGORIA_ORDEN[0])
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await fetchDocumentosAdmin()
      setDocs(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los documentos')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setFormError(null)
      setFormSuccess(null)

      if (!nombre.trim()) {
        setFormError('El nombre es obligatorio')
        return
      }
      if (!file) {
        setFormError('Selecciona un archivo PDF')
        return
      }

      setUploading(true)
      try {
        await uploadDocumento({
          categoria,
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          file,
        })
        setFormSuccess('Documento subido correctamente')
        setNombre('')
        setDescripcion('')
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        await load()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'No se pudo subir el documento')
      } finally {
        setUploading(false)
      }
    },
    [categoria, nombre, descripcion, file, load],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      setLoadError(null)
      try {
        await deleteDocumento(id)
        setConfirmDeleteId(null)
        await load()
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'No se pudo eliminar el documento')
      } finally {
        setDeletingId(null)
      }
    },
    [load],
  )

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={16} className="text-primary" />
        <h2 className="text-base font-bold text-slate-900">Documentación del Club</h2>
      </div>
      <p className="text-xs text-on-surface-variant mb-3">
        Sube formularios, check-lists y material de apoyo. Los archivos quedan visibles para los
        socios {memberBadge} en su sección "Documentación del Club".
      </p>

      {/* Formulario de subida */}
      <form
        onSubmit={(e) => void handleUpload(e)}
        className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-4 flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="doc-categoria" className="text-xs font-semibold text-slate-700">
            Categoría
          </label>
          <select
            id="doc-categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {CATEGORIA_ORDEN.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORIA_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-nombre" className="text-xs font-semibold text-slate-700">
            Nombre
          </label>
          <input
            id="doc-nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={uploading}
            placeholder="Ej: Aviso de expedición — Retén Río Blanco"
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-descripcion" className="text-xs font-semibold text-slate-700">
            Descripción <span className="font-normal text-on-surface-variant">(opcional)</span>
          </label>
          <input
            id="doc-descripcion"
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-file" className="text-xs font-semibold text-slate-700">
            Archivo PDF <span className="font-normal text-on-surface-variant">(máx. 15 MB)</span>
          </label>
          <input
            id="doc-file"
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-fixed file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary disabled:opacity-50"
          />
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-xs text-on-error-container">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p>{formError}</p>
          </div>
        )}

        {formSuccess && (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <p>{formSuccess}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="inline-flex items-center justify-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors self-start"
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Subiendo...
            </>
          ) : (
            <>
              <Upload size={14} />
              Subir documento
            </>
          )}
        </button>
      </form>

      {/* Lista de documentos existentes */}
      {loadError && (
        <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="text-xs">{loadError}</p>
        </div>
      )}

      {!docs && !loadError && (
        <div className="flex items-center gap-2 text-on-surface-variant">
          <Loader2 className="animate-spin text-primary" size={16} />
          <p className="text-xs">Cargando documentos...</p>
        </div>
      )}

      {docs && docs.length === 0 && (
        <p className="text-sm text-on-surface-variant py-4 text-center">
          Aún no hay documentos cargados.
        </p>
      )}

      {docs && docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => {
            const confirming = confirmDeleteId === doc.id
            const isDeleting = deletingId === doc.id
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 bg-white rounded-2xl border border-secondary/15 shadow-sm p-3"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary-fixed flex items-center justify-center">
                  <FileText size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">{doc.nombre}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">
                    {CATEGORIA_LABELS[doc.categoria] ?? doc.categoria}
                  </p>
                </div>
                {confirming ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc.id)}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        'Sí, borrar'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={isDeleting}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1.5 disabled:opacity-50 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(doc.id)}
                    aria-label={`Eliminar ${doc.nombre}`}
                    className="shrink-0 p-2 rounded-lg text-on-error-container hover:bg-error-container transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─── AdminPanel component ─────────────────────────────────────────────────────

export function AdminPanel({ shell, onBack, onDashboard, currentUserId }: AdminPanelProps) {
  const { displayName } = useOrganization()
  const [salidas, setSalidas] = useState<SalidaRecord[] | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fichas de salud section state
  const [expandedSaludId, setExpandedSaludId] = useState<string | null>(null)
  const [saludData, setSaludData] = useState<Record<string, SaludSalidaResponse>>({})
  const [saludLoading, setSaludLoading] = useState<Record<string, boolean>>({})
  const [saludError, setSaludError] = useState<Record<string, string | null>>({})
  const [confirmEnvioId, setConfirmEnvioId] = useState<string | null>(null)
  const [enviandoId, setEnviandoId] = useState<string | null>(null)
  const [envioSuccess, setEnvioSuccess] = useState<Record<string, string | null>>({})
  const [envioError, setEnvioError] = useState<Record<string, string | null>>({})

  const loadSalidas = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchSalidas()
      setSalidas(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las salidas')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Loaded independently: a stats failure must not block the salidas list
  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const data = await fetchAdminStats()
      setStats(data)
      setStatsError(null)
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas')
    } finally {
      setStatsLoading(false)
    }
  }, [])

  const handleToggleSalud = useCallback(async (salidaId: string) => {
    if (expandedSaludId === salidaId) {
      setExpandedSaludId(null)
      setConfirmEnvioId(null)
      return
    }
    setExpandedSaludId(salidaId)
    setConfirmEnvioId(null)

    // Lazy-fetch: only load once per salida
    if (saludData[salidaId]) return

    setSaludLoading((prev) => ({ ...prev, [salidaId]: true }))
    setSaludError((prev) => ({ ...prev, [salidaId]: null }))
    try {
      const data = await fetchSaludSalida(salidaId)
      setSaludData((prev) => ({ ...prev, [salidaId]: data }))
    } catch (err) {
      setSaludError((prev) => ({
        ...prev,
        [salidaId]: err instanceof Error ? err.message : 'No se pudieron cargar las fichas',
      }))
    } finally {
      setSaludLoading((prev) => ({ ...prev, [salidaId]: false }))
    }
  }, [expandedSaludId, saludData])

  const handleEnviarSalud = useCallback(async (salidaId: string) => {
    setEnviandoId(salidaId)
    setEnvioSuccess((prev) => ({ ...prev, [salidaId]: null }))
    setEnvioError((prev) => ({ ...prev, [salidaId]: null }))
    setConfirmEnvioId(null)
    try {
      const result = await enviarSaludSalida(salidaId)
      setEnvioSuccess((prev) => ({
        ...prev,
        [salidaId]: `Correo enviado a ${result.to} (${result.participantesConFicha} con ficha, ${result.participantesSinFicha} sin ficha)`,
      }))
    } catch (err) {
      setEnvioError((prev) => ({
        ...prev,
        [salidaId]: err instanceof Error ? err.message : 'No se pudo enviar el correo',
      }))
    } finally {
      setEnviandoId(null)
    }
  }, [])

  useEffect(() => {
    void loadSalidas()
    void loadStats()
  }, [loadSalidas, loadStats])

  const openSalidas = salidas ? salidas.filter(isOpenSalida) : []
  const allSalidas = salidas ?? []

  // Chart data: last 6 months in chronological order; max guards against
  // division by zero in BarRow (width renders as 0%)
  const meses = stats ? stats.porMes.slice(0, 6).reverse() : []
  const maxMes = Math.max(0, ...meses.map((x) => x.total))
  const maxDisciplina = stats ? Math.max(0, ...stats.topDisciplinas.map((x) => x.total)) : 0

  // Group all salidas by status for the history section
  const grouped = allSalidas.reduce<Record<string, SalidaRecord[]>>((acc, s) => {
    const list = acc[s.status] ?? []
    list.push(s)
    acc[s.status] = list
    return acc
  }, {})

  const statusOrder: Array<SalidaRecord['status']> = [
    'EN_CURSO',
    'COMPLETADA',
    'BORRADOR',
    'CONFIRMADA',
    'INCIDENTE',
    'CANCELADA',
  ]

  return (
    <AppShell shell={shell} active="none" onBack={onBack} width="narrow">
        {/* Page title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
            <LayoutDashboard size={14} />
            Administración
          </div>
          <h1 className="text-xl font-bold text-slate-900">Panel de Administración</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Salidas abiertas, alarmas pendientes e historial completo de registros.
          </p>
          <button
            onClick={onDashboard}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover"
          >
            <BarChart3 size={16} />
            Ver Dashboard analítico
          </button>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
            <Loader2 className="animate-spin text-primary" size={28} />
            <p className="text-sm">Cargando datos...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-6">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              <button
                onClick={() => void loadSalidas()}
                className="mt-2 text-on-error-container font-semibold underline text-xs"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* ── Section: Métricas ────────────────────────────────────────────── */}
        {!isLoading && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-primary" />
              <h2 className="text-base font-bold text-slate-900">Métricas</h2>
            </div>

            {statsLoading && (
              <div className="flex items-center gap-2 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 text-on-surface-variant">
                <Loader2 className="animate-spin text-primary" size={16} />
                <p className="text-xs">Cargando métricas...</p>
              </div>
            )}

            {!statsLoading && statsError && (
              <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p>{statsError}</p>
                  <button
                    onClick={() => void loadStats()}
                    className="mt-2 text-on-error-container font-semibold underline text-xs"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            )}

            {!statsLoading && stats && (
              <>
                {/* Metric cards */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <MetricCard label="Total de salidas" value={stats.totalSalidas} />
                  <MetricCard label="En curso" value={stats.salidasAbiertas} />
                  <MetricCard label="Completadas" value={stats.salidasCompletadas} />
                  <MetricCard
                    label="% con cierre"
                    value={`${stats.pctConCierre}%`}
                    subtitle={`${stats.totalCierres} de ${stats.totalSalidas} salidas`}
                    ariaLabel="Salidas con ficha de cierre registrada"
                  />
                  <MetricCard label="Incidentes (sin lesión)" value={stats.incidentes} />
                  <MetricCard label="Accidentes (con lesión)" value={stats.accidentes} />
                </div>

                {/* Salidas por mes (last 6 months, chronological order) */}
                <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-3">
                  <h3 className="text-xs font-bold text-primary uppercase tracking-wide mb-3">
                    Salidas por mes
                  </h3>
                  {meses.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">Sin datos de salidas en los últimos meses</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {meses.map((m) => (
                        <BarRow
                          key={m.mes}
                          label={formatMes(m.mes)}
                          value={m.total}
                          max={maxMes}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Top disciplinas */}
                <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4">
                  <h3 className="text-xs font-bold text-primary uppercase tracking-wide mb-3">
                    Disciplinas más frecuentes
                  </h3>
                  {stats.topDisciplinas.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">Sin salidas registradas</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {stats.topDisciplinas.map((d) => (
                        <BarRow
                          key={d.disciplina}
                          label={
                            (DISCIPLINA_LABELS as Record<string, string>)[d.disciplina] ??
                            d.disciplina
                          }
                          value={d.total}
                          max={maxDisciplina}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Section: Documentación del Club ─────────────────────────────── */}
        {!isLoading && <DocumentosAdminSection />}

        {/* ── Section: Usuarios e invitaciones (sistema cerrado) ──────────── */}
        {!isLoading && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <UserCog size={16} className="text-primary" />
              <h2 className="text-base font-bold text-slate-900">Usuarios e invitaciones</h2>
            </div>
            <p className="text-xs text-on-surface-variant mb-3">
              {displayName} es un sistema cerrado: las cuentas nuevas solo se crean por
              invitación. Gestiona quién puede unirse y qué rol tiene cada integrante.
            </p>

            <div className="flex flex-col gap-6">
              <InvitacionesManager rolActual="ADMIN" />
              <UsuariosManager currentUserId={currentUserId} />
            </div>
          </section>
        )}

        {!isLoading && salidas && (
          <>
            {/* ── Section 1: Salidas abiertas ─────────────────────────────── */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-slate-900">Salidas abiertas</h2>
                <span className="text-xs font-bold bg-primary-fixed text-primary px-2 py-0.5 rounded-full">
                  {openSalidas.length}
                </span>
              </div>

              {openSalidas.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-fixed">
                    <CheckCircle2 size={22} className="text-primary" />
                  </div>
                  <p className="text-sm text-on-surface-variant">No hay salidas abiertas sin cierre</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {openSalidas.map((s) => {
                    const vencida = isVencida(s)
                    const alertada = Boolean(s.alertaEnviadaAt)
                    const participantCount = Array.isArray(s.participantes)
                      ? s.participantes.length
                      : 0

                    return (
                      <li
                        key={s.id}
                        className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4"
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            {typeof s.numeroSalida === 'number' && (
                              <span className="inline-block text-[10px] font-bold text-secondary bg-primary-fixed px-2 py-0.5 rounded-md mb-1">
                                N° {s.numeroSalida}
                              </span>
                            )}
                            <p className="font-semibold text-slate-900 text-sm leading-tight">
                              {s.nombreActividad}
                            </p>
                            <p className="text-xs text-on-surface-variant mt-0.5">{s.ubicacionGeografica}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {vencida && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white bg-red-600 px-2 py-0.5 rounded-md">
                                <Clock size={10} />
                                VENCIDA
                              </span>
                            )}
                            {alertada && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md">
                                <BellOff size={10} />
                                Alerta enviada
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-on-surface-variant mt-2">
                          <span>
                            <span className="font-medium text-slate-600">Inicio:</span>{' '}
                            {formatDate(s.fechaInicio)}
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Retorno est.:</span>{' '}
                            {formatDate(s.fechaRetornoEstimada)} {s.horaRetornoEstimada}
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Hora alerta:</span>{' '}
                            {s.horaAlerta}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users size={11} />
                            {participantCount}{' '}
                            {participantCount === 1 ? 'participante' : 'participantes'}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 mt-2">
                          <span className="font-medium text-slate-700">Líder:</span>{' '}
                          {s.liderCordada}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Section: Fichas de salud ────────────────────────────────── */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <HeartPulse size={16} className="text-primary" />
                <h2 className="text-base font-bold text-slate-900">Fichas de salud</h2>
                <span className="text-xs font-bold bg-primary-fixed text-primary px-2 py-0.5 rounded-full">
                  {openSalidas.length}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-3">
                Consulta y envía al responsable de cada salida en curso el resumen de fichas de salud de sus participantes.
              </p>

              {openSalidas.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-fixed">
                    <HeartPulse size={22} className="text-primary" />
                  </div>
                  <p className="text-sm text-on-surface-variant">No hay salidas en curso</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {openSalidas.map((s) => {
                    const isExpanded = expandedSaludId === s.id
                    const loading = saludLoading[s.id]
                    const fetchErr = saludError[s.id]
                    const data = saludData[s.id]
                    const isEnviando = enviandoId === s.id
                    const confirmPending = confirmEnvioId === s.id
                    const successMsg = envioSuccess[s.id]
                    const errorMsg = envioError[s.id]

                    return (
                      <li
                        key={s.id}
                        className="bg-white rounded-2xl border border-secondary/15 shadow-sm overflow-hidden"
                      >
                        {/* Header row: always visible */}
                        <button
                          type="button"
                          onClick={() => void handleToggleSalud(s.id)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-container-low transition-colors"
                          aria-expanded={isExpanded}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 text-sm leading-tight truncate">
                              {s.nombreActividad}
                            </p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              Líder: {s.liderCordada} ·{' '}
                              {Array.isArray(s.participantes) ? s.participantes.length : 0} participante(s)
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-primary font-medium">Ver fichas</span>
                            {isExpanded ? (
                              <ChevronUp size={16} className="text-primary" />
                            ) : (
                              <ChevronDown size={16} className="text-primary" />
                            )}
                          </div>
                        </button>

                        {/* Expandable panel */}
                        {isExpanded && (
                          <div className="border-t border-primary-fixed px-4 py-3">
                            {loading && (
                              <div className="flex items-center gap-2 py-4 text-on-surface-variant">
                                <Loader2 className="animate-spin text-primary" size={16} />
                                <p className="text-xs">Cargando fichas de salud...</p>
                              </div>
                            )}

                            {fetchErr && (
                              <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-3">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <p className="text-xs">{fetchErr}</p>
                              </div>
                            )}

                            {data && (
                              <>
                                {/* Participant list */}
                                <ul className="flex flex-col gap-2 mb-4">
                                  {data.participantes.map((p) => (
                                    <li
                                      key={p.rut}
                                      className="rounded-xl border border-primary-fixed px-3 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-slate-900 truncate">
                                            {p.nombre}
                                          </p>
                                          <p className="text-[11px] text-on-surface-variant">RUT: {p.rut}</p>
                                        </div>
                                        {!p.fichaEncontrada && <SinFichaBadge />}
                                        {p.fichaEncontrada && (
                                          <span className="inline-block text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0">
                                            {p.salud?.grupoSanguineo}
                                          </span>
                                        )}
                                      </div>
                                      {p.fichaEncontrada && p.salud && (
                                        <SaludFlags salud={p.salud} />
                                      )}
                                    </li>
                                  ))}
                                </ul>

                                {/* Send action */}
                                <div className="border-t border-primary-fixed pt-3">
                                  <p className="text-xs text-on-surface-variant mb-2">
                                    Se enviará a:{' '}
                                    <span className="font-medium text-slate-700">
                                      {data.creatorEmail ?? 'correo vinculado a la cuenta'}
                                    </span>
                                  </p>

                                  {successMsg && (
                                    <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 mb-2">
                                      <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                                      <p>{successMsg}</p>
                                    </div>
                                  )}

                                  {errorMsg && (
                                    <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-xs text-on-error-container mb-2">
                                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                      <p>{errorMsg}</p>
                                    </div>
                                  )}

                                  {!confirmPending && !successMsg && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmEnvioId(s.id)}
                                      disabled={isEnviando}
                                      className="inline-flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                                    >
                                      <Send size={12} />
                                      Enviar resumen al responsable
                                    </button>
                                  )}

                                  {confirmPending && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-xs font-semibold text-slate-700">
                                        ¿Confirmar envío?
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => void handleEnviarSalud(s.id)}
                                        disabled={isEnviando}
                                        className="inline-flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                                      >
                                        {isEnviando ? (
                                          <>
                                            <Loader2 size={12} className="animate-spin" />
                                            Enviando...
                                          </>
                                        ) : (
                                          <>
                                            <Send size={12} />
                                            Sí, enviar
                                          </>
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmEnvioId(null)}
                                        disabled={isEnviando}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1.5 disabled:opacity-50 transition-colors"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Section 2: Historial de registros ───────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-slate-900">Historial de registros</h2>
                <span className="text-xs font-bold bg-primary-fixed text-primary px-2 py-0.5 rounded-full">
                  {allSalidas.length}
                </span>
              </div>

              {allSalidas.length === 0 ? (
                <p className="text-sm text-on-surface-variant py-6 text-center">
                  No hay salidas registradas en el sistema
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {statusOrder
                    .filter((st) => grouped[st]?.length)
                    .map((st) => (
                      <div key={st}>
                        <h3 className="text-xs font-bold text-primary uppercase tracking-wide mb-2">
                          {STATUS_LABELS[st]} ({grouped[st].length})
                        </h3>
                        <ul className="flex flex-col gap-1">
                          {grouped[st].map((s) => (
                            <li
                              key={s.id}
                              className="flex items-center gap-3 bg-white rounded-xl border border-secondary/10 px-3 py-2.5"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {s.nombreActividad}
                                </p>
                                <p className="text-xs text-on-surface-variant truncate">
                                  {DISCIPLINA_LABELS[s.disciplina] ?? s.disciplina} ·{' '}
                                  {formatDate(s.fechaInicio)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status]}`}
                                >
                                  {STATUS_LABELS[s.status]}
                                </span>
                                {/* Cierre indicator */}
                                {(s._count?.cierres ?? 0) > 0 ? (
                                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                    Con cierre
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                                    Sin cierre
                                  </span>
                                )}
                                {s.esRegistroHistorico && (
                                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                    Histórico
                                  </span>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </>
        )}
    </AppShell>
  )
}

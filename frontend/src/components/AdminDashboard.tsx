import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
  LayoutDashboard,
} from 'lucide-react'
import { Button } from './ui/Button'
import { AppShell, type ShellContext } from './shell/AppShell'
import { Select } from './ui/Select'
import { fetchAdminDashboard } from '../lib/api'
import type { AdminDashboard as AdminDashboardData, DashboardFiltros } from '../lib/api'
import { STATUS_LABELS, DISCIPLINA_LABELS, CLUB_FILTER_LABELS } from '../types/salida'
import { DashboardGrid } from './admin/DashboardGrid'

interface AdminDashboardProps {
  shell: ShellContext
  onBack: () => void
}

const STATUS_LABEL = STATUS_LABELS as Record<string, string>
const DISCIPLINA_LABEL = DISCIPLINA_LABELS as Record<string, string>

const TRISTATE_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'true', label: 'Sí' },
  { value: 'false', label: 'No' },
]

type BoolFilterKey = 'conCierre' | 'conIncidente' | 'conAccidente' | 'conExpress'
type StringFilterKey =
  | 'desde'
  | 'hasta'
  | 'status'
  | 'lider'
  | 'disciplina'
  | 'tipoSalida'
  | 'temporada'
  | 'club'

export function AdminDashboard({ shell, onBack }: AdminDashboardProps) {
  const [filtros, setFiltros] = useState<DashboardFiltros>({})
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (f: DashboardFiltros) => {
    setLoading(true)
    try {
      const result = await fetchAdminDashboard(f)
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-query whenever a filter changes (debounced so rapid edits collapse).
  useEffect(() => {
    const timer = setTimeout(() => void load(filtros), 300)
    return () => clearTimeout(timer)
  }, [filtros, load])

  function setFiltro(key: StringFilterKey, raw: string): void {
    setFiltros((prev) => {
      const next = { ...prev }
      if (raw === '') delete next[key]
      else next[key] = raw
      return next
    })
  }

  function setBoolFiltro(key: BoolFilterKey, raw: string): void {
    setFiltros((prev) => {
      const next = { ...prev }
      if (raw === 'true') next[key] = true
      else if (raw === 'false') next[key] = false
      else delete next[key]
      return next
    })
  }

  function setCalidadMin(raw: string): void {
    setFiltros((prev) => {
      const next = { ...prev }
      if (raw === '') delete next.calidadMin
      else next.calidadMin = Number(raw)
      return next
    })
  }

  const boolValue = (key: BoolFilterKey): string =>
    filtros[key] === undefined ? '' : String(filtros[key])

  const filterOptions = data?.filtros ?? { lideres: [], disciplinas: [], tipos: [], temporadas: [] }
  const hasActiveFilters = Object.keys(filtros).length > 0
  const sinSalidas = !!data && data.metrics.totalSalidas === 0

  return (
    <AppShell shell={shell} active="none" onBack={onBack}>
        {/* Title — "Actualizar" vive acá y no en el header, que ahora es
            compartido por toda la app y no admite acciones de una pantalla. */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
              <LayoutDashboard size={14} />
              Administración
            </div>
            <h1 className="text-xl font-bold text-slate-900">Dashboard analítico</h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Relación entre el formulario de salida y el de cierre. Los gráficos se actualizan al cambiar los filtros.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load(filtros)} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
            Actualizar
          </Button>
        </div>

        {/* Filters */}
        <section className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-slate-900">Filtros</h2>
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => setFiltros({})}
                className="text-xs font-semibold text-primary underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Date range */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-primary">Desde</label>
              <input
                type="date"
                value={filtros.desde ?? ''}
                onChange={(e) => setFiltro('desde', e.target.value)}
                className="w-full rounded-xl border border-secondary/40 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-primary">Hasta</label>
              <input
                type="date"
                value={filtros.hasta ?? ''}
                onChange={(e) => setFiltro('hasta', e.target.value)}
                className="w-full rounded-xl border border-secondary/40 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <Select
              label="Estado"
              value={filtros.status ?? ''}
              onChange={(e) => setFiltro('status', e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />

            <Select
              label="Líder"
              value={filtros.lider ?? ''}
              onChange={(e) => setFiltro('lider', e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                ...filterOptions.lideres.map((l) => ({ value: l, label: l })),
              ]}
            />

            {/* data-cross-club-options: filtro por la membresía de un PARTICIPANTE
                (a qué club dice pertenecer), no branding del club que consulta —
                lista legítimamente cruzada entre clubes. El marcador deja que un
                e2e de branding la excluda del barrido de "ningún texto de otro
                club" sin tocar sus datos (ver e2e/branding.spec.ts). */}
            <div data-cross-club-options="true">
              <Select
                label="Club"
                value={filtros.club ?? ''}
                onChange={(e) => setFiltro('club', e.target.value)}
                options={[
                  { value: '', label: 'Todos' },
                  ...Object.entries(CLUB_FILTER_LABELS).map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>

            <Select
              label="Disciplina"
              value={filtros.disciplina ?? ''}
              onChange={(e) => setFiltro('disciplina', e.target.value)}
              options={[
                { value: '', label: 'Todas' },
                ...filterOptions.disciplinas.map((d) => ({
                  value: d,
                  label: DISCIPLINA_LABEL[d] ?? d,
                })),
              ]}
            />

            <Select
              label="Tipo de salida"
              value={filtros.tipoSalida ?? ''}
              onChange={(e) => setFiltro('tipoSalida', e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                ...filterOptions.tipos.map((t) => ({ value: t, label: t })),
              ]}
            />

            {filterOptions.temporadas.length > 0 && (
              <Select
                label="Temporada"
                value={filtros.temporada ?? ''}
                onChange={(e) => setFiltro('temporada', e.target.value)}
                options={[
                  { value: '', label: 'Todas' },
                  ...filterOptions.temporadas.map((t) => ({ value: t, label: t })),
                ]}
              />
            )}

            <Select
              label="Con cierre"
              value={boolValue('conCierre')}
              onChange={(e) => setBoolFiltro('conCierre', e.target.value)}
              options={TRISTATE_OPTIONS}
            />
            <Select
              label="Con incidente"
              value={boolValue('conIncidente')}
              onChange={(e) => setBoolFiltro('conIncidente', e.target.value)}
              options={TRISTATE_OPTIONS}
            />
            <Select
              label="Con accidente"
              value={boolValue('conAccidente')}
              onChange={(e) => setBoolFiltro('conAccidente', e.target.value)}
              options={TRISTATE_OPTIONS}
            />
            <Select
              label="Con express"
              value={boolValue('conExpress')}
              onChange={(e) => setBoolFiltro('conExpress', e.target.value)}
              options={TRISTATE_OPTIONS}
            />
            <Select
              label="Calidad mínima"
              value={filtros.calidadMin === undefined ? '' : String(filtros.calidadMin)}
              onChange={(e) => setCalidadMin(e.target.value)}
              options={[
                { value: '', label: 'Cualquiera' },
                { value: '1', label: '≥ 1★' },
                { value: '2', label: '≥ 2★' },
                { value: '3', label: '≥ 3★' },
                { value: '4', label: '≥ 4★' },
                { value: '5', label: '5★' },
              ]}
            />
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-6">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              <button
                onClick={() => void load(filtros)}
                className="mt-2 text-on-error-container font-semibold underline text-xs"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Initial loading (no data yet) */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
            <Loader2 className="animate-spin text-primary" size={28} />
            <p className="text-sm">Cargando dashboard...</p>
          </div>
        )}

        {data && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {sinSalidas && (
              <div className="rounded-xl bg-white border border-secondary/15 shadow-sm p-6 text-center text-sm text-on-surface-variant mb-6">
                No hay salidas que coincidan con los filtros seleccionados.
              </div>
            )}

            <DashboardGrid data={data} />
          </div>
        )}
    </AppShell>
  )
}

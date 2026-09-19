import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
  LayoutDashboard,
} from 'lucide-react'
import logoPamir from '../assets/logo_PAMIR.png'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { fetchAdminDashboard } from '../lib/api'
import type { AdminDashboard as AdminDashboardData, DashboardFiltros } from '../lib/api'
import { STATUS_LABELS, DISCIPLINA_LABELS, CLUB_FILTER_LABELS } from '../types/salida'
import { DashboardGrid } from './admin/DashboardGrid'

interface AdminDashboardProps {
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

export function AdminDashboard({ onBack }: AdminDashboardProps) {
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
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
            <span className="font-bold text-slate-900 text-lg">Pamir</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void load(filtros)} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
              Actualizar
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft size={16} />
              Volver
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
            <LayoutDashboard size={14} />
            Administración
          </div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard analítico</h1>
          <p className="text-sm text-[#757874] mt-0.5">
            Relación entre el formulario de salida y el de cierre. Los gráficos se actualizan al cambiar los filtros.
          </p>
        </div>

        {/* Filters */}
        <section className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[#264c99]" />
              <h2 className="text-sm font-bold text-slate-900">Filtros</h2>
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => setFiltros({})}
                className="text-xs font-semibold text-[#264c99] underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Date range */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-[#264c99]">Desde</label>
              <input
                type="date"
                value={filtros.desde ?? ''}
                onChange={(e) => setFiltro('desde', e.target.value)}
                className="w-full rounded-xl border border-[#4a6fad]/40 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#264c99]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-[#264c99]">Hasta</label>
              <input
                type="date"
                value={filtros.hasta ?? ''}
                onChange={(e) => setFiltro('hasta', e.target.value)}
                className="w-full rounded-xl border border-[#4a6fad]/40 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#264c99]"
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

            <Select
              label="Club"
              value={filtros.club ?? ''}
              onChange={(e) => setFiltro('club', e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                ...Object.entries(CLUB_FILTER_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />

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
          <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44] mb-6">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              <button
                onClick={() => void load(filtros)}
                className="mt-2 text-[#8b3a44] font-semibold underline text-xs"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Initial loading (no data yet) */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#757874]">
            <Loader2 className="animate-spin text-[#264c99]" size={28} />
            <p className="text-sm">Cargando dashboard...</p>
          </div>
        )}

        {data && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {sinSalidas && (
              <div className="rounded-xl bg-white border border-[#4a6fad]/15 shadow-sm p-6 text-center text-sm text-[#757874] mb-6">
                No hay salidas que coincidan con los filtros seleccionados.
              </div>
            )}

            <DashboardGrid data={data} />
          </div>
        )}
      </main>
    </div>
  )
}

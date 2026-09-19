/* eslint-disable react-refresh/only-export-components --
   This is a widget registry module: it pairs widget metadata with their render
   functions. It intentionally exports data (WIDGETS, WIDGET_MAP, DEFAULT_LAYOUT)
   alongside JSX, so the React Fast Refresh component-only constraint does not
   apply here. */
import type { ReactNode } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { AdminDashboard, DashboardWidgetLayout } from '../../lib/api'
import { STATUS_LABELS } from '../../types/salida'

// Theme tokens (mirror index.css). Recharts needs concrete color strings.
const COLOR_PRIMARY = '#264c99'
const COLOR_SECONDARY = '#4a6fad'
const COLOR_TERTIARY = '#A4636E'
const COLOR_GRID = '#e8eef7'
const PIE_COLORS = ['#264c99', '#4a6fad', '#A4636E', '#7b9bd1', '#c08a93', '#9fb4d8']

const STATUS_LABEL = STATUS_LABELS as Record<string, string>

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// "YYYY-MM" → "Jun 26"
function formatMes(key: string): string {
  const [year, month] = key.split('-')
  const idx = Number(month) - 1
  return `${MESES[idx] ?? month} ${year?.slice(2) ?? ''}`
}

// ─── Presentational primitives (filled to the grid cell via h-full) ─────────────

function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string
  value: string | number
  subtitle?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 h-full flex flex-col justify-center overflow-hidden">
      <p className="text-2xl font-bold text-[#264c99] leading-tight">{value}</p>
      <p className="text-xs text-[#757874] mt-1">{label}</p>
      {subtitle && <p className="text-[10px] text-[#757874]/70 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string
  empty?: boolean
  children: ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 h-full flex flex-col overflow-hidden">
      <h3 className="text-xs font-bold text-[#264c99] uppercase tracking-wide mb-3 shrink-0">
        {title}
      </h3>
      {empty ? (
        <p className="text-xs text-[#757874] py-8 text-center">
          Sin datos para los filtros seleccionados
        </p>
      ) : (
        <div className="flex-1 min-h-0">{children}</div>
      )}
    </div>
  )
}

// ─── Widget registry ────────────────────────────────────────────────────────────
// A widget is a self-contained block addressable by a stable id. The grid only
// stores geometry ({widgetId,x,y,w,h}); the content lives here. Adding/removing a
// block is a single entry change — DashboardGrid reconciles saved layouts against
// this list. Widget ids MUST stay in sync with the backend allowlist in
// backend/src/controllers/admin.controller.ts (WIDGET_IDS).

export interface WidgetGeometry {
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface WidgetDef {
  id: string
  title: string
  geometry: WidgetGeometry
  render: (data: AdminDashboard) => ReactNode
}

const TILE: Pick<WidgetGeometry, 'w' | 'h' | 'minW' | 'minH'> = { w: 4, h: 2, minW: 2, minH: 2 }
const CHART: Pick<WidgetGeometry, 'w' | 'h' | 'minW' | 'minH'> = { w: 6, h: 6, minW: 4, minH: 4 }

export const WIDGETS: WidgetDef[] = [
  // ── Metric tiles (3 per row on lg) ──
  {
    id: 'total_salidas',
    title: 'Total de salidas',
    geometry: { x: 0, y: 0, ...TILE },
    render: (d) => <MetricCard label="Total de salidas" value={d.metrics.totalSalidas} />,
  },
  {
    id: 'pendientes_cierre',
    title: 'Pendientes de cierre',
    geometry: { x: 4, y: 0, ...TILE },
    render: (d) => <MetricCard label="Pendientes de cierre" value={d.metrics.pendientesCierre} />,
  },
  {
    id: 'con_cierre',
    title: 'Con cierre',
    geometry: { x: 8, y: 0, ...TILE },
    render: (d) => (
      <MetricCard
        label="Con cierre"
        value={d.metrics.conCierre}
        subtitle={`${d.metrics.pctConCierre}% del total`}
      />
    ),
  },
  {
    id: 'canceladas',
    title: 'Canceladas',
    geometry: { x: 0, y: 2, ...TILE },
    render: (d) => <MetricCard label="Canceladas" value={d.metrics.canceladas} />,
  },
  {
    id: 'total_participantes',
    title: 'Total participantes',
    geometry: { x: 4, y: 2, ...TILE },
    render: (d) => <MetricCard label="Total participantes" value={d.metrics.totalParticipantes} />,
  },
  {
    id: 'promedio_participantes',
    title: 'Promedio por salida',
    geometry: { x: 8, y: 2, ...TILE },
    render: (d) => (
      <MetricCard label="Promedio por salida" value={d.metrics.promedioParticipantes} />
    ),
  },
  {
    id: 'participantes_express',
    title: 'Participantes express',
    geometry: { x: 0, y: 4, ...TILE },
    render: (d) => <MetricCard label="Participantes express" value={d.metrics.totalExpress} />,
  },
  {
    id: 'salidas_incidentes',
    title: 'Salidas con incidentes',
    geometry: { x: 4, y: 4, ...TILE },
    render: (d) => <MetricCard label="Salidas con incidentes" value={d.metrics.incidentes} />,
  },
  {
    id: 'salidas_accidentes',
    title: 'Salidas con accidentes',
    geometry: { x: 8, y: 4, ...TILE },
    render: (d) => <MetricCard label="Salidas con accidentes" value={d.metrics.accidentes} />,
  },
  {
    id: 'calidad_promedio',
    title: 'Calidad promedio',
    geometry: { x: 0, y: 6, ...TILE },
    render: (d) => (
      <MetricCard
        label="Calidad promedio"
        value={d.metrics.promedioCalidad === null ? '—' : `${d.metrics.promedioCalidad}★`}
        subtitle={`${d.calidad.totalRespuestas} respuestas`}
      />
    ),
  },
  {
    id: 'eval_baja',
    title: 'Salidas con evaluación baja',
    geometry: { x: 4, y: 6, ...TILE },
    render: (d) => <MetricCard label="Salidas con evaluación baja" value={d.metrics.salidasEvalBaja} />,
  },

  // ── Charts (2 per row on lg) ──
  {
    id: 'salidas_por_estado',
    title: 'Salidas por estado',
    geometry: { x: 0, y: 8, ...CHART },
    render: (d) => {
      const estadoData = (d.porEstado ?? [])
        .filter((e) => e.total > 0)
        .map((e) => ({ label: STATUS_LABEL[e.estado] ?? e.estado, total: e.total }))
      return (
        <ChartCard title="Salidas por estado" empty={estadoData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={estadoData}
                dataKey="total"
                nameKey="label"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
              >
                {estadoData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'salidas_por_mes',
    title: 'Salidas por mes',
    geometry: { x: 6, y: 8, ...CHART },
    render: (d) => {
      const mesData = (d.porMes ?? []).map((m) => ({ label: formatMes(m.mes), total: m.total }))
      return (
        <ChartCard title="Salidas por mes" empty={mesData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mesData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="total"
                name="Salidas"
                stroke={COLOR_PRIMARY}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'incidentes_accidentes',
    title: 'Incidentes y accidentes por mes',
    geometry: { x: 0, y: 14, ...CHART },
    render: (d) => {
      const incidentesData = (d.incidentesPorMes ?? []).map((m) => ({
        label: formatMes(m.mes),
        incidentes: m.incidentes,
        accidentes: m.accidentes,
      }))
      return (
        <ChartCard title="Incidentes y accidentes por mes" empty={incidentesData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={incidentesData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="incidentes" name="Incidentes" fill={COLOR_SECONDARY} />
              <Bar dataKey="accidentes" name="Accidentes" fill={COLOR_TERTIARY} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'participantes_tipo',
    title: 'Participantes por tipo',
    geometry: { x: 6, y: 14, ...CHART },
    render: (d) => {
      const participantesData = [
        { label: 'Registrados', total: d.participantesPorTipo.registrados },
        { label: 'Express', total: d.participantesPorTipo.express },
      ].filter((x) => x.total > 0)
      return (
        <ChartCard title="Participantes por tipo" empty={participantesData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={participantesData}
                dataKey="total"
                nameKey="label"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
              >
                {participantesData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'calidad_distribucion',
    title: 'Calidad de experiencia (distribución)',
    geometry: { x: 0, y: 20, ...CHART },
    render: (d) => {
      const calidadDistData = (d.calidad.distribucion ?? []).map((x) => ({
        label: `${x.nota}★`,
        total: x.total,
      }))
      return (
        <ChartCard
          title="Calidad de experiencia (distribución)"
          empty={d.calidad.totalRespuestas === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={calidadDistData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" name="Respuestas" fill={COLOR_PRIMARY} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'calidad_evolucion',
    title: 'Evolución de la calidad',
    geometry: { x: 6, y: 20, ...CHART },
    render: (d) => {
      const calidadMesData = (d.calidad.porMes ?? []).map((m) => ({
        label: formatMes(m.mes),
        promedio: m.promedio,
      }))
      return (
        <ChartCard title="Evolución de la calidad" empty={calidadMesData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={calidadMesData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="promedio"
                name="Promedio"
                stroke={COLOR_TERTIARY}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'salidas_por_lider',
    title: 'Salidas por líder',
    geometry: { x: 0, y: 26, ...CHART, h: 7 },
    render: (d) => {
      const liderData = (d.porLider ?? []).map((l) => ({ lider: l.lider, total: l.total }))
      return (
        <ChartCard title="Salidas por líder" empty={liderData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={liderData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="lider" width={110} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" name="Salidas" fill={COLOR_PRIMARY} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
  {
    id: 'comparacion_salida_cierre',
    title: 'Comparación salida vs cierre',
    geometry: { x: 6, y: 26, ...CHART },
    render: (d) => {
      const salidaVsCierreData = [
        { label: 'Con cierre', total: d.salidaVsCierre.conCierre },
        { label: 'Sin cierre', total: d.salidaVsCierre.sinCierre },
        { label: 'Cambios roster', total: d.salidaVsCierre.conCambiosRoster },
        { label: 'Incidentes', total: d.salidaVsCierre.conIncidentes },
        { label: 'Accidentes', total: d.salidaVsCierre.conAccidentes },
      ]
      return (
        <ChartCard
          title="Comparación salida vs cierre"
          empty={salidaVsCierreData.every((x) => x.total === 0)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={salidaVsCierreData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" name="Salidas" fill={COLOR_SECONDARY} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    },
  },
]

export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w]),
)

// Single source of truth for the default arrangement and "restore default".
export const DEFAULT_LAYOUT: DashboardWidgetLayout[] = WIDGETS.map((w) => ({
  widgetId: w.id,
  x: w.geometry.x,
  y: w.geometry.y,
  w: w.geometry.w,
  h: w.geometry.h,
}))

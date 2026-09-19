import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout'
import { Pencil, Save, X, RotateCcw, AlertCircle } from 'lucide-react'
import 'react-grid-layout/css/styles.css'
import { Button } from '../ui/Button'
import {
  fetchDashboardLayout,
  saveDashboardLayout,
  resetDashboardLayout,
  type AdminDashboard,
  type DashboardWidgetLayout,
} from '../../lib/api'
import { WIDGETS, WIDGET_MAP, DEFAULT_LAYOUT } from './dashboardWidgets'

const COLS = { lg: 12, md: 12, sm: 6, xs: 1, xxs: 1 }
const BREAKPOINTS = { lg: 1024, md: 768, sm: 640, xs: 480, xxs: 0 }
const ROW_HEIGHT = 50
const MARGIN: readonly [number, number] = [12, 12]
const CONTAINER_PADDING: readonly [number, number] = [0, 0]

// Map our persisted geometry to react-grid-layout items, pulling min sizes from
// the registry so a saved layout can never shrink a widget below its minimum.
function toRgl(layout: DashboardWidgetLayout[]): LayoutItem[] {
  return layout
    .filter((item) => WIDGET_MAP[item.widgetId])
    .map((item) => {
      const g = WIDGET_MAP[item.widgetId].geometry
      return { i: item.widgetId, x: item.x, y: item.y, w: item.w, h: item.h, minW: g.minW, minH: g.minH }
    })
}

// Reconcile a saved layout against the current registry: drop widgets that no
// longer exist, and append widgets added in code (at their default position) so
// the dashboard never silently loses a block after a deploy.
function reconcile(saved: DashboardWidgetLayout[]): DashboardWidgetLayout[] {
  const known = saved.filter((item) => WIDGET_MAP[item.widgetId])
  const present = new Set(known.map((i) => i.widgetId))
  const appended = WIDGETS.filter((w) => !present.has(w.id)).map((w) => ({
    widgetId: w.id,
    x: w.geometry.x,
    y: w.geometry.y,
    w: w.geometry.w,
    h: w.geometry.h,
  }))
  return [...known, ...appended]
}

export function DashboardGrid({ data }: { data: AdminDashboard | null }) {
  const [layout, setLayout] = useState<DashboardWidgetLayout[]>(DEFAULT_LAYOUT)
  const [savedLayout, setSavedLayout] = useState<DashboardWidgetLayout[]>(DEFAULT_LAYOUT)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const { width, containerRef } = useContainerWidth()

  // Load the admin's saved arrangement once on mount; fall back to default.
  useEffect(() => {
    let alive = true
    fetchDashboardLayout()
      .then((res) => {
        if (!alive) return
        const next = reconcile(res.layout ?? DEFAULT_LAYOUT)
        setLayout(next)
        setSavedLayout(next)
      })
      .catch(() => {
        if (!alive) return
        setLayout(DEFAULT_LAYOUT)
        setSavedLayout(DEFAULT_LAYOUT)
      })
    return () => {
      alive = false
    }
  }, [])

  const rglLayout = useMemo(() => toRgl(layout), [layout])

  // Only the `lg` arrangement is persisted; editing on a stacked mobile
  // breakpoint must not overwrite the desktop layout.
  function handleLayoutChange(_current: Layout, all: ResponsiveLayouts): void {
    if (!editMode) return
    const lg = all.lg
    if (!lg) return
    setLayout((prev) =>
      prev.map((item) => {
        const m = lg.find((l) => l.i === item.widgetId)
        return m ? { ...item, x: m.x, y: m.y, w: m.w, h: m.h } : item
      }),
    )
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      await saveDashboardLayout(layout)
      setSavedLayout(layout)
      setEditMode(false)
      setLayoutError(null)
    } catch (e) {
      setLayoutError(e instanceof Error ? e.message : 'No se pudo guardar la distribución')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel(): void {
    setLayout(savedLayout)
    setEditMode(false)
    setLayoutError(null)
  }

  async function handleRestore(): Promise<void> {
    // Only mutate local state after the backend forgets the saved row, so a
    // failed request never leaves `layout` and `savedLayout` diverged (which
    // would make a subsequent Cancel revert to the old custom arrangement).
    try {
      await resetDashboardLayout()
      setLayout(DEFAULT_LAYOUT)
      setSavedLayout(DEFAULT_LAYOUT)
      setLayoutError(null)
    } catch (e) {
      setLayoutError(e instanceof Error ? e.message : 'No se pudo restaurar el diseño por defecto')
    }
  }

  if (!data) return null

  return (
    <div>
      {/* Edit toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-xs text-[#757874]">
          {editMode
            ? 'Arrastrá y redimensioná los bloques. Guardá para conservar la distribución.'
            : 'Personalizá el orden y tamaño de los bloques desde "Editar dashboard".'}
        </p>
        {editMode ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void handleRestore()} disabled={saving}>
              <RotateCcw size={16} />
              Restaurar por defecto
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
              <X size={16} />
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
              <Save size={16} />
              Guardar distribución
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setEditMode(true)}>
            <Pencil size={16} />
            Editar dashboard
          </Button>
        )}
      </div>

      {layoutError && (
        <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44] mb-4">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <p>{layoutError}</p>
        </div>
      )}

      <div ref={containerRef}>
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={{ lg: rglLayout }}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={CONTAINER_PADDING}
          dragConfig={{ enabled: editMode }}
          resizeConfig={{ enabled: editMode }}
          onLayoutChange={handleLayoutChange}
        >
          {layout
            .filter((item) => WIDGET_MAP[item.widgetId])
            .map((item) => (
              <div
                key={item.widgetId}
                className={
                  editMode
                    ? 'cursor-move rounded-2xl ring-2 ring-[#264c99]/30 ring-offset-1'
                    : undefined
                }
              >
                {WIDGET_MAP[item.widgetId].render(data)}
              </div>
            ))}
        </ResponsiveGridLayout>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, Reorder, motion } from 'motion/react'
import { ChevronUp, ChevronDown, GripVertical, RotateCcw, X, Lock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { cardSurface } from '../ui/Card'
import { dialog, scrim } from '../ui/motion'
import { useNavPreferences } from '../../hooks/useNavPreferences'
import { PINNED_TABS } from './navItems'

export interface OrderableEntry {
  key: string
  label: string
  icon: LucideIcon
}

interface PersonalizarNavProps {
  /** Destinos de la barra, ya filtrados por los permisos del socio. */
  tabs: OrderableEntry[]
  /** Accesos rápidos, ya filtrados por los permisos del socio. */
  quick: OrderableEntry[]
  onClose: () => void
}

/**
 * Una lista reordenable.
 *
 * Se puede arrastrar, pero arrastrar NUNCA es la única forma: cada fila lleva
 * botones de subir y bajar. Un gesto de arrastre no existe para quien navega
 * con teclado ni para quien usa un lector de pantalla, así que sin esos botones
 * la personalización quedaría reservada a quien puede usar un puntero.
 */
function OrderableList({
  entries,
  onChange,
  pinnedKeys,
}: {
  entries: OrderableEntry[]
  onChange: (next: OrderableEntry[]) => void
  pinnedKeys?: string[]
}) {
  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= entries.length) return
    const next = [...entries]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  return (
    <Reorder.Group axis="y" values={entries} onReorder={onChange} className="flex flex-col gap-2">
      {entries.map((entry, index) => {
        const Icon = entry.icon
        const isPinned = pinnedKeys?.includes(entry.key)
        return (
          <Reorder.Item
            key={entry.key}
            value={entry}
            className={`${cardSurface} flex items-center gap-3 p-3 cursor-grab active:cursor-grabbing`}
          >
            <GripVertical size={16} className="text-outline shrink-0" aria-hidden="true" />
            <Icon size={18} className="text-primary shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0 text-body-medium font-semibold text-on-surface truncate">
              {entry.label}
            </span>

            {isPinned && (
              <span
                className="inline-flex items-center gap-1 text-label-caps uppercase tracking-[0.05em] font-bold text-on-surface-variant shrink-0"
                title="Siempre visible"
              >
                <Lock size={11} aria-hidden="true" />
                Fijo
              </span>
            )}

            <span className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Subir ${entry.label}`}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === entries.length - 1}
                aria-label={`Bajar ${entry.label}`}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </span>
          </Reorder.Item>
        )
      })}
    </Reorder.Group>
  )
}

export function PersonalizarNav({ tabs, quick, onClose }: PersonalizarNavProps) {
  const { save, reset, error } = useNavPreferences()
  const [tabOrder, setTabOrder] = useState(tabs)
  const [quickOrder, setQuickOrder] = useState(quick)
  const [saving, setSaving] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    await save({ tabs: tabOrder.map((t) => t.key), quick: quickOrder.map((q) => q.key) })
    setSaving(false)
    onClose()
  }

  async function handleReset() {
    setSaving(true)
    await reset()
    setSaving(false)
    onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-alpine-dark/60 backdrop-blur-sm p-4"
        onClick={onClose}
        variants={scrim}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="personalizar-nav-title"
          className={`${cardSurface} w-full max-w-md p-4 pb-safe max-h-[85vh] overflow-y-auto`}
          onClick={(event) => event.stopPropagation()}
          variants={dialog}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-outline-variant/40 mb-4">
            <h2 id="personalizar-nav-title" className="text-headline-md font-bold text-on-surface">
              Personalizar navegación
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar personalización"
              className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Cada lista es una región con nombre: con dos listas reordenables
              en el mismo diálogo, un lector de pantalla necesita poder decir en
              cuál de las dos está parado. */}
          <section className="mb-5" aria-label="Barra de navegación">
            <h3 className="text-label-caps uppercase tracking-[0.1em] text-on-surface-variant/80 mb-2">
              Barra de navegación
            </h3>
            <OrderableList entries={tabOrder} onChange={setTabOrder} pinnedKeys={PINNED_TABS} />
            <p className="text-body-sm text-on-surface-variant mt-2">
              Inicio y Contacto SOS no se pueden quitar: el acceso a emergencias tiene que estar
              siempre donde lo buscas.
            </p>
          </section>

          <section className="mb-5" aria-label="Accesos rápidos">
            <h3 className="text-label-caps uppercase tracking-[0.1em] text-on-surface-variant/80 mb-2">
              Accesos rápidos
            </h3>
            <OrderableList entries={quickOrder} onChange={setQuickOrder} />
            <p className="text-body-sm text-on-surface-variant mt-2">
              Los primeros quedan a un toque en el inicio; el resto, dentro de “Ver más”.
            </p>
          </section>

          {error && (
            <p role="alert" className="text-body-sm text-error mb-3">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => void handleReset()} disabled={saving}>
              <RotateCcw size={15} aria-hidden="true" />
              Restablecer
            </Button>
            <Button variant="primary" size="md" onClick={() => void handleSave()} loading={saving}>
              Guardar
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

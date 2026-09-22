import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Siren,
  CalendarDays,
  BookOpen,
  LayoutDashboard,
  UserPlus,
  IdCard,
  MoreHorizontal,
  ChevronRight,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cardSurface, cardInteractive } from '../ui/Card'
import { SectionLabel } from '../ui/SectionLabel'

interface QuickAccessProps {
  isDesktop: boolean
  isAdmin: boolean
  locked: boolean
  canSeeDocumentos: boolean
  puedeInvitar: boolean
  memberBadge: string
  /** null mientras carga o si la consulta falló: entonces no se pinta insignia. */
  eventosProximos: number | null
  onContactos: () => void
  onEventos: () => void
  onDocumentos: () => void
  onAdminPanel: () => void
  onInvitar: () => void
  onNewIntegrante: () => void
}

interface QuickItem {
  key: string
  title: string
  /** Etiqueta corta para el mosaico mobile, donde no cabe el título largo. */
  shortLabel: string
  description: string
  ariaLabel: string
  icon: LucideIcon
  /** Clases del pozo del icono. */
  well: string
  badge?: ReactNode
  emergency?: boolean
  onClick: () => void
}

function Tag({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-label-caps font-bold uppercase tracking-[0.05em] ${tone}`}
    >
      {children}
    </span>
  )
}

export function QuickAccess({
  isDesktop,
  isAdmin,
  locked,
  canSeeDocumentos,
  puedeInvitar,
  memberBadge,
  eventosProximos,
  onContactos,
  onEventos,
  onDocumentos,
  onAdminPanel,
  onInvitar,
  onNewIntegrante,
}: QuickAccessProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const closeSheet = useCallback(() => setSheetOpen(false), [])

  useEffect(() => {
    if (!sheetOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKeyDown)
    closeButtonRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sheetOpen, closeSheet])

  // ── Una sola definición de los accesos; abajo se pinta de dos formas ───────
  // "primary" son los destinos de consulta; "secondary" son acciones de gestión
  // que en el boceto desktop viven en su propia fila y en mobile caen al
  // desplegable "Ver más".
  const primary: QuickItem[] = [
    {
      key: 'contactos',
      title: 'Contactos Esenciales',
      shortLabel: 'Contacto SOS',
      description: 'Socorro Andino, SAMU y GOPE',
      ariaLabel: 'Abrir contactos esenciales de emergencia',
      icon: Siren,
      well: 'bg-error-container text-on-error-container',
      badge: <Tag tone="bg-error-container text-on-error-container">SOS 136</Tag>,
      emergency: true,
      onClick: onContactos,
    },
    {
      key: 'eventos',
      title: 'Eventos & Salidas Club',
      shortLabel: 'Eventos',
      description: 'Calendario y cupos abiertos',
      ariaLabel: 'Abrir eventos del club',
      icon: CalendarDays,
      well: 'bg-primary-fixed text-on-primary-fixed',
      badge:
        eventosProximos && eventosProximos > 0 ? (
          <Tag tone="bg-primary-fixed text-on-primary-fixed">
            {eventosProximos} {eventosProximos === 1 ? 'Próximo' : 'Próximos'}
          </Tag>
        ) : undefined,
      onClick: onEventos,
    },
    ...(canSeeDocumentos
      ? [
          {
            key: 'documentos',
            title: 'Documentación del Club',
            shortLabel: 'Documentación',
            description: 'Matrices de riesgo, check-lists y glosario',
            ariaLabel: 'Abrir documentación del club',
            icon: BookOpen,
            well: 'bg-secondary-fixed text-on-secondary-fixed',
            badge: (
              <Tag tone="bg-secondary-fixed text-on-secondary-fixed">Socios {memberBadge}</Tag>
            ),
            onClick: onDocumentos,
          } satisfies QuickItem,
        ]
      : []),
    ...(isAdmin
      ? [
          {
            key: 'admin',
            title: 'Panel de Administración',
            shortLabel: 'Administración',
            description: 'Gestionar salidas y socios',
            ariaLabel: 'Abrir panel de administración',
            icon: LayoutDashboard,
            well: 'bg-surface-container-high text-on-surface',
            badge: <Tag tone="bg-surface-container-highest text-on-surface">Admin</Tag>,
            onClick: onAdminPanel,
          } satisfies QuickItem,
        ]
      : []),
  ]

  const secondary: QuickItem[] = [
    ...(puedeInvitar
      ? [
          {
            key: 'invitar',
            title: 'Invitar a un Socio',
            shortLabel: 'Invitar',
            description: 'Generar enlace de acceso para el registro',
            ariaLabel: 'Invitar al club',
            icon: UserPlus,
            well: 'bg-primary-fixed text-on-primary-fixed',
            onClick: onInvitar,
          } satisfies QuickItem,
        ]
      : []),
    ...(locked || isAdmin
      ? [
          {
            key: 'integrante',
            title: locked ? 'Completar mi Ficha' : 'Registrar Integrante',
            shortLabel: locked ? 'Mi Ficha' : 'Integrante',
            description: locked
              ? 'Completa tu registro para usar la aplicación'
              : 'Crear ficha sin necesidad de asociar una salida',
            ariaLabel: locked ? 'Completar mi ficha de integrante' : 'Registrar nuevo integrante',
            icon: IdCard,
            well: 'bg-surface-container-high text-on-surface',
            onClick: onNewIntegrante,
          } satisfies QuickItem,
        ]
      : []),
  ]

  // ── Desktop: 4 tarjetas ricas + una fila de acciones de gestión ───────────
  if (isDesktop) {
    return (
      <section>
        <SectionLabel>Herramientas &amp; Recursos Rápidos</SectionLabel>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {primary.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                aria-label={item.ariaLabel}
                className={`${cardSurface} ${cardInteractive} group p-4 flex flex-col justify-between gap-3 text-left rounded-xl`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${item.well}`}
                  >
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  {item.badge}
                </div>
                <div>
                  <h3
                    className={`text-body-medium font-bold text-on-surface transition-colors ${
                      item.emergency ? 'group-hover:text-error' : 'group-hover:text-primary'
                    }`}
                  >
                    {item.title}
                  </h3>
                  <p className="text-body-sm text-on-surface-variant mt-0.5">{item.description}</p>
                </div>
              </button>
            )
          })}
        </div>

        {secondary.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
            {secondary.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  aria-label={item.ariaLabel}
                  className={`${cardSurface} ${cardInteractive} px-4 py-3 flex items-center justify-between gap-3 text-left rounded-xl`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.well}`}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body-sm font-bold text-on-surface leading-tight">
                        {item.title}
                      </span>
                      <span className="block text-label-caps text-on-surface-variant mt-0.5">
                        {item.description}
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-on-surface-variant shrink-0" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  // ── Mobile: mosaico de iconos; lo que no entra cae en "Ver más" ───────────
  const all = [...primary, ...secondary]
  const needsSheet = all.length > 4
  const tiles = needsSheet ? primary.slice(0, 3) : all
  const overflow = needsSheet ? [...primary.slice(3), ...secondary] : []

  return (
    <section>
      <SectionLabel>Accesos Rápidos</SectionLabel>

      <div className="grid grid-cols-4 gap-2">
        {tiles.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              aria-label={item.ariaLabel}
              className={`${cardSurface} flex flex-col items-center justify-start gap-1.5 p-2 pt-3 rounded-xl min-h-[88px] text-center active:bg-surface-container-low transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
            >
              <span
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${item.well}`}
              >
                <Icon size={20} aria-hidden="true" />
              </span>
              <span
                className={`text-label-caps leading-tight ${
                  item.emergency ? 'font-bold text-error' : 'font-semibold text-on-surface'
                }`}
              >
                {item.shortLabel}
              </span>
            </button>
          )
        })}

        {needsSheet && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className={`${cardSurface} flex flex-col items-center justify-start gap-1.5 p-2 pt-3 rounded-xl min-h-[88px] text-center active:bg-surface-container-low transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
          >
            <span className="w-10 h-10 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center shrink-0">
              <MoreHorizontal size={20} aria-hidden="true" />
            </span>
            <span className="text-label-caps font-semibold text-on-surface leading-tight">
              Ver más
            </span>
          </button>
        )}
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-alpine-dark/60 backdrop-blur-sm p-4"
          onClick={closeSheet}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="accesos-adicionales-title"
            className={`${cardSurface} w-full max-w-md p-4 pb-safe`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-outline-variant/40 mb-3">
              <h2 id="accesos-adicionales-title" className="text-headline-md font-bold text-on-surface">
                Accesos Adicionales
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeSheet}
                aria-label="Cerrar accesos adicionales"
                className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              {overflow.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      closeSheet()
                      item.onClick()
                    }}
                    aria-label={item.ariaLabel}
                    className="flex items-center gap-3 p-3 rounded-lg text-left hover:bg-surface-container-low transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.well}`}
                    >
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-title-md font-semibold text-on-surface leading-tight">
                        {item.title}
                      </span>
                      <span className="block text-body-sm text-on-surface-variant">
                        {item.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

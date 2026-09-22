import { LayoutGrid, CalendarDays, BookOpen, Siren } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Destinos de navegación del shell.
 *
 * El boceto mobile propone "Inicio · Salidas · Rutas · Contacto SOS". Acá se
 * ajusta a lo que la app realmente tiene: "Rutas" no existe como pantalla, y
 * "Salidas" apuntaría a una sección del propio Inicio, no a otro destino — dos
 * pestañas al mismo lugar son ruido, no navegación. Quedan cuatro destinos
 * reales, que es también el máximo cómodo para una barra inferior.
 */
export type NavKey = 'inicio' | 'eventos' | 'documentos' | 'contactos'

export interface NavItem {
  key: NavKey
  /** Etiqueta corta de la barra inferior y del header. */
  label: string
  icon: LucideIcon
  /** Solo "Contacto SOS" es de emergencia; tiñe el ítem de rojo. */
  emergency?: boolean
}

const ALL_ITEMS: NavItem[] = [
  { key: 'inicio', label: 'Inicio', icon: LayoutGrid },
  { key: 'eventos', label: 'Eventos', icon: CalendarDays },
  { key: 'documentos', label: 'Documentación', icon: BookOpen },
  { key: 'contactos', label: 'Contacto SOS', icon: Siren, emergency: true },
]

/**
 * La documentación del club es exclusiva de socios del club que consulta (ver
 * esSocioDelClub en lib/club-brand.ts) y de admin: si el usuario no la puede
 * abrir, el destino no aparece en vez de aparecer y fallar al tocarlo.
 */
export function visibleNavItems(canSeeDocumentos: boolean): NavItem[] {
  return ALL_ITEMS.filter((item) => item.key !== 'documentos' || canSeeDocumentos)
}

/**
 * Destinos que no se pueden mover fuera de la barra.
 *
 * Es el espejo de PINNED_TABS en el backend, que es quien lo garantiza de
 * verdad. Acá está para que la interfaz de personalización no ofrezca quitarlos
 * y después el servidor los reponga en silencio.
 */
export const PINNED_TABS: NavKey[] = ['inicio', 'contactos']

/**
 * Aplica un orden guardado a una lista de destinos.
 *
 * La preferencia es SOLO orden, nunca visibilidad: lo que un socio puede abrir
 * lo deciden los gates de rol al renderizar, no lo que tenga guardado. Por eso
 * un destino que no figure en el orden guardado no desaparece — va al final.
 * Así, cuando se agregue un destino nuevo, quien ya había personalizado lo ve
 * igual en vez de quedarse sin enterarse de que existe.
 */
export function applyOrder<T extends { key: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((key, index) => [key, index]))
  return [...items].sort(
    (a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  )
}

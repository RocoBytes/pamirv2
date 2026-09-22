import { useOrganization } from '../../hooks/useOrganization'

/**
 * Pie de página (solo desktop).
 *
 * El boceto cierra con "Pamir v2 · Club Alemán Andino · © 2025 Pamir Alpine
 * Platform". Acá no puede ir ningún wordmark de producto: la app es white-label
 * y un socio de otro club no debe ver la marca de otro (ver el barrido
 * expectNoPamirLeak en e2e/branding.spec.ts). Queda el nombre del club propio y
 * el dato que de verdad importa tener siempre a la vista en montaña: el número
 * de Socorro Andino.
 */
export function AppFooter() {
  const { displayName } = useOrganization()

  return (
    <footer className="w-full bg-surface-container-lowest border-t border-outline-variant/40 py-6 mt-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-body-sm text-on-surface-variant">
        <span className="font-bold text-on-surface">{displayName}</span>
        <a
          href="tel:136"
          className="inline-flex items-center gap-1.5 font-bold text-error hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
        >
          Socorro Andino: 136
        </a>
      </div>
    </footer>
  )
}

import { cardSurface } from './Card'

/**
 * Marcador de carga con la forma del contenido que viene.
 *
 * Un spinner dice "esperá" y nada más; un esqueleto además dice cuánto va a
 * llegar y dónde, así que la página no salta cuando los datos entran. Se usa a
 * partir de ~300ms de espera: por debajo de eso alcanza con no mostrar nada,
 * porque un destello de esqueleto se percibe como un parpadeo.
 *
 * `animate-pulse` de Tailwind anima solo opacidad, y motion-reduce la desactiva.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface-container motion-safe:animate-pulse rounded ${className}`}
      aria-hidden="true"
    />
  )
}

/** Esqueleto con la silueta de una SalidaCard. */
export function SalidaCardSkeleton() {
  return (
    <div className={`${cardSurface} p-4 sm:p-5`} aria-hidden="true">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-10 rounded-md" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-4 w-28 mt-2" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-28" />
      </div>
    </div>
  )
}

/**
 * Lista de esqueletos.
 *
 * Lleva role="status" y un texto solo para lectores de pantalla: la forma
 * comunica la espera a quien ve, y este anuncio hace lo mismo para quien no.
 */
export function SalidasLoadingList({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-3" role="status" aria-live="polite">
      <span className="sr-only">Cargando salidas...</span>
      {Array.from({ length: count }, (_, i) => (
        <SalidaCardSkeleton key={i} />
      ))}
    </div>
  )
}

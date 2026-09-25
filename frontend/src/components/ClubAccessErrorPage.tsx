// Pantalla compartida por los tres casos de la tabla de routing donde la
// sesión existe pero NO puede entrar al club del path: no es socio (403),
// el club no existe (404), o el club está suspendido (403, mismo status que
// "no soy socio" — se distinguen solo por el texto, que es el que el propio
// backend ya devuelve — ver Ruling 5 del plan de PR 4a).
import { AlertCircle, LogOut } from 'lucide-react'
import { ClubLogo } from './ClubLogo'
import { Button } from './ui/Button'
import type { OrganizationBrand } from '../types/salida'

interface ClubAccessErrorPageProps {
  status: 403 | 404
  message: string
  // null si el slug no resolvió ninguna marca pública (p.ej. 404 real) — la
  // pantalla queda con el logo neutral.
  org: OrganizationBrand | null
  onLogout: () => void
  // Siempre provisto desde la Decisión del 2026-09-25: la raíz sin slug ya
  // no redirige transparentemente de vuelta a /<slug> con una sola
  // membresía (ese efecto se eliminó de App.tsx), así que "Mis clubes" nunca
  // es un callejón sin salida. Se deja opcional solo para no forzar un valor
  // en cada caller.
  onMisClubes?: () => void
}

export function ClubAccessErrorPage({ status, message, org, onLogout, onMisClubes }: ClubAccessErrorPageProps) {
  return (
    <div className="min-h-screen bg-alpine-canvas flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-secondary/15 p-6 text-center flex flex-col items-center gap-4">
        <ClubLogo org={org} alt="" className="w-14 h-14 object-contain" />
        <AlertCircle size={32} className="text-error" />
        <h1 className="text-headline-lg text-slate-800">No se pudo abrir el club</h1>
        <p className="text-sm text-slate-700" role="alert">{message}</p>
        <div className="flex flex-col gap-2 w-full">
          {onMisClubes && <Button fullWidth onClick={onMisClubes}>Mis clubes</Button>}
          <Button variant={onMisClubes ? 'ghost' : 'primary'} fullWidth onClick={onLogout}>
            <LogOut size={16} />
            Cerrar sesión
          </Button>
        </div>
        {/* status se usa solo para el test/lector de errores futuro — el
            texto ya lo explica todo a la persona. */}
        <span className="sr-only">Código {status}</span>
      </div>
    </div>
  )
}

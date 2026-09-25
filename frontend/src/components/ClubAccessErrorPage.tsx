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
  // undefined cuando "Mis clubes" no sería una salida real: la cuenta tiene
  // (según el caché de la sesión) una única membresía y es justo la que
  // acaba de rechazarla — la raíz sin slug la redirigiría transparentemente
  // de vuelta a esta misma pantalla (App.tsx decide esto, ver el comentario
  // junto a donde arma este componente). NO depende de si esa membresía
  // cacheada figura suspendida o no: clubAccessError ya implica que el /me
  // de montaje para este path falló, así que el caché está sin verificar
  // (pudo revocarse o suspenderse del lado del servidor después del login)
  // — el callejón sin salida es igual de real aunque el campo cacheado
  // todavía diga false (Ruling del round 2 de review de esta PR). En ese
  // caso el botón no se pinta y "Cerrar sesión" pasa a ser la acción
  // primaria, para que la pantalla nunca sea un callejón sin salida.
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

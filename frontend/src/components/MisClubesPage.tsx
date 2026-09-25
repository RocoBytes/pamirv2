// "Mis clubes": se muestra en riala.cl (sin slug) cuando la cuenta tiene más
// de una membresía — ver la tabla de routing en
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
// Alcance de esta PR (4a): funcional y accesible, sin la pulida visual
// (badges de club suspendido con más detalle, animaciones) que PR 4b agrega
// sobre este mismo componente — ver Ruling 4 del plan de PR 4a.
import { LogOut } from 'lucide-react'
import { ClubLogo } from './ClubLogo'
import { Button } from './ui/Button'
import { clubDisplayName } from '../lib/club-brand'
import type { ClubMembership } from '../types/salida'

interface MisClubesPageProps {
  clubes: ClubMembership[]
  onLogout: () => void
}

export function MisClubesPage({ clubes, onLogout }: MisClubesPageProps) {
  return (
    <div className="min-h-screen bg-alpine-canvas flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-headline-lg text-slate-800">Mis clubes</h1>
          <p className="text-sm text-on-surface-variant">Elige a qué club quieres entrar.</p>
        </div>

        <ul className="flex flex-col gap-3">
          {clubes.map((club) => (
            <li key={club.slug}>
              {club.suspendido ? (
                <div
                  className="w-full flex items-center gap-3 rounded-2xl border border-secondary/15 bg-surface-container-low p-4 opacity-60"
                  aria-disabled="true"
                >
                  <ClubLogo org={club} alt="" className="w-11 h-11 object-contain shrink-0" />
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="font-bold text-slate-700 truncate">{clubDisplayName(club)}</span>
                    <span className="text-xs font-semibold text-error">Suspendido</span>
                  </div>
                </div>
              ) : (
                <a
                  href={`/${club.slug}`}
                  className="w-full flex items-center gap-3 rounded-2xl border border-secondary/15 bg-white shadow-sm p-4 hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ClubLogo org={club} alt="" className="w-11 h-11 object-contain shrink-0" />
                  <span className="font-bold text-slate-800 truncate text-left">{clubDisplayName(club)}</span>
                </a>
              )}
            </li>
          ))}
        </ul>

        <Button variant="ghost" onClick={onLogout} className="self-center">
          <LogOut size={16} />
          Cerrar sesión
        </Button>
      </div>
    </div>
  )
}

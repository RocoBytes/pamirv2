import { UserPlus } from 'lucide-react'
import { AppShell, type ShellContext } from '../shell/AppShell'
import { InvitacionesManager } from './InvitacionesManager'
import type { Rol } from '../../types/invitacion'

interface InvitarPageProps {
  rolActual: Rol
  onBack: () => void
  shell: ShellContext
}

export function InvitarPage({ rolActual, onBack, shell }: InvitarPageProps) {
  return (
    <AppShell shell={shell} active="none" onBack={onBack} width="narrow">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-secondary text-label-caps uppercase tracking-[0.1em] font-bold mb-1">
          <UserPlus size={14} aria-hidden="true" />
          Sistema cerrado por invitación
        </div>
        <h1 className="text-headline-lg font-bold text-on-surface">Invitar al club</h1>
        <p className="text-body-base text-on-surface-variant mt-0.5">
          Envía una invitación por correo para que la persona cree su cuenta.
        </p>
      </div>

      <InvitacionesManager rolActual={rolActual} />
    </AppShell>
  )
}

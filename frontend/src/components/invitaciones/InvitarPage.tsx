import { ArrowLeft, UserPlus } from 'lucide-react'
import logoPamir from '../../assets/logo_PAMIR.png'
import { Button } from '../ui/Button'
import { InvitacionesManager } from './InvitacionesManager'
import type { Rol } from '../../types/invitacion'

interface InvitarPageProps {
  rolActual: Rol
  onBack: () => void
}

export function InvitarPage({ rolActual, onBack }: InvitarPageProps) {
  return (
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
            <span className="font-bold text-slate-900 text-lg">Pamir</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={16} />
            Volver
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
            <UserPlus size={14} />
            Sistema cerrado por invitación
          </div>
          <h1 className="text-xl font-bold text-slate-900">Invitar al club</h1>
          <p className="text-sm text-[#757874] mt-0.5">
            Envía una invitación por correo para que la persona cree su cuenta.
          </p>
        </div>

        <InvitacionesManager rolActual={rolActual} />
      </main>
    </div>
  )
}

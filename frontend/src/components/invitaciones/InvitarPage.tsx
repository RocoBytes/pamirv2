import { useState } from 'react'
import { UserPlus, Mail, QrCode } from 'lucide-react'
import { AppShell, type ShellContext } from '../shell/AppShell'
import { InvitacionesManager } from './InvitacionesManager'
import { CodigosQrManager } from './CodigosQrManager'
import type { Rol } from '../../types/invitacion'

interface InvitarPageProps {
  rolActual: Rol
  onBack: () => void
  shell: ShellContext
}

type Tab = 'correo' | 'qr'

const TABS: { key: Tab; label: string; icon: typeof Mail }[] = [
  { key: 'correo', label: 'Por correo', icon: Mail },
  { key: 'qr', label: 'QR del club', icon: QrCode },
]

export function InvitarPage({ rolActual, onBack, shell }: InvitarPageProps) {
  const [tab, setTab] = useState<Tab>('correo')

  return (
    <AppShell shell={shell} active="none" onBack={onBack} width="narrow">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-secondary text-label-caps uppercase tracking-[0.1em] font-bold mb-1">
          <UserPlus size={14} aria-hidden="true" />
          Sistema cerrado por invitación
        </div>
        <h1 className="text-headline-lg font-bold text-on-surface">Invitar al club</h1>
        <p className="text-body-base text-on-surface-variant mt-0.5">
          Envía una invitación por correo, o genera un QR reusable para que varias personas se unan a la vez.
        </p>
      </div>

      <div role="tablist" aria-label="Forma de invitar" className="flex gap-1 mb-5 bg-surface-container-low rounded-xl p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={[
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              tab === key
                ? 'bg-white text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-slate-700',
            ].join(' ')}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div id="panel-correo" role="tabpanel" aria-labelledby="tab-correo" hidden={tab !== 'correo'}>
        <InvitacionesManager rolActual={rolActual} />
      </div>
      <div id="panel-qr" role="tabpanel" aria-labelledby="tab-qr" hidden={tab !== 'qr'}>
        <CodigosQrManager rolActual={rolActual} />
      </div>
    </AppShell>
  )
}

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createPortal } from 'react-dom'
import { AlertTriangle, UserPlus, X } from 'lucide-react'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

// RUT already validated by the picker before this modal opens; kept here for safety.
const RUT_COMPLETE_REGEX = /^\d{1,2}\.\d{3}\.\d{3}-[\dKk]$/

export interface ExpressParticipantePayload {
  rut: string
  nombre: string
  telefono: string
  email: string
}

// ─── Modal 1: responsibility warning ──────────────────────────────────────────

interface ExpressResponsibilityModalProps {
  onCancel: () => void
  onConfirm: () => void
}

export function ExpressResponsibilityModal({ onCancel, onConfirm }: ExpressResponsibilityModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="express-responsibility-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[#A4636E]/20 bg-[#f5e8ea]">
          <AlertTriangle size={22} className="text-[#8b3a44] shrink-0 mt-0.5" />
          <h2 id="express-responsibility-title" className="text-base font-bold text-[#8b3a44] leading-snug">
            Participantes sin ficha registrada — responsabilidad del líder
          </h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            Si estás agregando personas que aún no han creado su ficha en el sistema, como responsable
            de la salida debes conocer y tener a mano su información de salud relevante: enfermedades
            preexistentes, medicación habitual y alergias. Esta información es fundamental para actuar
            correctamente ante una emergencia en terreno. Al confirmar su participación, estás asumiendo
            esta responsabilidad.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Confirmar y agregar participante
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Modal 2: express participant form ────────────────────────────────────────

const expressSchema = z.object({
  rut: z.string().regex(RUT_COMPLETE_REGEX, 'Formato inválido. Ej: 12.345.678-K'),
  nombreCompleto: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
  telefono: z.string().min(1, 'Campo requerido').max(20, 'Máximo 20 caracteres'),
  email: z.string().min(1, 'Campo requerido').email('Email inválido').max(100, 'Máximo 100 caracteres'),
})

type ExpressFormData = z.infer<typeof expressSchema>

interface IntegranteExpressModalProps {
  initialRut: string
  onCancel: () => void
  onSubmit: (data: ExpressParticipantePayload) => void
}

export function IntegranteExpressModal({ initialRut, onCancel, onSubmit }: IntegranteExpressModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ExpressFormData>({
    resolver: zodResolver(expressSchema),
    defaultValues: { rut: initialRut, nombreCompleto: '', telefono: '', email: '' },
  })

  function submit(data: ExpressFormData) {
    onSubmit({
      rut: data.rut,
      nombre: data.nombreCompleto.trim(),
      telefono: data.telefono.trim(),
      email: data.email.trim(),
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="express-form-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-4 border-b border-[#4a6fad]/15 bg-[#f0f4fb]">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-[#8b3a44] shrink-0" />
            <h2 id="express-form-title" className="text-base font-bold text-[#264c99]">
              Participante express
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4 px-5 py-4">
          <p className="text-xs text-[#757874] leading-relaxed">
            Persona sin ficha registrada. Quedará asociada solo a esta salida, identificada como
            <span className="font-semibold text-[#8b3a44]"> Express</span>.
          </p>

          <Input
            label="RUT"
            readOnly
            error={errors.rut?.message}
            className="bg-[#f0f4fb] text-[#757874] cursor-not-allowed font-mono"
            {...register('rut')}
          />
          <Input
            label="Nombre completo"
            placeholder="Nombre y apellidos"
            required
            error={errors.nombreCompleto?.message}
            {...register('nombreCompleto')}
          />
          <Input
            label="Teléfono"
            type="tel"
            placeholder="+56 9 1234 5678"
            required
            error={errors.telefono?.message}
            {...register('telefono')}
          />
          <Input
            label="Correo electrónico"
            type="email"
            placeholder="persona@correo.com"
            required
            error={errors.email?.message}
            {...register('email')}
          />

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={isSubmitting}>
              Agregar participante
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

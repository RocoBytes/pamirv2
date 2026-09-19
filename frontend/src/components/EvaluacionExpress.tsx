import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Mountain,
} from 'lucide-react'
import logoPamir from '../assets/logo_PAMIR.png'

import { fetchEvaluacion, submitEvaluacion } from '../lib/api'
import type { EvaluacionInfo } from '../lib/api'
import { Button } from './ui/Button'

const evaluacionSchema = z.object({
  notaObjetivos: z
    .number({ error: 'Selecciona una calificación' })
    .int()
    .min(1)
    .max(5),
  notaItinerario: z
    .number({ error: 'Selecciona una calificación' })
    .int()
    .min(1)
    .max(5),
  notaLider: z
    .number({ error: 'Selecciona una calificación' })
    .int()
    .min(1)
    .max(5),
  comentario: z.string().max(2000, 'Máximo 2000 caracteres').optional(),
})

type EvaluacionFormValues = z.infer<typeof evaluacionSchema>

interface NotaFieldProps {
  legend: string
  labelMin: string
  labelMax: string
  value?: number
  error?: string
  onChange: (n: number) => void
}

function NotaField({ legend, labelMin, labelMax, value, error, onChange }: NotaFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">
        {legend}
        <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
      </legend>
      <div className="flex items-center justify-between gap-1 text-xs text-[#757874] mb-1">
        <span>1 &mdash; {labelMin}</span>
        <span>5 &mdash; {labelMax}</span>
      </div>
      <div className="flex gap-2">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              'flex-1 py-3 rounded-xl border text-sm font-bold transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]/40',
              value === n
                ? 'bg-[#264c99] border-[#264c99] text-white'
                : 'bg-white border-[#4a6fad]/30 text-slate-700 hover:border-[#264c99]/40 hover:bg-[#f5f8f5]',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2.5">
          <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
          <span className="font-bold text-slate-900 text-lg">Pamir</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  )
}

function CenteredMessage({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-16 gap-4 text-center">
      {icon}
      <div>
        <p className="font-semibold text-slate-700">{title}</p>
        <p className="text-sm text-[#757874] mt-1 max-w-sm">{text}</p>
      </div>
    </div>
  )
}

interface EvaluacionExpressProps {
  token: string
}

export function EvaluacionExpress({ token }: EvaluacionExpressProps) {
  const [info, setInfo] = useState<EvaluacionInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EvaluacionFormValues>({
    resolver: zodResolver(evaluacionSchema),
    defaultValues: { comentario: '' },
  })

  const comentarioVal = watch('comentario') ?? ''

  useEffect(() => {
    fetchEvaluacion(token)
      .then(setInfo)
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la evaluación')
      })
      .finally(() => setIsLoading(false))
  }, [token])

  const onSubmit = async (values: EvaluacionFormValues) => {
    setSubmitError(null)
    try {
      await submitEvaluacion(token, {
        notaObjetivos: values.notaObjetivos,
        notaItinerario: values.notaItinerario,
        notaLider: values.notaLider,
        comentario: values.comentario?.trim() || undefined,
      })
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo enviar la evaluación')
    }
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#757874]">
          <Loader2 className="animate-spin text-[#264c99]" size={28} />
          <p className="text-sm">Cargando evaluación...</p>
        </div>
      </Shell>
    )
  }

  if (loadError || !info) {
    return (
      <Shell>
        <CenteredMessage
          icon={<AlertCircle size={32} className="text-[#A4636E]" />}
          title="Enlace no válido"
          text="Esta evaluación no existe o el enlace es incorrecto. Revisa el correo que recibiste e intenta nuevamente."
        />
      </Shell>
    )
  }

  if (submitted) {
    return (
      <Shell>
        <CenteredMessage
          icon={<CheckCircle2 size={36} className="text-emerald-600" />}
          title="¡Gracias por tu evaluación!"
          text="Tu respuesta anónima fue registrada. Con tu feedback el club puede seguir mejorando sus salidas."
        />
      </Shell>
    )
  }

  if (info.used) {
    return (
      <Shell>
        <CenteredMessage
          icon={<CheckCircle2 size={36} className="text-emerald-600" />}
          title="Esta evaluación ya fue respondida"
          text="El enlace es de un solo uso y ya registramos una respuesta para él. ¡Gracias por participar!"
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="mb-5">
        <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
          <Mountain size={14} />
          Evaluación express de salida
        </div>
        <h1 className="text-xl font-bold text-slate-900">{info.nombreActividad}</h1>
        <p className="text-sm text-[#757874] mt-0.5">
          Solo te tomará 1 minuto.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-[#e8eef7] border border-[#264c99]/20 p-3 mb-6 text-sm text-[#264c99]">
        <ShieldCheck size={18} className="shrink-0 mt-0.5" />
        <p>
          Esta evaluación es <strong>anónima</strong>: tu respuesta no queda asociada a tu
          nombre ni a tu correo.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6 bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 sm:p-6">
        <Controller
          control={control}
          name="notaObjetivos"
          render={({ field }) => (
            <NotaField
              legend="¿Se cumplieron tus objetivos y expectativas?"
              labelMin="Para nada"
              labelMax="Totalmente"
              value={field.value}
              error={errors.notaObjetivos?.message}
              onChange={field.onChange}
            />
          )}
        />

        <Controller
          control={control}
          name="notaItinerario"
          render={({ field }) => (
            <NotaField
              legend="¿Consideras que se cumplió el itinerario?"
              labelMin="No se cumplió"
              labelMax="Se cumplió por completo"
              value={field.value}
              error={errors.notaItinerario?.message}
              onChange={field.onChange}
            />
          )}
        />

        <Controller
          control={control}
          name="notaLider"
          render={({ field }) => (
            <NotaField
              legend="¿Cómo evalúas al líder/responsable de la salida?"
              labelMin="Deficiente"
              labelMax="Excelente"
              value={field.value}
              error={errors.notaLider?.message}
              onChange={field.onChange}
            />
          )}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="comentario" className="text-sm font-semibold text-[#264c99]">
            ¿Tienes comentarios que quieras dar o algo que agregar?
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#4a6fad] bg-[#e8eef7] px-2 py-0.5 rounded-md">
              Anónimo · Opcional
            </span>
          </label>
          <textarea
            id="comentario"
            rows={4}
            placeholder="Situaciones o actitudes observadas, sugerencias, reconocimientos..."
            {...register('comentario')}
            className="w-full rounded-xl border border-[#4a6fad]/30 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-[#757874]/60 focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 resize-y"
          />
          <div className="flex items-center justify-between">
            {errors.comentario ? (
              <p className="text-xs text-[#A4636E]" role="alert">{errors.comentario.message}</p>
            ) : <span />}
            <span
              className={[
                'text-xs tabular-nums',
                comentarioVal.length > 1800 ? 'text-[#A4636E]' : 'text-[#757874]',
              ].join(' ')}
            >
              {comentarioVal.length} / 2000
            </span>
          </div>
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44]">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{submitError}</p>
          </div>
        )}

        <Button type="submit" loading={isSubmitting} fullWidth>
          {isSubmitting ? 'Enviando...' : 'Enviar evaluación anónima'}
        </Button>
      </form>
    </Shell>
  )
}

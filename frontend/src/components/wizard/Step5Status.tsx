import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, Send } from 'lucide-react'
import { Button } from '../ui/Button'
import { FilePicker } from '../ui/FilePicker'
import { originFromSubmitEvent, type RevealOrigin } from '../../lib/reveal-geometry'
import type { RiesgoIdentificado } from '../../types/salida'
import { RIESGO_IDENTIFICADO_LABELS } from '../../types/salida'

// ─── Schema ───────────────────────────────────────────────────────────────────

const RIESGOS = [
  'AVALANCHAS',
  'DESPRENDIMIENTO_ROCAS',
  'CRUCE_RIOS',
  'FRIO_EXTREMO',
  'MAL_ALTURA',
  'CAIDA_DISTINTO_NIVEL',
  'CALOR_EXTREMO',
  'OTRO',
] as const

const step5Schema = z.object({
  pronosticoMeteorologico: z
    .string()
    .trim()
    .min(1, 'Describe el pronóstico meteorológico')
    .max(1000, 'Máximo 1000 caracteres'),
  riesgosIdentificados: z
    .array(z.enum(RIESGOS))
    .min(1, 'Selecciona al menos un riesgo'),
  riesgosOtro: z.string().max(100, 'Máximo 100 caracteres'),
  planEvacuacion: z.string().max(1000, 'Máximo 1000 caracteres'),
})

export type Step5Data = z.infer<typeof step5Schema>

// ─── Checkbox group (reused pattern from Step4) ───────────────────────────────

interface CheckboxGroupProps<T extends string> {
  label: string
  required?: boolean
  options: readonly T[]
  labels: Record<T, string>
  selected: T[]
  onChange: (next: T[]) => void
  error?: string
}

function CheckboxGroup<T extends string>({
  label,
  required,
  options,
  labels,
  selected,
  onChange,
  error,
}: CheckboxGroupProps<T>) {
  function toggle(value: T) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-primary">
        {label}
        {required && (
          <span className="text-error ml-1" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const checked = selected.includes(opt)
          return (
            <label
              key={opt}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-150 select-none',
                'focus-within:ring-2 focus-within:ring-primary/40',
                checked
                  ? 'bg-primary-fixed border-primary/40 text-primary-hover'
                  : 'bg-white border-secondary/25 text-slate-700 hover:border-primary/40 hover:bg-surface-container-low',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt)}
                className="sr-only"
              />
              <span
                className={[
                  'flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors',
                  checked
                    ? 'bg-primary border-primary'
                    : 'bg-white border-secondary/50',
                ].join(' ')}
                aria-hidden="true"
              >
                {checked && (
                  <svg viewBox="0 0 12 10" fill="none" className="w-2.5 h-2.5">
                    <path
                      d="M1 5l3.5 3.5L11 1"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className="text-sm font-medium">{labels[opt]}</span>
            </label>
          )
        })}
      </div>
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step5TechnicalPlanProps {
  defaultValues: Step5Data
  gpxFile: File | null
  pronosticoFile: File | null
  isSubmitting: boolean
  onFileChange: (file: File | null) => void
  onPronosticoFileChange: (file: File | null) => void
  /** `origin` es el centro del botón que envió: de ahí nace la onda de confirmación. */
  onSubmit: (data: Step5Data, origin: RevealOrigin) => Promise<void>
  onBack: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Step5Status({
  defaultValues,
  gpxFile,
  pronosticoFile,
  isSubmitting,
  onFileChange,
  onPronosticoFileChange,
  onSubmit,
  onBack,
}: Step5TechnicalPlanProps) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Step5Data>({
    resolver: zodResolver(step5Schema),
    defaultValues,
  })

  const riesgosSeleccionados = watch('riesgosIdentificados')
  const showOtroRiesgo = riesgosSeleccionados?.includes('OTRO')

  return (
    <form
      // El origen se mide SÍNCRONAMENTE acá, pero la onda recién nace dentro
      // del handler de submit VÁLIDO. Los dos detalles importan:
      // react-hook-form valida con `await` y para entonces el navegador ya
      // limpió `currentTarget`; y si la onda arrancara en este mismo lugar,
      // también se dispararía cuando la validación rechaza el envío — hay un
      // test e2e que cubre justamente ese caso.
      onSubmit={(event) => {
        const origin = originFromSubmitEvent(event)
        void handleSubmit((data) => onSubmit(data, origin))(event)
      }}
      noValidate
      className="flex flex-col gap-6"
    >
      {/* Pronóstico Meteorológico (descripción obligatoria) */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pronosticoMeteorologico"
          className="text-sm font-semibold text-primary"
        >
          Pronóstico Meteorológico
          <span className="text-error ml-1" aria-hidden="true">*</span>
        </label>
        <textarea
          id="pronosticoMeteorologico"
          rows={3}
          maxLength={1000}
          placeholder='Ej: "Despejado en la mañana, viento de 40 km/h en altura desde las 14:00"'
          {...register('pronosticoMeteorologico')}
          className={[
            'w-full rounded-xl border px-3 py-2.5 text-sm text-slate-900 bg-white',
            'placeholder:text-on-surface-variant/50 resize-y',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors',
            errors.pronosticoMeteorologico ? 'border-error' : 'border-secondary/40',
          ].join(' ')}
        />
        {errors.pronosticoMeteorologico && (
          <p className="text-xs text-error" role="alert">
            {errors.pronosticoMeteorologico.message}
          </p>
        )}
      </div>

      {/* Archivo del pronóstico (opcional) */}
      <FilePicker
        label={
          <>
            Archivo del Pronóstico{' '}
            <span className="text-on-surface-variant font-normal">(opcional)</span>
          </>
        }
        hint="Opcionalmente sube una foto o documento (PDF, JPG, PNG) del pronóstico meteorológico."
        accept=".pdf,.jpg,.jpeg,.png"
        placeholder="Seleccionar archivo…"
        value={pronosticoFile}
        onChange={onPronosticoFileChange}
      />

      {/* Principales Riesgos Identificados */}
      <div className="flex flex-col gap-3">
        <Controller
          control={control}
          name="riesgosIdentificados"
          render={({ field }) => (
            <CheckboxGroup<RiesgoIdentificado>
              label="Principales Riesgos Identificados"
              required
              options={RIESGOS}
              labels={RIESGO_IDENTIFICADO_LABELS}
              selected={field.value}
              onChange={field.onChange}
              error={errors.riesgosIdentificados?.message}
            />
          )}
        />

        {showOtroRiesgo && (
          <div className="flex flex-col gap-1.5 pl-7">
            <label
              htmlFor="riesgosOtro"
              className="text-xs font-semibold text-primary"
            >
              Especifica el riesgo
            </label>
            <input
              id="riesgosOtro"
              type="text"
              maxLength={100}
              placeholder="Describe el riesgo..."
              {...register('riesgosOtro')}
              className={[
                'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800',
                'placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow',
                errors.riesgosOtro ? 'border-error' : 'border-secondary/30',
              ].join(' ')}
            />
            {errors.riesgosOtro && (
              <p className="text-xs text-error" role="alert">
                {errors.riesgosOtro.message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Plan de Evacuación / Ruta Alternativa */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="planEvacuacion"
          className="text-sm font-semibold text-primary"
        >
          Plan de Evacuación / Ruta Alternativa{' '}
          <span className="text-on-surface-variant font-normal">(opcional)</span>
        </label>
        <textarea
          id="planEvacuacion"
          rows={3}
          maxLength={1000}
          placeholder='Ej: "En caso de incidente en el punto X, bajaremos por Y"'
          {...register('planEvacuacion')}
          className={[
            'w-full rounded-xl border px-3 py-2.5 text-sm text-slate-900 bg-white',
            'placeholder:text-on-surface-variant/50 resize-y',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors',
            errors.planEvacuacion ? 'border-error' : 'border-secondary/40',
          ].join(' ')}
        />
        {errors.planEvacuacion && (
          <p className="text-xs text-error" role="alert">
            {errors.planEvacuacion.message}
          </p>
        )}
      </div>

      {/* GPX File */}
      <FilePicker
        label={
          <>
            Archivo de Ruta GPX{' '}
            <span className="text-on-surface-variant font-normal">(opcional)</span>
          </>
        }
        hint="Selecciona un archivo .gpx desde tu dispositivo. Se subirá automáticamente al guardar la salida."
        accept=".gpx"
        placeholder="Seleccionar archivo .gpx…"
        value={gpxFile}
        onChange={onFileChange}
      />

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isSubmitting}
        >
          <ChevronLeft size={18} />
          Anterior
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          <Send size={18} />
          Guardar salida
        </Button>
      </div>
    </form>
  )
}

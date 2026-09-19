import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { Button } from '../ui/Button'
import type { MedioComunicacion, EquipoColectivoSeguridad } from '../../types/salida'
import {
  MEDIO_COMUNICACION_LABELS,
  EQUIPO_COLECTIVO_LABELS,
} from '../../types/salida'

// ─── Schema ───────────────────────────────────────────────────────────────────

const MEDIOS = [
  'RADIO_VHF_UHF',
  'TELEFONO_SATELITAL',
  'INREACH_SPOT',
  'CELULAR',
  'NINGUNO',
] as const

const EQUIPOS = [
  'CUERDAS',
  'BOTIQUIN_GRUPAL',
  'GPS',
  'MAPA_BRUJULA',
  'RESCATE_GRIETAS',
  'ARVA_PALA_SONDA',
  'SIN_EQUIPO',
  'OTRO',
] as const

const step4Schema = z.object({
  mediosComunicacion: z
    .array(z.enum(MEDIOS))
    .min(1, 'Selecciona al menos un medio de comunicación'),
  idDispositivoFrecuencia: z.string().max(100, 'Máximo 100 caracteres'),
  equipoColectivo: z
    .array(z.enum(EQUIPOS))
    .min(1, 'Selecciona al menos una opción'),
  equipoColectivoOtro: z.string().max(100, 'Máximo 100 caracteres'),
})

export type Step4Data = z.infer<typeof step4Schema>

// ─── Reusable checkbox group ──────────────────────────────────────────────────

interface CheckboxGroupProps<T extends string> {
  label: string
  required?: boolean
  hint?: string
  options: readonly T[]
  labels: Record<T, string>
  selected: T[]
  onChange: (next: T[]) => void
  error?: string
}

function CheckboxGroup<T extends string>({
  label,
  required,
  hint,
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
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        {required && (
          <span className="text-[#A4636E] ml-1" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {hint && <p className="text-xs text-[#757874] -mt-1">{hint}</p>}
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const checked = selected.includes(opt)
          return (
            <label
              key={opt}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-150 select-none',
                'focus-within:ring-2 focus-within:ring-[#264c99]/40',
                checked
                  ? 'bg-[#e8eef7] border-[#264c99]/40 text-[#1e3c7a]'
                  : 'bg-white border-[#4a6fad]/25 text-slate-700 hover:border-[#264c99]/40 hover:bg-[#f5f8f5]',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt)}
                className="sr-only"
              />
              {/* Custom checkbox indicator */}
              <span
                className={[
                  'flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors',
                  checked
                    ? 'bg-[#264c99] border-[#264c99]'
                    : 'bg-white border-[#4a6fad]/50',
                ].join(' ')}
                aria-hidden="true"
              >
                {checked && (
                  <svg
                    viewBox="0 0 12 10"
                    fill="none"
                    className="w-2.5 h-2.5"
                  >
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
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step4CommunicationsProps {
  defaultValues: Step4Data
  onSubmit: (data: Step4Data) => void
  onBack: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Step4Communications({
  defaultValues,
  onSubmit,
  onBack,
}: Step4CommunicationsProps) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Step4Data>({
    resolver: zodResolver(step4Schema),
    defaultValues,
  })

  const equipoColectivo = watch('equipoColectivo')
  const showOtroInput = equipoColectivo?.includes('OTRO')

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {/* Medios de Comunicación */}
      <Controller
        control={control}
        name="mediosComunicacion"
        render={({ field }) => (
          <CheckboxGroup<MedioComunicacion>
            label="Medios de Comunicación"
            required
            options={MEDIOS}
            labels={MEDIO_COMUNICACION_LABELS}
            selected={field.value}
            onChange={field.onChange}
            error={errors.mediosComunicacion?.message}
          />
        )}
      />

      {/* ID Dispositivo / Frecuencia Radial */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="idDispositivoFrecuencia"
          className="text-sm font-semibold text-[#264c99]"
        >
          ID de Dispositivo / Frecuencia Radial{' '}
          <span className="text-[#757874] font-normal">(opcional)</span>
        </label>
        <input
          id="idDispositivoFrecuencia"
          type="text"
          maxLength={100}
          placeholder="Dirección de mapa compartido de Garmin-Spot / Frecuencia de Radio"
          {...register('idDispositivoFrecuencia')}
          className={[
            'w-full px-3 py-2.5 rounded-xl border bg-white text-sm text-slate-800',
            'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
            errors.idDispositivoFrecuencia
              ? 'border-[#A4636E]'
              : 'border-[#4a6fad]/30',
          ].join(' ')}
        />
        {errors.idDispositivoFrecuencia && (
          <p className="text-xs text-[#A4636E]" role="alert">
            {errors.idDispositivoFrecuencia.message}
          </p>
        )}
      </div>

      {/* Equipo Colectivo de Seguridad */}
      <div className="flex flex-col gap-3">
        <Controller
          control={control}
          name="equipoColectivo"
          render={({ field }) => (
            <CheckboxGroup<EquipoColectivoSeguridad>
              label="Equipo Colectivo de Seguridad"
              required
              options={EQUIPOS}
              labels={EQUIPO_COLECTIVO_LABELS}
              selected={field.value}
              onChange={field.onChange}
              error={errors.equipoColectivo?.message}
            />
          )}
        />

        {/* "Otro" free-text field — shown only when OTRO is checked */}
        {showOtroInput && (
          <div className="flex flex-col gap-1.5 pl-7">
            <label
              htmlFor="equipoColectivoOtro"
              className="text-xs font-semibold text-[#264c99]"
            >
              Especifica el equipo adicional
            </label>
            <input
              id="equipoColectivoOtro"
              type="text"
              maxLength={100}
              placeholder="Describe el equipo..."
              {...register('equipoColectivoOtro')}
              className={[
                'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800',
                'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                errors.equipoColectivoOtro
                  ? 'border-[#A4636E]'
                  : 'border-[#4a6fad]/30',
              ].join(' ')}
            />
            {errors.equipoColectivoOtro && (
              <p className="text-xs text-[#A4636E]" role="alert">
                {errors.equipoColectivoOtro.message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft size={18} />
          Anterior
        </Button>
        <Button type="submit" variant="primary" size="lg">
          Siguiente
          <ArrowRight size={18} />
        </Button>
      </div>
    </form>
  )
}

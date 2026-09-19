import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight } from 'lucide-react'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import type { TipoSalida, Disciplina, Temporada } from '../../types/salida'

const TEMPORADA_OPTIONS: { value: Temporada; label: string }[] = [
  { value: 'estival', label: 'Estival' },
  { value: 'invernal', label: 'Invernal' },
]

const TIPO_OPTIONS: { value: TipoSalida; label: string }[] = [
  { value: 'OFICIAL_CLUB', label: 'Oficial del Club' },
  { value: 'NO_OFICIAL', label: 'No Oficial' },
  { value: 'EXPEDICION_PARTICULAR', label: 'Expedición Particular' },
]

const DISCIPLINA_OPTIONS: { value: Disciplina; label: string }[] = [
  { value: 'TREKKING', label: 'Trekking' },
  { value: 'MEDIA_MONTANA', label: 'Media Montaña' },
  { value: 'ALTA_MONTANA', label: 'Alta Montaña' },
  { value: 'ESCALADA_ROCA', label: 'Escalada en Roca' },
  { value: 'ESCALADA_HIELO', label: 'Escalada en Hielo' },
  { value: 'ESQUI_MONTANA', label: 'Esquí de Montaña' },
  { value: 'TRAIL_SKY_RUNNING', label: 'Trail / Sky Running' },
]

const step1Schema = z.object({
  tipoSalida: z.enum(
    ['OFICIAL_CLUB', 'NO_OFICIAL', 'EXPEDICION_PARTICULAR'],
    { error: 'Selecciona el tipo de salida' },
  ),
  disciplina: z.enum(
    ['TREKKING', 'MEDIA_MONTANA', 'ALTA_MONTANA', 'ESCALADA_ROCA', 'ESCALADA_HIELO', 'ESQUI_MONTANA', 'TRAIL_SKY_RUNNING'],
    { error: 'Selecciona la disciplina' },
  ),
  temporada: z.enum(
    ['estival', 'invernal'],
    { error: 'Selecciona la temporada' },
  ),
  nombreActividad: z.string().min(2, 'Ingresa el nombre de la actividad o ruta (min. 2 caracteres)'),
  ubicacionGeografica: z.string().min(2, 'Ingresa la ubicación geográfica (min. 2 caracteres)'),
})

type Step1Data = z.infer<typeof step1Schema>

interface Step1GeneralProps {
  defaultValues: Step1Data
  onSubmit: (data: Step1Data) => void
}

interface RadioGroupProps<T extends string> {
  label: string
  options: { value: T; label: string }[]
  value: T | undefined
  onChange: (val: T) => void
  error?: string
}

function RadioChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: RadioGroupProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              className={[
                'px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1',
                selected
                  ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                  : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
              ].join(' ')}
            >
              {opt.label}
            </button>
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

export function Step1General({ defaultValues, onSubmit }: Step1GeneralProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues,
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <Controller
        name="tipoSalida"
        control={control}
        render={({ field }) => (
          <RadioChipGroup
            label="Tipo de Salida"
            options={TIPO_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.tipoSalida?.message}
          />
        )}
      />

      <Controller
        name="disciplina"
        control={control}
        render={({ field }) => (
          <RadioChipGroup
            label="Disciplina"
            options={DISCIPLINA_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.disciplina?.message}
          />
        )}
      />

      <Controller
        name="temporada"
        control={control}
        render={({ field }) => (
          <RadioChipGroup
            label="Temporada"
            options={TEMPORADA_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.temporada?.message}
          />
        )}
      />

      <Input
        label="Nombre de la Actividad / Ruta"
        placeholder="ej. Ascenso al Cerro Plomo por cara norte"
        required
        error={errors.nombreActividad?.message}
        {...register('nombreActividad')}
      />

      <Input
        label="Ubicación Geográfica"
        placeholder="ej. Cajón del Maipo, Región Metropolitana"
        required
        error={errors.ubicacionGeografica?.message}
        {...register('ubicacionGeografica')}
      />

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="primary" size="lg">
          Siguiente
          <ArrowRight size={18} />
        </Button>
      </div>
    </form>
  )
}

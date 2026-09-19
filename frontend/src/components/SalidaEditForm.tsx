import { useEffect, useState, type ReactNode } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, Save, Loader2, AlertCircle, Pencil } from 'lucide-react'
import { Input } from './ui/Input'
import { TimeInput24 } from './ui/TimeInput24'
import { Button } from './ui/Button'
import { getSalida, updateSalida } from '../lib/api'
import { fechaInputField } from '../lib/fechas'
import type {
  SalidaRecord,
  TipoSalida,
  Disciplina,
  Temporada,
  AvisoExterno,
  MedioComunicacion,
  EquipoColectivoSeguridad,
  RiesgoIdentificado,
} from '../types/salida'
import {
  TIPO_SALIDA_LABELS,
  DISCIPLINA_LABELS,
  TEMPORADA_LABELS,
  AVISO_EXTERNO_LABELS,
  MEDIO_COMUNICACION_LABELS,
  EQUIPO_COLECTIVO_LABELS,
  RIESGO_IDENTIFICADO_LABELS,
} from '../types/salida'

// ─── Catálogos de valores ───────────────────────────────────────────────────

const TIPOS = ['OFICIAL_CLUB', 'NO_OFICIAL', 'EXPEDICION_PARTICULAR'] as const
const DISCIPLINAS = [
  'TREKKING',
  'MEDIA_MONTANA',
  'ALTA_MONTANA',
  'ESCALADA_ROCA',
  'ESCALADA_HIELO',
  'ESQUI_MONTANA',
  'TRAIL_SKY_RUNNING',
] as const
const TEMPORADAS = ['estival', 'invernal'] as const
const AVISOS = ['CARABINEROS', 'SOCORRO_ANDINO', 'FAMILIAR_OTRO'] as const
const MEDIOS = ['RADIO_VHF_UHF', 'TELEFONO_SATELITAL', 'INREACH_SPOT', 'CELULAR', 'NINGUNO'] as const
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

// ─── Schema ─────────────────────────────────────────────────────────────────
// Relajado respecto al wizard: NO se valida "fecha no pasada", porque una salida
// EN_CURSO pudo haber comenzado hoy o antes. Solo se exige retorno >= inicio.

const editSchema = z
  .object({
    tipoSalida: z.enum(TIPOS),
    disciplina: z.enum(DISCIPLINAS),
    temporada: z.enum(TEMPORADAS),
    nombreActividad: z.string().min(2, 'Ingresa el nombre de la actividad (mín. 2 caracteres)'),
    ubicacionGeografica: z.string().min(2, 'Ingresa la ubicación (mín. 2 caracteres)'),
    fechaInicio: fechaInputField('Selecciona la fecha de inicio'),
    fechaRetornoEstimada: fechaInputField('Selecciona la fecha de retorno'),
    horaRetornoEstimada: z.string().min(1, 'Ingresa la hora de retorno'),
    horaAlerta: z.string().min(1, 'Ingresa la hora de alerta'),
    avisosExternos: z.array(z.enum(AVISOS)).min(1, 'Selecciona al menos una opción'),
    retenCarabineros: z.string().max(200).optional(),
    nombreFamiliar: z.string().max(200).optional(),
    telefonoFamiliar: z.string().max(50).optional(),
    coordinacionGrupal: z.boolean(),
    matrizRiesgos: z.boolean(),
    mediosComunicacion: z.array(z.enum(MEDIOS)).min(1, 'Selecciona al menos un medio'),
    idDispositivoFrecuencia: z.string().max(100, 'Máximo 100 caracteres'),
    equipoColectivo: z.array(z.enum(EQUIPOS)).min(1, 'Selecciona al menos una opción'),
    equipoColectivoOtro: z.string().max(100, 'Máximo 100 caracteres'),
    pronosticoMeteorologico: z
      .string()
      .trim()
      .min(1, 'Describe el pronóstico meteorológico')
      .max(1000, 'Máximo 1000 caracteres'),
    riesgosIdentificados: z.array(z.enum(RIESGOS)).min(1, 'Selecciona al menos un riesgo'),
    riesgosOtro: z.string().max(100, 'Máximo 100 caracteres'),
    planEvacuacion: z.string().max(1000, 'Máximo 1000 caracteres'),
  })
  .refine((d) => d.fechaRetornoEstimada >= d.fechaInicio, {
    message: 'La fecha de retorno debe ser igual o posterior a la de inicio',
    path: ['fechaRetornoEstimada'],
  })
  .superRefine((data, ctx) => {
    if (data.avisosExternos.includes('CARABINEROS') && !data.retenCarabineros?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El retén de Carabineros es obligatorio', path: ['retenCarabineros'] })
    }
    if (data.avisosExternos.includes('FAMILIAR_OTRO')) {
      if (!data.nombreFamiliar?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El nombre del familiar es obligatorio', path: ['nombreFamiliar'] })
      }
      if (!data.telefonoFamiliar?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El teléfono del familiar es obligatorio', path: ['telefonoFamiliar'] })
      }
    }
  })

type EditFormValues = z.infer<typeof editSchema>

// ─── Grupos reutilizables (mismo estilo que el wizard) ───────────────────────

function ChipSingle<T extends string>({
  label, options, labels, value, onChange, error,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T | undefined
  onChange: (v: T) => void
  error?: string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              aria-pressed={selected}
              className={[
                'px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1',
                selected
                  ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                  : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
              ].join(' ')}
            >
              {labels[opt]}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
    </fieldset>
  )
}

function ChipMulti<T extends string>({
  label, options, labels, value, onChange, error,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T[]
  onChange: (v: T[]) => void
  error?: string
}) {
  function toggle(opt: T) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value.includes(opt)
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              aria-pressed={selected}
              className={[
                'px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1',
                selected
                  ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                  : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
              ].join(' ')}
            >
              {labels[opt]}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
    </fieldset>
  )
}

function BoolChips({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">{label}</legend>
      <div className="flex gap-2">
        {[{ v: true, l: 'Sí' }, { v: false, l: 'No' }].map(({ v, l }) => {
          const selected = value === v
          return (
            <button
              key={l}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={selected}
              className={[
                'px-5 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                selected
                  ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                  : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
              ].join(' ')}
            >
              {l}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-5">
      <h3 className="text-sm font-bold text-[#264c99]">{title}</h3>
      {children}
    </section>
  )
}

// ─── Mapeo salida → valores del formulario ───────────────────────────────────

function toFormValues(s: SalidaRecord): EditFormValues {
  return {
    tipoSalida: s.tipoSalida,
    disciplina: s.disciplina,
    temporada: s.temporada ?? 'estival',
    nombreActividad: s.nombreActividad,
    ubicacionGeografica: s.ubicacionGeografica,
    fechaInicio: (s.fechaInicio ?? '').split('T')[0],
    fechaRetornoEstimada: (s.fechaRetornoEstimada ?? '').split('T')[0],
    horaRetornoEstimada: s.horaRetornoEstimada ?? '',
    horaAlerta: s.horaAlerta ?? '',
    avisosExternos: s.avisosExternos ?? [],
    retenCarabineros: s.retenCarabineros ?? '',
    nombreFamiliar: s.nombreFamiliar ?? '',
    telefonoFamiliar: s.telefonoFamiliar ?? '',
    coordinacionGrupal: s.coordinacionGrupal,
    matrizRiesgos: s.matrizRiesgos,
    mediosComunicacion: s.mediosComunicacion ?? [],
    idDispositivoFrecuencia: s.idDispositivoFrecuencia ?? '',
    equipoColectivo: s.equipoColectivo ?? [],
    equipoColectivoOtro: s.equipoColectivoOtro ?? '',
    pronosticoMeteorologico: s.pronosticoMeteorologico ?? '',
    riesgosIdentificados: s.riesgosIdentificados ?? [],
    riesgosOtro: s.riesgosOtro ?? '',
    planEvacuacion: s.planEvacuacion ?? '',
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface SalidaEditFormProps {
  salidaId: string
  onDone: () => void
  onCancel: () => void
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function SalidaEditForm({ salidaId, onDone, onCancel }: SalidaEditFormProps) {
  const [salida, setSalida] = useState<SalidaRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<EditFormValues>({ resolver: zodResolver(editSchema) })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const data = await getSalida(salidaId)
        if (cancelled) return
        setSalida(data)
        reset(toFormValues(data))
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Error al cargar la salida')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [salidaId, reset])

  const avisos = watch('avisosExternos') ?? []
  const showCarabineros = avisos.includes('CARABINEROS')
  const showFamiliar = avisos.includes('FAMILIAR_OTRO')
  const showEquipoOtro = (watch('equipoColectivo') ?? []).includes('OTRO')
  const showRiesgoOtro = (watch('riesgosIdentificados') ?? []).includes('OTRO')

  const onSubmit = async (values: EditFormValues) => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await updateSalida(salidaId, values)
      onDone()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar la salida')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f4fb] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#4a6fad]/15 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors" aria-label="Volver">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Pencil size={18} className="text-[#264c99] shrink-0" />
            <span className="font-semibold text-slate-900 truncate">Editar salida</span>
            {typeof salida?.numeroSalida === 'number' && (
              <span className="shrink-0 text-[10px] font-bold text-[#4a6fad] bg-[#e8eef7] px-2 py-0.5 rounded-md">N° {salida.numeroSalida}</span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#757874]">
            <Loader2 className="animate-spin text-[#264c99]" size={28} />
            <p className="text-sm">Cargando salida...</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center py-16 gap-4 text-center">
            <AlertCircle size={32} className="text-[#A4636E]" />
            <p className="text-sm text-[#757874]">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={onCancel}>Volver</Button>
          </div>
        )}

        {!loading && !loadError && salida && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {/* Contexto no editable: grupo humano */}
            <div className="bg-[#e8eef7] border border-[#264c99]/15 rounded-2xl px-4 py-3 text-xs text-[#1e3c7a]">
              Líder de cordada e integrantes <strong>no son editables</strong> desde aquí.
              Líder: <strong>{salida.liderCordada}</strong> · {salida.participantes.length} participante(s).
            </div>

            <Section title="Clasificación">
              <Controller name="tipoSalida" control={control} render={({ field }) => (
                <ChipSingle<TipoSalida> label="Tipo de salida" options={TIPOS} labels={TIPO_SALIDA_LABELS} value={field.value} onChange={field.onChange} error={errors.tipoSalida?.message} />
              )} />
              <Controller name="disciplina" control={control} render={({ field }) => (
                <ChipSingle<Disciplina> label="Disciplina" options={DISCIPLINAS} labels={DISCIPLINA_LABELS} value={field.value} onChange={field.onChange} error={errors.disciplina?.message} />
              )} />
              <Controller name="temporada" control={control} render={({ field }) => (
                <ChipSingle<Temporada> label="Temporada" options={TEMPORADAS} labels={TEMPORADA_LABELS} value={field.value} onChange={field.onChange} error={errors.temporada?.message} />
              )} />
              <Input label="Nombre de la actividad / ruta" required error={errors.nombreActividad?.message} {...register('nombreActividad')} />
              <Input label="Ubicación geográfica" required error={errors.ubicacionGeografica?.message} {...register('ubicacionGeografica')} />
            </Section>

            <Section title="Cronología y seguridad">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Fecha de inicio" type="date" required error={errors.fechaInicio?.message} {...register('fechaInicio')} />
                <Input label="Fecha estimada de retorno" type="date" required error={errors.fechaRetornoEstimada?.message} {...register('fechaRetornoEstimada')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Controller name="horaRetornoEstimada" control={control} render={({ field }) => (
                  <TimeInput24 label="Hora de retorno (vehículos)" required value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={errors.horaRetornoEstimada?.message} />
                )} />
                <Controller name="horaAlerta" control={control} render={({ field }) => (
                  <TimeInput24 label="Hora de alerta" required value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={errors.horaAlerta?.message} />
                )} />
              </div>
              <Controller name="avisosExternos" control={control} render={({ field }) => (
                <ChipMulti<AvisoExterno> label="Avisos a autoridades / terceros" options={AVISOS} labels={AVISO_EXTERNO_LABELS} value={field.value ?? []} onChange={field.onChange} error={errors.avisosExternos?.message} />
              )} />
              {showCarabineros && (
                <Input label="Retén de Carabineros" required error={errors.retenCarabineros?.message} {...register('retenCarabineros')} />
              )}
              {showFamiliar && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Nombre del familiar / contacto" required error={errors.nombreFamiliar?.message} {...register('nombreFamiliar')} />
                  <Input label="Teléfono del familiar / contacto" required error={errors.telefonoFamiliar?.message} {...register('telefonoFamiliar')} />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Controller name="coordinacionGrupal" control={control} render={({ field }) => (
                  <BoolChips label="¿Coordinación grupal previa?" value={field.value} onChange={field.onChange} />
                )} />
                <Controller name="matrizRiesgos" control={control} render={({ field }) => (
                  <BoolChips label="¿Matriz de riesgos elaborada?" value={field.value} onChange={field.onChange} />
                )} />
              </div>
            </Section>

            <Section title="Comunicaciones y equipo">
              <Controller name="mediosComunicacion" control={control} render={({ field }) => (
                <ChipMulti<MedioComunicacion> label="Medios de comunicación" options={MEDIOS} labels={MEDIO_COMUNICACION_LABELS} value={field.value ?? []} onChange={field.onChange} error={errors.mediosComunicacion?.message} />
              )} />
              <Input label="ID de dispositivo / frecuencia radial (opcional)" error={errors.idDispositivoFrecuencia?.message} {...register('idDispositivoFrecuencia')} />
              <Controller name="equipoColectivo" control={control} render={({ field }) => (
                <ChipMulti<EquipoColectivoSeguridad> label="Equipo colectivo de seguridad" options={EQUIPOS} labels={EQUIPO_COLECTIVO_LABELS} value={field.value ?? []} onChange={field.onChange} error={errors.equipoColectivo?.message} />
              )} />
              {showEquipoOtro && (
                <Input label="Especifica el equipo adicional" error={errors.equipoColectivoOtro?.message} {...register('equipoColectivoOtro')} />
              )}
            </Section>

            <Section title="Planificación técnica">
              <Controller name="riesgosIdentificados" control={control} render={({ field }) => (
                <ChipMulti<RiesgoIdentificado> label="Riesgos identificados" options={RIESGOS} labels={RIESGO_IDENTIFICADO_LABELS} value={field.value ?? []} onChange={field.onChange} error={errors.riesgosIdentificados?.message} />
              )} />
              {showRiesgoOtro && (
                <Input label="Especifica el otro riesgo" error={errors.riesgosOtro?.message} {...register('riesgosOtro')} />
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pronosticoMeteorologico" className="text-sm font-semibold text-[#264c99]">
                  Pronóstico meteorológico<span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="pronosticoMeteorologico"
                  rows={3}
                  maxLength={1000}
                  {...register('pronosticoMeteorologico')}
                  className={[
                    'w-full px-3 py-2.5 rounded-xl border bg-white text-sm text-slate-800 resize-y',
                    'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                    errors.pronosticoMeteorologico ? 'border-[#A4636E]' : 'border-[#4a6fad]/30',
                  ].join(' ')}
                />
                {errors.pronosticoMeteorologico && (
                  <p className="text-xs text-[#A4636E]" role="alert">{errors.pronosticoMeteorologico.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="planEvacuacion" className="text-sm font-semibold text-[#264c99]">
                  Plan de evacuación <span className="text-[#757874] font-normal">(opcional)</span>
                </label>
                <textarea
                  id="planEvacuacion"
                  rows={3}
                  maxLength={1000}
                  {...register('planEvacuacion')}
                  className={[
                    'w-full px-3 py-2.5 rounded-xl border bg-white text-sm text-slate-800 resize-y',
                    'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                    errors.planEvacuacion ? 'border-[#A4636E]' : 'border-[#4a6fad]/30',
                  ].join(' ')}
                />
                {errors.planEvacuacion && (
                  <p className="text-xs text-[#A4636E]" role="alert">{errors.planEvacuacion.message}</p>
                )}
              </div>
            </Section>

            {submitError && (
              <div className="flex items-start gap-2 bg-[#f5e8ea] border border-[#A4636E]/30 rounded-xl px-4 py-3 text-sm text-[#A4636E]">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex justify-between gap-3 pt-2 pb-6">
              <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="lg" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                Guardar cambios
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}

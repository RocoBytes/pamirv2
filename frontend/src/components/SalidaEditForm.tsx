import { useEffect, useState, type ReactNode } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save, Loader2, AlertCircle, Pencil } from 'lucide-react'
import { AppShell, type ShellContext } from './shell/AppShell'
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
      <legend className="text-sm font-semibold text-primary">{label}</legend>
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                selected
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-slate-700 border-secondary/40 hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              {labels[opt]}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-error" role="alert">{error}</p>}
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
      <legend className="text-sm font-semibold text-primary">{label}</legend>
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                selected
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-slate-700 border-secondary/40 hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              {labels[opt]}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-error" role="alert">{error}</p>}
    </fieldset>
  )
}

function BoolChips({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-primary">{label}</legend>
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
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-slate-700 border-secondary/40 hover:border-primary hover:text-primary',
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
    <section className="bg-white rounded-2xl border border-secondary/15 p-5 shadow-sm flex flex-col gap-5">
      <h3 className="text-sm font-bold text-primary">{title}</h3>
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
  shell: ShellContext
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function SalidaEditForm({ salidaId, onDone, onCancel, shell }: SalidaEditFormProps) {
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
    <AppShell
      shell={shell}
      active="none"
      onBack={onCancel}
      width="narrow"
      chrome="focused"
      title="Editar salida"
    >
        {/* Identidad de la salida editada: el header compartido solo lleva el
            título genérico, así que el N° va acá, junto al formulario. */}
        <div className="mb-5 flex items-center gap-2 min-w-0">
          <Pencil size={18} className="text-primary shrink-0" aria-hidden="true" />
          <h1 className="text-headline-md font-bold text-on-surface truncate">Editar salida</h1>
          {typeof salida?.numeroSalida === 'number' && (
            <span className="shrink-0 text-label-caps font-bold text-primary bg-primary-fixed px-2 py-0.5 rounded-md tabular-nums">
              N° {salida.numeroSalida}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
            <Loader2 className="animate-spin text-primary" size={28} />
            <p className="text-sm">Cargando salida...</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center py-16 gap-4 text-center">
            <AlertCircle size={32} className="text-error" />
            <p className="text-sm text-on-surface-variant">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={onCancel}>Volver</Button>
          </div>
        )}

        {!loading && !loadError && salida && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {/* Contexto no editable: grupo humano */}
            <div className="bg-primary-fixed border border-primary/15 rounded-2xl px-4 py-3 text-xs text-primary-hover">
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
                <label htmlFor="pronosticoMeteorologico" className="text-sm font-semibold text-primary">
                  Pronóstico meteorológico<span className="text-error ml-1" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="pronosticoMeteorologico"
                  rows={3}
                  maxLength={1000}
                  {...register('pronosticoMeteorologico')}
                  className={[
                    'w-full px-3 py-2.5 rounded-xl border bg-white text-sm text-slate-800 resize-y',
                    'placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow',
                    errors.pronosticoMeteorologico ? 'border-error' : 'border-secondary/30',
                  ].join(' ')}
                />
                {errors.pronosticoMeteorologico && (
                  <p className="text-xs text-error" role="alert">{errors.pronosticoMeteorologico.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="planEvacuacion" className="text-sm font-semibold text-primary">
                  Plan de evacuación <span className="text-on-surface-variant font-normal">(opcional)</span>
                </label>
                <textarea
                  id="planEvacuacion"
                  rows={3}
                  maxLength={1000}
                  {...register('planEvacuacion')}
                  className={[
                    'w-full px-3 py-2.5 rounded-xl border bg-white text-sm text-slate-800 resize-y',
                    'placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow',
                    errors.planEvacuacion ? 'border-error' : 'border-secondary/30',
                  ].join(' ')}
                />
                {errors.planEvacuacion && (
                  <p className="text-xs text-error" role="alert">{errors.planEvacuacion.message}</p>
                )}
              </div>
            </Section>

            {submitError && (
              <div className="flex items-start gap-2 bg-error-container border border-error/30 rounded-xl px-4 py-3 text-sm text-error">
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
    </AppShell>
  )
}

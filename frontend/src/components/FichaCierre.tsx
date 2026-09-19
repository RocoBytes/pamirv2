import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Mountain,
  X,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Paperclip,
  Info,
} from 'lucide-react'

import type {
  User,
  SalidaRecord,
  EstadoCierre,
  MotivoAbandono,
  MotivoCambio,
  TipoIncidente,
  TipoAccidente,
  DesempenoEquipo,
} from '../types/salida'
import {
  ESTADO_CIERRE_LABELS,
  MOTIVO_ABANDONO_LABELS,
  MOTIVO_CAMBIO_LABELS,
  TIPO_INCIDENTE_LABELS,
  TIPO_ACCIDENTE_LABELS,
  DESEMPENO_EQUIPO_LABELS,
} from '../types/salida'
import { fetchSalidas, uploadGpx, createCierre } from '../lib/api'
import { Button } from './ui/Button'

// ─── Constants ────────────────────────────────────────────────────────────────

const ESTADOS = [
  'COMPLETADA_SEGUN_PLAN',
  'COMPLETADA_CON_VARIACIONES',
  'ABORTADA_INCOMPLETA',
] as const

const MOTIVOS_ABANDONO = [
  'METEOROLOGIA',
  'SALUD_INTEGRANTE',
  'MAL_ESTADO_RUTA',
  'FALLO_EQUIPO',
  'ERROR_PLANIFICACION',
  'FALTA_TIEMPO',
] as const

const MOTIVOS_CAMBIO = [
  'CLIMA_ADVERSO',
  'ERROR_NAVEGACION',
  'FATIGA_FISICA',
  'FALTA_EQUIPO_TECNICO',
  'FALTA_TIEMPO',
  'OTRO',
] as const

const HUBO_CAMBIOS = ['SI', 'NO'] as const

const SI_NO = ['SI', 'NO'] as const
const SI_NO_LABELS = { SI: 'Sí', NO: 'No' } as const

const TIPOS_INCIDENTE = [
  'EXTRAVIO',
  'CAIDA_SIN_LESION',
  'GOLPE_LEVE',
  'FALLA_EQUIPAMIENTO',
  'CLIMA_ADVERSO',
  'PROBLEMA_COMUNICACION',
  'INICIO_MAL_ALTURA',
  'DESCENSO_PREVENTIVO',
  'OTRO',
] as const

const TIPOS_ACCIDENTE = [
  'CAIDA_CON_LESION',
  'GOLPE_ROCA',
  'HIPOTERMIA',
  'MAL_AGUDO_MONTANA',
  'DESHIDRATACION_SEVERA',
  'CONGELAMIENTO',
  'QUEMADURA_SOLAR',
  'AVALANCHA',
  'GRAVE_FATAL',
  'OTRO',
] as const

const DESEMPENO_EQUIPO_OPTIONS = ['TODO_FUNCIONO', 'FALLO_EQUIPO'] as const

// ─── Schema ───────────────────────────────────────────────────────────────────

const cierreSchema = z
  .object({
    // Paso 1
    salidaId: z.string().min(1, 'Selecciona una salida'),
    fechaFinalizacionReal: z.string().min(1, 'La fecha de finalización es obligatoria'),
    estadoCierre: z.enum(ESTADOS, { error: 'Selecciona el estado de la salida' }),
    altitudMaxima: z.number({ error: 'Debe ser un número' }).min(0, 'Debe ser mayor o igual a 0 m.s.n.m.'),
    motivoAbandono: z.enum(MOTIVOS_ABANDONO).optional(),
    // Paso 2
    huboCambios: z.enum(HUBO_CAMBIOS).optional(),
    motivosCambios: z.array(z.enum(MOTIVOS_CAMBIO)).optional(),
    motivosCambiosOtro: z.string().max(100, 'Máximo 100 caracteres').optional(),
    // Paso 3
    ocurrioIncidente: z.enum(SI_NO, {
      error: 'Selecciona una opción',
    }),
    ocurrioAccidente: z.enum(SI_NO, {
      error: 'Selecciona una opción',
    }),
    tiposIncidente: z.array(z.enum(TIPOS_INCIDENTE)).optional(),
    incidenteOtroDescripcion: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
    tiposAccidente: z.array(z.enum(TIPOS_ACCIDENTE)).optional(),
    accidenteOtroDescripcion: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
    // Paso 4
    desempenoEquipo: z.enum(DESEMPENO_EQUIPO_OPTIONS, { error: 'Selecciona una opción' }),
    detalleFallaEquipo: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
    observacionesRuta: z
      .string()
      .min(1, 'Las observaciones son obligatorias')
      .max(1000, 'Máximo 1000 caracteres'),
    precisionPronostico: z
      .number({ error: 'Selecciona una calificación' })
      .int()
      .min(1)
      .max(5),
    // Paso 5
    leccionesAprendidas: z
      .string()
      .min(1, 'Este campo es obligatorio')
      .max(1000, 'Máximo 1000 caracteres'),
    recomendacionesFuturos: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
    sugerenciasClub: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
  })
  .refine(
    (d) => d.estadoCierre !== 'ABORTADA_INCOMPLETA' || !!d.motivoAbandono,
    { message: 'Indica el motivo del abandono', path: ['motivoAbandono'] },
  )
  .refine(
    (d) => !!d.huboCambios,
    { message: 'Selecciona una opción', path: ['huboCambios'] },
  )
  .refine(
    (d) => d.huboCambios !== 'SI' || (d.motivosCambios && d.motivosCambios.length > 0),
    { message: 'Selecciona al menos un motivo', path: ['motivosCambios'] },
  )
  // Paso 3 — Incidente (independiente del accidente). Safe cuando el campo es undefined.
  .refine(
    (d) => d.ocurrioIncidente !== 'SI' || (d.tiposIncidente && d.tiposIncidente.length > 0),
    { message: 'Selecciona al menos un tipo de incidente', path: ['tiposIncidente'] },
  )
  .refine(
    (d) => !d.tiposIncidente?.includes('OTRO') || !!d.incidenteOtroDescripcion?.trim(),
    { message: 'Describe el incidente', path: ['incidenteOtroDescripcion'] },
  )
  // Paso 3 — Accidente (independiente del incidente).
  .refine(
    (d) => d.ocurrioAccidente !== 'SI' || (d.tiposAccidente && d.tiposAccidente.length > 0),
    { message: 'Selecciona al menos un tipo de accidente', path: ['tiposAccidente'] },
  )
  .refine(
    (d) => !d.tiposAccidente?.includes('OTRO') || !!d.accidenteOtroDescripcion?.trim(),
    { message: 'Describe el accidente', path: ['accidenteOtroDescripcion'] },
  )
  .refine(
    (d) => d.desempenoEquipo !== 'FALLO_EQUIPO' || !!d.detalleFallaEquipo?.trim(),
    { message: 'Describe la falla del equipamiento', path: ['detalleFallaEquipo'] },
  )

type CierreFormValues = z.infer<typeof cierreSchema>

// ─── InfoTooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointer(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex align-middle ml-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Más información"
        className="inline-flex items-center justify-center rounded-full text-[#4a6fad] hover:text-[#264c99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]/40 transition-colors"
      >
        <Info size={16} />
      </button>
      {open && (
        <span
          role="note"
          className="absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border border-[#4a6fad]/25 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-slate-700 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}

// ─── RadioGroup ───────────────────────────────────────────────────────────────

interface RadioGroupProps<T extends string> {
  label: string
  required?: boolean
  labelExtra?: React.ReactNode
  options: readonly T[]
  labels: Record<T, string>
  value: T | undefined
  onChange: (val: T) => void
  error?: string
}

function RadioGroup<T extends string>({
  label,
  required,
  labelExtra,
  options,
  labels,
  value,
  onChange,
  error,
}: RadioGroupProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        {required && (
          <span className="text-[#A4636E] ml-1" aria-hidden="true">
            *
          </span>
        )}
        {labelExtra}
      </legend>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const checked = value === opt
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
                type="radio"
                checked={checked}
                onChange={() => onChange(opt)}
                className="sr-only"
              />
              <span
                className={[
                  'flex items-center justify-center w-4 h-4 rounded-full border shrink-0 transition-colors',
                  checked ? 'bg-[#264c99] border-[#264c99]' : 'bg-white border-[#4a6fad]/50',
                ].join(' ')}
                aria-hidden="true"
              >
                {checked && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
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

// ─── CheckboxGroup ────────────────────────────────────────────────────────────

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
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        {required && (
          <span className="text-[#A4636E] ml-1" aria-hidden="true">
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
              <span
                className={[
                  'flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors',
                  checked ? 'bg-[#264c99] border-[#264c99]' : 'bg-white border-[#4a6fad]/50',
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
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// ─── GpxFilePicker ───────────────────────────────────────────────────────────

const MAX_GPX_SIZE = 15 * 1024 * 1024 // 15 MB

interface GpxFilePickerProps {
  value: File | null
  onChange: (file: File | null) => void
}

function GpxFilePicker({ value, onChange }: GpxFilePickerProps) {
  const [sizeError, setSizeError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      if (file.size > MAX_GPX_SIZE) {
        setSizeError('El archivo supera el límite de 15 MB')
        e.target.value = ''
        return
      }
      setSizeError(null)
    }
    onChange(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-[#264c99]">
        Ruta real trazada (GPX){' '}
        <span className="text-[#757874] font-normal">(opcional)</span>
      </span>
      <p className="text-xs text-[#757874]">
        Adjunta el archivo .gpx registrado durante la actividad. Se subirá a Google Drive al guardar.
      </p>

      {value ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#264c99]/40 bg-[#e8eef7]">
          <Paperclip size={15} className="text-[#264c99] shrink-0" />
          <span className="text-sm text-[#1e3c7a] flex-1 truncate">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[#4a6fad] hover:text-[#A4636E] transition-colors"
            aria-label="Quitar archivo"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-[#4a6fad]/40 bg-white cursor-pointer hover:border-[#264c99]/60 hover:bg-[#f5f8f5] transition-colors">
          <Paperclip size={15} className="text-[#4a6fad]/60" />
          <span className="text-sm text-[#757874]">Seleccionar archivo .gpx…</span>
          <input
            type="file"
            accept=".gpx"
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
      )}

      {sizeError && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {sizeError}
        </p>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FichaCierreProps {
  user: User
  onDone: () => void
  onCancel: () => void
  /** Salida preseleccionada (flujo admin desde el detalle): bloquea la selección. */
  salidaId?: string
  isAdmin?: boolean
}

const STEP_LABELS = [
  'Cierre de Actividad',
  'Evaluación de la Planificación',
  'Gestión de Incidentes',
  'Análisis Técnico y de Equipamiento',
  'Lecciones Aprendidas y Recomendaciones',
]

// ─── Component ───────────────────────────────────────────────────────────────

export function FichaCierre({ user, onDone, onCancel, salidaId: preselectedSalidaId, isAdmin = false }: FichaCierreProps) {
  const [salidas, setSalidas] = useState<SalidaRecord[]>([])
  const [loadingSalidas, setLoadingSalidas] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [gpxFile, setGpxFile] = useState<File | null>(null)

  const {
    register,
    control,
    handleSubmit,
    trigger,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CierreFormValues>({
    resolver: zodResolver(cierreSchema),
    defaultValues: { salidaId: preselectedSalidaId ?? '', motivosCambios: [], tiposIncidente: [], tiposAccidente: [] },
  })

  const estadoSeleccionado = watch('estadoCierre')
  const huboCambiosVal = watch('huboCambios')
  const motivosCambiosVal = watch('motivosCambios') ?? []
  const showOtroMotivo = motivosCambiosVal.includes('OTRO')
  const ocurrioIncidenteVal = watch('ocurrioIncidente')
  const ocurrioAccidenteVal = watch('ocurrioAccidente')
  const tiposIncidenteVal = watch('tiposIncidente') ?? []
  const tiposAccidenteVal = watch('tiposAccidente') ?? []
  const showIncidenteOtro = tiposIncidenteVal.includes('OTRO')
  const showAccidenteOtro = tiposAccidenteVal.includes('OTRO')
  const incidenteOtroDescripcionVal = watch('incidenteOtroDescripcion') ?? ''
  const accidenteOtroDescripcionVal = watch('accidenteOtroDescripcion') ?? ''

  const desempenoEquipoVal = watch('desempenoEquipo')
  const observacionesRutaVal = watch('observacionesRuta') ?? ''
  const detalleFallaEquipoVal = watch('detalleFallaEquipo') ?? ''
  const showDetalleFalla = desempenoEquipoVal === 'FALLO_EQUIPO'

  const leccionesAprendidasVal = watch('leccionesAprendidas') ?? ''
  const recomendacionesFuturosVal = watch('recomendacionesFuturos') ?? ''
  const sugerenciasClubVal = watch('sugerenciasClub') ?? ''

  const loadSalidas = useCallback(async () => {
    setLoadingSalidas(true)
    setLoadError(null)
    try {
      const data = await fetchSalidas()
      setSalidas(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error al cargar las salidas')
    } finally {
      setLoadingSalidas(false)
    }
  }, [])

  useEffect(() => {
    void loadSalidas()
  }, [loadSalidas])

  const goToStep2 = useCallback(async () => {
    const valid = await trigger([
      'salidaId',
      'fechaFinalizacionReal',
      'estadoCierre',
      'altitudMaxima',
      'motivoAbandono',
    ])
    if (valid) setCurrentStep(2)
  }, [trigger])

  const goToStep3 = useCallback(async () => {
    const valid = await trigger(['huboCambios', 'motivosCambios', 'motivosCambiosOtro'])
    if (valid) setCurrentStep(3)
  }, [trigger])

  const goToStep4 = useCallback(async () => {
    const valid = await trigger([
      'ocurrioIncidente',
      'ocurrioAccidente',
      'tiposIncidente',
      'incidenteOtroDescripcion',
      'tiposAccidente',
      'accidenteOtroDescripcion',
    ])
    if (valid) setCurrentStep(4)
  }, [trigger])

  const goToStep5 = useCallback(async () => {
    const valid = await trigger([
      'desempenoEquipo',
      'detalleFallaEquipo',
      'observacionesRuta',
      'precisionPronostico',
    ])
    if (valid) setCurrentStep(5)
  }, [trigger])

  const onSubmit = useCallback(
    async (values: CierreFormValues) => {
      setIsSubmitting(true)
      setSubmitError(null)
      try {
        await createCierre({
            salidaId: values.salidaId,
            fechaFinalizacionReal: values.fechaFinalizacionReal,
            estadoCierre: values.estadoCierre,
            altitudMaxima: values.altitudMaxima,
            motivoAbandono: values.motivoAbandono,
            huboCambios: values.huboCambios!,
            motivosCambios: values.motivosCambios,
            motivosCambiosOtro: values.motivosCambiosOtro,
            ocurrioIncidente: values.ocurrioIncidente,
            ocurrioAccidente: values.ocurrioAccidente,
            tiposIncidente: values.tiposIncidente,
            incidenteOtroDescripcion: values.incidenteOtroDescripcion,
            tiposAccidente: values.tiposAccidente,
            accidenteOtroDescripcion: values.accidenteOtroDescripcion,
            desempenoEquipo: values.desempenoEquipo,
            detalleFallaEquipo: values.detalleFallaEquipo,
            observacionesRuta: values.observacionesRuta,
            precisionPronostico: values.precisionPronostico,
            leccionesAprendidas: values.leccionesAprendidas,
            recomendacionesFuturos: values.recomendacionesFuturos,
            sugerenciasClub: values.sugerenciasClub,
          })
          // La transición a COMPLETADA la realiza el backend de forma atómica al crear el cierre.
          if (gpxFile) {
            await uploadGpx(values.salidaId, gpxFile)
          }
        setSubmitSuccess(true)
        setTimeout(onDone, 1500)
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Error al guardar el cierre')
        setIsSubmitting(false)
      }
    },
    [onDone, gpxFile],
  )

  // ─── Success screen ─────────────────────────────────────────────────────────

  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-[#f0f4fb] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#e8eef7] mx-auto mb-4">
            <Check size={32} className="text-[#264c99]" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Cierre registrado</h2>
          <p className="text-[#757874] text-sm">Redirigiendo...</p>
        </div>
      </div>
    )
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f0f4fb] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#4a6fad]/15 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm text-[#757874] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] rounded transition-colors"
            aria-label="Cancelar y volver"
          >
            <X size={18} />
            <span className="hidden sm:inline">Cancelar</span>
          </button>
          <div className="flex items-center gap-2">
            <Mountain size={18} className="text-[#264c99]" />
            <span className="font-semibold text-slate-800 text-sm">Cierre de Actividad</span>
          </div>
          <span className="text-xs text-[#757874] font-medium">{currentStep} / 5</span>
        </div>
      </header>

      {/* Progress bars + step label */}
      <div className="bg-white border-b border-[#4a6fad]/10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-2">
          <div className="flex gap-1.5 mb-2" role="list" aria-label="Progreso del formulario">
            {([1, 2, 3, 4, 5] as const).map((s) => (
              <div
                key={s}
                role="listitem"
                className={[
                  'flex-1 h-1 rounded-full transition-colors duration-300',
                  s < currentStep
                    ? 'bg-[#264c99]'
                    : s === currentStep
                    ? 'bg-[#264c99]/60'
                    : 'bg-[#dde6f7]',
                ].join(' ')}
              />
            ))}
          </div>
          <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider">
            Paso {currentStep} &mdash; {STEP_LABELS[currentStep - 1]}
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900">{STEP_LABELS[currentStep - 1]}</h2>
          <p className="text-sm text-[#757874] mt-1">
            {currentStep === 1
              ? 'Registra cómo resultó la salida y cierra el expediente de la actividad.'
              : currentStep === 2
              ? 'Evalúa si la actividad se desarrolló según lo planificado.'
              : currentStep === 3
              ? 'Esta sección es el corazón del Catastro de Accidentes.'
              : currentStep === 4
              ? 'Evalúa el desempeño del equipamiento y las condiciones de la ruta.'
              : 'Comparte lo aprendido para mejorar futuras salidas.'}
          </p>
        </div>

        {loadingSalidas && (
          <div className="flex items-center gap-2 text-sm text-[#757874] py-6 justify-center">
            <Loader2 className="animate-spin text-[#264c99]" size={20} />
            Cargando salidas...
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 mb-5 text-sm text-[#8b3a44]">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {!loadingSalidas && !loadError && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">

            {/* ── PASO 1: Cierre de Actividad ─────────────────────────── */}
            {currentStep === 1 && (
              <>
                {/* Selección de Salida */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="salidaId" className="text-sm font-semibold text-[#264c99]">
                    Formulario de Salida asociado
                    <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                  </label>
                  {preselectedSalidaId ? (
                    <>
                      <p className="text-xs text-[#757874] -mt-0.5">
                        Cerrando la siguiente salida:
                      </p>
                      <input type="hidden" {...register('salidaId')} />
                      <div className="rounded-xl border border-[#4a6fad]/40 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900">
                        {(() => {
                          const s = salidas.find((x) => x.id === preselectedSalidaId)
                          return s ? `${s.nombreActividad} (${s.ubicacionGeografica})` : 'Cargando…'
                        })()}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-[#757874] -mt-0.5">
                        Selecciona la salida que deseas cerrar.
                      </p>
                      <div className="relative">
                        <select
                          id="salidaId"
                          {...register('salidaId')}
                          aria-invalid={errors.salidaId ? 'true' : undefined}
                          className={[
                            'w-full appearance-none rounded-xl border bg-white px-3 py-2 pr-9 text-sm text-slate-900',
                            'transition-colors duration-150',
                            'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
                            errors.salidaId
                              ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
                              : 'border-[#4a6fad]/40',
                          ].join(' ')}
                        >
                          <option value="">— Selecciona una salida —</option>
                          {salidas
                            .filter((s) => (isAdmin ? s.status === 'EN_CURSO' : s.userId === user.id))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nombreActividad} ({s.ubicacionGeografica})
                              </option>
                            ))}
                        </select>
                        <ChevronDown
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a6fad]/60 pointer-events-none"
                          size={16}
                        />
                      </div>
                    </>
                  )}
                  {errors.salidaId && (
                    <p className="text-xs text-[#A4636E]" role="alert">
                      {errors.salidaId.message}
                    </p>
                  )}
                </div>

                {/* Fecha de Finalización Real */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="fechaFinalizacionReal"
                    className="text-sm font-semibold text-[#264c99]"
                  >
                    Fecha de Finalización Real
                    <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="fechaFinalizacionReal"
                    type="date"
                    {...register('fechaFinalizacionReal')}
                    aria-invalid={errors.fechaFinalizacionReal ? 'true' : undefined}
                    className={[
                      'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900',
                      'transition-colors duration-150',
                      'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
                      errors.fechaFinalizacionReal
                        ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
                        : 'border-[#4a6fad]/40',
                    ].join(' ')}
                  />
                  {errors.fechaFinalizacionReal && (
                    <p className="text-xs text-[#A4636E]" role="alert">
                      {errors.fechaFinalizacionReal.message}
                    </p>
                  )}
                </div>

                {/* Estado de la Salida */}
                <Controller
                  control={control}
                  name="estadoCierre"
                  render={({ field }) => (
                    <RadioGroup<EstadoCierre>
                      label="Estado de la Salida"
                      required
                      options={ESTADOS}
                      labels={ESTADO_CIERRE_LABELS}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.estadoCierre?.message}
                    />
                  )}
                />

                {/* Altitud Máxima */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="altitudMaxima" className="text-sm font-semibold text-[#264c99]">
                    Altitud máxima alcanzada (m.s.n.m.)
                    <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                  </label>
                  <p className="text-xs text-[#757874] -mt-0.5">
                    Independiente si lograron o no el objetivo.
                  </p>
                  <input
                    id="altitudMaxima"
                    type="number"
                    min="0"
                    placeholder="Ej: 4500"
                    {...register('altitudMaxima', { valueAsNumber: true })}
                    className={[
                      'w-full md:w-1/2 rounded-xl border px-3 py-2.5 text-sm text-slate-900 bg-white',
                      'placeholder:text-[#757874]/50 focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-colors',
                      errors.altitudMaxima ? 'border-[#A4636E]' : 'border-[#4a6fad]/40',
                    ].join(' ')}
                  />
                  {errors.altitudMaxima && (
                    <p className="text-xs text-[#A4636E]" role="alert">
                      {errors.altitudMaxima.message}
                    </p>
                  )}
                </div>

                {/* Motivo de Abandono (condicional) */}
                {estadoSeleccionado === 'ABORTADA_INCOMPLETA' && (
                  <Controller
                    control={control}
                    name="motivoAbandono"
                    render={({ field }) => (
                      <RadioGroup<MotivoAbandono>
                        label="Si fue abortada, ¿cuál fue el motivo principal?"
                        required
                        options={MOTIVOS_ABANDONO}
                        labels={MOTIVO_ABANDONO_LABELS}
                        value={field.value}
                        onChange={field.onChange}
                        error={errors.motivoAbandono?.message}
                      />
                    )}
                  />
                )}

                {/* Navegación */}
                <div className="flex justify-end pt-2">
                  <Button type="button" variant="primary" size="lg" onClick={goToStep2}>
                    Siguiente
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </>
            )}

            {/* ── PASO 2: Evaluación de la Planificación ──────────────── */}
            {currentStep === 2 && (
              <>
                {/* Pregunta 5: ¿Hubo cambios? */}
                <Controller
                  control={control}
                  name="huboCambios"
                  render={({ field }) => (
                    <RadioGroup<'SI' | 'NO'>
                      label="¿Hubo cambios significativos respecto a lo planificado?"
                      required
                      options={HUBO_CAMBIOS}
                      labels={{ SI: 'Sí', NO: 'No' }}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.huboCambios?.message}
                    />
                  )}
                />

                {/* Pregunta 6: Motivos de cambio (condicional si huboCambios === 'SI') */}
                {huboCambiosVal === 'SI' && (
                  <>
                    <Controller
                      control={control}
                      name="motivosCambios"
                      render={({ field }) => (
                        <CheckboxGroup<MotivoCambio>
                          label="Si hubo cambios, ¿cuáles fueron los motivos?"
                          required
                          options={MOTIVOS_CAMBIO}
                          labels={MOTIVO_CAMBIO_LABELS}
                          selected={field.value ?? []}
                          onChange={field.onChange}
                          error={errors.motivosCambios?.message}
                        />
                      )}
                    />

                    {/* Campo "Otro" condicional */}
                    {showOtroMotivo && (
                      <div className="flex flex-col gap-1.5 pl-7">
                        <label
                          htmlFor="motivosCambiosOtro"
                          className="text-xs font-semibold text-[#264c99]"
                        >
                          Especifica el motivo
                        </label>
                        <input
                          id="motivosCambiosOtro"
                          type="text"
                          maxLength={100}
                          placeholder="Describe el motivo del cambio..."
                          {...register('motivosCambiosOtro')}
                          className={[
                            'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800',
                            'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                            errors.motivosCambiosOtro
                              ? 'border-[#A4636E]'
                              : 'border-[#4a6fad]/30',
                          ].join(' ')}
                        />
                        {errors.motivosCambiosOtro && (
                          <p className="text-xs text-[#A4636E]" role="alert">
                            {errors.motivosCambiosOtro.message}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Navegación */}
                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCurrentStep(1)}
                  >
                    <ChevronLeft size={18} />
                    Anterior
                  </Button>
                  <Button type="button" variant="primary" size="lg" onClick={goToStep3}>
                    Siguiente
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </>
            )}

            {/* ── PASO 3: Gestión de Incidentes y Accidentes ── */}
            {currentStep === 3 && (
              <>
                {/* Q1: ¿Hubo un incidente? */}
                <Controller
                  control={control}
                  name="ocurrioIncidente"
                  render={({ field }) => (
                    <RadioGroup<'SI' | 'NO'>
                      label="¿Hubo un incidente?"
                      required
                      labelExtra={
                        <InfoTooltip text="Un incidente es un evento no deseado que no provocó lesiones ni daño material, pero que tuvo potencial para hacerlo." />
                      }
                      options={SI_NO}
                      labels={SI_NO_LABELS}
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val)
                        if (val === 'NO') {
                          setValue('tiposIncidente', [])
                          setValue('incidenteOtroDescripcion', '')
                        }
                      }}
                      error={errors.ocurrioIncidente?.message}
                    />
                  )}
                />

                {/* Q1 detalle — solo si hubo incidente */}
                {ocurrioIncidenteVal === 'SI' && (
                  <div className="flex flex-col gap-4 pl-7 border-l-2 border-[#264c99]/20">
                    {/* Tipo de incidente */}
                    <Controller
                      control={control}
                      name="tiposIncidente"
                      render={({ field }) => (
                        <CheckboxGroup<TipoIncidente>
                          label="Tipo de incidente — Puedes marcar más de uno"
                          required
                          options={TIPOS_INCIDENTE}
                          labels={TIPO_INCIDENTE_LABELS}
                          selected={field.value ?? []}
                          onChange={(next) => {
                            field.onChange(next)
                            if (!next.includes('OTRO')) setValue('incidenteOtroDescripcion', '')
                          }}
                          error={errors.tiposIncidente?.message}
                        />
                      )}
                    />

                    {/* Descripción del incidente (solo si "Otro") */}
                    {showIncidenteOtro && (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="incidenteOtroDescripcion"
                          className="text-sm font-semibold text-[#264c99]"
                        >
                          Descripción del incidente
                          <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                        </label>
                        <textarea
                          id="incidenteOtroDescripcion"
                          maxLength={1000}
                          rows={4}
                          placeholder="Describe brevemente qué ocurrió, cómo se resolvió y si hay lecciones aprendidas."
                          {...register('incidenteOtroDescripcion')}
                          aria-invalid={errors.incidenteOtroDescripcion ? 'true' : undefined}
                          className={[
                            'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                            'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                            errors.incidenteOtroDescripcion ? 'border-[#A4636E]' : 'border-[#4a6fad]/30',
                          ].join(' ')}
                        />
                        <div className="flex justify-between items-center">
                          {errors.incidenteOtroDescripcion ? (
                            <p className="text-xs text-[#A4636E]" role="alert">
                              {errors.incidenteOtroDescripcion.message}
                            </p>
                          ) : (
                            <span />
                          )}
                          <span
                            className={[
                              'text-xs tabular-nums',
                              incidenteOtroDescripcionVal.length > 900
                                ? 'text-[#A4636E]'
                                : 'text-[#757874]',
                            ].join(' ')}
                          >
                            {incidenteOtroDescripcionVal.length} / 1000
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Q2: ¿Hubo un accidente? */}
                <Controller
                  control={control}
                  name="ocurrioAccidente"
                  render={({ field }) => (
                    <RadioGroup<'SI' | 'NO'>
                      label="¿Hubo un accidente?"
                      required
                      labelExtra={
                        <InfoTooltip text="Un accidente es un evento no deseado que resultó en lesión a persona/s o daño material significativo." />
                      }
                      options={SI_NO}
                      labels={SI_NO_LABELS}
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val)
                        if (val === 'NO') {
                          setValue('tiposAccidente', [])
                          setValue('accidenteOtroDescripcion', '')
                        }
                      }}
                      error={errors.ocurrioAccidente?.message}
                    />
                  )}
                />

                {/* Q2 detalle — solo si hubo accidente */}
                {ocurrioAccidenteVal === 'SI' && (
                  <div className="flex flex-col gap-4 pl-7 border-l-2 border-[#264c99]/20">
                    {/* Tipo de accidente */}
                    <Controller
                      control={control}
                      name="tiposAccidente"
                      render={({ field }) => (
                        <CheckboxGroup<TipoAccidente>
                          label="Tipo de accidente — Puedes marcar más de uno"
                          required
                          options={TIPOS_ACCIDENTE}
                          labels={TIPO_ACCIDENTE_LABELS}
                          selected={field.value ?? []}
                          onChange={(next) => {
                            field.onChange(next)
                            if (!next.includes('OTRO')) setValue('accidenteOtroDescripcion', '')
                          }}
                          error={errors.tiposAccidente?.message}
                        />
                      )}
                    />

                    {/* Descripción del accidente (solo si "Otro") */}
                    {showAccidenteOtro && (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="accidenteOtroDescripcion"
                          className="text-sm font-semibold text-[#264c99]"
                        >
                          Descripción del accidente
                          <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                        </label>
                        <textarea
                          id="accidenteOtroDescripcion"
                          maxLength={1000}
                          rows={4}
                          placeholder="Describe brevemente qué ocurrió, qué consecuencias tuvo, cómo se resolvió y si hay medidas preventivas o lecciones aprendidas."
                          {...register('accidenteOtroDescripcion')}
                          aria-invalid={errors.accidenteOtroDescripcion ? 'true' : undefined}
                          className={[
                            'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                            'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                            errors.accidenteOtroDescripcion ? 'border-[#A4636E]' : 'border-[#4a6fad]/30',
                          ].join(' ')}
                        />
                        <div className="flex justify-between items-center">
                          {errors.accidenteOtroDescripcion ? (
                            <p className="text-xs text-[#A4636E]" role="alert">
                              {errors.accidenteOtroDescripcion.message}
                            </p>
                          ) : (
                            <span />
                          )}
                          <span
                            className={[
                              'text-xs tabular-nums',
                              accidenteOtroDescripcionVal.length > 900
                                ? 'text-[#A4636E]'
                                : 'text-[#757874]',
                            ].join(' ')}
                          >
                            {accidenteOtroDescripcionVal.length} / 1000
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Navegación */}
                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCurrentStep(2)}
                  >
                    <ChevronLeft size={18} />
                    Anterior
                  </Button>
                  <Button type="button" variant="primary" size="lg" onClick={goToStep4}>
                    Siguiente
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </>
            )}
            {/* ── PASO 4: Análisis Técnico y de Equipamiento ─────────────────── */}
            {currentStep === 4 && (
              <>
                {/* Q12: Desempeño del Equipamiento */}
                <Controller
                  control={control}
                  name="desempenoEquipo"
                  render={({ field }) => (
                    <RadioGroup<DesempenoEquipo>
                      label="Desempeño del Equipamiento"
                      required
                      options={DESEMPENO_EQUIPO_OPTIONS}
                      labels={DESEMPENO_EQUIPO_LABELS}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.desempenoEquipo?.message}
                    />
                  )}
                />

                {/* Q13: Detalle de falla (condicional) */}
                {showDetalleFalla && (
                  <div className="flex flex-col gap-1.5 pl-7 border-l-2 border-[#A4636E]/20">
                    <label
                      htmlFor="detalleFallaEquipo"
                      className="text-sm font-semibold text-[#264c99]"
                    >
                      Detalle de falla de equipamiento
                      <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                    </label>
                    <p className="text-xs text-[#757874] -mt-0.5">
                      Ej: Se rompió un crampón, la radio no tenía alcance, etc.
                    </p>
                    <textarea
                      id="detalleFallaEquipo"
                      maxLength={1000}
                      rows={3}
                      placeholder="Describe la falla o daño ocurrido..."
                      {...register('detalleFallaEquipo')}
                      aria-invalid={errors.detalleFallaEquipo ? 'true' : undefined}
                      className={[
                        'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                        'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                        errors.detalleFallaEquipo
                          ? 'border-[#A4636E]'
                          : 'border-[#4a6fad]/30',
                      ].join(' ')}
                    />
                    <div className="flex justify-between items-center">
                      {errors.detalleFallaEquipo ? (
                        <p className="text-xs text-[#A4636E]" role="alert">
                          {errors.detalleFallaEquipo.message}
                        </p>
                      ) : (
                        <span />
                      )}
                      <span
                        className={[
                          'text-xs tabular-nums',
                          detalleFallaEquipoVal.length > 900
                            ? 'text-[#A4636E]'
                            : 'text-[#757874]',
                        ].join(' ')}
                      >
                        {detalleFallaEquipoVal.length} / 1000
                      </span>
                    </div>
                  </div>
                )}

                {/* Q14: Carga GPX */}
                <GpxFilePicker value={gpxFile} onChange={setGpxFile} />

                {/* Q15: Observaciones sobre la Ruta */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="observacionesRuta"
                    className="text-sm font-semibold text-[#264c99]"
                  >
                    Observaciones sobre la Ruta
                    <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                  </label>
                  <p className="text-xs text-[#757874] -mt-0.5">
                    Ej: &quot;Mucha más nieve de lo esperado&quot;, &quot;derrumbe&quot;,
                    &quot;Sin agua en el campamento base&quot;
                  </p>
                  <textarea
                    id="observacionesRuta"
                    maxLength={1000}
                    rows={4}
                    placeholder="Describe las condiciones reales de la ruta..."
                    {...register('observacionesRuta')}
                    aria-invalid={errors.observacionesRuta ? 'true' : undefined}
                    className={[
                      'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                      'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                      errors.observacionesRuta
                        ? 'border-[#A4636E]'
                        : 'border-[#4a6fad]/30',
                    ].join(' ')}
                  />
                  <div className="flex justify-between items-center">
                    {errors.observacionesRuta ? (
                      <p className="text-xs text-[#A4636E]" role="alert">
                        {errors.observacionesRuta.message}
                      </p>
                    ) : (
                      <span />
                    )}
                    <span
                      className={[
                        'text-xs tabular-nums',
                        observacionesRutaVal.length > 900
                          ? 'text-[#A4636E]'
                          : 'text-[#757874]',
                      ].join(' ')}
                    >
                      {observacionesRutaVal.length} / 1000
                    </span>
                  </div>
                </div>

                {/* Q16: Precisión del Pronóstico Meteorológico */}
                <Controller
                  control={control}
                  name="precisionPronostico"
                  render={({ field }) => (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="text-sm font-semibold text-[#264c99]">
                        Precisión del Pronóstico Meteorológico
                        <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                      </legend>
                      <div className="flex items-center justify-between gap-1 text-xs text-[#757874] mb-1">
                        <span>1 &mdash; Totalmente errado</span>
                        <span>5 &mdash; Muy preciso</span>
                      </div>
                      <div className="flex gap-2">
                        {([1, 2, 3, 4, 5] as const).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => field.onChange(n)}
                            className={[
                              'flex-1 py-3 rounded-xl border text-sm font-bold transition-all duration-150',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]/40',
                              field.value === n
                                ? 'bg-[#264c99] border-[#264c99] text-white'
                                : 'bg-white border-[#4a6fad]/30 text-slate-700 hover:border-[#264c99]/40 hover:bg-[#f5f8f5]',
                            ].join(' ')}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {errors.precisionPronostico && (
                        <p className="text-xs text-[#A4636E]" role="alert">
                          {errors.precisionPronostico.message}
                        </p>
                      )}
                    </fieldset>
                  )}
                />

                {/* Navegación */}
                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCurrentStep(3)}
                  >
                    <ChevronLeft size={18} />
                    Anterior
                  </Button>
                  <Button type="button" variant="primary" size="lg" onClick={goToStep5}>
                    Siguiente
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </>
            )}

            {/* ── PASO 5: Lecciones Aprendidas y Recomendaciones ──────── */}
            {currentStep === 5 && (
              <>
                {/* Q17: ¿Qué aprendió la cordada? */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="leccionesAprendidas"
                    className="text-sm font-semibold text-[#264c99]"
                  >
                    ¿Qué aprendió la cordada en esta salida?
                    <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="leccionesAprendidas"
                    maxLength={1000}
                    rows={4}
                    placeholder="Describe los aprendizajes clave de la cordada..."
                    {...register('leccionesAprendidas')}
                    aria-invalid={errors.leccionesAprendidas ? 'true' : undefined}
                    className={[
                      'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                      'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                      errors.leccionesAprendidas ? 'border-[#A4636E]' : 'border-[#4a6fad]/30',
                    ].join(' ')}
                  />
                  <div className="flex justify-between items-center">
                    {errors.leccionesAprendidas ? (
                      <p className="text-xs text-[#A4636E]" role="alert">
                        {errors.leccionesAprendidas.message}
                      </p>
                    ) : (
                      <span />
                    )}
                    <span
                      className={[
                        'text-xs tabular-nums',
                        leccionesAprendidasVal.length > 900 ? 'text-[#A4636E]' : 'text-[#757874]',
                      ].join(' ')}
                    >
                      {leccionesAprendidasVal.length} / 1000
                    </span>
                  </div>
                </div>

                {/* Q18: Recomendaciones para futuros socios */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="recomendacionesFuturos"
                    className="text-sm font-semibold text-[#264c99]"
                  >
                    Recomendaciones para futuros socios que realicen esta ruta
                  </label>
                  <textarea
                    id="recomendacionesFuturos"
                    maxLength={1000}
                    rows={4}
                    placeholder="Consejos prácticos para quienes repitan esta ruta..."
                    {...register('recomendacionesFuturos')}
                    className={[
                      'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                      'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                      'border-[#4a6fad]/30',
                    ].join(' ')}
                  />
                  <div className="flex justify-end">
                    <span
                      className={[
                        'text-xs tabular-nums',
                        recomendacionesFuturosVal.length > 900
                          ? 'text-[#A4636E]'
                          : 'text-[#757874]',
                      ].join(' ')}
                    >
                      {recomendacionesFuturosVal.length} / 1000
                    </span>
                  </div>
                </div>

                {/* Q19: Sugerencias para el Club */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="sugerenciasClub"
                    className="text-sm font-semibold text-[#264c99]"
                  >
                    Sugerencias para el Club
                  </label>
                  <p className="text-xs text-[#757874] -mt-0.5">
                    Ej: &quot;Se necesita renovar las cuerdas de 60m&quot;, &quot;Falta
                    capacitación en uso de GPS&quot;.
                  </p>
                  <textarea
                    id="sugerenciasClub"
                    maxLength={1000}
                    rows={4}
                    placeholder="Comparte tus sugerencias con el Club..."
                    {...register('sugerenciasClub')}
                    className={[
                      'w-full px-3 py-2 rounded-xl border bg-white text-sm text-slate-800 resize-none',
                      'placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
                      'border-[#4a6fad]/30',
                    ].join(' ')}
                  />
                  <div className="flex justify-end">
                    <span
                      className={[
                        'text-xs tabular-nums',
                        sugerenciasClubVal.length > 900 ? 'text-[#A4636E]' : 'text-[#757874]',
                      ].join(' ')}
                    >
                      {sugerenciasClubVal.length} / 1000
                    </span>
                  </div>
                </div>

                {/* Error de envío */}
                {submitError && (
                  <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Navegación */}
                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCurrentStep(4)}
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
                    <Check size={18} />
                    Registrar cierre
                  </Button>
                </div>
              </>
            )}
          </form>
        )}
      </main>
    </div>
  )
}

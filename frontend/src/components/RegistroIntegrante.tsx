import { useForm, Controller, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronLeft, Check, User } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { createIntegrante } from '../lib/api'
import {
  registroIntegranteSchema,
  type IntegranteFormData,
  type IntegranteField,
  type RegistroIntegranteStepId,
  REGISTRO_INTEGRANTE_STEPS,
  REGISTRO_INTEGRANTE_STEP_FIELDS,
  FIRST_STEP,
  LAST_STEP,
  nextStep,
  previousStep,
  firstStepWithErrors,
  firstErrorFieldInStep,
  progressLabel,
  validateRegistroStep,
} from '../lib/registro-integrante-steps'

// ─── RUT formatter ───────────────────────────────────────────────────────────

function formatRut(value: string): string {
  const clean = value.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length <= 1) return clean
  const dv = clean.slice(-1)
  const body = clean.slice(0, -1)
  const bodyFormatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${bodyFormatted}-${dv}`
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIONES = [
  'Metropolitana de Santiago',
  'Arica y Parinacota',
  'Tarapacá',
  'Antofagasta',
  'Atacama',
  'Coquimbo',
  'Valparaíso',
  'Libertador Gral Bernardo O\'Higgins',
  'Maule',
  'Ñuble',
  'Biobío',
  'La Araucanía',
  'Los Ríos',
  'Los Lagos',
  'Aysén del Gral Carlos Ibáñez del Campo',
  'Magallanes y de la Antártica Chilena',
]

const PREVISIONES = [
  'Fonasa',
  'Banmédica',
  'Colmena',
  'Consalud',
  'Cruz Blanca',
  'Nueva MasVida',
  'Vida Tres',
  'Esencial',
  'Fundación - Banco Estado',
  'Isalud - Codelco',
  'Sistema de Salud del Ejército',
]

const GRUPOS_SANGUINEOS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Lo Desconozco']

const GENEROS = [
  { value: 'FEMENINO', label: 'Femenino' },
  { value: 'MASCULINO', label: 'Masculino' },
  { value: 'PREFIERO_NO_DECIRLO', label: 'Prefiero no decirlo' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  number,
  title,
  headingRef,
}: {
  number: string
  title: string
  headingRef?: RefObject<HTMLHeadingElement | null>
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span
        aria-hidden="true"
        className="flex-shrink-0 w-7 h-7 rounded-full bg-[#264c99] text-white text-xs font-bold flex items-center justify-center"
      >
        {number}
      </span>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-bold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1 rounded"
      >
        {title}
      </h3>
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-xs text-[#A4636E] mt-1" role="alert">
      {message}
    </p>
  )
}


interface SingleSelectChipProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  error?: string
  required?: boolean
}

function SingleSelectChip({ label, options, value, onChange, error, required }: SingleSelectChipProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        {required && <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>}
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
      <FieldError message={error} />
    </fieldset>
  )
}

interface YesNoFieldProps {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  error?: string
}

function YesNoField({ label, value, onChange, error }: YesNoFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-[#264c99]">
        {label}
        <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
      </legend>
      <div className="flex gap-2">
        {([true, false] as const).map((opt) => {
          const selected = value === opt
          const btnLabel = opt ? 'Sí' : 'No'
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(opt)}
              aria-pressed={selected}
              className={[
                'px-6 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1',
                selected
                  ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                  : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
              ].join(' ')}
            >
              {btnLabel}
            </button>
          )
        })}
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

interface YesNoWithDetailProps {
  label: string
  tiene: boolean | undefined
  detalle: string
  onChangeTiene: (v: boolean) => void
  onChangeDetalle: (v: string) => void
  errorTiene?: string
  errorDetalle?: string
  placeholder?: string
}

function YesNoWithDetail({
  label,
  tiene,
  detalle,
  onChangeTiene,
  onChangeDetalle,
  errorTiene,
  errorDetalle,
  placeholder,
}: YesNoWithDetailProps) {
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-[#264c99]">
          {label}
          <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
        </legend>
        <div className="flex gap-2">
          {([true, false] as const).map((opt) => {
            const selected = tiene === opt
            return (
              <button
                key={String(opt)}
                type="button"
                onClick={() => onChangeTiene(opt)}
                aria-pressed={selected}
                className={[
                  'px-6 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] focus-visible:ring-offset-1',
                  selected
                    ? 'bg-[#264c99] text-white border-[#264c99] shadow-sm'
                    : 'bg-white text-slate-700 border-[#4a6fad]/40 hover:border-[#264c99] hover:text-[#264c99]',
                ].join(' ')}
              >
                {opt ? 'Sí' : 'No'}
              </button>
            )
          })}
        </div>
        <FieldError message={errorTiene} />
      </fieldset>
      {tiene === true && (
        <div className="flex flex-col gap-1">
          <textarea
            rows={3}
            placeholder={placeholder}
            maxLength={200}
            value={detalle}
            onChange={(e) => onChangeDetalle(e.target.value)}
            className={[
              'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-[#757874]/50 resize-none',
              'transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
              errorDetalle ? 'border-[#A4636E]' : 'border-[#4a6fad]/40',
            ].join(' ')}
          />
          <p className="text-xs text-[#757874] self-end">{detalle.length}/200</p>
          <FieldError message={errorDetalle} />
        </div>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface RegistroIntegranteProps {
  onBack: () => void
  defaultEmail?: string
  onComplete?: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RegistroIntegrante({ onBack, defaultEmail, onComplete }: RegistroIntegranteProps) {
  const [success, setSuccess] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<RegistroIntegranteStepId>(FIRST_STEP)
  const [completedSteps, setCompletedSteps] = useState<Set<RegistroIntegranteStepId>>(new Set())

  const stepHeadingRef = useRef<HTMLHeadingElement>(null)
  // Campo a enfocar en el próximo cambio de paso cuando este lo provoca un
  // error de validación (en vez del foco "normal", que va al título del
  // paso) — ver el efecto de cambio de paso y onInvalid más abajo.
  const pendingFocusFieldRef = useRef<IntegranteField | null>(null)
  const isFirstRenderRef = useRef(true)

  const form = useForm<IntegranteFormData>({
    resolver: zodResolver(registroIntegranteSchema),
    defaultValues: {
      nombreCompleto: '',
      rut: '',
      nacionalidad: '',
      genero: undefined,
      fechaNacimiento: '',
      direccion: '',
      comuna: '',
      region: '',
      telefonoCelular: '',
      email: defaultEmail ?? '',
      previsionSalud: '',
      nombreContacto: '',
      parentesco: '',
      telefonoContacto: '',
      grupoSanguineo: '',
      alergiasTiene: undefined as unknown as boolean,
      alergiasDetalle: '',
      enfermedadesCronicasTiene: undefined as unknown as boolean,
      enfermedadesCronicasDetalle: '',
      medicamentosTiene: undefined as unknown as boolean,
      medicamentosDetalle: '',
      cirugiasLesionesTiene: undefined as unknown as boolean,
      cirugiasLesionesDetalle: '',
      fuma: undefined as unknown as boolean,
      usaLentes: undefined as unknown as boolean,
      declaracionSalud: undefined as unknown as true,
      aceptacionRiesgo: undefined as unknown as true,
      consentimientoDatos: undefined as unknown as true,
      derechoImagen: undefined as unknown as true,
    },
  })

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    clearErrors,
    setFocus,
    formState: { errors, isSubmitting, isDirty },
  } = form

  // Un solo watch() para TODOS los campos: alimenta tanto el render (los
  // YesNoWithDetail de abajo leen de `values`) como el efecto de
  // revalidación en vivo del paso actual, más abajo.
  const values = watch()

  // La ficha contiene datos médicos: el progreso del wizard vive SOLO EN
  // MEMORIA (el estado de React), nunca en localStorage/sessionStorage — a
  // diferencia del wizard de salida (frontend/src/lib/storage.ts), que sí
  // cachea localmente porque no maneja datos sensibles.

  // No valida ni pierde datos: solo mueve el paso actual hacia atrás.
  function goBack() {
    setCurrentStep((step) => previousStep(step))
  }

  // "Siguiente" valida ÚNICAMENTE los campos del paso actual, con SU PROPIO
  // schema (validateRegistroStep) — nunca con el schema completo: ese
  // dependía de que el paso 4 (más adelante) ya estuviera lleno para poder
  // correr las reglas condicionales del paso 3 (ver el comentario junto a
  // CONDITIONAL_DETAIL_RULES en lib/registro-integrante-steps.ts).
  function handleNext() {
    const fields = REGISTRO_INTEGRANTE_STEP_FIELDS[currentStep]
    clearErrors(fields)
    const issues = validateRegistroStep(currentStep, getValues())
    if (issues.length > 0) {
      for (const issue of issues) {
        setError(issue.field, { type: 'manual', message: issue.message })
      }
      const firstInvalid = fields.find((field) => issues.some((issue) => issue.field === field))
      if (firstInvalid) setFocus(firstInvalid)
      return
    }
    setCompletedSteps((prev) => {
      const next = new Set(prev)
      next.add(currentStep)
      return next
    })
    setCurrentStep((step) => nextStep(step))
  }

  // Revalidación en vivo del paso actual: si un campo mostraba error y la
  // persona lo corrige (o cambia la respuesta Sí/No que lo hacía
  // obligatorio) sin pasar de nuevo por "Siguiente", el error desaparece
  // solo. Usa el mismo validateRegistroStep (nunca el schema completo), así
  // que nunca reintroduce el bug de depender de otro paso. Solo LIMPIA
  // errores que ya no aplican — nunca crea uno nuevo mientras se escribe.
  useEffect(() => {
    const fields = REGISTRO_INTEGRANTE_STEP_FIELDS[currentStep]
    const issues = validateRegistroStep(currentStep, values)
    const stillInvalid = new Set(issues.map((issue) => issue.field))
    for (const field of fields) {
      if (!stillInvalid.has(field)) clearErrors(field)
    }
  }, [values, currentStep, clearErrors])

  // Advierte antes de perder datos sin enviar — se desactiva sola tras un
  // envío exitoso (success) o si el formulario nunca se tocó (isDirty).
  useEffect(() => {
    if (!isDirty || success) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, success])

  function handleLeave() {
    if (isDirty && !success) {
      const confirmado = window.confirm(
        'Tienes datos sin guardar. Si sales ahora se perderán. ¿Deseas salir de todas formas?',
      )
      if (!confirmado) return
    }
    onBack()
  }

  // En cada cambio de paso: sube el scroll y mueve el foco — al primer campo
  // inválido si el cambio lo provocó un error (ver onInvalid), o si no al
  // título del paso (tabIndex=-1), con la etiqueta de progreso anunciando el
  // cambio via aria-live="polite". Se omite en el montaje inicial: la página
  // ya abre arriba y no hace falta robarle el foco a la pantalla anterior.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    window.scrollTo(0, 0)
    const pendingField = pendingFocusFieldRef.current
    pendingFocusFieldRef.current = null
    if (pendingField) {
      setFocus(pendingField)
    } else {
      stepHeadingRef.current?.focus()
    }
  }, [currentStep, setFocus])

  async function onSubmit(data: IntegranteFormData) {
    setApiError(null)
    try {
      await createIntegrante({
        nombreCompleto: data.nombreCompleto,
        rut: data.rut,
        nacionalidad: data.nacionalidad,
        genero: data.genero,
        fechaNacimiento: data.fechaNacimiento,
        direccion: data.direccion,
        comuna: data.comuna,
        region: data.region,
        telefonoCelular: data.telefonoCelular,
        email: data.email,
        previsionSalud: data.previsionSalud,
        nombreContacto: data.nombreContacto,
        parentesco: data.parentesco,
        telefonoContacto: data.telefonoContacto,
        grupoSanguineo: data.grupoSanguineo,
        alergiasTiene: data.alergiasTiene,
        alergiasDetalle: data.alergiasDetalle,
        enfermedadesCronicasTiene: data.enfermedadesCronicasTiene,
        enfermedadesCronicasDetalle: data.enfermedadesCronicasDetalle,
        medicamentosTiene: data.medicamentosTiene,
        medicamentosDetalle: data.medicamentosDetalle,
        cirugiasLesionesTiene: data.cirugiasLesionesTiene,
        cirugiasLesionesDetalle: data.cirugiasLesionesDetalle,
        fuma: data.fuma,
        usaLentes: data.usaLentes,
        declaracionSalud: data.declaracionSalud,
        aceptacionRiesgo: data.aceptacionRiesgo,
        consentimientoDatos: data.consentimientoDatos,
        derechoImagen: data.derechoImagen,
      })
      setSuccess(true)
      if (onComplete) {
        setTimeout(onComplete, 1800)
      } else {
        setTimeout(onBack, 1800)
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Error al registrar el integrante')
    }
  }

  // El submit final valida TODO el schema (handleSubmit siempre lo hace). Si
  // queda un campo inválido en un paso ANTERIOR (por ejemplo: se editó algo
  // con "Atrás", que nunca valida, y no se volvió a pasar por "Siguiente"),
  // salta al primer paso con error y enfoca ese campo.
  function onInvalid(formErrors: FieldErrors<IntegranteFormData>) {
    const step = firstStepWithErrors(formErrors)
    if (step === undefined) return
    const firstInvalidField = firstErrorFieldInStep(step, formErrors)
    if (step !== currentStep) {
      pendingFocusFieldRef.current = firstInvalidField ?? null
      setCurrentStep(step)
    } else if (firstInvalidField) {
      setFocus(firstInvalidField)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#f0f4fb] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#e8eef7] mx-auto mb-4">
            <Check size={32} className="text-[#264c99]" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Integrante registrado</h2>
          <p className="text-[#757874] text-sm">
            {onComplete ? '¡Todo listo! Accediendo al sistema...' : 'Volviendo al formulario...'}
          </p>
        </div>
      </div>
    )
  }

  const stepMeta = REGISTRO_INTEGRANTE_STEPS[currentStep - 1]
  const isLastStep = currentStep === LAST_STEP

  return (
    <div className="min-h-screen bg-[#f0f4fb] flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-[#4a6fad]/15 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={handleLeave}
            className="flex items-center gap-1.5 text-sm text-[#757874] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] rounded transition-colors"
            aria-label="Volver"
          >
            <ChevronLeft size={18} />
            <span className="hidden sm:inline">Volver</span>
          </button>
          <div className="flex items-center gap-2 ml-2">
            <User size={18} className="text-[#264c99]" />
            <span className="font-semibold text-slate-800 text-sm">Registro de Integrante</span>
          </div>
        </div>
      </header>

      {/* Stepper — puramente informativo: la única forma de moverse entre
          pasos es "Siguiente"/"Atrás" (más abajo), nunca tocando estas
          barras. */}
      <div className="bg-white border-b border-[#4a6fad]/10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-2">
          <div className="flex gap-1.5 mb-2" role="list" aria-label="Progreso del formulario">
            {REGISTRO_INTEGRANTE_STEPS.map((step) => {
              const isCompleted = completedSteps.has(step.id)
              const isActive = step.id === currentStep
              return (
                <div
                  key={step.id}
                  role="listitem"
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`Paso ${step.id}: ${step.title}${isCompleted ? ' (completado)' : isActive ? ' (actual)' : ''}`}
                  className={[
                    'flex-1 h-1.5 rounded-full transition-colors duration-300',
                    isCompleted || isActive ? 'bg-[#264c99]' : 'bg-[#dde6f7]',
                  ].join(' ')}
                />
              )
            })}
          </div>
          {/* Solo "Paso N de 4": el título no se repite acá — ya es el
              encabezado del paso, más abajo. aria-live anuncia el cambio de
              conteo; el cambio de foco al encabezado (ver el efecto de
              cambio de paso) anuncia el título por su cuenta. */}
          <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider" aria-live="polite">
            {progressLabel(currentStep)}
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <p className="text-sm text-[#757874] mb-6">
          Completa la ficha de registro y datos médicos del integrante. Todos los campos marcados con{' '}
          <span className="text-[#A4636E] font-semibold">*</span> son obligatorios.
        </p>

        {apiError && (
          <div className="rounded-xl border border-[#A4636E]/30 bg-[#f5e8ea] px-4 py-3 text-sm text-[#8b3a44] mb-5">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="flex flex-col gap-6">
          <div key={currentStep} className="motion-safe:animate-step-in flex flex-col gap-6">
            {currentStep === 1 && (
              <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
                <SectionHeader number="I" title={stepMeta.title} headingRef={stepHeadingRef} />

                <Input
                  label="Nombre Completo"
                  placeholder="Ej: Juan Andrés Pérez González"
                  required
                  autoComplete="name"
                  maxLength={100}
                  error={errors.nombreCompleto?.message}
                  {...register('nombreCompleto')}
                />

                <Controller
                  control={control}
                  name="rut"
                  render={({ field }) => (
                    <Input
                      label="RUT"
                      placeholder="12.345.678-K"
                      required
                      error={errors.rut?.message}
                      value={field.value}
                      onChange={(e) => field.onChange(formatRut(e.target.value))}
                    />
                  )}
                />

                <Input
                  label="Nacionalidad"
                  placeholder="Ej: Chilena"
                  required
                  error={errors.nacionalidad?.message}
                  {...register('nacionalidad')}
                />

                <Controller
                  control={control}
                  name="genero"
                  render={({ field }) => (
                    <SingleSelectChip
                      label="Género"
                      options={GENEROS}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      error={errors.genero?.message}
                      required
                    />
                  )}
                />

                <Input
                  label="Fecha de Nacimiento"
                  type="date"
                  required
                  error={errors.fechaNacimiento?.message}
                  {...register('fechaNacimiento')}
                />

                <Input
                  label="Dirección"
                  placeholder="Calle, número, depto..."
                  required
                  maxLength={100}
                  error={errors.direccion?.message}
                  {...register('direccion')}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Comuna"
                    placeholder="Ej: Las Condes"
                    required
                    maxLength={100}
                    error={errors.comuna?.message}
                    {...register('comuna')}
                  />

                  <Select
                    label="Región"
                    required
                    placeholder="Selecciona tu región"
                    options={REGIONES.map((r) => ({ value: r, label: r }))}
                    error={errors.region?.message}
                    {...register('region')}
                  />
                </div>

                <Input
                  label="Teléfono Celular"
                  type="tel"
                  placeholder="+56 9 1234 5678"
                  required
                  autoComplete="tel"
                  inputMode="numeric"
                  error={errors.telefonoCelular?.message}
                  {...register('telefonoCelular')}
                />

                <Input
                  label="Email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  required
                  autoComplete="email"
                  maxLength={100}
                  error={errors.email?.message}
                  readOnly={!!defaultEmail}
                  title={defaultEmail ? 'Este email corresponde a tu cuenta de usuario' : undefined}
                  className={defaultEmail ? 'bg-slate-50 cursor-not-allowed' : undefined}
                  {...register('email')}
                />

                <Select
                  label="Previsión de Salud"
                  required
                  placeholder="Selecciona tu previsión"
                  options={PREVISIONES.map((p) => ({ value: p, label: p }))}
                  error={errors.previsionSalud?.message}
                  {...register('previsionSalud')}
                />
              </div>
            )}

            {currentStep === 2 && (
              <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
                <SectionHeader number="II" title={stepMeta.title} headingRef={stepHeadingRef} />

                <Input
                  label="Nombre del Contacto"
                  placeholder="Nombre completo"
                  required
                  maxLength={100}
                  error={errors.nombreContacto?.message}
                  {...register('nombreContacto')}
                />

                <Input
                  label="Parentesco"
                  placeholder="Ej: Madre, Cónyuge, Hermano..."
                  required
                  maxLength={100}
                  error={errors.parentesco?.message}
                  {...register('parentesco')}
                />

                <Input
                  label="Teléfono de Contacto"
                  type="tel"
                  placeholder="+56 9 1234 5678"
                  required
                  inputMode="numeric"
                  error={errors.telefonoContacto?.message}
                  {...register('telefonoContacto')}
                />
              </div>
            )}

            {currentStep === 3 && (
              <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
                <SectionHeader number="III" title={stepMeta.title} headingRef={stepHeadingRef} />

                <Controller
                  control={control}
                  name="grupoSanguineo"
                  render={({ field }) => (
                    <SingleSelectChip
                      label="Grupo Sanguíneo y Factor RH"
                      options={GRUPOS_SANGUINEOS.map((g) => ({ value: g, label: g }))}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.grupoSanguineo?.message}
                      required
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="alergiasTiene"
                  render={({ field }) => (
                    <YesNoWithDetail
                      label="Alergias Conocidas"
                      tiene={values.alergiasTiene}
                      detalle={values.alergiasDetalle ?? ''}
                      onChangeTiene={field.onChange}
                      onChangeDetalle={(v) => setValue('alergiasDetalle', v)}
                      errorTiene={errors.alergiasTiene?.message}
                      errorDetalle={errors.alergiasDetalle?.message}
                      placeholder="Ej: Penicilina, mariscos, picaduras de abejas..."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="enfermedadesCronicasTiene"
                  render={({ field }) => (
                    <YesNoWithDetail
                      label="Enfermedades Crónicas"
                      tiene={values.enfermedadesCronicasTiene}
                      detalle={values.enfermedadesCronicasDetalle ?? ''}
                      onChangeTiene={field.onChange}
                      onChangeDetalle={(v) => setValue('enfermedadesCronicasDetalle', v)}
                      errorTiene={errors.enfermedadesCronicasTiene?.message}
                      errorDetalle={errors.enfermedadesCronicasDetalle?.message}
                      placeholder="Ej: Diabetes tipo 2, hipertensión, asma..."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="medicamentosTiene"
                  render={({ field }) => (
                    <YesNoWithDetail
                      label="¿Toma medicamentos de forma regular?"
                      tiene={values.medicamentosTiene}
                      detalle={values.medicamentosDetalle ?? ''}
                      onChangeTiene={field.onChange}
                      onChangeDetalle={(v) => setValue('medicamentosDetalle', v)}
                      errorTiene={errors.medicamentosTiene?.message}
                      errorDetalle={errors.medicamentosDetalle?.message}
                      placeholder="Ej: Metformina 500mg, Losartán 50mg..."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="cirugiasLesionesTiene"
                  render={({ field }) => (
                    <YesNoWithDetail
                      label="Cirugías o Lesiones"
                      tiene={values.cirugiasLesionesTiene}
                      detalle={values.cirugiasLesionesDetalle ?? ''}
                      onChangeTiene={field.onChange}
                      onChangeDetalle={(v) => setValue('cirugiasLesionesDetalle', v)}
                      errorTiene={errors.cirugiasLesionesTiene?.message}
                      errorDetalle={errors.cirugiasLesionesDetalle?.message}
                      placeholder="Ej: Meniscectomía rodilla derecha (03/2022), fractura tobillo (2019)..."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="fuma"
                  render={({ field }) => (
                    <YesNoField
                      label="¿Fuma?"
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.fuma?.message}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="usaLentes"
                  render={({ field }) => (
                    <YesNoField
                      label="¿Usa lentes ópticos?"
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.usaLentes?.message}
                    />
                  )}
                />
              </div>
            )}

            {currentStep === 4 && (
              <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
                <SectionHeader number="IV" title={stepMeta.title} headingRef={stepHeadingRef} />

                {/* Cláusula 1 */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]/60 p-4">
                    <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider mb-2">
                      1. Declaración de Salud y Aptitud Física
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      El firmante declara que se encuentra en condiciones físicas y psíquicas aptas para la
                      práctica de deportes de montaña (senderismo, escalada, montañismo y otras actividades
                      relacionadas). Declara que la información proporcionada en este formulario es veraz y
                      completa, asumiendo que la ocultación de antecedentes médicos puede comprometer su
                      seguridad y la del grupo.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="declaracionSalud"
                    render={({ field }) => (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.value === true}
                          onChange={(e) =>
                            field.onChange(e.target.checked ? true : (undefined as unknown as true))
                          }
                          className="mt-0.5 w-4 h-4 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99]"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          He leído y estoy de acuerdo
                          <span className="text-[#A4636E] ml-1">*</span>
                        </span>
                      </label>
                    )}
                  />
                  <FieldError message={errors.declaracionSalud?.message} />
                </div>

                {/* Cláusula 2 */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]/60 p-4">
                    <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider mb-2">
                      2. Aceptación de Riesgo y Exención de Responsabilidad
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed mb-3">
                      Reconozco que las actividades de montaña son intrínsecamente riesgosas y pueden
                      implicar peligros derivados del terreno, clima extremo, caída de rocas, fallas de equipo y
                      otros factores objetivos y subjetivos que pueden resultar en lesiones graves o la muerte.
                    </p>
                    <ul className="flex flex-col gap-2">
                      <li className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-[#4a6fad]/30">
                        <span className="font-medium">Exención:</span> Libero de toda responsabilidad civil y
                        criminal al Club, a sus directivos, guías, instructores y miembros, por cualquier
                        accidente o incidente derivado de los riesgos propios de la actividad o de mi propia
                        negligencia, siempre que el club haya actuado bajo los protocolos de seguridad estándar.
                      </li>
                      <li className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-[#4a6fad]/30">
                        El Club no se hace responsable por accidentes derivados de la omisión de información o
                        negligencia de los participantes.
                      </li>
                    </ul>
                  </div>
                  <Controller
                    control={control}
                    name="aceptacionRiesgo"
                    render={({ field }) => (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.value === true}
                          onChange={(e) =>
                            field.onChange(e.target.checked ? true : (undefined as unknown as true))
                          }
                          className="mt-0.5 w-4 h-4 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99]"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          He leído y estoy de acuerdo
                          <span className="text-[#A4636E] ml-1">*</span>
                        </span>
                      </label>
                    )}
                  />
                  <FieldError message={errors.aceptacionRiesgo?.message} />
                </div>

                {/* Cláusula 3 */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]/60 p-4">
                    <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider mb-2">
                      3. Consentimiento de Uso de Datos Personales (Ley 19.628)
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed mb-3">
                      En cumplimiento con la Ley N° 19.628 sobre Protección de la Vida Privada, autorizo
                      expresamente al Club para:
                    </p>
                    <ul className="flex flex-col gap-2 mb-3">
                      <li className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-[#4a6fad]/30">
                        Tratar mis datos personales y sensibles (salud) con el fin exclusivo de gestionar mi
                        participación en actividades y responder ante emergencias médicas.
                      </li>
                      <li className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-[#4a6fad]/30">
                        Almacenar de forma segura esta información, la cual solo será accesible por el cuerpo
                        técnico o servicios de emergencia en caso de ser necesario.
                      </li>
                      <li className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-[#4a6fad]/30">
                        Comunicar estos datos a centros de salud o cuerpos de socorro en caso de rescate o
                        atención urgente.
                      </li>
                    </ul>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">
                      Los datos serán utilizados exclusivamente para la gestión de seguridad en montaña,
                      coordinación de rescates, registro estadístico de incidentes y cumplimiento de protocolos
                      internos del club.
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">
                      El titular de los datos podrá ejercer en cualquier momento sus derechos de Acceso,
                      Rectificación, Cancelación y Oposición mediante comunicación escrita a la directiva del Club.
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      Los datos se conservarán durante el periodo necesario para la gestión de la actividad y el
                      posterior análisis estadístico anónimo, tras lo cual serán eliminados o debidamente
                      anonimizados.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="consentimientoDatos"
                    render={({ field }) => (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.value === true}
                          onChange={(e) =>
                            field.onChange(e.target.checked ? true : (undefined as unknown as true))
                          }
                          className="mt-0.5 w-4 h-4 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99]"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          He leído y estoy de acuerdo
                          <span className="text-[#A4636E] ml-1">*</span>
                        </span>
                      </label>
                    )}
                  />
                  <FieldError message={errors.consentimientoDatos?.message} />
                </div>

                {/* Cláusula 4 */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]/60 p-4">
                    <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider mb-2">
                      4. Derecho de Imagen
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      Autorizo el uso de fotografías o videos capturados durante las salidas para fines
                      promocionales o educativos del club, sin derecho a compensación económica.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="derechoImagen"
                    render={({ field }) => (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.value === true}
                          onChange={(e) =>
                            field.onChange(e.target.checked ? true : (undefined as unknown as true))
                          }
                          className="mt-0.5 w-4 h-4 rounded border-[#4a6fad]/40 text-[#264c99] focus:ring-[#264c99]"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          He leído y estoy de acuerdo
                          <span className="text-[#A4636E] ml-1">*</span>
                        </span>
                      </label>
                    )}
                  />
                  <FieldError message={errors.derechoImagen?.message} />
                </div>
              </div>
            )}
          </div>

          {/* Navegación del wizard */}
          <div className="flex items-center gap-3 pb-8">
            {currentStep > FIRST_STEP && (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={goBack}
                disabled={isSubmitting}
              >
                Atrás
              </Button>
            )}
            {isLastStep ? (
              <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : 'Registrar Integrante'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={handleNext}
                disabled={isSubmitting}
              >
                Siguiente
              </Button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

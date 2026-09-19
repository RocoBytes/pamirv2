import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, Check, User } from 'lucide-react'
import { useState } from 'react'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { createIntegrante } from '../lib/api'

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

// ─── Schema ───────────────────────────────────────────────────────────────────

const RUT_REGEX = /^\d{1,2}\.\d{3}\.\d{3}-[\dKk]$/

const schema = z
  .object({
    // Sección I
    nombreCompleto: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    rut: z.string().regex(RUT_REGEX, 'Formato inválido. Ej: 12.345.678-K'),
    nacionalidad: z.string().min(1, 'Campo requerido'),
    genero: z.enum(['FEMENINO', 'MASCULINO', 'PREFIERO_NO_DECIRLO'], {
      error: 'Selecciona una opción',
    }),
    fechaNacimiento: z.string().min(1, 'Selecciona tu fecha de nacimiento'),
    direccion: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    comuna: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    region: z.string().min(1, 'Selecciona una región'),
    telefonoCelular: z.string().min(1, 'Campo requerido').regex(/^\+?[\d\s\-()]{7,15}$/, 'Teléfono inválido'),
    email: z.string().min(1, 'Campo requerido').email('Email inválido').max(100, 'Máximo 100 caracteres'),
    previsionSalud: z.string().min(1, 'Selecciona tu previsión de salud'),

    // Sección II
    nombreContacto: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    parentesco: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    telefonoContacto: z.string().min(1, 'Campo requerido').regex(/^\+?[\d\s\-()]{7,15}$/, 'Teléfono inválido'),

    // Sección III
    grupoSanguineo: z.string().min(1, 'Selecciona tu grupo sanguíneo'),
    alergiasTiene: z.boolean({ error: 'Selecciona una opción' }),
    alergiasDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    enfermedadesCronicasTiene: z.boolean({ error: 'Selecciona una opción' }),
    enfermedadesCronicasDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    medicamentosTiene: z.boolean({ error: 'Selecciona una opción' }),
    medicamentosDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    cirugiasLesionesTiene: z.boolean({ error: 'Selecciona una opción' }),
    cirugiasLesionesDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    fuma: z.boolean({ error: 'Selecciona una opción' }),
    usaLentes: z.boolean({ error: 'Selecciona una opción' }),

    // Membresía
    membresiaClub: z.enum(
      ['SOCIO_ANDINO_PAMIR', 'SOCIO_EL_MONTANISTA', 'SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB', 'NO_PERTENECE'],
      { error: 'Selecciona una opción' }
    ),
    nombreClub: z.string().max(50, 'Máximo 50 caracteres').optional(),

    // Sección IV
    declaracionSalud: z.literal(true, { error: 'Debes aceptar esta declaración para continuar' }),
    aceptacionRiesgo: z.literal(true, { error: 'Debes aceptar esta cláusula para continuar' }),
    consentimientoDatos: z.literal(true, { error: 'Debes aceptar el consentimiento de uso de datos para continuar' }),
    derechoImagen: z.literal(true, { error: 'Debes aceptar esta cláusula para continuar' }),
  })
  .superRefine((data, ctx) => {
    if (data.alergiasTiene && !data.alergiasDetalle?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Describe las alergias conocidas', path: ['alergiasDetalle'] })
    }
    if (data.enfermedadesCronicasTiene && !data.enfermedadesCronicasDetalle?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Describe las enfermedades crónicas', path: ['enfermedadesCronicasDetalle'] })
    }
    if (data.medicamentosTiene && !data.medicamentosDetalle?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica el nombre y dosis del medicamento', path: ['medicamentosDetalle'] })
    }
    if (data.cirugiasLesionesTiene && !data.cirugiasLesionesDetalle?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Describe la cirugía o lesión', path: ['cirugiasLesionesDetalle'] })
    }
    if (
      (data.membresiaClub === 'SOCIO_OTRO_CLUB' || data.membresiaClub === 'POSTULANTE_CLUB') &&
      !data.nombreClub?.trim()
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica el nombre del club', path: ['nombreClub'] })
    }
  })

type IntegranteFormData = z.infer<typeof schema>

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#264c99] text-white text-xs font-bold flex items-center justify-center">
        {number}
      </span>
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
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

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<IntegranteFormData>({
    resolver: zodResolver(schema),
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
      membresiaClub: undefined as unknown as 'SOCIO_ANDINO_PAMIR' | 'SOCIO_EL_MONTANISTA' | 'SOCIO_OTRO_CLUB' | 'POSTULANTE_CLUB' | 'NO_PERTENECE',
      nombreClub: '',
      declaracionSalud: undefined as unknown as true,
      aceptacionRiesgo: undefined as unknown as true,
      consentimientoDatos: undefined as unknown as true,
      derechoImagen: undefined as unknown as true,
    },
  })

  const membresiaClub = watch('membresiaClub')
  const nombreClub = watch('nombreClub') ?? ''
  const alergiasTiene = watch('alergiasTiene')
  const alergiasDetalle = watch('alergiasDetalle') ?? ''
  const enfermedadesCronicasTiene = watch('enfermedadesCronicasTiene')
  const enfermedadesCronicasDetalle = watch('enfermedadesCronicasDetalle') ?? ''
  const medicamentosTiene = watch('medicamentosTiene')
  const medicamentosDetalle = watch('medicamentosDetalle') ?? ''
  const cirugiasLesionesTiene = watch('cirugiasLesionesTiene')
  const cirugiasLesionesDetalle = watch('cirugiasLesionesDetalle') ?? ''

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
        membresiaClub: data.membresiaClub,
        nombreClub: data.nombreClub,
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

  return (
    <div className="min-h-screen bg-[#f0f4fb] flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-[#4a6fad]/15 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
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

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <p className="text-sm text-[#757874] mb-6">
          Completa la ficha de registro y datos médicos del integrante. Todos los campos marcados con{' '}
          <span className="text-[#A4636E] font-semibold">*</span> son obligatorios.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">

          {/* ── Sección I ──────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
            <SectionHeader number="I" title="Información Personal y de Contacto" />

            <Input
              label="Nombre Completo"
              placeholder="Ej: Juan Andrés Pérez González"
              required
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
              inputMode="numeric"
              error={errors.telefonoCelular?.message}
              {...register('telefonoCelular')}
            />

            <Input
              label="Email"
              type="email"
              placeholder="correo@ejemplo.com"
              required
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

            <Controller
              control={control}
              name="membresiaClub"
              render={({ field }) => (
                <SingleSelectChip
                  label="Membresía en Club de Montaña"
                  options={[
                    { value: 'SOCIO_ANDINO_PAMIR', label: 'Socio Andino Club Pamir' },
                    { value: 'SOCIO_EL_MONTANISTA', label: 'Socio Club El Montañista' },
                    { value: 'SOCIO_OTRO_CLUB', label: 'Socio otro Club' },
                    { value: 'POSTULANTE_CLUB', label: 'Postulante a un club' },
                    { value: 'NO_PERTENECE', label: 'No pertenece a ningún club' },
                  ]}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  error={errors.membresiaClub?.message}
                  required
                />
              )}
            />

            {(membresiaClub === 'SOCIO_OTRO_CLUB' || membresiaClub === 'POSTULANTE_CLUB') && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-[#264c99]">
                  Nombre del Club
                  <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej: Club Andino de Chile"
                  maxLength={50}
                  value={nombreClub}
                  onChange={(e) => setValue('nombreClub', e.target.value, { shouldValidate: true })}
                  className={[
                    'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-[#757874]/50',
                    'transition-colors duration-150',
                    'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
                    errors.nombreClub ? 'border-[#A4636E]' : 'border-[#4a6fad]/40',
                  ].join(' ')}
                />
                <p className="text-xs text-[#757874] self-end">{nombreClub.length}/50</p>
                <FieldError message={errors.nombreClub?.message} />
              </div>
            )}
          </div>

          {/* ── Sección II ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
            <SectionHeader number="II" title="Contacto de Emergencia" />

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

          {/* ── Sección III ────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
            <SectionHeader number="III" title="Perfil Médico y Antecedentes" />

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
                  tiene={alergiasTiene}
                  detalle={alergiasDetalle}
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
                  tiene={enfermedadesCronicasTiene}
                  detalle={enfermedadesCronicasDetalle}
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
                  tiene={medicamentosTiene}
                  detalle={medicamentosDetalle}
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
                  tiene={cirugiasLesionesTiene}
                  detalle={cirugiasLesionesDetalle}
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

          {/* ── Sección IV ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-[#4a6fad]/15 bg-white p-5 flex flex-col gap-5">
            <SectionHeader number="IV" title="Cláusulas Legales y Consentimiento Informado" />

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

          {/* Submit */}
          <div className="flex flex-col gap-3 pb-8">
            {apiError && (
              <div className="rounded-xl border border-[#A4636E]/30 bg-[#f5e8ea] px-4 py-3 text-sm text-[#8b3a44]">
                {apiError}
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Registrar Integrante'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}

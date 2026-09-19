import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, ChevronLeft, X, UserPlus, UserCheck, Loader2, ChevronDown } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '../ui/Button'
import { getIntegranteByRut } from '../../lib/api'
import { CLUB_BADGE_LABELS } from '../../types/salida'
import type { IntegranteRecord, Participante } from '../../types/salida'
import {
  ExpressResponsibilityModal,
  IntegranteExpressModal,
  type ExpressParticipantePayload,
} from './IntegranteExpressModal'

// ─── Schema ──────────────────────────────────────────────────────────────────

// membresiaClub es opcional para que drafts guardados en localStorage antes de
// este campo sigan validando sin migración
const step3Schema = z.object({
  liderCordada: z.string().min(1, 'Selecciona el líder de cordada'),
  participantes: z
    .array(
      z.object({
        rut: z.string(),
        nombre: z.string(),
        membresiaClub: z
          .enum(['SOCIO_ANDINO_PAMIR', 'SOCIO_EL_MONTANISTA', 'SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB', 'NO_PERTENECE'])
          .optional(),
        // Express participant fields (sin ficha registrada). Must be declared here so
        // Zod's .strip() does not drop them before the form is submitted.
        esExpress: z.boolean().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
      }),
    )
    .min(1, 'Agrega al menos un participante'),
  coordinacionGrupal: z.boolean({ error: 'Selecciona una opción' }),
  matrizRiesgos: z.boolean({ error: 'Selecciona una opción' }),
})

export type Step3Data = z.infer<typeof step3Schema>

// ─── RUT formatter ────────────────────────────────────────────────────────────

function formatRut(value: string): string {
  const clean = value.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length <= 1) return clean
  const dv = clean.slice(-1)
  const body = clean.slice(0, -1)
  const bodyFormatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${bodyFormatted}-${dv}`
}

const RUT_COMPLETE_REGEX = /^\d{1,2}\.\d{3}\.\d{3}-[\dKk]$/

// ─── Sí / No toggle ──────────────────────────────────────────────────────────

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
      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// ─── Hook: buscar integrante por RUT con debounce ────────────────────────────

function useRutLookup(rut: string) {
  const [integrante, setIntegrante] = useState<IntegranteRecord | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isComplete = RUT_COMPLETE_REGEX.test(rut)

  useEffect(() => {
    if (!isComplete) {
      setIntegrante(undefined)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const result = await getIntegranteByRut(rut)
        setIntegrante(result) // null si no existe, IntegranteRecord si existe
      } catch {
        setIntegrante(null)
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [rut, isComplete])

  return { integrante, loading, isComplete }
}

// ─── RUT lookup result card ───────────────────────────────────────────────────

interface RutLookupResultProps {
  rut: string
  integrante: IntegranteRecord | null | undefined
  loading: boolean
  actionLabel: string
  isAdmin: boolean
  onSelect: (integrante: IntegranteRecord) => void
  onCreateIntegrante: () => void
  onStartExpress: () => void
}

function RutLookupResult({ rut, integrante, loading, actionLabel, isAdmin, onSelect, onCreateIntegrante, onStartExpress }: RutLookupResultProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb] text-sm text-[#757874]">
        <Loader2 size={15} className="animate-spin shrink-0" />
        Buscando integrante...
      </div>
    )
  }

  if (integrante) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#264c99]/30 bg-[#e8eef7]">
        <UserCheck size={18} className="text-[#264c99] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1e3c7a] truncate">
            {integrante.nombreCompleto}
            {integrante.membresiaClub && (
              <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide bg-[#264c99]/10 text-[#264c99] px-1.5 py-0.5 rounded-md">
                {CLUB_BADGE_LABELS[integrante.membresiaClub]}
              </span>
            )}
          </p>
          <p className="text-xs text-[#757874]">{integrante.rut}</p>
        </div>
        <Button type="button" size="sm" onClick={() => onSelect(integrante)}>
          {actionLabel}
        </Button>
      </div>
    )
  }

  if (integrante === null) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]">
        <p className="text-sm text-[#757874]">
          Integrante no encontrado:{' '}
          <span className="font-mono font-medium text-slate-700">{rut}</span>
        </p>
        <button
          type="button"
          onClick={onStartExpress}
          className="flex items-center gap-1.5 text-sm text-[#8b3a44] hover:text-[#A4636E] font-semibold self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A4636E] rounded transition-colors"
        >
          <UserPlus size={15} className="text-[#A4636E]" />
          Agregar participante express
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={onCreateIntegrante}
            className="flex items-center gap-1.5 text-sm text-[#264c99] hover:text-[#1e3c7a] font-medium self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] rounded transition-colors"
          >
            <UserPlus size={15} />
            Crear integrante con ficha completa
          </button>
        )}
      </div>
    )
  }

  return null
}

// ─── Líder picker (single-select from participants list) ─────────────────────

interface LiderPickerProps {
  value: string
  participantes: string[]
  onChange: (name: string) => void
  error?: string
}

export function LiderPicker({ value, participantes, onChange, error }: LiderPickerProps) {
  const [open, setOpen] = useState(false)
  const hasParticipants = participantes.length > 0

  function handleSelect(name: string) {
    onChange(name)
    setOpen(false)
  }

  function handleClear() {
    onChange('')
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-[#264c99]">
        Líder de Cordada
        <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
      </label>

      {!hasParticipants ? (
        <div className="px-4 py-3 rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb] text-sm text-[#757874]">
          Primero agrega al menos un participante a la nómina.
        </div>
      ) : value ? (
        <div
          className={[
            'flex items-center gap-2 px-3 py-2.5 rounded-xl border',
            error ? 'border-[#A4636E]' : 'border-[#264c99]/40 bg-[#e8eef7]',
          ].join(' ')}
        >
          <UserCheck size={16} className="text-[#264c99] shrink-0" />
          <span className="text-sm font-medium text-[#1e3c7a] flex-1">{value}</span>
          <button
            type="button"
            onClick={handleClear}
            aria-label="Quitar líder de cordada"
            className="text-[#264c99] hover:text-[#A4636E] transition-colors leading-none"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={[
              'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border bg-white text-sm text-left',
              'focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow',
              error ? 'border-[#A4636E] text-[#A4636E]' : 'border-[#4a6fad]/30 text-[#adb5ad]',
            ].join(' ')}
          >
            <span>Selecciona el líder de cordada</span>
            <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <ul
              role="listbox"
              aria-label="Participantes disponibles"
              className="absolute z-10 mt-1 w-full rounded-xl border border-[#4a6fad]/20 bg-white shadow-lg overflow-hidden"
            >
              {participantes.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(name)}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-800 hover:bg-[#e8eef7] hover:text-[#1e3c7a] transition-colors"
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">{error}</p>
      )}
    </div>
  )
}

// ─── Participant picker (multi-select by RUT) ─────────────────────────────────

interface ParticipantePickerProps {
  selected: Participante[]
  isAdmin: boolean
  onAdd: (p: Participante) => void
  onCreateIntegrante: () => void
}

export function ParticipantePicker({ selected, isAdmin, onAdd, onCreateIntegrante }: ParticipantePickerProps) {
  const [rut, setRut] = useState('')
  // Express sub-flow: 'none' → 'confirm' (responsibility) → 'form' (data entry)
  const [expressStep, setExpressStep] = useState<'none' | 'confirm' | 'form'>('none')
  const { integrante, loading, isComplete } = useRutLookup(rut)
  const alreadyAdded = integrante ? selected.some((p) => p.rut === integrante.rut) : false

  function handleAdd(i: IntegranteRecord) {
    if (!selected.some((p) => p.rut === i.rut)) {
      onAdd({ rut: i.rut, nombre: i.nombreCompleto, membresiaClub: i.membresiaClub })
    }
    setRut('')
  }

  function handleAddExpress(payload: ExpressParticipantePayload) {
    if (!selected.some((p) => p.rut === payload.rut)) {
      onAdd({
        rut: payload.rut,
        nombre: payload.nombre,
        telefono: payload.telefono,
        email: payload.email,
        esExpress: true,
      })
    }
    setExpressStep('none')
    setRut('')
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={rut}
        onChange={(e) => setRut(formatRut(e.target.value))}
        placeholder={selected.length === 0 ? 'Ingresa el RUT del participante' : 'Agregar otro participante por RUT'}
        aria-label="RUT del participante"
        className="w-full px-3 py-2.5 rounded-xl border border-[#4a6fad]/30 bg-white text-sm text-slate-800 placeholder:text-[#adb5ad] focus:outline-none focus:ring-2 focus:ring-[#264c99]/40 focus:border-[#264c99] transition-shadow"
      />

      {isComplete && !alreadyAdded && (
        <RutLookupResult
          rut={rut}
          integrante={integrante}
          loading={loading}
          actionLabel="Agregar"
          isAdmin={isAdmin}
          onSelect={handleAdd}
          onCreateIntegrante={() => {
            setRut('')
            onCreateIntegrante()
          }}
          onStartExpress={() => setExpressStep('confirm')}
        />
      )}

      {isComplete && !loading && alreadyAdded && (
        <p className="text-xs text-[#757874] px-1">
          Este integrante ya está en la nómina.
        </p>
      )}

      {expressStep === 'confirm' && (
        <ExpressResponsibilityModal
          onCancel={() => setExpressStep('none')}
          onConfirm={() => setExpressStep('form')}
        />
      )}

      {expressStep === 'form' && (
        <IntegranteExpressModal
          initialRut={rut}
          onCancel={() => setExpressStep('none')}
          onSubmit={handleAddExpress}
        />
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step3HumanTeamProps {
  defaultValues: Step3Data
  isAdmin: boolean
  onSubmit: (data: Step3Data) => void
  onBack: () => void
  onCreateIntegrante: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Step3HumanTeam({ defaultValues, isAdmin, onSubmit, onBack, onCreateIntegrante }: Step3HumanTeamProps) {
  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<Step3Data>({
    resolver: zodResolver(step3Schema),
    defaultValues,
  })

  const participantes = watch('participantes')
  const liderCordada = watch('liderCordada')

  function addParticipante(p: Participante) {
    if (!participantes.some((existing) => existing.rut === p.rut)) {
      setValue('participantes', [...participantes, p], { shouldValidate: true })
    }
  }

  function removeParticipante(rut: string) {
    const removed = participantes.find((p) => p.rut === rut)
    const updated = participantes.filter((p) => p.rut !== rut)
    setValue('participantes', updated, { shouldValidate: true })
    if (removed && liderCordada === removed.nombre) {
      setValue('liderCordada', '', { shouldValidate: true })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {/* Nómina de Participantes */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-[#264c99]">
          Nómina de Participantes
          <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>
        </span>
        <p className="text-xs text-[#757874]">
          Selecciona los integrantes registrados que participarán en esta salida.
        </p>

        {/* Selected participant chips */}
        {participantes.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-[#4a6fad]/20 bg-[#f0f4fb]/60">
            {participantes.map((p) => (
              <span
                key={p.rut}
                className="inline-flex items-center gap-1.5 bg-[#e8eef7] text-[#1e3c7a] text-sm font-medium px-3 py-1 rounded-full border border-[#264c99]/20"
              >
                {p.esExpress ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] px-1.5 py-0.5 rounded-md">
                    Express
                  </span>
                ) : (
                  p.membresiaClub && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-[#264c99]/10 text-[#264c99] px-1.5 py-0.5 rounded-md">
                      {CLUB_BADGE_LABELS[p.membresiaClub]}
                    </span>
                  )
                )}
                {p.nombre}
                <button
                  type="button"
                  onClick={() => removeParticipante(p.rut)}
                  aria-label={`Quitar ${p.nombre}`}
                  className="text-[#264c99] hover:text-[#A4636E] transition-colors leading-none"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Searchable picker */}
        <ParticipantePicker
          selected={participantes}
          isAdmin={isAdmin}
          onAdd={addParticipante}
          onCreateIntegrante={onCreateIntegrante}
        />

        {errors.participantes && (
          <p className="text-xs text-[#A4636E]" role="alert">
            {errors.participantes.message}
          </p>
        )}
      </div>

      {/* Líder de Cordada */}
      <Controller
        control={control}
        name="liderCordada"
        render={({ field }) => (
          <LiderPicker
            value={field.value}
            participantes={participantes.filter((p) => !p.esExpress).map((p) => p.nombre)}
            onChange={(name) => field.onChange(name)}
            error={errors.liderCordada?.message}
          />
        )}
      />

      {/* Coordinación grupal */}
      <div className="rounded-2xl border border-[#4a6fad]/15 bg-[#f0f4fb]/60 p-4">
        <Controller
          control={control}
          name="coordinacionGrupal"
          render={({ field }) => (
            <YesNoField
              label="¿Se realizó una coordinación grupal inicial antes de la salida?"
              value={field.value}
              onChange={field.onChange}
              error={errors.coordinacionGrupal?.message}
            />
          )}
        />
      </div>

      {/* Matriz de riesgos */}
      <div className="rounded-2xl border border-[#4a6fad]/15 bg-[#f0f4fb]/60 p-4">
        <Controller
          control={control}
          name="matrizRiesgos"
          render={({ field }) => (
            <YesNoField
              label="¿Se completó una Matriz de Riesgos 3x3 para esta salida?"
              value={field.value}
              onChange={field.onChange}
              error={errors.matrizRiesgos?.message}
            />
          )}
        />
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

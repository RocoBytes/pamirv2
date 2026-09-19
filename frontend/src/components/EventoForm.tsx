import { forwardRef, useEffect, useState, type TextareaHTMLAttributes } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, AlertTriangle, Paperclip, X } from 'lucide-react'

import type { EventoDetail, CategoriaEventoRecord, EventoPayload } from '../types/evento'
import { DIFICULTAD_LABELS } from '../types/evento'
import {
  createEvento,
  updateEvento,
  fetchCategoriasEvento,
  uploadItinerarioAdjunto,
  deleteItinerarioAdjunto,
} from '../lib/api'
import type { EventoConCategoria } from '../lib/api'
import { restarDias, esFechaCompleta } from '../lib/fechas'
import { Button } from './ui/Button'
import { FilePicker } from './ui/FilePicker'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { TimeInput24 } from './ui/TimeInput24'

// ─── Schema (los inputs manejan strings; la conversión ocurre al enviar) ─────

const texto300 = z.string().trim().max(300, 'Máximo 300 caracteres')
const texto5000 = z.string().trim().max(5000, 'Máximo 5000 caracteres')

const eventoFormSchema = z
  .object({
    titulo: z.string().trim().min(2, 'El título es muy corto').max(150, 'Máximo 150 caracteres'),
    categoriaId: z.string(),
    fechaInicio: z.string(),
    horaInicio: z.string(),
    fechaFin: z.string(),
    duracionTexto: texto300,
    ubicacion: texto300,
    reunionCoordinacion: texto300,
    organizadorNombre: texto300,
    alturaMaximaMsnm: z
      .string()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 9000), 'Entre 0 y 9000 msnm'),
    dificultad: z.string(),
    avisoDestacado: texto300,
    cupos: z
      .string()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1), 'Debe ser al menos 1'),
    fechaCorteFecha: z.string(),
    fechaCorteHora: z.string(),
    objetivo: texto5000,
    itinerario: texto5000,
    incluye: texto5000,
    noIncluye: texto5000,
    recomendaciones: texto5000,
  })
  .refine((d) => !d.fechaInicio || !d.fechaFin || d.fechaFin >= d.fechaInicio, {
    message: 'La fecha de término no puede ser anterior a la fecha de inicio',
    path: ['fechaFin'],
  })
  .refine((d) => !d.fechaCorteFecha || d.fechaCorteHora !== '', {
    message: 'Indica la hora del cierre',
    path: ['fechaCorteHora'],
  })
  .refine((d) => !d.fechaCorteHora || d.fechaCorteFecha !== '', {
    message: 'Indica la fecha del cierre',
    path: ['fechaCorteFecha'],
  })

type EventoFormValues = z.infer<typeof eventoFormSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

// fechaCorte se guarda como instante UTC; para editar se vuelve a hora de pared de Santiago
function corteASantiago(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso)
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d)
  const hora = d.toLocaleTimeString('es-ES', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return { fecha, hora }
}

function buildDefaults(evento: EventoDetail | null): EventoFormValues {
  const corte = evento?.fechaCorte ? corteASantiago(evento.fechaCorte) : null
  return {
    titulo: evento?.titulo ?? '',
    categoriaId: evento?.categoriaId != null ? String(evento.categoriaId) : '',
    fechaInicio: evento?.fechaInicio?.slice(0, 10) ?? '',
    horaInicio: evento?.horaInicio ?? '',
    fechaFin: evento?.fechaFin?.slice(0, 10) ?? '',
    duracionTexto: evento?.duracionTexto ?? '',
    ubicacion: evento?.ubicacion ?? '',
    reunionCoordinacion: evento?.reunionCoordinacion ?? '',
    organizadorNombre: evento?.organizadorNombre ?? '',
    alturaMaximaMsnm: evento?.alturaMaximaMsnm != null ? String(evento.alturaMaximaMsnm) : '',
    dificultad: evento?.dificultad != null ? String(evento.dificultad) : '',
    avisoDestacado: evento?.avisoDestacado ?? '',
    cupos: evento?.cupos != null ? String(evento.cupos) : '',
    fechaCorteFecha: corte?.fecha ?? '',
    fechaCorteHora: corte?.hora ?? '',
    objetivo: evento?.objetivo ?? '',
    itinerario: evento?.itinerario ?? '',
    incluye: evento?.incluye ?? '',
    noIncluye: evento?.noIncluye ?? '',
    recomendaciones: evento?.recomendaciones ?? '',
  }
}

function toPayload(values: EventoFormValues): EventoPayload {
  return {
    titulo: values.titulo,
    categoriaId: values.categoriaId ? Number(values.categoriaId) : null,
    fechaInicio: values.fechaInicio || null,
    horaInicio: values.horaInicio || null,
    fechaFin: values.fechaFin || null,
    duracionTexto: values.duracionTexto || null,
    ubicacion: values.ubicacion || null,
    reunionCoordinacion: values.reunionCoordinacion || null,
    organizadorNombre: values.organizadorNombre || null,
    alturaMaximaMsnm: values.alturaMaximaMsnm ? Number(values.alturaMaximaMsnm) : null,
    dificultad: values.dificultad ? Number(values.dificultad) : null,
    avisoDestacado: values.avisoDestacado || null,
    cupos: values.cupos ? Number(values.cupos) : null,
    fechaCorte:
      values.fechaCorteFecha && values.fechaCorteHora
        ? { fecha: values.fechaCorteFecha, hora: values.fechaCorteHora }
        : null,
    objetivo: values.objetivo || null,
    itinerario: values.itinerario || null,
    incluye: values.incluye || null,
    noIncluye: values.noIncluye || null,
    recomendaciones: values.recomendaciones || null,
  }
}

// ─── Campos auxiliares ───────────────────────────────────────────────────────

interface CampoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
}

const CampoTextarea = forwardRef<HTMLTextAreaElement, CampoTextareaProps>(function CampoTextarea(
  { label, error, id, ...props },
  ref,
) {
  const areaId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={areaId} className="text-sm font-semibold text-[#264c99]">
        {label}
      </label>
      <textarea
        ref={ref}
        id={areaId}
        rows={4}
        aria-invalid={error ? 'true' : undefined}
        className={[
          'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900',
          'placeholder:text-[#757874]/50 transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
          error
            ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
            : 'border-[#4a6fad]/40',
        ].join(' ')}
        {...props}
      />
      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
})

// ─── Form ────────────────────────────────────────────────────────────────────

interface EventoFormProps {
  /** null = crear un borrador nuevo */
  evento: EventoDetail | null
  esAdminEventos?: boolean
  gestorCategoriaIds?: number[]
  onSaved: (evento: EventoConCategoria) => void
}

export function EventoForm({ evento, esAdminEventos = false, gestorCategoriaIds = [], onSaved }: EventoFormProps) {
  const [categorias, setCategorias] = useState<CategoriaEventoRecord[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Attachment lives outside RHF: it is uploaded in a second request after the JSON save
  const [adjuntoFile, setAdjuntoFile] = useState<File | null>(null)
  const [quitarAdjunto, setQuitarAdjunto] = useState(false)
  const adjuntoActual =
    !quitarAdjunto && evento?.itinerarioFileUrl
      ? { url: evento.itinerarioFileUrl, nombre: evento.itinerarioFileName ?? 'archivo' }
      : null
  // Un gestor crea siempre dentro de una de sus categorías (espejo del backend)
  const categoriaObligatoria = !esAdminEventos

  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
    setValue,
    setError: setFieldError,
    formState: { errors, dirtyFields },
  } = useForm<EventoFormValues>({
    resolver: zodResolver(eventoFormSchema),
    defaultValues: buildDefaults(evento),
  })

  useEffect(() => {
    fetchCategoriasEvento()
      .then(setCategorias)
      .catch(() => {
        // El select queda vacío; el campo no es obligatorio para un borrador
      })
  }, [])

  // Sugerencia de cierre: dos días antes del inicio, 23:59 (solo si está vacío
  // y la fecha de inicio ya está completa, no un valor intermedio del input)
  const fechaInicioVal = watch('fechaInicio')
  useEffect(() => {
    if (!fechaInicioVal || !esFechaCompleta(fechaInicioVal)) return
    const { fechaCorteFecha, fechaCorteHora } = getValues()
    if (fechaCorteFecha || fechaCorteHora) return
    setValue('fechaCorteFecha', restarDias(fechaInicioVal, 2))
    setValue('fechaCorteHora', '23:59')
  }, [fechaInicioVal, getValues, setValue])

  // Spec §4: editar campos sensibles de un PUBLICADO con postulantes merece aviso
  const camposSensiblesEditados = Boolean(
    dirtyFields.fechaInicio || dirtyFields.fechaCorteFecha || dirtyFields.fechaCorteHora || dirtyFields.cupos,
  )
  const mostrarAvisoPostulantes =
    evento !== null && evento.estado === 'PUBLICADO' && evento.totalPostulantes > 0 && camposSensiblesEditados

  async function onSubmit(values: EventoFormValues): Promise<void> {
    if (categoriaObligatoria && !values.categoriaId) {
      setFieldError('categoriaId', { type: 'manual', message: 'Selecciona la categoría' })
      return
    }
    setSaving(true)
    setSubmitError(null)
    let guardado: EventoConCategoria
    try {
      guardado = evento
        ? await updateEvento(evento.id, toPayload(values))
        : await createEvento(toPayload(values))
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el evento')
      setSaving(false)
      return
    }
    // The JSON is persisted; on creation this switches the form to edit mode.
    onSaved(guardado)
    try {
      if (adjuntoFile) {
        const conAdjunto = await uploadItinerarioAdjunto(guardado.id, adjuntoFile)
        setAdjuntoFile(null)
        setQuitarAdjunto(false)
        onSaved(conAdjunto)
      } else if (quitarAdjunto && guardado.itinerarioFileId) {
        const sinAdjunto = await deleteItinerarioAdjunto(guardado.id)
        setQuitarAdjunto(false)
        onSaved(sinAdjunto)
      }
    } catch (err) {
      const detalle = err instanceof Error ? err.message : ''
      setSubmitError(
        adjuntoFile
          ? `El evento se guardó, pero no se pudo subir el adjunto${detalle ? `: ${detalle}` : ''}. Vuelve a guardar para reintentar.`
          : `El evento se guardó, pero no se pudo quitar el adjunto${detalle ? `: ${detalle}` : ''}. Vuelve a guardar para reintentar.`,
      )
      // adjuntoFile / quitarAdjunto are kept so the next save retries only the file step
    } finally {
      setSaving(false)
    }
  }

  // El gestor solo elige entre sus categorías; el admin ve todas
  const categoriasElegibles = esAdminEventos
    ? categorias
    : categorias.filter((c) => gestorCategoriaIds.includes(c.id))
  const categoriaOptions = [
    { value: '', label: categoriaObligatoria ? '— Selecciona —' : '— Sin categoría —' },
    ...categoriasElegibles.map((c) => ({ value: String(c.id), label: c.nombre })),
  ]
  const dificultadOptions = [
    { value: '', label: '— Sin definir —' },
    ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${DIFICULTAD_LABELS[n]}` })),
  ]

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      {/* ── Cabecera ── */}
      <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-[#264c99]">Cabecera</h2>

        <Input
          label="Título"
          required
          placeholder="Ej: Trekking Cerro Provincia"
          error={errors.titulo?.message}
          {...register('titulo')}
        />

        <Select
          label="Categoría"
          required={categoriaObligatoria}
          options={categoriaOptions}
          error={errors.categoriaId?.message}
          {...register('categoriaId')}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Fecha de inicio"
            type="date"
            error={errors.fechaInicio?.message}
            {...register('fechaInicio')}
          />
          <Controller
            control={control}
            name="horaInicio"
            render={({ field }) => (
              <TimeInput24
                label="Hora de inicio (opcional)"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.horaInicio?.message}
              />
            )}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Fecha de término"
            type="date"
            error={errors.fechaFin?.message}
            {...register('fechaFin')}
          />
          <Input
            label="Duración"
            placeholder="Ej: 2 días"
            error={errors.duracionTexto?.message}
            {...register('duracionTexto')}
          />
        </div>

        <Input
          label="Ubicación"
          placeholder="Ej: Cajón del Maipo, RM"
          error={errors.ubicacion?.message}
          {...register('ubicacion')}
        />

        <Input
          label="Reunión de coordinación"
          placeholder="Ej: Jueves 27, 20:00, online"
          error={errors.reunionCoordinacion?.message}
          {...register('reunionCoordinacion')}
        />

        <Input
          label="Organizador"
          placeholder="Nombre de quien organiza"
          error={errors.organizadorNombre?.message}
          {...register('organizadorNombre')}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Altura máxima (msnm)"
            type="number"
            min={0}
            max={9000}
            error={errors.alturaMaximaMsnm?.message}
            {...register('alturaMaximaMsnm')}
          />
          <Select
            label="Dificultad"
            options={dificultadOptions}
            error={errors.dificultad?.message}
            {...register('dificultad')}
          />
        </div>

        <Input
          label="Aviso destacado"
          hint="Cinta visible en la tarjeta (ej: Reprogramada, Cupos llenos)"
          error={errors.avisoDestacado?.message}
          {...register('avisoDestacado')}
        />
      </section>

      {/* ── Cupos e inscripción ── */}
      <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-[#264c99]">Cupos e inscripción</h2>

        <Input
          label="Cupos"
          type="number"
          min={1}
          hint="Tamaño del grupo que se selecciona entre los postulantes; no limita las postulaciones"
          error={errors.cupos?.message}
          {...register('cupos')}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Cierre de inscripciones — fecha"
            type="date"
            error={errors.fechaCorteFecha?.message}
            {...register('fechaCorteFecha')}
          />
          <Controller
            control={control}
            name="fechaCorteHora"
            render={({ field }) => (
              <TimeInput24
                label="Cierre — hora (Santiago)"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.fechaCorteHora?.message}
              />
            )}
          />
        </div>
        <p className="text-xs text-[#757874] -mt-2">
          Sugerencia automática: dos días antes del inicio, a las 23:59.
        </p>
      </section>

      {/* ── Contenido ── */}
      <section className="bg-white rounded-2xl border border-[#4a6fad]/15 p-5 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-[#264c99]">Contenido</h2>

        <CampoTextarea
          label="Objetivo"
          maxLength={5000}
          error={errors.objetivo?.message}
          {...register('objetivo')}
        />
        <CampoTextarea
          label="Itinerario"
          maxLength={5000}
          error={errors.itinerario?.message}
          {...register('itinerario')}
        />
        {adjuntoActual && !adjuntoFile ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-[#264c99]">Adjunto del itinerario</span>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#264c99]/40 bg-[#e8eef7]">
              <a
                href={adjuntoActual.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 flex-1 min-w-0 text-sm text-[#1e3c7a] hover:underline"
              >
                <Paperclip size={15} className="text-[#264c99] shrink-0" />
                <span className="truncate">{adjuntoActual.nombre}</span>
              </a>
              <button
                type="button"
                onClick={() => setQuitarAdjunto(true)}
                disabled={saving}
                className="shrink-0 text-[#4a6fad] hover:text-[#A4636E] transition-colors disabled:opacity-50"
                aria-label="Quitar adjunto"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ) : (
          <FilePicker
            label={
              <>
                Adjunto del itinerario{' '}
                <span className="text-[#757874] font-normal">(opcional)</span>
              </>
            }
            hint="PDF, JPG o PNG, máximo 15 MB. Se sube al guardar."
            accept=".pdf,.jpg,.jpeg,.png"
            placeholder="Seleccionar archivo"
            value={adjuntoFile}
            onChange={(f) => {
              setAdjuntoFile(f)
              if (f) setQuitarAdjunto(false)
            }}
            disabled={saving}
          />
        )}
        {quitarAdjunto && !adjuntoFile && evento?.itinerarioFileUrl && (
          <p className="text-xs text-[#757874] -mt-2">
            Se quitará el adjunto al guardar.{' '}
            <button
              type="button"
              onClick={() => setQuitarAdjunto(false)}
              className="font-semibold text-[#264c99] hover:underline"
            >
              Deshacer
            </button>
          </p>
        )}
        <CampoTextarea
          label="Incluye"
          rows={3}
          maxLength={5000}
          error={errors.incluye?.message}
          {...register('incluye')}
        />
        <CampoTextarea
          label="No incluye"
          rows={3}
          maxLength={5000}
          error={errors.noIncluye?.message}
          {...register('noIncluye')}
        />
        <CampoTextarea
          label="Recomendaciones"
          rows={3}
          maxLength={5000}
          error={errors.recomendaciones?.message}
          {...register('recomendaciones')}
        />
      </section>

      {mostrarAvisoPostulantes && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <p>Hay postulantes; considera avisar con la cinta destacada.</p>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 px-4 py-3 text-sm text-[#8b3a44]" role="alert">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p>{submitError}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>
          {evento ? 'Guardar cambios' : 'Guardar borrador'}
        </Button>
      </div>
    </form>
  )
}

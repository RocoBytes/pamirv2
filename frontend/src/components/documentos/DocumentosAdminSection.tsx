import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { BookOpen, Loader2, AlertCircle, CheckCircle2, FileText, Upload, Trash2 } from 'lucide-react'
import { fetchDocumentosAdmin, uploadDocumento, deleteDocumento } from '../../lib/api'
import type { DocumentoRecord } from '../../lib/api'
import { CATEGORIA_LABELS, CATEGORIA_ORDEN } from '../../lib/documentos'
import { useOrganization } from '../../hooks/useOrganization'

interface DocumentosAdminSectionProps {
  /**
   * 'panel' se usa dentro del Panel de Administración, donde esta sección es
   * una más entre varias y necesita anunciarse. 'inline' se usa dentro de la
   * propia pantalla de Documentación, que YA se titula "Documentación del
   * Club": repetir ahí ese título dejaría dos elementos con el mismo texto,
   * confuso para un lector de pantalla y ambiguo para los tests.
   */
  variant?: 'panel' | 'inline'
  /**
   * Se llama después de subir o borrar. La pantalla de Documentación muestra
   * en paralelo la lista que ven los socios (fetchDocumentos), distinta de la
   * lista de administración: sin este aviso el admin subiría un PDF y no lo
   * vería aparecer donde lo van a ver los demás.
   */
  onChanged?: () => void
}

export function DocumentosAdminSection({
  variant = 'panel',
  onChanged,
}: DocumentosAdminSectionProps) {
  const { memberBadge } = useOrganization()
  const [docs, setDocs] = useState<DocumentoRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [categoria, setCategoria] = useState<string>(CATEGORIA_ORDEN[0])
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await fetchDocumentosAdmin()
      setDocs(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los documentos')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setFormError(null)
      setFormSuccess(null)

      if (!nombre.trim()) {
        setFormError('El nombre es obligatorio')
        return
      }
      if (!file) {
        setFormError('Selecciona un archivo PDF')
        return
      }

      setUploading(true)
      try {
        await uploadDocumento({
          categoria,
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          file,
        })
        setFormSuccess('Documento subido correctamente')
        setNombre('')
        setDescripcion('')
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        await load()
        onChanged?.()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'No se pudo subir el documento')
      } finally {
        setUploading(false)
      }
    },
    [categoria, nombre, descripcion, file, load, onChanged],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      setLoadError(null)
      try {
        await deleteDocumento(id)
        setConfirmDeleteId(null)
        await load()
        onChanged?.()
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'No se pudo eliminar el documento')
      } finally {
        setDeletingId(null)
      }
    },
    [load, onChanged],
  )

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={16} className="text-primary" aria-hidden="true" />
        <h2 className="text-base font-bold text-on-surface">
          {variant === 'inline' ? 'Gestionar documentos' : 'Documentación del Club'}
        </h2>
      </div>
      <p className="text-xs text-on-surface-variant mb-3">
        {variant === 'inline'
          ? `Sube formularios, check-lists y material de apoyo. Lo que subas aparece arriba, igual que lo ven los socios ${memberBadge}.`
          : `Sube formularios, check-lists y material de apoyo. Los archivos quedan visibles para los socios ${memberBadge} en su sección "Documentación del Club".`}
      </p>

      {/* Formulario de subida */}
      <form
        onSubmit={(e) => void handleUpload(e)}
        className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-4 flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="doc-categoria" className="text-xs font-semibold text-slate-700">
            Categoría
          </label>
          <select
            id="doc-categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {CATEGORIA_ORDEN.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORIA_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-nombre" className="text-xs font-semibold text-slate-700">
            Nombre
          </label>
          <input
            id="doc-nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={uploading}
            placeholder="Ej: Aviso de expedición — Retén Río Blanco"
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-descripcion" className="text-xs font-semibold text-slate-700">
            Descripción <span className="font-normal text-on-surface-variant">(opcional)</span>
          </label>
          <input
            id="doc-descripcion"
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-secondary/25 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doc-file" className="text-xs font-semibold text-slate-700">
            Archivo PDF <span className="font-normal text-on-surface-variant">(máx. 15 MB)</span>
          </label>
          <input
            id="doc-file"
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-fixed file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary disabled:opacity-50"
          />
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-xs text-on-error-container">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p>{formError}</p>
          </div>
        )}

        {formSuccess && (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <p>{formSuccess}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="inline-flex items-center justify-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors self-start"
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Subiendo...
            </>
          ) : (
            <>
              <Upload size={14} />
              Subir documento
            </>
          )}
        </button>
      </form>

      {/* Lista de documentos existentes */}
      {loadError && (
        <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="text-xs">{loadError}</p>
        </div>
      )}

      {!docs && !loadError && (
        <div className="flex items-center gap-2 text-on-surface-variant">
          <Loader2 className="animate-spin text-primary" size={16} />
          <p className="text-xs">Cargando documentos...</p>
        </div>
      )}

      {docs && docs.length === 0 && (
        <p className="text-sm text-on-surface-variant py-4 text-center">
          Aún no hay documentos cargados.
        </p>
      )}

      {docs && docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => {
            const confirming = confirmDeleteId === doc.id
            const isDeleting = deletingId === doc.id
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 bg-white rounded-2xl border border-secondary/15 shadow-sm p-3"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary-fixed flex items-center justify-center">
                  <FileText size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">{doc.nombre}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">
                    {CATEGORIA_LABELS[doc.categoria] ?? doc.categoria}
                  </p>
                </div>
                {confirming ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc.id)}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        'Sí, borrar'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={isDeleting}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1.5 disabled:opacity-50 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(doc.id)}
                    aria-label={`Eliminar ${doc.nombre}`}
                    className="shrink-0 p-2 rounded-lg text-on-error-container hover:bg-error-container transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

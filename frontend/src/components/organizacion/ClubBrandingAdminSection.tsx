import { useState, useCallback, type FormEvent } from 'react'
import { Image, Loader2, AlertCircle, CheckCircle2, Upload, Trash2 } from 'lucide-react'
import { useOrganization } from '../../hooks/useOrganization'
import { uploadOrganizacionLogo, deleteOrganizacionLogo } from '../../lib/api'
import { FilePicker } from '../ui/FilePicker'
import { ClubLogo } from '../ClubLogo'

const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB — igual al límite del backend

interface ClubBrandingAdminSectionProps {
  // Refresca /me (ver useAuth.refreshSession) tras subir o quitar el logo:
  // hasLogo/logoVersion viven en Organization, que solo useAuth puede
  // reescribir de verdad (organization llega por props desde App, no por un
  // contexto de sesión). Sin esto, la cabecera seguiría mostrando el logo
  // viejo hasta el próximo login.
  refreshSession: () => Promise<void>
}

export function ClubBrandingAdminSection({ refreshSession }: ClubBrandingAdminSectionProps) {
  const { organization, shortName } = useOrganization()

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  // Best-effort a propósito: el upload/borrado ya respondió 200 cuando esto
  // corre, así que un refresh fallido (red caída) no debe convertir un éxito
  // en un error — el logo nuevo igual queda; solo la cabecera de ESTA sesión
  // tarda hasta el próximo /me en mostrarlo.
  const refreshSessionBestEffort = useCallback(async () => {
    try {
      await refreshSession()
    } catch {
      // ignore
    }
  }, [refreshSession])

  const handleUpload = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setFormError(null)
      setFormSuccess(null)

      if (!file) {
        setFormError('Selecciona una imagen PNG o JPG')
        return
      }

      setUploading(true)
      try {
        await uploadOrganizacionLogo(file)
        setFormSuccess('Logo actualizado correctamente')
        setFile(null)
        await refreshSessionBestEffort()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'No se pudo subir el logo')
      } finally {
        setUploading(false)
      }
    },
    [file, refreshSessionBestEffort],
  )

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setFormError(null)
    setFormSuccess(null)
    try {
      await deleteOrganizacionLogo()
      setConfirmDelete(false)
      setFormSuccess('Logo quitado: vuelve a mostrarse el logo por defecto')
      await refreshSessionBestEffort()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo quitar el logo')
    } finally {
      setDeleting(false)
    }
  }, [refreshSessionBestEffort])

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Image size={16} className="text-primary" aria-hidden="true" />
        <h2 className="text-base font-bold text-on-surface">Logo del club</h2>
      </div>
      <p className="text-xs text-on-surface-variant mb-3">
        Sube el logo propio de {shortName} (PNG o JPG, máx. 2 MB). Se ve en el login y en toda la
        app, incluso antes de iniciar sesión.
      </p>

      <div className="bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-16 h-16 rounded-xl border border-secondary/15 bg-surface-container-low flex items-center justify-center overflow-hidden">
            <ClubLogo org={organization} alt="" className="w-full h-full object-contain p-1.5" />
          </div>
          <p className="text-xs text-on-surface-variant flex-1">
            {organization?.hasLogo
              ? 'Este es el logo que ven hoy los socios.'
              : `Todavía no subiste un logo propio: se muestra el logo por defecto de ${shortName}.`}
          </p>
        </div>

        <form onSubmit={(e) => void handleUpload(e)} className="flex flex-col gap-3">
          <FilePicker
            label="Archivo"
            accept="image/png,image/jpeg"
            maxBytes={MAX_LOGO_BYTES}
            value={file}
            onChange={setFile}
            disabled={uploading}
          />

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

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={uploading || !file}
              className="inline-flex items-center justify-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Subir logo
                </>
              )}
            </button>

            {organization?.hasLogo && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={uploading || deleting}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-error-container hover:bg-error-container px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                <Trash2 size={14} />
                Quitar logo
              </button>
            )}

            {confirmDelete && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Sí, quitar'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1.5 disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}

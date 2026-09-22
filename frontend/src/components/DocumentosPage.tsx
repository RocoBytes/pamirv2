import { useState, useEffect } from 'react'
import { BookOpen, Loader2, AlertCircle, FileText, Download, FolderOpen } from 'lucide-react'
import { fetchDocumentos, fetchDocumentoUrl } from '../lib/api'
import type { DocumentoRecord } from '../lib/api'
import { CATEGORIA_LABELS, CATEGORIA_ORDEN } from '../lib/documentos'
import { useOrganization } from '../hooks/useOrganization'
import { AppShell, type ShellContext } from './shell/AppShell'
import { FileDownloadButton } from './FileDownloadButton'

function agruparPorCategoria(docs: DocumentoRecord[]): [string, DocumentoRecord[]][] {
  const grupos = new Map<string, DocumentoRecord[]>()
  for (const doc of docs) {
    const lista = grupos.get(doc.categoria) ?? []
    lista.push(doc)
    grupos.set(doc.categoria, lista)
  }
  return [...grupos.entries()].sort(([a], [b]) => {
    const ia = CATEGORIA_ORDEN.indexOf(a)
    const ib = CATEGORIA_ORDEN.indexOf(b)
    return (ia === -1 ? CATEGORIA_ORDEN.length : ia) - (ib === -1 ? CATEGORIA_ORDEN.length : ib)
  })
}

interface DocumentosPageProps {
  onBack: () => void
  shell: ShellContext
}

export function DocumentosPage({ onBack, shell }: DocumentosPageProps) {
  const { memberBadge } = useOrganization()
  const [documentos, setDocumentos] = useState<DocumentoRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDocumentos()
      .then(setDocumentos)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los documentos')
      })
  }, [])

  const grupos = documentos ? agruparPorCategoria(documentos) : []

  return (
    <AppShell shell={shell} active="documentos" onBack={onBack} width="narrow">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
            <BookOpen size={14} />
            Exclusivo socios {memberBadge}
          </div>
          <h1 className="text-xl font-bold text-slate-900">Documentación del Club</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Formularios, check-lists y material de apoyo para tus salidas de montaña.
          </p>
        </div>

        {!documentos && !error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
            <Loader2 className="animate-spin text-primary" size={28} />
            <p className="text-sm">Cargando documentos...</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {documentos && documentos.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-3 text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-fixed">
              <FolderOpen size={24} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-slate-700">Documentos en preparación</p>
              <p className="text-sm text-on-surface-variant mt-0.5 max-w-sm">
                Pronto encontrarás aquí los formularios de aviso de expedición de los retenes de
                Carabineros, la matriz de riesgo 3x3, check-lists de salidas, glosario, libros y más.
              </p>
            </div>
          </div>
        )}

        {documentos && documentos.length > 0 && (
          <div className="flex flex-col gap-6">
            {grupos.map(([categoria, docs]) => (
              <section key={categoria}>
                <h2 className="text-sm font-bold text-primary uppercase tracking-wide mb-2">
                  {CATEGORIA_LABELS[categoria] ?? categoria}
                </h2>
                <ul className="flex flex-col gap-2">
                  {docs.map((doc) => {
                    const contenido = (
                      <>
                        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center">
                          <FileText size={18} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{doc.nombre}</p>
                          {doc.descripcion && (
                            <p className="text-xs text-on-surface-variant truncate">{doc.descripcion}</p>
                          )}
                        </div>
                        <Download size={16} className="shrink-0 text-secondary" />
                      </>
                    )
                    return (
                      <li key={doc.id}>
                        {doc.driveFileId ? (
                          <FileDownloadButton
                            fetchUrl={() => fetchDocumentoUrl(doc.id)}
                            className={[
                              'flex items-center gap-3 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 w-full text-left',
                              'transition-shadow duration-200 hover:shadow-md',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                              'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-sm',
                            ].join(' ')}
                          >
                            {contenido}
                          </FileDownloadButton>
                        ) : (
                          // Documento sin archivo aún: visible pero deshabilitado
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-3 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 w-full text-left opacity-60 cursor-not-allowed"
                          >
                            {contenido}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
    </AppShell>
  )
}

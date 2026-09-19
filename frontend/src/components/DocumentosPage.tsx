import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Loader2,
  AlertCircle,
  FileText,
  Download,
  FolderOpen,
} from 'lucide-react'
import logoPamir from '../assets/logo_PAMIR.png'

import { fetchDocumentos } from '../lib/api'
import type { DocumentoRecord } from '../lib/api'
import { CATEGORIA_LABELS, CATEGORIA_ORDEN } from '../lib/documentos'
import { Button } from './ui/Button'

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
}

export function DocumentosPage({ onBack }: DocumentosPageProps) {
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
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
            <span className="font-bold text-slate-900 text-lg">Pamir</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={16} />
            Volver
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
            <BookOpen size={14} />
            Exclusivo socios Andino Club Pamir
          </div>
          <h1 className="text-xl font-bold text-slate-900">Documentación del Club</h1>
          <p className="text-sm text-[#757874] mt-0.5">
            Formularios, check-lists y material de apoyo para tus salidas de montaña.
          </p>
        </div>

        {!documentos && !error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#757874]">
            <Loader2 className="animate-spin text-[#264c99]" size={28} />
            <p className="text-sm">Cargando documentos...</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44]">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {documentos && documentos.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-3 text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[#e8eef7]">
              <FolderOpen size={24} className="text-[#264c99]" />
            </div>
            <div>
              <p className="font-semibold text-slate-700">Documentos en preparación</p>
              <p className="text-sm text-[#757874] mt-0.5 max-w-sm">
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
                <h2 className="text-sm font-bold text-[#264c99] uppercase tracking-wide mb-2">
                  {CATEGORIA_LABELS[categoria] ?? categoria}
                </h2>
                <ul className="flex flex-col gap-2">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <a
                        href={doc.driveFileUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!doc.driveFileUrl}
                        className={[
                          'flex items-center gap-3 bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4',
                          'transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]',
                          doc.driveFileUrl ? 'hover:shadow-md' : 'opacity-60 pointer-events-none',
                        ].join(' ')}
                      >
                        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#e8eef7] flex items-center justify-center">
                          <FileText size={18} className="text-[#264c99]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{doc.nombre}</p>
                          {doc.descripcion && (
                            <p className="text-xs text-[#757874] truncate">{doc.descripcion}</p>
                          )}
                        </div>
                        <Download size={16} className="shrink-0 text-[#4a6fad]" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

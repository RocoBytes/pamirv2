import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Paperclip, X } from 'lucide-react'

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024 // 15 MB

interface FilePickerProps {
  label: ReactNode
  hint?: ReactNode
  accept: string
  placeholder?: string
  /** Client-side size guard; the server enforces its own limit too. */
  maxBytes?: number
  value: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}

export function FilePicker({
  label,
  hint,
  accept,
  placeholder = 'Seleccionar archivo…',
  maxBytes = DEFAULT_MAX_BYTES,
  value,
  onChange,
  disabled = false,
}: FilePickerProps) {
  const [sizeError, setSizeError] = useState<string | null>(null)
  const maxMb = Math.round(maxBytes / (1024 * 1024))

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      if (file.size > maxBytes) {
        setSizeError(`El archivo supera el límite de ${maxMb} MB`)
        e.target.value = ''
        return
      }
      setSizeError(null)
    }
    onChange(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-primary">{label}</span>
      {hint && <p className="text-xs text-on-surface-variant">{hint}</p>}

      {value ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-primary/40 bg-primary-fixed">
          <Paperclip size={15} className="text-primary shrink-0" />
          <span className="text-sm text-primary-hover flex-1 truncate">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="shrink-0 text-secondary hover:text-error transition-colors disabled:opacity-50"
            aria-label="Quitar archivo"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <label
          className={[
            'flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-secondary/40 bg-white transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer hover:border-primary/60 hover:bg-surface-container-low',
          ].join(' ')}
        >
          <Paperclip size={15} className="text-secondary/60" />
          <span className="text-sm text-on-surface-variant">{placeholder}</span>
          <input
            type="file"
            accept={accept}
            className="sr-only"
            disabled={disabled}
            onChange={handleFileChange}
          />
        </label>
      )}

      {sizeError && (
        <p className="text-xs text-error" role="alert">
          {sizeError}
        </p>
      )}
    </div>
  )
}

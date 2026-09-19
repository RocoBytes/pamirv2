import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, options, placeholder, className = '', id, ...props },
  ref,
) {
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-semibold text-[#264c99]"
        >
          {label}
          {props.required && <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={[
            'w-full appearance-none rounded-xl border bg-white px-3 py-2 pr-9 text-sm text-slate-900',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
            'disabled:bg-[#f0f4fb] disabled:text-[#757874]/60 disabled:cursor-not-allowed',
            error
              ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
              : 'border-[#4a6fad]/40',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined
          }
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a6fad]/60 pointer-events-none"
          size={16}
        />
      </div>
      {hint && !error && (
        <p id={`${selectId}-hint`} className="text-xs text-[#757874]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${selectId}-error`} className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
})

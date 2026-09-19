import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftIcon, rightIcon, className = '', id, ...props },
  ref,
) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-[#264c99]"
        >
          {label}
          {props.required && <span className="text-[#A4636E] ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && (
          <span className="absolute left-3 text-[#4a6fad]/60 pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900',
            'placeholder:text-[#757874]/50',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99]',
            'disabled:bg-[#f0f4fb] disabled:text-[#757874]/60 disabled:cursor-not-allowed',
            error
              ? 'border-[#A4636E] focus:ring-[#A4636E] focus:border-[#A4636E]'
              : 'border-[#4a6fad]/40',
            leftIcon ? 'pl-9' : '',
            rightIcon ? 'pr-9' : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
          }
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 text-[#4a6fad]/60 pointer-events-none">
            {rightIcon}
          </span>
        )}
      </div>
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-[#757874]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
})

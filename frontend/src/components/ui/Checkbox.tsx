import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

// Checkbox táctil: mismo indicador visual (cuadro + check en SVG) que ya usan
// los chips de selección de Step4GPX.tsx/FichaCierre.tsx, pero como fila
// simple label + control en vez de "tile" con borde propio — pensado para ir
// junto a otro elemento en la misma línea (p. ej. un enlace).
//
// El <input> real queda sr-only pero sigue siendo el foco/estado real: el
// indicador visual es aria-hidden y reacciona a :checked/:focus-visible del
// input via `peer`, salvo el check en sí, que se renderiza según la prop
// `checked` (un peer-checked en un descendiente del hermano no funciona en
// CSS, solo en un hermano directo).
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className = '', id, checked, ...props },
  ref,
) {
  const generatedId = useId()
  const checkboxId = id ?? generatedId

  return (
    <label
      htmlFor={checkboxId}
      className={['inline-flex items-center gap-2 min-h-11 py-2 cursor-pointer select-none text-sm text-on-surface-variant', className]
        .filter(Boolean)
        .join(' ')}
    >
      <input ref={ref} type="checkbox" id={checkboxId} checked={checked} className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className={[
          'flex items-center justify-center w-5 h-5 rounded-md border shrink-0 transition-colors',
          'border-secondary/40 bg-white',
          'peer-checked:bg-primary peer-checked:border-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2',
        ].join(' ')}
      >
        {checked && (
          <svg viewBox="0 0 12 10" fill="none" className="w-3 h-3">
            <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  )
})

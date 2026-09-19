import { useState, useRef, useId } from 'react'
import { ChevronUp, ChevronDown, Clock } from 'lucide-react'

interface TimeInput24Props {
  label?: string
  required?: boolean
  error?: string
  /** Controlled value in "HH:MM" format, or empty string */
  value?: string
  onChange?: (val: string) => void
  onBlur?: () => void
  id?: string
}

export function TimeInput24({
  label,
  required,
  error,
  value = '',
  onChange,
  onBlur,
  id: idProp,
}: TimeInput24Props) {
  const autoId = useId()
  const inputId = idProp ?? autoId
  const minutesRef = useRef<HTMLInputElement>(null)
  const hoursRef = useRef<HTMLInputElement>(null)

  // Los inputs son controlados: el value del DOM siempre refleja el último
  // valor tipeado, así que sirve como fuente fresca en los handlers cruzados
  // (blur de horas leyendo minutos y viceversa) sin refs-espejo
  const domHours = () => hoursRef.current?.value ?? ''
  const domMinutes = () => minutesRef.current?.value ?? ''

  function parseTime(v: string): { h: string; m: string } {
    if (!v) return { h: '', m: '' }
    const [h = '', m = ''] = v.split(':')
    return { h, m }
  }

  const init = parseTime(value)
  const [hours, setHours] = useState(init.h)
  const [minutes, setMinutes] = useState(init.m)

  // Sincronización prop → estado ajustando durante el render
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    const { h, m } = parseTime(value)
    setHours(h)
    setMinutes(m)
  }

  function emitComplete(h: string, m: string) {
    const hNum = parseInt(h, 10)
    const mNum = parseInt(m, 10)
    if (
      h !== '' && m !== '' &&
      !isNaN(hNum) && !isNaN(mNum) &&
      hNum >= 0 && hNum <= 23 &&
      mNum >= 0 && mNum <= 59
    ) {
      onChange?.(`${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`)
    } else {
      onChange?.('')
    }
  }

  function handleHoursChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    setHours(raw)
    const hNum = parseInt(raw, 10)
    // Only emit once both digits are typed; single digit waits for blur to pad
    if (raw.length === 2 && hNum <= 23) {
      const mVal = domMinutes()
      const mNum = parseInt(mVal, 10)
      if (mVal !== '' && !isNaN(mNum) && mNum <= 59) {
        onChange?.(`${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`)
      }
      minutesRef.current?.focus()
      minutesRef.current?.select()
    }
  }

  function handleMinutesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    setMinutes(raw)
    const mNum = parseInt(raw, 10)
    // Only emit once both digits are typed; single digit waits for blur to pad
    if (raw.length === 2 && mNum <= 59) {
      const hVal = domHours()
      const hNum = parseInt(hVal, 10)
      if (hVal !== '' && !isNaN(hNum) && hNum <= 23) {
        onChange?.(`${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`)
      }
    }
  }

  function isInternalFocus(relatedTarget: EventTarget | null): boolean {
    return (
      relatedTarget === hoursRef.current ||
      relatedTarget === minutesRef.current
    )
  }

  function handleHoursBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Skip if focus is moving to minutes — we're still inside the component
    if (isInternalFocus(e.relatedTarget)) return

    const domVal = e.target.value.replace(/\D/g, '').slice(0, 2)
    const num = parseInt(domVal, 10)
    if (!isNaN(num) && num >= 0 && num <= 23) {
      const padded = String(num).padStart(2, '0')
      setHours(padded)
      emitComplete(padded, domMinutes())
    } else {
      setHours('')
      onChange?.('')
    }
    onBlur?.()
  }

  function handleMinutesBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Skip if focus is moving to hours — we're still inside the component
    if (isInternalFocus(e.relatedTarget)) return

    const domVal = e.target.value.replace(/\D/g, '').slice(0, 2)
    const num = parseInt(domVal, 10)
    if (!isNaN(num) && num >= 0 && num <= 59) {
      const padded = String(num).padStart(2, '0')
      setMinutes(padded)
      emitComplete(domHours(), padded)
    } else {
      setMinutes('')
      onChange?.('')
    }
    onBlur?.()
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.target.select()
  }

  function handleHoursKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const current = parseInt(domHours(), 10)
      const base = isNaN(current) ? 0 : current
      const next = e.key === 'ArrowUp' ? (base + 1) % 24 : (base - 1 + 24) % 24
      const padded = String(next).padStart(2, '0')
      setHours(padded)
      emitComplete(padded, domMinutes())
    }
    if (e.key === ':' || e.key === 'Tab') {
      minutesRef.current?.focus()
      minutesRef.current?.select()
    }
  }

  function handleMinutesKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const current = parseInt(domMinutes(), 10)
      const base = isNaN(current) ? 0 : current
      const next = e.key === 'ArrowUp' ? (base + 1) % 60 : (base - 1 + 60) % 60
      const padded = String(next).padStart(2, '0')
      setMinutes(padded)
      emitComplete(domHours(), padded)
    }
    if (e.key === 'Backspace' && minutesRef.current?.value === '') {
      hoursRef.current?.focus()
      hoursRef.current?.select()
    }
  }

  function stepHours(delta: 1 | -1) {
    const current = parseInt(domHours(), 10)
    const base = isNaN(current) ? 0 : current
    const next = (base + delta + 24) % 24
    const padded = String(next).padStart(2, '0')
    setHours(padded)
    emitComplete(padded, domMinutes())
  }

  function stepMinutes(delta: 1 | -1) {
    const current = parseInt(domMinutes(), 10)
    const base = isNaN(current) ? 0 : current
    const next = (base + delta + 60) % 60
    const padded = String(next).padStart(2, '0')
    setMinutes(padded)
    emitComplete(domHours(), padded)
  }

  const borderClass = error
    ? 'border-[#A4636E] focus-within:ring-[#A4636E]'
    : 'border-[#4a6fad]/40 focus-within:ring-[#264c99] focus-within:border-[#264c99]'

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={`${inputId}-h`} className="text-sm font-semibold text-[#264c99]">
          {label}
          {required && (
            <span className="text-[#A4636E] ml-1" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div
        role="group"
        aria-label={label}
        className={[
          'flex items-center rounded-xl border bg-white transition-colors duration-150',
          'focus-within:outline-none focus-within:ring-2',
          borderClass,
        ].join(' ')}
      >
        <Clock className="ml-3 w-4 h-4 text-[#4a6fad]/60 shrink-0" aria-hidden="true" />

        {/* Hours spinner */}
        <div className="flex flex-col items-center ml-2">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepHours(1)}
            aria-label="Aumentar horas"
            className="text-[#4a6fad]/60 hover:text-[#264c99] leading-none"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <input
            ref={hoursRef}
            id={`${inputId}-h`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="HH"
            maxLength={2}
            value={hours}
            onChange={handleHoursChange}
            onFocus={handleFocus}
            onBlur={handleHoursBlur}
            onKeyDown={handleHoursKeyDown}
            aria-label="Horas (00–23)"
            className="w-8 py-1 text-sm text-slate-900 bg-transparent border-none focus:outline-none text-center tabular-nums"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepHours(-1)}
            aria-label="Disminuir horas"
            className="text-[#4a6fad]/60 hover:text-[#264c99] leading-none"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="text-slate-400 font-bold select-none px-0.5" aria-hidden="true">
          :
        </span>

        {/* Minutes spinner */}
        <div className="flex flex-col items-center mr-3">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepMinutes(1)}
            aria-label="Aumentar minutos"
            className="text-[#4a6fad]/60 hover:text-[#264c99] leading-none"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <input
            ref={minutesRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="MM"
            maxLength={2}
            value={minutes}
            onChange={handleMinutesChange}
            onFocus={handleFocus}
            onBlur={handleMinutesBlur}
            onKeyDown={handleMinutesKeyDown}
            aria-label="Minutos (00–59)"
            className="w-8 py-1 text-sm text-slate-900 bg-transparent border-none focus:outline-none text-center tabular-nums"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepMinutes(-1)}
            aria-label="Disminuir minutos"
            className="text-[#4a6fad]/60 hover:text-[#264c99] leading-none"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-[#A4636E]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './Input'

type PasswordInputProps = Omit<ComponentPropsWithoutRef<typeof Input>, 'type' | 'rightIcon'>

// Envuelve Input agregando el botón de mostrar/ocultar (Eye/EyeOff de
// lucide) como su rightIcon: Input no necesita saber que existe. El botón es
// type="button" (nunca dispara el submit del form que lo contiene) y su
// aria-label cambia con el estado. El span de rightIcon en Input es
// pointer-events-none (icono puramente decorativo en el resto de los usos),
// así que este botón se marca pointer-events-auto para seguir siendo
// clickeable; el padding negativo-compensado agranda el área táctil a 44px
// sin mover el ícono de 16px que se ve.
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false)

  return (
    <Input
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      rightIcon={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="pointer-events-auto p-3.5 -m-3.5 rounded-md text-secondary/60 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      }
    />
  )
})

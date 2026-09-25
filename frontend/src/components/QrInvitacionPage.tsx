import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, AlertCircle, CheckCircle2, QrCode as QrCodeIcon, Clock, UserPlus, AtSign, Lock } from 'lucide-react'
import { consultarCodigoQr, solicitarInvitacionQr, registrarConQrDirecto, ApiError } from '../lib/api'
import type { OrganizationBrand } from '../types/salida'
import { clubDisplayName, clubShortName } from '../lib/club-brand'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { PasswordInput } from './ui/PasswordInput'
import { ClubLogo } from './ClubLogo'

const MENSAJE_RATE_LIMIT = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  // Modo CORREO (de siempre): pide una invitación por email.
  | { kind: 'form'; organization: OrganizationBrand }
  | { kind: 'confirmation'; organization: OrganizationBrand; message: string }
  // Modo DIRECTO: registro en el acto, sin correo — ver registrarConQrDirecto.
  | { kind: 'form-directo'; organization: OrganizationBrand }
  | { kind: 'creado-sin-sesion'; organization: OrganizationBrand }
  | { kind: 'rate-limited'; organization: OrganizationBrand | null }

interface QrInvitacionPageProps {
  token: string
  isAuthenticated: boolean
  onIrALaApp: () => void
  // Solo lo usa el modo DIRECTO: registrada la cuenta, inicia sesión con las
  // mismas credenciales — mismo prop que recibe AuthPage.
  onLogin: (email: string, password: string, remember: boolean) => Promise<void>
}

// Página pública para `/#qr=<token>` (patrón de EvaluacionExpress.tsx): la
// marca es SIEMPRE la del club dueño del QR, nunca la de una sesión — no hay
// ninguna en este flujo (o, si la hay, es irrelevante para lo que se pinta).
function Shell({ children, org }: { children: React.ReactNode; org?: OrganizationBrand | null }) {
  return (
    <div className="min-h-screen bg-alpine-canvas">
      <header className="bg-white border-b border-secondary/10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2.5">
          <ClubLogo org={org ?? null} alt="" className="w-11 h-11 object-contain" />
          <span className="font-bold text-slate-900 text-lg">{clubShortName(org ?? null)}</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  )
}

function CenteredMessage({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-16 gap-4 text-center">
      {icon}
      <div>
        <p className="font-semibold text-slate-700">{title}</p>
        <p className="text-sm text-on-surface-variant mt-1 max-w-sm">{text}</p>
      </div>
    </div>
  )
}

// Ofrecido cuando ya hay una sesión iniciada: es inofensivo mostrar esta
// pantalla igual (no hace daño reabrir un QR con sesión activa), pero quien
// ya está adentro probablemente prefiere volver a la app en vez de pedir una
// invitación nueva.
function BannerSesionActiva({ onIrALaApp }: { onIrALaApp: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-primary-fixed border border-primary/20 p-3 mb-5 text-sm text-primary">
      <p>Ya tienes una sesión iniciada.</p>
      <button
        type="button"
        onClick={onIrALaApp}
        className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline"
      >
        Ir a la aplicación
      </button>
    </div>
  )
}

export function QrInvitacionPage({ token, isAuthenticated, onIrALaApp, onLogin }: QrInvitacionPageProps) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Modo DIRECTO — crear cuenta (comportamiento de siempre)
  const [directoName, setDirectoName] = useState('')
  const [directoEmail, setDirectoEmail] = useState('')
  const [directoPassword, setDirectoPassword] = useState('')
  const [directoConfirmPassword, setDirectoConfirmPassword] = useState('')

  // Modo DIRECTO — "ya tengo cuenta" (Global Constraints del plan de esta
  // PR: nunca se consulta al backend si el email escrito tiene cuenta; es
  // una elección de la persona, no una respuesta del servidor).
  const [directoModo, setDirectoModo] = useState<'crear' | 'iniciar-sesion'>('crear')
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')

  useEffect(() => {
    let cancelled = false
    consultarCodigoQr(token)
      .then((result) => {
        if (cancelled) return
        setState(
          result.modo === 'DIRECTO'
            ? { kind: 'form-directo', organization: result.organization }
            : { kind: 'form', organization: result.organization },
        )
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 429) {
          setState({ kind: 'rate-limited', organization: null })
          return
        }
        const message =
          err instanceof ApiError && (err.status === 404 || err.status === 410)
            ? err.message
            : 'Este código QR no es válido o ya no está disponible.'
        setState({ kind: 'unavailable', message })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form') return
    setSubmitError(null)

    const valor = email.trim()
    if (!valor) {
      setSubmitError('El email es obligatorio')
      return
    }

    setSubmitting(true)
    try {
      const result = await solicitarInvitacionQr(token, valor)
      setState({ kind: 'confirmation', organization: state.organization, message: result.message })
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization: state.organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud')
    } finally {
      setSubmitting(false)
    }
  }

  // Rama "crear cuenta" — comportamiento de siempre. El club PRIMARIO de una
  // cuenta NUEVA ES el club del QR (se crea así), así que el login normal ya
  // aterriza en el lugar correcto — a diferencia de handleSubmitDirectoIniciarSesion.
  async function handleSubmitDirecto(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form-directo') return
    setSubmitError(null)

    if (!directoName.trim()) {
      setSubmitError('El nombre es requerido')
      return
    }
    if (directoPassword.length < 8) {
      setSubmitError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (directoPassword !== directoConfirmPassword) {
      setSubmitError('Las contraseñas no coinciden')
      return
    }

    const organization = state.organization
    const emailValor = directoEmail.trim()

    setSubmitting(true)
    try {
      await registrarConQrDirecto(token, { name: directoName.trim(), email: emailValor, password: directoPassword })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo completar el registro')
      return
    }

    try {
      await onLogin(emailValor, directoPassword, true)
      onIrALaApp()
    } catch {
      setSubmitting(false)
      setState({ kind: 'creado-sin-sesion', organization })
    }
  }

  // Rama "ya tengo cuenta" (Ruling 1 y 2 del plan de esta PR): un solo campo
  // de contraseña, sin nombre ni confirmación, sin Authorization (nunca hay
  // sesión abierta acá). registrarConQrDirecto ya trata la contraseña
  // enviada como prueba de titularidad de una cuenta existente (backend PR
  // 3) — este handler solo cambia qué campos pide y a dónde navega después.
  async function handleSubmitDirectoIniciarSesion(e: FormEvent) {
    e.preventDefault()
    if (state.kind !== 'form-directo') return
    setSubmitError(null)

    const emailValor = signInEmail.trim()
    if (!emailValor) {
      setSubmitError('El email es obligatorio')
      return
    }
    if (!signInPassword) {
      setSubmitError('La contraseña es requerida')
      return
    }

    const organization = state.organization

    setSubmitting(true)
    try {
      await registrarConQrDirecto(token, { name: '', email: emailValor, password: signInPassword })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        setState({ kind: 'rate-limited', organization })
        return
      }
      setSubmitError(err instanceof Error ? err.message : 'No se pudo completar el registro')
      return
    }

    try {
      await onLogin(emailValor, signInPassword, true)
      // A diferencia de la rama "crear cuenta": el club PRIMARIO de esta
      // cuenta puede ser OTRO club (se estaba uniendo a un SEGUNDO club) —
      // navega explícitamente al club del QR, nunca al que devuelva el
      // login (ver Ruling 1 del plan de esta PR).
      window.location.assign(`/${organization.slug}`)
    } catch {
      setSubmitting(false)
      setState({ kind: 'creado-sin-sesion', organization })
    }
  }

  if (state.kind === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
          <Loader2 className="animate-spin text-primary" size={28} />
          <p className="text-sm">Cargando...</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'rate-limited') {
    return (
      <Shell org={state.organization}>
        {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}
        <CenteredMessage
          icon={<Clock size={32} className="text-error" />}
          title="Demasiados intentos"
          text={MENSAJE_RATE_LIMIT}
        />
      </Shell>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <Shell>
        {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}
        <CenteredMessage
          icon={<AlertCircle size={32} className="text-error" />}
          title="Este código QR no está disponible"
          text={state.message}
        />
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onIrALaApp}>
            Ir a iniciar sesión
          </Button>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'confirmation') {
    return (
      <Shell org={state.organization}>
        {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}
        <CenteredMessage
          icon={<CheckCircle2 size={36} className="text-emerald-600" />}
          title="Solicitud enviada"
          text={state.message}
        />
        <div className="flex flex-col sm:flex-row justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEmail('')
              setState({ kind: 'form', organization: state.organization })
            }}
          >
            Usar otro correo
          </Button>
          <Button onClick={onIrALaApp}>Iniciar sesión</Button>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'creado-sin-sesion') {
    return (
      <Shell org={state.organization}>
        <CenteredMessage
          icon={<CheckCircle2 size={36} className="text-emerald-600" />}
          title="¡Cuenta creada!"
          text="No pudimos iniciar tu sesión automáticamente. Inicia sesión con tu nueva contraseña."
        />
        <div className="flex justify-center">
          <Button onClick={onIrALaApp}>Iniciar sesión</Button>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'form-directo') {
    return (
      <Shell org={state.organization}>
        {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}

        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
            <UserPlus size={14} />
            Registro directo
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {directoModo === 'crear' ? `Únete a ${clubDisplayName(state.organization)}` : `Inicia sesión para unirte a ${clubDisplayName(state.organization)}`}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {directoModo === 'crear'
              ? 'Completa tus datos y quedarás adentro al instante — este código sirve una sola vez.'
              : 'Ya tienes una cuenta RIALA: inicia sesión con tu correo y tu contraseña de siempre para unirte a este club.'}
          </p>
        </div>

        {directoModo === 'crear' ? (
          <form
            onSubmit={(e) => void handleSubmitDirecto(e)}
            className="flex flex-col gap-4 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 sm:p-6"
          >
            <Input
              type="text"
              label="Nombre completo"
              value={directoName}
              onChange={(e) => { setDirectoName(e.target.value); setSubmitError(null) }}
              required
              autoComplete="name"
              disabled={submitting}
            />

            <Input
              type="email"
              label="Correo electrónico"
              value={directoEmail}
              onChange={(e) => { setDirectoEmail(e.target.value); setSubmitError(null) }}
              placeholder="persona@ejemplo.com"
              required
              autoComplete="email"
              disabled={submitting}
              leftIcon={<AtSign size={16} />}
            />

            <PasswordInput
              label="Contraseña"
              hint="Mínimo 8 caracteres"
              value={directoPassword}
              onChange={(e) => { setDirectoPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="new-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            <PasswordInput
              label="Confirmar contraseña"
              value={directoConfirmPassword}
              onChange={(e) => { setDirectoConfirmPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="new-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            {submitError && <p className="text-xs text-error" role="alert">{submitError}</p>}

            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? 'Creando cuenta...' : 'Unirme ahora'}
            </Button>

            <button
              type="button"
              onClick={() => { setDirectoModo('iniciar-sesion'); setSubmitError(null) }}
              className="text-sm text-secondary text-center hover:underline underline-offset-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ¿Ya tienes cuenta RIALA? Inicia sesión para unirte a {clubDisplayName(state.organization)}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitDirectoIniciarSesion(e)}
            className="flex flex-col gap-4 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 sm:p-6"
          >
            <Input
              type="email"
              label="Correo electrónico"
              value={signInEmail}
              onChange={(e) => { setSignInEmail(e.target.value); setSubmitError(null) }}
              placeholder="persona@ejemplo.com"
              required
              autoComplete="email"
              disabled={submitting}
              leftIcon={<AtSign size={16} />}
            />

            <PasswordInput
              label="Contraseña"
              value={signInPassword}
              onChange={(e) => { setSignInPassword(e.target.value); setSubmitError(null) }}
              required
              autoComplete="current-password"
              disabled={submitting}
              leftIcon={<Lock size={16} />}
            />

            {submitError && <p className="text-xs text-error" role="alert">{submitError}</p>}

            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? 'Iniciando sesión...' : 'Iniciar sesión y unirme'}
            </Button>

            <button
              type="button"
              onClick={() => { setDirectoModo('crear'); setSubmitError(null) }}
              className="text-sm text-secondary text-center hover:underline underline-offset-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ¿Aún no tienes cuenta? Crea una
            </button>
          </form>
        )}
      </Shell>
    )
  }

  // state.kind === 'form' (modo CORREO)
  return (
    <Shell org={state.organization}>
      {isAuthenticated && <BannerSesionActiva onIrALaApp={onIrALaApp} />}

      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2 text-secondary text-xs font-semibold uppercase tracking-widest mb-1">
          <QrCodeIcon size={14} />
          Invitación por QR
        </div>
        <h1 className="text-xl font-bold text-slate-900">{clubDisplayName(state.organization)}</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Escribe tu correo y te enviaremos una invitación para unirte a{' '}
          <span className="font-semibold text-slate-700">{clubDisplayName(state.organization)}</span>.
        </p>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex flex-col gap-4 bg-white rounded-2xl border border-secondary/15 shadow-sm p-4 sm:p-6"
      >
        <Input
          type="email"
          label="Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setSubmitError(null)
          }}
          placeholder="persona@ejemplo.com"
          disabled={submitting}
          required
        />

        {submitError && (
          <p className="text-xs text-error" role="alert">
            {submitError}
          </p>
        )}

        <Button type="submit" loading={submitting} fullWidth>
          {submitting ? 'Enviando...' : 'Enviar invitación'}
        </Button>
      </form>
    </Shell>
  )
}

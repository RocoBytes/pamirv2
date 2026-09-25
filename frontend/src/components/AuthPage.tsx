import { useState, useEffect } from 'react'
import { Loader2, CheckCircle, AlertCircle, ArrowLeft, ArrowRight, UserPlus, AtSign, Lock, ShieldCheck } from 'lucide-react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { PasswordInput } from './ui/PasswordInput'
import { Checkbox } from './ui/Checkbox'
import { AuthVisualPanel } from './auth/AuthVisualPanel'
import { PLATFORM_LOGO_FULL, PLATFORM_NAME, clubDisplayName } from '../lib/club-brand'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { forgotPassword, resetPassword, consultarInvitacion, aceptarInvitacion } from '../lib/api'
import type { ConsultarInvitacionResponse } from '../types/invitacion'

type View = 'login' | 'forgot' | 'reset' | 'verify-success' | 'verify-error' | 'accept-invite'

interface AuthPageProps {
  // remember: true guarda la sesión en localStorage ("recordar este
  // equipo"); false, en sessionStorage (muere al cerrar el navegador). Ver
  // establishSession en lib/storage.ts.
  onLogin: (email: string, password: string, remember: boolean) => Promise<void>
  isLoading: boolean
  verifiedStatus?: 'success' | 'error'
  resetToken?: string
  inviteToken?: string
}

export function AuthPage({ onLogin, isLoading, verifiedStatus, resetToken, inviteToken }: AuthPageProps) {
  const isDesktop = useIsDesktop()

  const initialView: View = verifiedStatus === 'success'
    ? 'verify-success'
    : verifiedStatus === 'error'
    ? 'verify-error'
    : resetToken
    ? 'reset'
    : inviteToken
    ? 'accept-invite'
    : 'login'

  const [view, setView] = useState<View>(initialView)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginNote, setLoginNote] = useState<string | null>(null)

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Sin marcar por defecto: la sesión dura lo que dure el navegador salvo que
  // el socio lo pida explícitamente. Es el default seguro en un equipo
  // compartido (un refugio, el computador del club).
  const [rememberDevice, setRememberDevice] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetDone, setResetDone] = useState(false)

  // Aceptar invitación
  const [inviteInfo, setInviteInfo] = useState<ConsultarInvitacionResponse | null>(null)
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken))
  const [inviteLoadError, setInviteLoadError] = useState<string | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  // Rama "cuenta existente" (inviteInfo.cuentaExistente): un solo campo de
  // contraseña, sin nombre ni confirmación — ver Global Constraints del plan
  // de esta PR.
  const [existingPassword, setExistingPassword] = useState('')

  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    setInviteLoading(true)
    setInviteLoadError(null)
    consultarInvitacion(inviteToken)
      .then((data) => {
        if (cancelled) return
        setInviteInfo(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setInviteLoadError(err instanceof Error ? err.message : 'No se pudo consultar la invitación')
      })
      .finally(() => {
        if (cancelled) return
        setInviteLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  function clearError() { setError(null) }

  // Rama "cuenta nueva": comportamiento de siempre.
  async function handleAcceptInviteNueva(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)

    if (!inviteName.trim()) {
      setInviteError('El nombre es requerido')
      return
    }
    if (invitePassword.length < 8) {
      setInviteError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (invitePassword !== inviteConfirmPassword) {
      setInviteError('Las contraseñas no coinciden')
      return
    }

    setInviteSubmitting(true)
    try {
      const { message, email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, inviteName.trim(), invitePassword)
      try {
        // Cuenta recién creada, sin checkbox de "recordar" en esta vista:
        // se recuerda por defecto, igual que el comportamiento de siempre.
        // El club primario de una cuenta NUEVA ES el club de la invitación
        // (se crea así), así que el login normal ya aterriza en el lugar
        // correcto — a diferencia de la rama de cuenta existente, ver
        // handleAcceptInviteExistente y Ruling 1 del plan de esta PR.
        await onLogin(aceptadoEmail, invitePassword, true)
      } catch {
        setLoginNote(message)
        setView('login')
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    } finally {
      setInviteSubmitting(false)
    }
  }

  // Rama "cuenta existente" (Ruling 1, 2 y 3 del plan de esta PR): un solo
  // campo de contraseña, sin Authorization (nunca hay sesión abierta acá —
  // ver Ruling 2), y tras el login SIEMPRE navega explícitamente al club de
  // ESTA invitación, nunca al que devuelva el login (que es el club PRIMARIO
  // de la cuenta, no el recién unido).
  async function handleAcceptInviteExistente(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)

    // Fix round 1 (Ruling 1): sin el slug de ESTA invitación no hay adónde
    // redirigir tras el login (que siempre resuelve el club PRIMARIO de la
    // cuenta, nunca el recién unido) — la vista ya deja el formulario
    // deshabilitado y muestra el error de forma permanente más abajo cuando
    // esto pasa; este guard es la última línea de defensa para que JAMÁS se
    // llegue a aceptar la invitación sin saber a qué club aterrizar.
    const targetSlug = inviteInfo?.organization?.slug
    if (!targetSlug) return

    if (!existingPassword) {
      setInviteError('La contraseña es requerida')
      return
    }

    setInviteSubmitting(true)
    try {
      const { message, email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, '', existingPassword)
      try {
        await onLogin(aceptadoEmail, existingPassword, true)
        window.location.assign(`/${targetSlug}`)
        return
      } catch {
        setLoginNote(message)
        setView('login')
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    setSubmitting(true)
    try {
      await onLogin(email, password, rememberDevice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    setSubmitting(true)
    try {
      await forgotPassword(forgotEmail)
      setForgotSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar la solicitud')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(resetToken!, newPassword)
      setResetDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al restablecer la contraseña')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Columna del formulario PRIMERO en el DOM: el e2e de branding asume
          que el logo de RIALA es el primer <img> de la página, y es además
          el orden correcto para un lector de pantalla (el contenido antes
          que la imagen decorativa). */}
      <div className="min-h-dvh flex flex-col bg-surface-container-lowest px-4">
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="w-full max-w-[360px] flex flex-col gap-8">

            {/* ── Verificación exitosa ─────────────────────────────────── */}
            {view === 'verify-success' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <CheckCircle size={48} className="text-primary" />
                <h1 className="text-xl font-bold text-slate-800">¡Cuenta verificada!</h1>
                <p className="text-on-surface-variant text-sm">Tu email fue confirmado. Ahora puedes iniciar sesión.</p>
                <Button fullWidth onClick={() => setView('login')}>Iniciar sesión</Button>
              </div>
            )}

            {/* ── Error de verificación ────────────────────────────────── */}
            {view === 'verify-error' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <AlertCircle size={48} className="text-error" />
                <h1 className="text-xl font-bold text-slate-800">Enlace inválido</h1>
                <p className="text-on-surface-variant text-sm">El enlace de verificación es inválido o ya fue usado.</p>
                <Button fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
              </div>
            )}

            {/* ── Restablecer contraseña ───────────────────────────────── */}
            {view === 'reset' && (
              <>
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold text-slate-800">Nueva contraseña</h1>
                  <p className="text-on-surface-variant text-sm">Ingresa tu nueva contraseña.</p>
                </div>
                {resetDone ? (
                  <div className="flex flex-col gap-4 text-center">
                    <CheckCircle size={40} className="text-primary mx-auto" />
                    <p className="text-slate-700 text-sm font-medium">¡Contraseña actualizada! Ya puedes iniciar sesión.</p>
                    <Button fullWidth onClick={() => setView('login')}>Iniciar sesión</Button>
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleReset(e)} className="flex flex-col gap-4">
                    <PasswordInput
                      label="Nueva contraseña"
                      hint="Mínimo 8 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      leftIcon={<Lock size={16} />}
                    />
                    {error && <p className="text-xs text-error" role="alert">{error}</p>}
                    <Button type="submit" fullWidth disabled={submitting}>
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Actualizar contraseña'}
                    </Button>
                  </form>
                )}
              </>
            )}

            {/* ── Aceptar invitación ───────────────────────────────────── */}
            {view === 'accept-invite' && (
              <>
                {inviteLoading && (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <Loader2 size={32} className="animate-spin text-primary" />
                    <p className="text-sm text-on-surface-variant">Consultando invitación...</p>
                  </div>
                )}

                {!inviteLoading && inviteLoadError && (
                  <div className="flex flex-col items-center gap-4 text-center">
                    <AlertCircle size={48} className="text-error" />
                    <h1 className="text-xl font-bold text-slate-800">Invitación no disponible</h1>
                    <p className="text-on-surface-variant text-sm" role="alert">{inviteLoadError}</p>
                    <Button fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
                  </div>
                )}

                {!inviteLoading && !inviteLoadError && inviteInfo && inviteInfo.cuentaExistente && (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-secondary">
                        <ShieldCheck size={18} />
                        <h1 className="text-xl font-bold text-slate-800">Ya tienes una cuenta RIALA</h1>
                      </div>
                      <p className="text-on-surface-variant text-sm">
                        <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                        unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                        como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>. Inicia sesión
                        con tu correo y tu contraseña de siempre para unirte.
                      </p>
                    </div>

                    <form onSubmit={(e) => void handleAcceptInviteExistente(e)} className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-primary">Email</span>
                        <p
                          className="w-full rounded-xl border border-secondary/40 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
                          aria-label="Email de la invitación"
                        >
                          {inviteInfo.email}
                        </p>
                      </div>

                      {/* Fix round 1 (Ruling 1): sin el slug del club de ESTA
                          invitación no hay adónde redirigir tras el login —
                          el formulario queda deshabilitado de forma
                          permanente, no solo tras un intento de envío. */}
                      {!inviteInfo.organization?.slug && (
                        <p className="text-xs text-error" role="alert">
                          No pudimos identificar el club de esta invitación. Pide una nueva invitación.
                        </p>
                      )}

                      <PasswordInput
                        label="Contraseña"
                        value={existingPassword}
                        onChange={(e) => { setExistingPassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="current-password"
                        leftIcon={<Lock size={16} />}
                        disabled={!inviteInfo.organization?.slug}
                      />

                      {inviteError && <p className="text-xs text-error" role="alert">{inviteError}</p>}

                      <Button type="submit" fullWidth disabled={inviteSubmitting || !inviteInfo.organization?.slug}>
                        {inviteSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Iniciar sesión y unirme'}
                      </Button>
                    </form>
                  </>
                )}

                {!inviteLoading && !inviteLoadError && inviteInfo && !inviteInfo.cuentaExistente && (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-secondary">
                        <UserPlus size={18} />
                        <h1 className="text-xl font-bold text-slate-800">Crea tu cuenta</h1>
                      </div>
                      <p className="text-on-surface-variant text-sm">
                        <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                        unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                        como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>.
                      </p>
                    </div>

                    <form onSubmit={(e) => void handleAcceptInviteNueva(e)} className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-primary">Email</span>
                        <p
                          className="w-full rounded-xl border border-secondary/40 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
                          aria-label="Email de la invitación"
                        >
                          {inviteInfo.email}
                        </p>
                      </div>

                      <Input
                        type="text"
                        label="Nombre completo"
                        value={inviteName}
                        onChange={(e) => { setInviteName(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="name"
                      />

                      <PasswordInput
                        label="Contraseña"
                        hint="Mínimo 8 caracteres"
                        value={invitePassword}
                        onChange={(e) => { setInvitePassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      <PasswordInput
                        label="Confirmar contraseña"
                        value={inviteConfirmPassword}
                        onChange={(e) => { setInviteConfirmPassword(e.target.value); setInviteError(null) }}
                        required
                        autoComplete="new-password"
                        leftIcon={<Lock size={16} />}
                      />

                      {inviteError && <p className="text-xs text-error" role="alert">{inviteError}</p>}

                      <Button type="submit" fullWidth disabled={inviteSubmitting}>
                        {inviteSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Crear cuenta'}
                      </Button>
                    </form>
                  </>
                )}
              </>
            )}

            {/* ── Olvidé mi contraseña ─────────────────────────────────── */}
            {view === 'forgot' && (
              <>
                <button
                  onClick={() => setView('login')}
                  className="inline-flex items-center gap-1 self-start text-sm text-on-surface-variant hover:text-slate-700 transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowLeft size={14} />Volver
                </button>
                <div className="flex flex-col gap-1 -mt-4">
                  <h1 className="text-xl font-bold text-slate-800">Restablecer contraseña</h1>
                  <p className="text-on-surface-variant text-sm">Ingresa tu email y te enviaremos un enlace.</p>
                </div>
                {forgotSent ? (
                  <div className="flex flex-col gap-3 text-center">
                    <CheckCircle size={40} className="text-primary mx-auto" />
                    <p className="text-slate-700 text-sm">Si el email está registrado, recibirás el enlace en breve. Revisa tu bandeja de entrada y la carpeta de spam.</p>
                    <Button variant="ghost" fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleForgot(e)} className="flex flex-col gap-4">
                    <Input
                      type="email"
                      label="Correo electrónico"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="tu@correo.cl"
                      required
                      autoComplete="email"
                      leftIcon={<AtSign size={16} />}
                    />
                    {error && <p className="text-xs text-error" role="alert">{error}</p>}
                    <Button type="submit" fullWidth disabled={submitting}>
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Enviar enlace'}
                    </Button>
                  </form>
                )}
              </>
            )}

            {/* ── Login ────────────────────────────────────────────────── */}
            {view === 'login' && (
              <>
                <div className="flex flex-col items-start gap-4">
                  {/* Login único, siempre con marca RIALA (Decisión del
                      2026-09-25): nunca el logo de un club, ni por slug del
                      path ni por preferencia recordada — quien inicia sesión
                      elige su club DESPUÉS, en Mis clubes. Grande y centrado
                      sobre el formulario, sin recuadro de color. */}
                  <img
                    src={PLATFORM_LOGO_FULL}
                    alt={PLATFORM_NAME}
                    className="self-center h-28 sm:h-32 w-auto max-w-full object-contain"
                  />
                  <div className="flex flex-col gap-2">
                    <p className="text-label-caps uppercase tracking-[0.05em] text-secondary">
                      Registro de salidas y expediciones
                    </p>
                    <h1 className="text-headline-lg text-slate-800">Iniciar sesión</h1>
                    <p className="text-sm text-on-surface-variant">
                      Ingresa tus credenciales para acceder a la plataforma.
                    </p>
                  </div>
                </div>

                {loginNote && (
                  <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
                    <CheckCircle size={14} className="shrink-0 mt-0.5" />
                    <p>{loginNote}</p>
                  </div>
                )}

                <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4">
                  <Input
                    type="email"
                    label="Correo electrónico"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearError() }}
                    placeholder="tu@correo.cl"
                    required
                    autoComplete="email"
                    leftIcon={<AtSign size={16} />}
                  />
                  <PasswordInput
                    label="Contraseña"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError() }}
                    required
                    autoComplete="current-password"
                    leftIcon={<Lock size={16} />}
                  />

                  <div className="flex items-center justify-between gap-3">
                    <Checkbox
                      label="Recordar este equipo"
                      className="whitespace-nowrap"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                    />
                    <button
                      type="button"
                      onClick={() => { clearError(); setView('forgot') }}
                      className="text-xs text-secondary whitespace-nowrap hover:underline rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>

                  {error && <p className="text-xs text-error" role="alert">{error}</p>}

                  <Button type="submit" fullWidth disabled={submitting || isLoading}>
                    {submitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        Iniciar sesión
                        <ArrowRight size={16} />
                      </>
                    )}
                  </Button>
                </form>

                <div className="flex items-start gap-2 text-xs text-on-surface-variant">
                  <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                  <p>El acceso está restringido a socios y cordadas registradas.</p>
                </div>
              </>
            )}

          </div>
        </div>

        <footer className="pb-6 text-center text-xs text-on-surface-variant">
          © 2026 RIALA · Seguridad en Montaña
        </footer>
      </div>

      {/* Panel visual a sangre completa. Se RENDERIZA condicionalmente en vez
          de ocultarse con `hidden lg:block`: el navegador descarga igual la
          imagen (y descargaría el video) de un <img> que está dentro de un
          contenedor display:none. En móvil el panel ni siquiera se ve, así que
          su costo tiene que ser cero bytes, no "bytes despriorizados". Misma
          razón por la que el dashboard elige variante desde JS — ver el
          comentario de hooks/useMediaQuery.ts. */}
      {isDesktop && (
        <div className="relative">
          <AuthVisualPanel />
        </div>
      )}
    </div>
  )
}

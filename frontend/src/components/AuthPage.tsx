import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle, ArrowLeft, UserPlus } from 'lucide-react'
import { Button } from './ui/Button'
import { ClubLogo } from './ClubLogo'
import { clubDisplayName } from '../lib/club-brand'
import { forgotPassword, resetPassword, consultarInvitacion, aceptarInvitacion } from '../lib/api'
import type { ConsultarInvitacionResponse } from '../types/invitacion'

type View = 'login' | 'forgot' | 'reset' | 'verify-success' | 'verify-error' | 'accept-invite'

interface AuthPageProps {
  onLogin: (email: string, password: string) => Promise<void>
  isLoading: boolean
  verifiedStatus?: 'success' | 'error'
  resetToken?: string
  inviteToken?: string
}

export function AuthPage({ onLogin, isLoading, verifiedStatus, resetToken, inviteToken }: AuthPageProps) {
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
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginNote, setLoginNote] = useState<string | null>(null)

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
  const [showInvitePassword, setShowInvitePassword] = useState(false)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

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

  async function handleAcceptInvite(e: React.FormEvent) {
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
      const { email: aceptadoEmail } = await aceptarInvitacion(inviteToken!, inviteName.trim(), invitePassword)
      try {
        await onLogin(aceptadoEmail, invitePassword)
      } catch {
        setLoginNote('Tu cuenta fue creada. Inicia sesión con tu nueva contraseña.')
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
      await onLogin(email, password)
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

  const inputClass = 'w-full rounded-xl border border-[#4a6fad]/40 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#264c99] focus:border-[#264c99] transition-colors'

  // El login (y cualquier otra vista sin invitación resuelta) es
  // intencionalmente neutral: nunca antes de autenticar se sabe a qué club
  // pertenece quien mira la pantalla. Solo "aceptar invitación", con la
  // invitación ya consultada, muestra la marca de ESE club.
  const inviteOrg = view === 'accept-invite' ? (inviteInfo?.organization ?? null) : null

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #0f1f3d 0%, #1a3060 100%)' }}
    >
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none" aria-hidden="true">
        <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <ClubLogo org={inviteOrg} alt="" className="w-36 h-36 object-contain drop-shadow-lg mb-2" />
          <p className="text-white/50 mt-1 text-center text-sm">Registro de salidas de montaña</p>
        </div>

        <div className="bg-[#fafaf8] rounded-2xl shadow-2xl p-8">

          {/* ── Verificación exitosa ─────────────────────────────────── */}
          {view === 'verify-success' && (
            <div className="flex flex-col items-center gap-4 text-center">
              <CheckCircle size={48} className="text-[#264c99]" />
              <h2 className="text-xl font-bold text-slate-800">¡Cuenta verificada!</h2>
              <p className="text-[#757874] text-sm">Tu email fue confirmado. Ahora puedes iniciar sesión.</p>
              <Button fullWidth onClick={() => setView('login')}>Iniciar sesión</Button>
            </div>
          )}

          {/* ── Error de verificación ────────────────────────────────── */}
          {view === 'verify-error' && (
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle size={48} className="text-[#A4636E]" />
              <h2 className="text-xl font-bold text-slate-800">Enlace inválido</h2>
              <p className="text-[#757874] text-sm">El enlace de verificación es inválido o ya fue usado.</p>
              <Button fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
            </div>
          )}

          {/* ── Restablecer contraseña ───────────────────────────────── */}
          {view === 'reset' && (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Nueva contraseña</h2>
              <p className="text-[#757874] text-sm mb-6">Ingresa tu nueva contraseña.</p>
              {resetDone ? (
                <div className="flex flex-col gap-4 text-center">
                  <CheckCircle size={40} className="text-[#264c99] mx-auto" />
                  <p className="text-slate-700 text-sm font-medium">¡Contraseña actualizada! Ya puedes iniciar sesión.</p>
                  <Button fullWidth onClick={() => setView('login')}>Iniciar sesión</Button>
                </div>
              ) : (
                <form onSubmit={(e) => void handleReset(e)} className="flex flex-col gap-4">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Nueva contraseña (mín. 8 caracteres)"
                      required
                      className={inputClass + ' pr-10'}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#757874]">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
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
                  <Loader2 size={32} className="animate-spin text-[#264c99]" />
                  <p className="text-sm text-[#757874]">Consultando invitación...</p>
                </div>
              )}

              {!inviteLoading && inviteLoadError && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <AlertCircle size={48} className="text-[#A4636E]" />
                  <h2 className="text-xl font-bold text-slate-800">Invitación no disponible</h2>
                  <p className="text-[#757874] text-sm" role="alert">{inviteLoadError}</p>
                  <Button fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
                </div>
              )}

              {!inviteLoading && !inviteLoadError && inviteInfo && (
                <>
                  <div className="flex items-center gap-2 text-[#4a6fad] mb-1">
                    <UserPlus size={18} />
                    <h2 className="text-xl font-bold text-slate-800">Crea tu cuenta</h2>
                  </div>
                  <p className="text-[#757874] text-sm mb-6">
                    <span className="font-semibold text-slate-700">{inviteInfo.invitadoPor}</span> te invitó a
                    unirse a <span className="font-semibold text-slate-700">{clubDisplayName(inviteInfo.organization)}</span>{' '}
                    como <span className="font-semibold text-slate-700">{inviteInfo.rolLabel}</span>.
                  </p>

                  <form onSubmit={(e) => void handleAcceptInvite(e)} className="flex flex-col gap-4">
                    <div>
                      <span className="block text-xs font-semibold text-[#264c99] mb-1">Email</span>
                      <p className={inputClass + ' bg-[#f0f4fb] text-[#757874]'} aria-label="Email de la invitación">{inviteInfo.email}</p>
                    </div>

                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => { setInviteName(e.target.value); setInviteError(null) }}
                      placeholder="Nombre completo"
                      aria-label="Nombre completo"
                      required
                      autoComplete="name"
                      className={inputClass}
                    />

                    <div className="relative">
                      <input
                        type={showInvitePassword ? 'text' : 'password'}
                        value={invitePassword}
                        onChange={(e) => { setInvitePassword(e.target.value); setInviteError(null) }}
                        placeholder="Contraseña (mín. 8 caracteres)"
                        aria-label="Contraseña"
                        required
                        autoComplete="new-password"
                        className={inputClass + ' pr-10'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowInvitePassword(!showInvitePassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#757874]"
                        aria-label={showInvitePassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showInvitePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    <input
                      type={showInvitePassword ? 'text' : 'password'}
                      value={inviteConfirmPassword}
                      onChange={(e) => { setInviteConfirmPassword(e.target.value); setInviteError(null) }}
                      placeholder="Confirmar contraseña"
                      aria-label="Confirmar contraseña"
                      required
                      autoComplete="new-password"
                      className={inputClass}
                    />

                    {inviteError && <p className="text-xs text-[#A4636E]" role="alert">{inviteError}</p>}

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
              <button onClick={() => setView('login')} className="flex items-center gap-1 text-sm text-[#757874] hover:text-slate-700 mb-4 transition-colors">
                <ArrowLeft size={14} />Volver
              </button>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Restablecer contraseña</h2>
              <p className="text-[#757874] text-sm mb-6">Ingresa tu email y te enviaremos un enlace.</p>
              {forgotSent ? (
                <div className="flex flex-col gap-3 text-center">
                  <CheckCircle size={40} className="text-[#264c99] mx-auto" />
                  <p className="text-slate-700 text-sm">Si el email está registrado, recibirás el enlace en breve. Revisa tu bandeja de entrada y la carpeta de spam.</p>
                  <Button variant="ghost" fullWidth onClick={() => setView('login')}>Volver al inicio</Button>
                </div>
              ) : (
                <form onSubmit={(e) => void handleForgot(e)} className="flex flex-col gap-4">
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="Tu email"
                    required
                    className={inputClass}
                  />
                  {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
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
              <h2 className="text-xl font-bold text-slate-800 mb-1" style={{ fontFamily: "'Manrope', sans-serif" }}>Bienvenido</h2>
              <p className="text-[#757874] text-sm mb-7">Inicia sesión para guardar y sincronizar tus salidas.</p>
              {loginNote && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 mb-5">
                  <CheckCircle size={14} className="shrink-0 mt-0.5" />
                  <p>{loginNote}</p>
                </div>
              )}
              <form onSubmit={(e) => void handleLogin(e)} className="flex flex-col gap-4 mb-5">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError() }}
                  placeholder="Email"
                  required
                  autoComplete="email"
                  className={inputClass}
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError() }}
                    placeholder="Contraseña"
                    required
                    autoComplete="current-password"
                    className={inputClass + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#757874]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
                <Button type="submit" fullWidth disabled={submitting || isLoading}>
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Iniciar sesión'}
                </Button>
              </form>
              <div className="flex justify-end text-xs text-[#4a6fad] mb-3">
                <button type="button" onClick={() => { clearError(); setView('forgot') }} className="hover:underline">
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <p className="text-center text-[11px] text-[#757874]">
                El acceso es solo por invitación de un administrador o líder del club.
              </p>
            </>
          )}

        </div>

        <p className="text-white/30 text-xs text-center mt-6">
          Sistema de registro de salidas de montaña
        </p>
      </div>
    </div>
  )
}

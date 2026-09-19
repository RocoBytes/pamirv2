import { useState } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from './ui/Button'
import { forgotPassword, resetPassword } from '../lib/api'
import logoPamir from '../assets/logo_PAMIR.png'

type View = 'login' | 'register' | 'verify-pending' | 'forgot' | 'reset' | 'verify-success' | 'verify-error'

interface AuthPageProps {
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (name: string, email: string, password: string) => Promise<void>
  isLoading: boolean
  verifiedStatus?: 'success' | 'error'
  resetToken?: string
}

export function AuthPage({ onLogin, onRegister, isLoading, verifiedStatus, resetToken }: AuthPageProps) {
  const initialView: View = verifiedStatus === 'success'
    ? 'verify-success'
    : verifiedStatus === 'error'
    ? 'verify-error'
    : resetToken
    ? 'reset'
    : 'login'

  const [view, setView] = useState<View>(initialView)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState('')

  // Form fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetDone, setResetDone] = useState(false)

  function clearError() { setError(null) }

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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setSubmitting(true)
    try {
      await onRegister(name, email, password)
      setPendingEmail(email)
      setView('verify-pending')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la cuenta')
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
          <img src={logoPamir} alt="Pamir Andino Club" className="w-36 h-36 object-contain drop-shadow-lg mb-2" />
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

          {/* ── Verificación pendiente ───────────────────────────────── */}
          {view === 'verify-pending' && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#e8eef7]">
                <CheckCircle size={32} className="text-[#264c99]" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Revisa tu correo</h2>
              <p className="text-[#757874] text-sm">
                Enviamos un enlace de verificación a <strong className="text-slate-700">{pendingEmail}</strong>.
                Haz clic en el enlace para activar tu cuenta.
              </p>
              <p className="text-xs text-[#757874]/70">¿No llegó? Revisa la carpeta de spam.</p>
              <Button variant="ghost" fullWidth onClick={() => setView('login')}>Volver al inicio de sesión</Button>
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

          {/* ── Registro ─────────────────────────────────────────────── */}
          {view === 'register' && (
            <>
              <button onClick={() => setView('login')} className="flex items-center gap-1 text-sm text-[#757874] hover:text-slate-700 mb-4 transition-colors">
                <ArrowLeft size={14} />Volver al inicio de sesión
              </button>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Crear cuenta</h2>
              <p className="text-[#757874] text-sm mb-6">Usa cualquier correo: Gmail, Outlook, Yahoo, etc.</p>
              <form onSubmit={(e) => void handleRegister(e)} className="flex flex-col gap-4">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearError() }}
                  placeholder="Nombre completo"
                  required
                  className={inputClass}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError() }}
                  placeholder="Email"
                  required
                  className={inputClass}
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError() }}
                    placeholder="Contraseña (mín. 8 caracteres)"
                    required
                    className={inputClass + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#757874]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); clearError() }}
                    placeholder="Confirmar contraseña"
                    required
                    className={inputClass + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#757874]">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {error && <p className="text-xs text-[#A4636E]" role="alert">{error}</p>}
                <Button type="submit" fullWidth disabled={submitting || isLoading}>
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Crear cuenta'}
                </Button>
              </form>
            </>
          )}

          {/* ── Login ────────────────────────────────────────────────── */}
          {view === 'login' && (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-1" style={{ fontFamily: "'Manrope', sans-serif" }}>Bienvenido</h2>
              <p className="text-[#757874] text-sm mb-7">Inicia sesión para guardar y sincronizar tus salidas.</p>
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
              <div className="flex justify-between text-xs text-[#4a6fad] mb-5">
                <button type="button" onClick={() => { clearError(); setView('register') }} className="hover:underline">
                  ¿No tienes cuenta? Regístrate
                </button>
                <button type="button" onClick={() => { clearError(); setView('forgot') }} className="hover:underline">
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </>
          )}

        </div>

        <p className="text-white/30 text-xs text-center mt-6">
          Sistema de registro alpino &mdash; Pamir v1.0
        </p>
      </div>
    </div>
  )
}

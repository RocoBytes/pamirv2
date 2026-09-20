import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  UserPlus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  Send,
  Ban,
  Inbox,
} from 'lucide-react'

import {
  listarInvitaciones,
  crearInvitacion,
  revocarInvitacion,
  reenviarInvitacion,
} from '../../lib/api'
import type { Invitacion, EstadoInvitacion, Rol } from '../../types/invitacion'
import { ROL_LABELS, ESTADO_LABELS } from '../../types/invitacion'
import { rolesInvitables } from '../../lib/roles'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'

interface InvitacionesManagerProps {
  rolActual: Rol
}

const ESTADO_BADGE_CLASS: Record<EstadoInvitacion, string> = {
  PENDIENTE: 'bg-[#e8eef7] text-[#264c99] border border-[#264c99]/20',
  ACEPTADA: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  REVOCADA: 'bg-slate-100 text-slate-500 border border-slate-200',
  EXPIRADA: 'bg-amber-50 text-amber-800 border border-amber-200',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function EstadoBadge({ estado }: { estado: EstadoInvitacion }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${ESTADO_BADGE_CLASS[estado]}`}>
      {ESTADO_LABELS[estado]}
    </span>
  )
}

interface EnlaceBannerProps {
  inviteUrl: string
  emailEnviado: boolean
}

function EnlaceBanner({ inviteUrl, emailEnviado }: EnlaceBannerProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'unavailable'>('idle')

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard no disponible')
      await navigator.clipboard.writeText(inviteUrl)
      setCopyState('copied')
    } catch {
      setCopyState('unavailable')
    }
  }, [inviteUrl])

  return (
    <div
      className={
        emailEnviado
          ? 'flex flex-col gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 mb-4'
          : 'flex flex-col gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 mb-4'
      }
    >
      <div className="flex items-start gap-2">
        {emailEnviado ? (
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
        )}
        <p className="font-semibold">
          {emailEnviado
            ? 'Invitación enviada por correo.'
            : 'No se pudo enviar el correo. Comparte el enlace manualmente.'}
        </p>
      </div>
      <p className="text-xs">
        El enlace es personal, de un solo uso y vale por 7 días.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          readOnly
          value={inviteUrl}
          aria-label="Enlace de invitación"
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 rounded-lg border border-current/20 bg-white/70 px-2 py-1.5 text-xs text-slate-700 font-mono"
        />
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 bg-white border border-current/30 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-white/70 transition-colors"
        >
          <Copy size={12} />
          Copiar enlace
        </button>
      </div>
      {copyState === 'copied' && <p className="text-xs font-medium">Enlace copiado.</p>}
      {copyState === 'unavailable' && (
        <p className="text-xs font-medium">
          No se pudo copiar automáticamente. Selecciona el texto de arriba y cópialo manualmente.
        </p>
      )}
    </div>
  )
}

export function InvitacionesManager({ rolActual }: InvitacionesManagerProps) {
  const opcionesRol = rolesInvitables(rolActual)
  const soloUnaOpcion = opcionesRol.length === 1

  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<Rol>(opcionesRol[0] ?? 'SOCIO')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ inviteUrl: string; emailEnviado: boolean } | null>(null)

  const [invitaciones, setInvitaciones] = useState<Invitacion[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [confirmRevocarId, setConfirmRevocarId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string | null>>({})

  const load = useCallback(async () => {
    setListError(null)
    try {
      const { invitaciones } = await listarInvitaciones()
      setInvitaciones(invitaciones)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudieron cargar las invitaciones')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCrear = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setCreateError(null)
      setBanner(null)

      const valor = email.trim()
      if (!valor) {
        setCreateError('El email es obligatorio')
        return
      }

      setCreating(true)
      try {
        const result = await crearInvitacion(valor, soloUnaOpcion ? opcionesRol[0] : rol)
        setBanner({ inviteUrl: result.inviteUrl, emailEnviado: result.emailEnviado })
        setEmail('')
        await load()
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'No se pudo crear la invitación')
      } finally {
        setCreating(false)
      }
    },
    [email, rol, soloUnaOpcion, opcionesRol, load],
  )

  const handleRevocar = useCallback(
    async (id: string) => {
      setPendingId(id)
      setBanner(null)
      setRowError((prev) => ({ ...prev, [id]: null }))
      try {
        await revocarInvitacion(id)
        setConfirmRevocarId(null)
        await load()
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : 'No se pudo revocar la invitación',
        }))
      } finally {
        setPendingId(null)
      }
    },
    [load],
  )

  const handleReenviar = useCallback(
    async (id: string) => {
      setPendingId(id)
      setBanner(null)
      setRowError((prev) => ({ ...prev, [id]: null }))
      try {
        const result = await reenviarInvitacion(id)
        setBanner({ inviteUrl: result.inviteUrl, emailEnviado: result.emailEnviado })
        await load()
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : 'No se pudo reenviar la invitación',
        }))
      } finally {
        setPendingId(null)
      }
    },
    [load],
  )

  const mostrarInvitadoPor = rolActual === 'ADMIN'

  return (
    <div>
      {/* ── Formulario de invitación ─────────────────────────────────────── */}
      <form
        onSubmit={(e) => void handleCrear(e)}
        className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 mb-5 flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-[#264c99]" />
          <h3 className="text-sm font-bold text-slate-900">Nueva invitación</h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@ejemplo.com"
              disabled={creating}
              required
            />
          </div>

          {soloUnaOpcion ? (
            <div className="flex items-end pb-2 sm:w-56 shrink-0">
              <p className="text-xs text-[#757874]">
                Se invitará como <span className="font-semibold text-slate-700">{ROL_LABELS[opcionesRol[0]!]}</span>.
              </p>
            </div>
          ) : (
            <div className="sm:w-56 shrink-0">
              <Select
                label="Rol"
                value={rol}
                onChange={(e) => setRol(e.target.value as Rol)}
                disabled={creating}
                options={opcionesRol.map((r) => ({ value: r, label: ROL_LABELS[r] }))}
              />
            </div>
          )}
        </div>

        {createError && (
          <p className="text-xs text-[#A4636E]" role="alert">
            {createError}
          </p>
        )}

        {banner && <EnlaceBanner inviteUrl={banner.inviteUrl} emailEnviado={banner.emailEnviado} />}

        <Button type="submit" disabled={creating} className="self-start">
          {creating ? <Loader2 size={16} className="animate-spin" /> : 'Enviar invitación'}
        </Button>
      </form>

      {/* ── Lista de invitaciones ────────────────────────────────────────── */}
      {listError && (
        <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 text-sm text-[#8b3a44] mb-4">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{listError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1 font-semibold underline text-xs"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {!invitaciones && !listError && (
        <div className="flex items-center gap-2 text-[#757874] py-6">
          <Loader2 className="animate-spin text-[#264c99]" size={18} />
          <p className="text-sm">Cargando invitaciones...</p>
        </div>
      )}

      {invitaciones && invitaciones.length === 0 && (
        <div className="flex flex-col items-center py-10 gap-3 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-[#e8eef7]">
            <Inbox size={22} className="text-[#264c99]" />
          </div>
          <p className="text-sm text-[#757874]">Todavía no has enviado invitaciones</p>
        </div>
      )}

      {invitaciones && invitaciones.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {invitaciones.map((inv) => {
              const isPending = pendingId === inv.id
              const confirming = confirmRevocarId === inv.id
              const puedeReenviar = inv.estado === 'PENDIENTE' || inv.estado === 'EXPIRADA'
              const puedeRevocar = inv.estado === 'PENDIENTE'
              return (
                <li key={inv.id} className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{inv.email}</p>
                      <p className="text-xs text-[#757874] mt-0.5">{ROL_LABELS[inv.rol]}</p>
                    </div>
                    <EstadoBadge estado={inv.estado} />
                  </div>
                  <p className="text-xs text-[#757874]">Vence: {formatDate(inv.expiresAt)}</p>
                  {mostrarInvitadoPor && inv.invitadoPor && (
                    <p className="text-xs text-[#757874]">Invitó: {inv.invitadoPor.name}</p>
                  )}

                  {rowError[inv.id] && (
                    <p className="text-xs text-[#A4636E] mt-2" role="alert">
                      {rowError[inv.id]}
                    </p>
                  )}

                  {(puedeReenviar || puedeRevocar) && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {puedeReenviar && (
                        <button
                          type="button"
                          onClick={() => void handleReenviar(inv.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1.5 bg-[#e8eef7] text-[#264c99] text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-[#dde6f7] disabled:opacity-50 transition-colors"
                        >
                          <Send size={12} />
                          Reenviar
                        </button>
                      )}
                      {puedeRevocar && !confirming && (
                        <button
                          type="button"
                          onClick={() => setConfirmRevocarId(inv.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1.5 text-[#8b3a44] text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-[#f5e8ea] disabled:opacity-50 transition-colors"
                        >
                          <Ban size={12} />
                          Revocar
                        </button>
                      )}
                      {puedeRevocar && confirming && (
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-700">¿Confirmar?</p>
                          <button
                            type="button"
                            onClick={() => void handleRevocar(inv.id)}
                            disabled={isPending}
                            className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {isPending ? <Loader2 size={12} className="animate-spin" /> : 'Sí, revocar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRevocarId(null)}
                            disabled={isPending}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-[#4a6fad]/15 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#e8eef7] text-[#264c99] text-xs uppercase tracking-wide">
                  <th className="text-left font-bold px-4 py-2">Email</th>
                  <th className="text-left font-bold px-4 py-2">Rol</th>
                  <th className="text-left font-bold px-4 py-2">Estado</th>
                  <th className="text-left font-bold px-4 py-2">Vence</th>
                  {mostrarInvitadoPor && <th className="text-left font-bold px-4 py-2">Invitó</th>}
                  <th className="text-left font-bold px-4 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitaciones.map((inv) => {
                  const isPending = pendingId === inv.id
                  const confirming = confirmRevocarId === inv.id
                  const puedeReenviar = inv.estado === 'PENDIENTE' || inv.estado === 'EXPIRADA'
                  const puedeRevocar = inv.estado === 'PENDIENTE'
                  return (
                    <tr key={inv.id} className="border-t border-[#4a6fad]/10 bg-white">
                      <td className="px-4 py-2.5 text-slate-900">{inv.email}</td>
                      <td className="px-4 py-2.5 text-slate-700">{ROL_LABELS[inv.rol]}</td>
                      <td className="px-4 py-2.5">
                        <EstadoBadge estado={inv.estado} />
                      </td>
                      <td className="px-4 py-2.5 text-[#757874]">{formatDate(inv.expiresAt)}</td>
                      {mostrarInvitadoPor && (
                        <td className="px-4 py-2.5 text-[#757874]">{inv.invitadoPor?.name ?? '—'}</td>
                      )}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {puedeReenviar && (
                            <button
                              type="button"
                              onClick={() => void handleReenviar(inv.id)}
                              disabled={isPending}
                              aria-label={`Reenviar invitación a ${inv.email}`}
                              className="inline-flex items-center gap-1.5 bg-[#e8eef7] text-[#264c99] text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-[#dde6f7] disabled:opacity-50 transition-colors"
                            >
                              <Send size={12} />
                              Reenviar
                            </button>
                          )}
                          {puedeRevocar && !confirming && (
                            <button
                              type="button"
                              onClick={() => setConfirmRevocarId(inv.id)}
                              disabled={isPending}
                              aria-label={`Revocar invitación a ${inv.email}`}
                              className="inline-flex items-center gap-1.5 text-[#8b3a44] text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-[#f5e8ea] disabled:opacity-50 transition-colors"
                            >
                              <Ban size={12} />
                              Revocar
                            </button>
                          )}
                          {puedeRevocar && confirming && (
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-700">¿Confirmar?</p>
                              <button
                                type="button"
                                onClick={() => void handleRevocar(inv.id)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                              >
                                {isPending ? <Loader2 size={12} className="animate-spin" /> : 'Sí, revocar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRevocarId(null)}
                                disabled={isPending}
                                className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                        {rowError[inv.id] && (
                          <p className="text-xs text-[#A4636E] mt-1" role="alert">
                            {rowError[inv.id]}
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

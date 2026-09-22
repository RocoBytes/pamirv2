import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, AlertCircle, Users, Search } from 'lucide-react'

import { listarUsuarios, cambiarRolUsuario } from '../../lib/api'
import type { UsuarioAdmin, Rol } from '../../types/invitacion'
import { ROL_LABELS } from '../../types/invitacion'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'

interface UsuariosManagerProps {
  currentUserId: string
}

const ROL_OPTIONS = (Object.keys(ROL_LABELS) as Rol[]).map((r) => ({ value: r, label: ROL_LABELS[r] }))

const FILTRO_UMBRAL = 8

export function UsuariosManager({ currentUserId }: UsuariosManagerProps) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string | null>>({})
  const [filtro, setFiltro] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await listarUsuarios()
      setUsuarios(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCambiarRol = useCallback(
    async (usuario: UsuarioAdmin, nuevoRol: Rol) => {
      if (nuevoRol === usuario.rol) return
      setSavingId(usuario.id)
      setRowError((prev) => ({ ...prev, [usuario.id]: null }))
      try {
        const actualizado = await cambiarRolUsuario(usuario.id, nuevoRol)
        setUsuarios((prev) => prev?.map((u) => (u.id === actualizado.id ? actualizado : u)) ?? prev)
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [usuario.id]: err instanceof Error ? err.message : 'No se pudo actualizar el rol',
        }))
      } finally {
        setSavingId(null)
      }
    },
    [],
  )

  const usuariosFiltrados = useMemo(() => {
    if (!usuarios) return usuarios
    const q = filtro.trim().toLowerCase()
    if (!q) return usuarios
    return usuarios.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [usuarios, filtro])

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-slate-900">Usuarios</h3>
        {usuarios && (
          <span className="text-xs font-bold bg-primary-fixed text-primary px-2 py-0.5 rounded-full">
            {usuarios.length}
          </span>
        )}
      </div>

      {usuarios && usuarios.length > FILTRO_UMBRAL && (
        <div className="mb-3">
          <Input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nombre o email..."
            leftIcon={<Search size={14} />}
            aria-label="Buscar usuarios"
          />
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 text-sm text-on-error-container mb-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{loadError}</p>
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

      {!usuarios && !loadError && (
        <div className="flex items-center gap-2 text-on-surface-variant py-6">
          <Loader2 className="animate-spin text-primary" size={18} />
          <p className="text-sm">Cargando usuarios...</p>
        </div>
      )}

      {usuariosFiltrados && usuariosFiltrados.length === 0 && (
        <p className="text-sm text-on-surface-variant py-6 text-center">
          {usuarios && usuarios.length > 0 ? 'Ningún usuario coincide con la búsqueda' : 'No hay usuarios registrados'}
        </p>
      )}

      {usuariosFiltrados && usuariosFiltrados.length > 0 && (
        <ul className="flex flex-col gap-2">
          {usuariosFiltrados.map((u) => {
            const esUnoMismo = u.id === currentUserId
            const isSaving = savingId === u.id
            return (
              <li
                key={u.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-white rounded-2xl border border-secondary/15 shadow-sm p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 text-sm truncate">{u.name}</p>
                    {!u.emailVerified && (
                      <span className="inline-block text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        sin verificar
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                  {rowError[u.id] && (
                    <p className="text-xs text-error mt-1" role="alert">
                      {rowError[u.id]}
                    </p>
                  )}
                </div>
                <div className="shrink-0 sm:w-44">
                  <Select
                    aria-label={`Rol de ${u.name}`}
                    value={u.rol}
                    onChange={(e) => void handleCambiarRol(u, e.target.value as Rol)}
                    disabled={esUnoMismo || isSaving}
                    options={ROL_OPTIONS}
                  />
                  {esUnoMismo && (
                    <p className="text-[10px] text-on-surface-variant mt-1">No puedes cambiar tu propio rol</p>
                  )}
                  {isSaving && (
                    <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" />
                      Guardando...
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

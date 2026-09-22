import type { Rol } from '../types/invitacion'

// Espejo de backend/src/lib/invitaciones.ts (rolesInvitables/puedeInvitarRol):
// solo conveniencia de UI para decidir qué mostrar. La autoridad real vive en
// el backend, que vuelve a validar cada invitación.
export function rolesInvitables(rol: Rol | undefined): Rol[] {
  if (rol === 'ADMIN') return ['SOCIO', 'LIDER', 'ADMIN']
  if (rol === 'LIDER') return ['SOCIO']
  return []
}

export function puedeInvitar(rol: Rol | undefined): boolean {
  return rolesInvitables(rol).length > 0
}

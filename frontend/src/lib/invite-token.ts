// El link de invitación va en el fragmento de la URL (`#invite=<token>`), a
// propósito, para que el token nunca llegue al servidor ni a los logs del
// proxy. Este parser solo lee `window.location.hash`, nunca la hace viajar.
const MAX_TOKEN_LENGTH = 200

export function parseInviteToken(hash: string): string | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash
    if (!raw) return null

    const params = new URLSearchParams(raw)
    const token = params.get('invite')
    if (!token || token.length > MAX_TOKEN_LENGTH) return null

    return token
  } catch {
    return null
  }
}

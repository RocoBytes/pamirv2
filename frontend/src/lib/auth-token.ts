import { loadAuth } from './storage'

// Inicializar desde localStorage para que el token sobreviva recargas de página
let _token: string | null = loadAuth()?.token ?? null

export function setAuthToken(token: string | null): void {
  _token = token
}

export function getAuthToken(): string | null {
  return _token
}

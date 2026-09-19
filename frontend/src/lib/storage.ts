import type { SalidaFormData, AuthState, IntegranteRecord } from '../types/salida'

const KEYS = {
  AUTH: 'pamir_auth',
  DRAFT: 'pamir_draft',
  DRAFT_STEP: 'pamir_draft_step',
  INTEGRANTES: 'pamir_integrantes',
} as const

// ─── Auth persistence ─────────────────────────────────────────────────────────

export function saveAuth(state: Pick<AuthState, 'user' | 'token'>): void {
  try {
    localStorage.setItem(KEYS.AUTH, JSON.stringify(state))
  } catch {
    // Storage might be full or unavailable
  }
}

export function loadAuth(): Pick<AuthState, 'user' | 'token'> | null {
  try {
    const raw = localStorage.getItem(KEYS.AUTH)
    if (!raw) return null
    return JSON.parse(raw) as Pick<AuthState, 'user' | 'token'>
  } catch {
    return null
  }
}

export function clearAuth(): void {
  localStorage.removeItem(KEYS.AUTH)
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export function saveDraft(data: Partial<Omit<SalidaFormData, 'gpxFile'>>): void {
  try {
    localStorage.setItem(KEYS.DRAFT, JSON.stringify(data))
  } catch {
    // Storage might be full
  }
}

export function saveDraftStep(step: number): void {
  try {
    localStorage.setItem(KEYS.DRAFT_STEP, String(step))
  } catch {
    // ignore
  }
}

export function loadDraft(): Partial<Omit<SalidaFormData, 'gpxFile'>> | null {
  try {
    const raw = localStorage.getItem(KEYS.DRAFT)
    if (!raw) return null
    return JSON.parse(raw) as Partial<Omit<SalidaFormData, 'gpxFile'>>
  } catch {
    return null
  }
}

export function loadDraftStep(): number {
  try {
    const raw = localStorage.getItem(KEYS.DRAFT_STEP)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch {
    return 0
  }
}

export function clearDraft(): void {
  localStorage.removeItem(KEYS.DRAFT)
  localStorage.removeItem(KEYS.DRAFT_STEP)
}

// ─── Integrantes (registered club members) ───────────────────────────────────

export function saveIntegrante(integrante: IntegranteRecord): void {
  try {
    const existing = loadIntegrantes()
    const idx = existing.findIndex((i) => i.id === integrante.id)
    if (idx >= 0) {
      existing[idx] = integrante
    } else {
      existing.unshift(integrante)
    }
    localStorage.setItem(KEYS.INTEGRANTES, JSON.stringify(existing))
  } catch {
    // ignore
  }
}

export function loadIntegrantes(): IntegranteRecord[] {
  try {
    const raw = localStorage.getItem(KEYS.INTEGRANTES)
    if (!raw) return []
    return JSON.parse(raw) as IntegranteRecord[]
  } catch {
    return []
  }
}


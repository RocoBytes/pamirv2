import type { CSSProperties } from 'react'

// ─── Eventos del club: tipos de API ──────────────────────────────────────────

export type EstadoEvento = 'BORRADOR' | 'PUBLICADO' | 'FINALIZADO' | 'CANCELADO'

export type EstadoInscripcion =
  | 'POSTULADO'
  | 'RETIRADO'
  | 'SELECCIONADO'
  | 'NO_SELECCIONADO'

export interface CategoriaEventoRecord {
  id: number
  slug: string
  nombre: string
  color: string
  orden: number
  activa: boolean
}

export interface EventoRecord {
  id: string
  titulo: string
  categoriaId: number | null
  estado: EstadoEvento
  // Fechas como ISO string; el día calendario es la parte YYYY-MM-DD
  // (medianoche UTC, convención Salida). fechaCorte es un instante UTC real.
  fechaInicio: string | null
  horaInicio: string | null
  fechaFin: string | null
  duracionTexto: string | null
  ubicacion: string | null
  reunionCoordinacion: string | null
  organizadorNombre: string | null
  alturaMaximaMsnm: number | null
  dificultad: number | null
  cupos: number | null
  fechaCorte: string | null
  objetivo: string | null
  itinerario: string | null
  itinerarioFileId: string | null
  itinerarioFileName: string | null
  itinerarioFileUrl: string | null
  incluye: string | null
  noIncluye: string | null
  recomendaciones: string | null
  avisoDestacado: string | null
  creadoPor: string
  creadoAt: string
  actualizadoAt: string
  publicadoAt: string | null
  finalizadoAt: string | null
  finalizadoPor: string | null
  canceladoAt: string | null
  motivoCancelacion: string | null
}

export interface EventoListItem extends EventoRecord {
  categoria: CategoriaEventoRecord | null
  totalPostulantes: number
  miInscripcion: { estado: EstadoInscripcion } | null
}

export interface DeclaracionVigente {
  id: number
  version: string
  titulo: string
  items: string[]
}

export interface InscripcionRecord {
  id: string
  eventoId: string
  usuarioId: string
  estado: EstadoInscripcion
  tieneVehiculo: boolean
  cuposVehiculo: number | null
  declaracionVersionId: number
  declaracionAceptadaAt: string
  postuladoAt: string
  retiradoAt: string | null
  resueltoAt: string | null
}

export interface InscripcionPayload {
  tieneVehiculo: boolean
  cuposVehiculo: number | null
  declaracionVersionId: number
  itemsAceptados: boolean[]
}

// ─── Postulantes (vista admin) ───────────────────────────────────────────────

export type TipoNotificacion =
  | 'INSCRIPCION_CONFIRMADA'
  | 'SELECCIONADO'
  | 'NO_SELECCIONADO'
  | 'EVENTO_CANCELADO'

export type EstadoNotificacion = 'PENDIENTE' | 'ENVIADA' | 'ERROR'

export interface NotificacionResumen {
  tipo: TipoNotificacion
  estado: EstadoNotificacion
  intentos: number
  ultimoError: string | null
}

export interface PostulanteRow {
  id: string
  usuario: { nombre: string; email: string }
  telefono: string | null
  membresiaClub: string | null
  tieneVehiculo: boolean
  cuposVehiculo: number | null
  estado: EstadoInscripcion
  postuladoAt: string
  retiradoAt: string | null
  notificaciones: NotificacionResumen[]
}

export interface PostulantesResponse {
  evento: {
    id: string
    titulo: string
    cupos: number | null
    estado: EstadoEvento
    fechaCorte: string | null
  }
  postulantes: PostulanteRow[]
}

export const ESTADO_INSCRIPCION_LABELS: Record<EstadoInscripcion, string> = {
  POSTULADO: 'Postulado',
  RETIRADO: 'Retirado',
  SELECCIONADO: 'Seleccionado',
  NO_SELECCIONADO: 'No seleccionado',
}

export const ESTADO_INSCRIPCION_COLORS: Record<EstadoInscripcion, string> = {
  POSTULADO: 'bg-[#e8eef7] text-[#264c99]',
  RETIRADO: 'bg-slate-100 text-slate-600',
  SELECCIONADO: 'bg-[#e9f3ec] text-[#2c6e49]',
  NO_SELECCIONADO: 'bg-[#f5e8ea] text-[#A4636E]',
}

export const TIPO_NOTIFICACION_LABELS: Record<TipoNotificacion, string> = {
  INSCRIPCION_CONFIRMADA: 'Confirmación',
  SELECCIONADO: 'Seleccionado',
  NO_SELECCIONADO: 'No seleccionado',
  EVENTO_CANCELADO: 'Cancelación',
}

export interface EventoDetail extends EventoListItem {
  declaracionVigente: DeclaracionVigente | null
}

// Payload de creación/edición: campos parciales, null limpia el valor.
// Las fechas viajan como 'YYYY-MM-DD'; fechaCorte como hora de pared de Santiago.
export interface EventoPayload {
  titulo?: string
  categoriaId?: number | null
  fechaInicio?: string | null
  horaInicio?: string | null
  fechaFin?: string | null
  duracionTexto?: string | null
  ubicacion?: string | null
  reunionCoordinacion?: string | null
  organizadorNombre?: string | null
  alturaMaximaMsnm?: number | null
  dificultad?: number | null
  cupos?: number | null
  fechaCorte?: { fecha: string; hora: string } | null
  objetivo?: string | null
  itinerario?: string | null
  incluye?: string | null
  noIncluye?: string | null
  recomendaciones?: string | null
  avisoDestacado?: string | null
}

// ─── Labels y colores ────────────────────────────────────────────────────────

export const ESTADO_EVENTO_LABELS: Record<EstadoEvento, string> = {
  BORRADOR: 'Borrador',
  PUBLICADO: 'Publicado',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
}

export const ESTADO_EVENTO_COLORS: Record<EstadoEvento, string> = {
  BORRADOR: 'bg-[#f0f4fb] text-[#757874]',
  PUBLICADO: 'bg-[#e8eef7] text-[#264c99]',
  FINALIZADO: 'bg-[#edf2fb] text-[#4a6fad]',
  CANCELADO: 'bg-[#f5e8ea] text-[#A4636E]',
}

// Escala DAV de dificultad (1–5)
export const DIFICULTAD_LABELS: Record<number, string> = {
  1: 'Fácil',
  2: 'Moderada',
  3: 'Media',
  4: 'Exigente',
  5: 'Extenuante',
}

// ─── Estado visible derivado (spec §4) ───────────────────────────────────────

export type EstadoVisibleTone =
  | 'draft'
  | 'open'
  | 'closed'
  | 'confirmed'
  | 'done'
  | 'cancelled'

export interface EstadoVisible {
  badge: string
  tone: EstadoVisibleTone
}

export const ESTADO_VISIBLE_COLORS: Record<EstadoVisibleTone, string> = {
  draft: 'bg-[#f0f4fb] text-[#757874]',
  open: 'bg-[#e8eef7] text-[#264c99]',
  closed: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-[#edf2fb] text-[#4a6fad]',
  done: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-[#f5e8ea] text-[#A4636E]',
}

// Fecha calendario (YYYY-MM-DD) actual vista desde Santiago
function hoySantiago(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now)
}

// 'dd mmm, HH:MM' del instante de cierre, en hora de Santiago
export function formatCorteSantiago(instante: Date): string {
  const fecha = instante.toLocaleDateString('es-ES', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
  })
  const hora = instante.toLocaleTimeString('es-ES', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${fecha}, ${hora}`
}

// El estado que ve el socio no es el de la máquina: para un PUBLICADO el
// cierre de inscripciones se deriva comparando instantes (cero cron).
export function deriveEstadoVisible(evento: EventoRecord, now: Date = new Date()): EstadoVisible {
  switch (evento.estado) {
    case 'BORRADOR':
      return { badge: 'Borrador', tone: 'draft' }
    case 'CANCELADO':
      return { badge: 'Cancelado', tone: 'cancelled' }
    case 'FINALIZADO': {
      const fin = evento.fechaFin?.slice(0, 10)
      return fin && hoySantiago(now) <= fin
        ? { badge: 'Participantes confirmados', tone: 'confirmed' }
        : { badge: 'Realizado', tone: 'done' }
    }
    case 'PUBLICADO': {
      if (!evento.fechaCorte) return { badge: 'Publicado', tone: 'open' }
      const corte = new Date(evento.fechaCorte)
      return now < corte
        ? { badge: `Inscripciones abiertas · cierra ${formatCorteSantiago(corte)}`, tone: 'open' }
        : { badge: 'Inscripciones cerradas · en selección', tone: 'closed' }
    }
  }
}

// ─── Gestores por categoría ──────────────────────────────────────────────────

// El admin gestiona todo; un gestor solo sus categorías. Un evento sin
// categoría (borrador del admin) solo lo gestiona el admin.
export function puedeGestionarCategoria(
  esAdmin: boolean,
  gestorCategoriaIds: number[],
  categoriaId: number | null,
): boolean {
  if (esAdmin) return true
  if (categoriaId === null) return false
  return gestorCategoriaIds.includes(categoriaId)
}

// ─── Chips de categoría ──────────────────────────────────────────────────────

// Texto oscuro sobre colores claros (amarillo/celeste) vía luminancia relativa
function esColorClaro(hex: string): boolean {
  const n = hex.replace('#', '')
  if (n.length !== 6) return false
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

export function categoriaChipStyle(
  color: string,
  variant: 'solid' | 'tint' = 'solid',
): CSSProperties {
  if (variant === 'tint') {
    return { backgroundColor: `${color}1f`, color }
  }
  return { backgroundColor: color, color: esColorClaro(color) ? '#3d3d3d' : '#ffffff' }
}

// ─── Fechas para mostrar ─────────────────────────────────────────────────────

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Parseo manual del día calendario (nunca new Date('YYYY-MM-DD') para
// display: evita el corrimiento UTC de un día)
function partesFecha(iso: string): { d: number; m: number; y: number } {
  const [y = 0, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number)
  return { d, m, y }
}

export function formatFechaCorta(iso: string): string {
  const { d, m, y } = partesFecha(iso)
  return `${d} ${MESES_CORTOS[m - 1]} ${y}`
}

// '6 sep 2026' para un día, '30 ago – 2 sep 2026' para rangos
export function formatRangoFechas(inicio: string | null, fin: string | null): string | null {
  if (!inicio) return null
  const a = partesFecha(inicio)
  if (!fin || fin.slice(0, 10) === inicio.slice(0, 10)) {
    return `${a.d} ${MESES_CORTOS[a.m - 1]} ${a.y}`
  }
  const b = partesFecha(fin)
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MESES_CORTOS[a.m - 1]} ${a.y}`
  if (a.y === b.y) return `${a.d} ${MESES_CORTOS[a.m - 1]} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${a.y}`
  return `${a.d} ${MESES_CORTOS[a.m - 1]} ${a.y} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`
}

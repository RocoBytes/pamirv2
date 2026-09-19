import type { SalidaFormData, SalidaRecord, GpxUploadResponse, PronosticoUploadResponse, User, IntegranteRecord, Participante } from '../types/salida'
import type {
  CategoriaEventoRecord,
  EventoRecord,
  EventoListItem,
  EventoDetail,
  EventoPayload,
  InscripcionRecord,
  InscripcionPayload,
  PostulantesResponse,
} from '../types/evento'
import { getAuthToken } from './auth-token'

// En desarrollo el proxy de Vite redirige /api → localhost:3000.
// En producción (Vercel) no hay proxy: se usa VITE_API_URL apuntando a Render.com.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return handleResponse<{ user: User; token: string }>(res)
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  return handleResponse<{ message: string }>(res)
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return handleResponse<{ message: string }>(res)
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  return handleResponse<{ message: string }>(res)
}

export async function fetchMe(): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/me`, {
    headers: authHeaders(),
  })
  return handleResponse<{ user: User }>(res)
}

// ─── Salidas ──────────────────────────────────────────────────────────────────

export async function fetchSalidas(): Promise<SalidaRecord[]> {
  const res = await fetch(`${API_BASE}/salidas`, {
    headers: authHeaders(),
  })
  return handleResponse<SalidaRecord[]>(res)
}

// Salidas cerradas (COMPLETADA) en las que el usuario participó — alimenta el
// desplegable "Históricos" del Dashboard. Reusa GET /api/salidas con un flag.
export async function fetchHistoricos(): Promise<SalidaRecord[]> {
  const res = await fetch(`${API_BASE}/salidas?historico=true`, {
    headers: authHeaders(),
  })
  return handleResponse<SalidaRecord[]>(res)
}

export async function getSalida(id: string): Promise<SalidaRecord> {
  const res = await fetch(`${API_BASE}/salidas/${id}`, {
    headers: authHeaders(),
  })
  return handleResponse<SalidaRecord>(res)
}

export async function createSalida(
  data: Omit<SalidaFormData, 'gpxFile'> & {
    gpxFileId?: string
    gpxFileName?: string
    gpxFileUrl?: string
  },
): Promise<SalidaRecord> {
  const res = await fetch(`${API_BASE}/salidas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<SalidaRecord>(res)
}

export async function updateSalida(
  id: string,
  data: Partial<Omit<SalidaFormData, 'gpxFile'>>,
): Promise<SalidaRecord> {
  const res = await fetch(`${API_BASE}/salidas/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<SalidaRecord>(res)
}

// Edita solo el apartado de integrantes (participantes + líder). El backend valida
// permiso (admin o dueño) y que la salida no haya comenzado todavía.
export async function updateSalidaIntegrantes(
  id: string,
  data: { participantes: Participante[]; liderCordada?: string },
): Promise<SalidaRecord> {
  const res = await fetch(`${API_BASE}/salidas/${id}/integrantes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<SalidaRecord>(res)
}

export async function claimSalida(id: string): Promise<SalidaRecord> {
  const res = await fetch(`${API_BASE}/salidas/${id}/claim`, {
    method: 'PATCH',
    headers: authHeaders(),
  })
  return handleResponse<SalidaRecord>(res)
}

export async function deleteSalida(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/salidas/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}

// ─── GPX Upload ───────────────────────────────────────────────────────────────

export async function uploadGpx(salidaId: string, file: File): Promise<GpxUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/salidas/${salidaId}/gpx`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse<GpxUploadResponse>(res)
}

export async function uploadPronostico(salidaId: string, file: File): Promise<PronosticoUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/salidas/${salidaId}/pronostico`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse<PronosticoUploadResponse>(res)
}

// ─── Integrantes ─────────────────────────────────────────────────────────────

export interface CreateIntegrantePayload {
  nombreCompleto: string
  rut: string
  nacionalidad: string
  genero: string
  fechaNacimiento: string
  direccion: string
  comuna: string
  region: string
  telefonoCelular: string
  email: string
  previsionSalud: string
  nombreContacto: string
  parentesco: string
  telefonoContacto: string
  grupoSanguineo: string
  alergiasTiene: boolean
  alergiasDetalle?: string
  enfermedadesCronicasTiene: boolean
  enfermedadesCronicasDetalle?: string
  medicamentosTiene: boolean
  medicamentosDetalle?: string
  cirugiasLesionesTiene: boolean
  cirugiasLesionesDetalle?: string
  fuma: boolean
  usaLentes: boolean
  membresiaClub: string
  nombreClub?: string
  declaracionSalud: boolean
  aceptacionRiesgo: boolean
  consentimientoDatos: boolean
  derechoImagen: boolean
}

export async function createIntegrante(
  data: CreateIntegrantePayload,
): Promise<IntegranteRecord> {
  const res = await fetch(`${API_BASE}/integrantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<IntegranteRecord>(res)
}

export async function getIntegranteByRut(rut: string): Promise<IntegranteRecord | null> {
  const res = await fetch(
    `${API_BASE}/integrantes/by-rut/${encodeURIComponent(rut)}`,
    { headers: authHeaders() },
  )
  if (res.status === 404) return null
  return handleResponse<IntegranteRecord>(res)
}

export async function fetchMyIntegrante(): Promise<IntegranteRecord | null> {
  const res = await fetch(`${API_BASE}/integrantes/me`, { headers: authHeaders() })
  if (res.status === 404) return null
  return handleResponse<IntegranteRecord>(res)
}

// ─── Cierres ──────────────────────────────────────────────────────────────────

export interface CreateCierrePayload {
  salidaId: string
  fechaFinalizacionReal: string
  estadoCierre: string
  altitudMaxima: number
  motivoAbandono?: string
  huboCambios: string
  motivosCambios?: string[]
  motivosCambiosOtro?: string
  ocurrioIncidente: string
  ocurrioAccidente: string
  tiposIncidente?: string[]
  incidenteOtroDescripcion?: string
  tiposAccidente?: string[]
  accidenteOtroDescripcion?: string
  desempenoEquipo: string
  detalleFallaEquipo?: string
  observacionesRuta: string
  precisionPronostico: number
  leccionesAprendidas: string
  recomendacionesFuturos?: string
  sugerenciasClub?: string
}

export async function createCierre(data: CreateCierrePayload): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/cierres`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<{ id: string }>(res)
}

// ─── Evaluaciones (anónimas) ─────────────────────────────────────────────────

export interface EvaluacionInfo {
  nombreActividad: string
  fechaInicio: string
  used: boolean
}

export interface SubmitEvaluacionPayload {
  notaObjetivos: number
  notaItinerario: number
  notaLider: number
  comentario?: string
}

export interface EvaluacionResultados {
  totalTokens: number
  totalRespuestas: number
  promedios: {
    objetivos: number
    itinerario: number
    lider: number
  }
  comentarios: string[]
}

export async function fetchEvaluacion(token: string): Promise<EvaluacionInfo> {
  const res = await fetch(`${API_BASE}/evaluaciones/${encodeURIComponent(token)}`)
  return handleResponse<EvaluacionInfo>(res)
}

export async function submitEvaluacion(
  token: string,
  data: SubmitEvaluacionPayload,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/evaluaciones/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return handleResponse<{ ok: boolean }>(res)
}

export async function fetchResultadosEvaluacion(salidaId: string): Promise<EvaluacionResultados> {
  const res = await fetch(`${API_BASE}/evaluaciones/resultados/${salidaId}`, {
    headers: authHeaders(),
  })
  return handleResponse<EvaluacionResultados>(res)
}

// ─── Documentos del club (solo socios ACP) ───────────────────────────────────

export interface DocumentoRecord {
  id: string
  categoria: string
  nombre: string
  descripcion?: string | null
  driveFileUrl?: string | null
  // Solo presentes en la vista admin (GET /api/documentos/admin):
  visible?: boolean
  orden?: number
}

export async function fetchDocumentos(): Promise<DocumentoRecord[]> {
  const res = await fetch(`${API_BASE}/documentos`, {
    headers: authHeaders(),
  })
  return handleResponse<DocumentoRecord[]>(res)
}

// ─── Documentos: gestión admin ───────────────────────────────────────────────

export async function fetchDocumentosAdmin(): Promise<DocumentoRecord[]> {
  const res = await fetch(`${API_BASE}/documentos/admin`, {
    headers: authHeaders(),
  })
  return handleResponse<DocumentoRecord[]>(res)
}

export async function uploadDocumento(data: {
  categoria: string
  nombre: string
  descripcion?: string
  orden?: number
  file: File
}): Promise<DocumentoRecord> {
  const formData = new FormData()
  formData.append('categoria', data.categoria)
  formData.append('nombre', data.nombre)
  if (data.descripcion) formData.append('descripcion', data.descripcion)
  if (typeof data.orden === 'number') formData.append('orden', String(data.orden))
  // El archivo va al final: así los campos de texto ya están en el stream
  // cuando busboy dispara el evento 'file' en el backend.
  formData.append('file', data.file)

  const res = await fetch(`${API_BASE}/documentos`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse<DocumentoRecord>(res)
}

export async function deleteDocumento(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documentos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}

// ─── Admin (solo administrador) ──────────────────────────────────────────────

export interface AdminStats {
  totalSalidas: number
  salidasAbiertas: number
  salidasCompletadas: number
  totalCierres: number
  pctConCierre: number
  incidentes: number
  accidentes: number
  porMes: { mes: string; total: number }[]
  topDisciplinas: { disciplina: string; total: number }[]
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch(`${API_BASE}/admin/stats`, {
    headers: authHeaders(),
  })
  return handleResponse<AdminStats>(res)
}

// ─── Credencial de Google (refresh token rotable desde el panel) ─────────────

export interface GoogleCredencial {
  configurado: boolean
  /** 'db' = pegado desde el panel; 'env' = el del servidor, como respaldo. */
  origen: 'db' | 'env'
  actualizadoAt: string | null
  actualizadoPor: string | null
  diasDesdeActualizacion: number | null
  estado: { ok: boolean; motivo: string | null }
}

export async function fetchGoogleCredencial(): Promise<GoogleCredencial> {
  const res = await fetch(`${API_BASE}/admin/google-credencial`, {
    headers: authHeaders(),
  })
  return handleResponse<GoogleCredencial>(res)
}

export async function saveGoogleCredencial(refreshToken: string): Promise<GoogleCredencial> {
  const res = await fetch(`${API_BASE}/admin/google-credencial`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ refreshToken }),
  })
  return handleResponse<GoogleCredencial>(res)
}

// ─── Admin analytics dashboard ──────────────────────────────────────────────────

export interface DashboardFiltros {
  desde?: string
  hasta?: string
  status?: string
  lider?: string
  disciplina?: string
  tipoSalida?: string
  temporada?: string
  club?: string
  conCierre?: boolean
  conIncidente?: boolean
  conAccidente?: boolean
  conExpress?: boolean
  calidadMin?: number
}

export interface AdminDashboard {
  metrics: {
    totalSalidas: number
    pendientesCierre: number
    conCierre: number
    canceladas: number
    totalParticipantes: number
    promedioParticipantes: number
    totalExpress: number
    pctConCierre: number
    incidentes: number
    accidentes: number
    promedioCalidad: number | null
    salidasEvalBaja: number
  }
  porEstado: { estado: string; total: number }[]
  porMes: { mes: string; total: number }[]
  incidentesPorMes: { mes: string; incidentes: number; accidentes: number }[]
  participantesPorTipo: { registrados: number; express: number }
  calidad: {
    promedio: number | null
    totalRespuestas: number
    distribucion: { nota: number; total: number }[]
    porMes: { mes: string; promedio: number }[]
  }
  porLider: { lider: string; total: number }[]
  tiposIncidente: { tipo: string; total: number }[]
  tiposAccidente: { tipo: string; total: number }[]
  salidaVsCierre: {
    conCierre: number
    sinCierre: number
    conCambiosRoster: number
    conIncidentes: number
    conAccidentes: number
  }
  filtros: {
    lideres: string[]
    disciplinas: string[]
    tipos: string[]
    temporadas: string[]
  }
}

export async function fetchAdminDashboard(filtros: DashboardFiltros = {}): Promise<AdminDashboard> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filtros)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  const res = await fetch(`${API_BASE}/admin/dashboard${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  })
  return handleResponse<AdminDashboard>(res)
}

// ─── Admin dashboard layout (per-admin customizable grid) ───────────────────────

export interface DashboardWidgetLayout {
  widgetId: string
  x: number
  y: number
  w: number
  h: number
  visible?: boolean
}

export async function fetchDashboardLayout(): Promise<{ layout: DashboardWidgetLayout[] | null }> {
  const res = await fetch(`${API_BASE}/admin/dashboard-layout`, {
    headers: authHeaders(),
  })
  return handleResponse<{ layout: DashboardWidgetLayout[] | null }>(res)
}

export async function saveDashboardLayout(layout: DashboardWidgetLayout[]): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/dashboard-layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ layout }),
  })
  await handleResponse<unknown>(res)
}

export async function resetDashboardLayout(): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/dashboard-layout`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  await handleResponse<unknown>(res)
}

export interface ParticipanteSalud {
  rut: string
  nombre: string
  fichaEncontrada: boolean
  salud?: {
    grupoSanguineo: string
    alergiasTiene: boolean
    alergiasDetalle?: string | null
    enfermedadesCronicasTiene: boolean
    enfermedadesCronicasDetalle?: string | null
    medicamentosTiene: boolean
    medicamentosDetalle?: string | null
    cirugiasLesionesTiene: boolean
    cirugiasLesionesDetalle?: string | null
    fuma: boolean
    usaLentes: boolean
    previsionSalud: string
  } | null
}

export interface SaludSalidaResponse {
  salidaId: string
  nombreActividad: string
  liderCordada: string
  creatorEmail: string | null
  participantes: ParticipanteSalud[]
}

export async function fetchSaludSalida(id: string): Promise<SaludSalidaResponse> {
  const res = await fetch(`${API_BASE}/admin/salidas/${encodeURIComponent(id)}/salud`, {
    headers: authHeaders(),
  })
  return handleResponse<SaludSalidaResponse>(res)
}

export async function enviarSaludSalida(
  id: string,
): Promise<{ sent: boolean; to: string; participantesConFicha: number; participantesSinFicha: number }> {
  const res = await fetch(`${API_BASE}/admin/salidas/${encodeURIComponent(id)}/enviar-salud`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<{ sent: boolean; to: string; participantesConFicha: number; participantesSinFicha: number }>(res)
}

// ─── Eventos del club ─────────────────────────────────────────────────────────

export async function fetchCategoriasEvento(): Promise<CategoriaEventoRecord[]> {
  const res = await fetch(`${API_BASE}/eventos/categorias`, {
    headers: authHeaders(),
  })
  return handleResponse<CategoriaEventoRecord[]>(res)
}

export async function fetchEventos(
  params: { mes?: string; categorias?: string[]; incluirPasados?: boolean } = {},
): Promise<EventoListItem[]> {
  const query = new URLSearchParams()
  if (params.mes) query.set('mes', params.mes)
  for (const slug of params.categorias ?? []) query.append('categoria', slug)
  if (params.incluirPasados) query.set('incluirPasados', 'true')
  const qs = query.toString()
  const res = await fetch(`${API_BASE}/eventos${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  })
  return handleResponse<EventoListItem[]>(res)
}

export async function fetchEvento(id: string): Promise<EventoDetail> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  })
  return handleResponse<EventoDetail>(res)
}

export type EventoConCategoria = EventoRecord & { categoria: CategoriaEventoRecord | null }

export async function createEvento(payload: EventoPayload): Promise<EventoConCategoria> {
  const res = await fetch(`${API_BASE}/eventos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<EventoConCategoria>(res)
}

export async function updateEvento(id: string, payload: EventoPayload): Promise<EventoConCategoria> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<EventoConCategoria>(res)
}

export async function deleteEventoBorrador(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      message = body.error ?? message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
}

// Multipart (field `file`); the browser sets Content-Type with the boundary
export async function uploadItinerarioAdjunto(eventoId: string, file: File): Promise<EventoConCategoria> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(eventoId)}/itinerario-adjunto`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse<EventoConCategoria>(res)
}

export async function deleteItinerarioAdjunto(eventoId: string): Promise<EventoConCategoria> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(eventoId)}/itinerario-adjunto`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<EventoConCategoria>(res)
}

export async function inscribirseEvento(
  id: string,
  payload: InscripcionPayload,
): Promise<{ inscripcion: InscripcionRecord }> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/inscripcion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return handleResponse<{ inscripcion: InscripcionRecord }>(res)
}

export async function retirarseEvento(id: string): Promise<{ inscripcion: InscripcionRecord }> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/inscripcion`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<{ inscripcion: InscripcionRecord }>(res)
}

export async function publicarEvento(id: string): Promise<EventoRecord> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/publicar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<EventoRecord>(res)
}

export async function despublicarEvento(id: string): Promise<EventoRecord> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/despublicar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<EventoRecord>(res)
}

export async function fetchPostulantes(id: string): Promise<PostulantesResponse> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/postulantes`, {
    headers: authHeaders(),
  })
  return handleResponse<PostulantesResponse>(res)
}

export async function finalizarEvento(
  id: string,
  seleccionadosIds: string[],
): Promise<{ seleccionados: number; noSeleccionados: number }> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/finalizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ seleccionadosIds }),
  })
  return handleResponse<{ seleccionados: number; noSeleccionados: number }>(res)
}

export async function reenviarNotificaciones(
  id: string,
): Promise<{ despachadas: number; fallidas: number; pendientes: number }> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/notificaciones/reenviar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<{ despachadas: number; fallidas: number; pendientes: number }>(res)
}

export async function cancelarEvento(id: string, motivo?: string): Promise<EventoRecord> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/cancelar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(motivo ? { motivo } : {}),
  })
  return handleResponse<EventoRecord>(res)
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`)
  return handleResponse<{ status: string }>(res)
}

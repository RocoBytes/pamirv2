import type { SalidaFormData, SalidaRecord, GpxUploadResponse, PronosticoUploadResponse, User, IntegranteRecord, Participante, OrganizationBrand } from '../types/salida'
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
import type {
  Rol,
  Invitacion,
  UsuarioAdmin,
  ConsultarInvitacionResponse,
  AceptarInvitacionResponse,
  CrearInvitacionResponse,
  ListarInvitacionesResponse,
} from '../types/invitacion'
import type {
  QrDuracion,
  ModoCodigoQr,
  CrearCodigoQrResponse,
  ListarCodigosQrResponse,
  VerCodigoQrResponse,
  RevocarCodigoQrResponse,
  EstadoCodigoQrResponse,
  ConsultarCodigoQrResponse,
  SolicitarInvitacionQrResponse,
  RegistrarConQrDirectoResponse,
} from '../types/codigo-qr'

// En desarrollo el proxy de Vite redirige /api → localhost:3000.
// En producción (Vercel) no hay proxy: se usa VITE_API_URL apuntando a Render.com.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Conserva el status HTTP junto al mensaje: los controles de descarga de
// archivos (ver fetchSalidaArchivoUrl y hermanas) lo necesitan para distinguir
// 403 (sin permiso, el backend nombra el club) de 404 (ya no existe) sin
// parsear el texto del mensaje.
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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
    throw new ApiError(message, res.status)
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

// Los metadatos del GPX nunca viajan en este payload: el archivo se sube
// después, a través de uploadGpx(), una vez creada la salida.
export async function createSalida(
  data: Omit<SalidaFormData, 'gpxFile'>,
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

// membresiaClub/nombreClub NO van en este payload: el servidor asigna
// siempre la membresía propia del club donde se crea la ficha (ver
// membresiaParaNuevaFicha en backend/src/lib/integrante-membresia.ts) — el
// formulario de registro ya no pregunta a qué club pertenece la persona.
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
  // null si el backend no pudo resolver el club dueño del token (no debería
  // pasar en producción; la pantalla se mantiene neutral en ese caso).
  organization: OrganizationBrand | null
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
  // No null = tiene archivo subido; la URL de descarga se pide aparte y bajo
  // demanda (ver fetchDocumentoUrl), nunca viaja en este payload.
  driveFileId?: string | null
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

// ─── Descarga de archivos (Google Cloud Storage) ─────────────────────────────

// Las tres rutas de "url" nunca deben cachearse: la respuesta trae
// Cache-Control: no-store y, cuando es una URL firmada, expira a los 10
// minutos — cada click debe pedir una fresca (ver lib/file-download.ts).
export interface DownloadUrlResponse {
  url: string
  expiresInSeconds: number | null
}

export async function fetchSalidaArchivoUrl(
  salidaId: string,
  tipo: 'gpx' | 'pronostico',
): Promise<DownloadUrlResponse> {
  const res = await fetch(
    `${API_BASE}/salidas/${encodeURIComponent(salidaId)}/archivos/${tipo}/url`,
    { headers: authHeaders() },
  )
  return handleResponse<DownloadUrlResponse>(res)
}

export async function fetchDocumentoUrl(id: string): Promise<DownloadUrlResponse> {
  const res = await fetch(`${API_BASE}/documentos/${encodeURIComponent(id)}/url`, {
    headers: authHeaders(),
  })
  return handleResponse<DownloadUrlResponse>(res)
}

export async function fetchEventoItinerarioUrl(id: string): Promise<DownloadUrlResponse> {
  const res = await fetch(`${API_BASE}/eventos/${encodeURIComponent(id)}/itinerario/url`, {
    headers: authHeaders(),
  })
  return handleResponse<DownloadUrlResponse>(res)
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

// ─── Invitaciones (sistema cerrado) ──────────────────────────────────────────

// Públicos: no llevan Authorization. El token siempre va en el body, nunca en
// la URL, para que no quede en los logs de acceso.

export async function consultarInvitacion(token: string): Promise<ConsultarInvitacionResponse> {
  const res = await fetch(`${API_BASE}/auth/invitaciones/consultar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return handleResponse<ConsultarInvitacionResponse>(res)
}

export async function aceptarInvitacion(
  token: string,
  name: string,
  password: string,
): Promise<AceptarInvitacionResponse> {
  const res = await fetch(`${API_BASE}/auth/invitaciones/aceptar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, password }),
  })
  return handleResponse<AceptarInvitacionResponse>(res)
}

// Autenticados (ADMIN o LIDER): ADMIN ve todas, LIDER solo las que él envió.

export async function listarInvitaciones(): Promise<ListarInvitacionesResponse> {
  const res = await fetch(`${API_BASE}/invitaciones`, {
    headers: authHeaders(),
  })
  return handleResponse<ListarInvitacionesResponse>(res)
}

export async function crearInvitacion(email: string, rol?: Rol): Promise<CrearInvitacionResponse> {
  const res = await fetch(`${API_BASE}/invitaciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(rol ? { email, rol } : { email }),
  })
  return handleResponse<CrearInvitacionResponse>(res)
}

export async function revocarInvitacion(id: string): Promise<{ invitacion: Invitacion }> {
  const res = await fetch(`${API_BASE}/invitaciones/${encodeURIComponent(id)}/revocar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<{ invitacion: Invitacion }>(res)
}

export async function reenviarInvitacion(id: string): Promise<CrearInvitacionResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/${encodeURIComponent(id)}/reenviar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<CrearInvitacionResponse>(res)
}

// ─── QR reusable del club ─────────────────────────────────────────────────────

// Autenticados (ADMIN o LIDER): ADMIN ve todos los del club, LIDER solo los suyos.

export async function listarCodigosQr(): Promise<ListarCodigosQrResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/qr`, {
    headers: authHeaders(),
  })
  return handleResponse<ListarCodigosQrResponse>(res)
}

export async function crearCodigoQr(
  data: { modo?: ModoCodigoQr; duracion?: QrDuracion; maxUsos?: number; etiqueta?: string } = {},
): Promise<CrearCodigoQrResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/qr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  return handleResponse<CrearCodigoQrResponse>(res)
}

export async function verCodigoQr(id: string): Promise<VerCodigoQrResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/qr/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  })
  return handleResponse<VerCodigoQrResponse>(res)
}

export async function revocarCodigoQr(id: string): Promise<RevocarCodigoQrResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/qr/${encodeURIComponent(id)}/revocar`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return handleResponse<RevocarCodigoQrResponse>(res)
}

// Poleado por el panel de "QR directo" mientras espera un escaneo.
export async function estadoCodigoQr(id: string): Promise<EstadoCodigoQrResponse> {
  const res = await fetch(`${API_BASE}/invitaciones/qr/${encodeURIComponent(id)}/estado`, {
    headers: authHeaders(),
  })
  return handleResponse<EstadoCodigoQrResponse>(res)
}

// Públicos: no llevan Authorization. El token siempre va en el body, nunca en
// la URL, para que no quede en los logs de acceso.

export async function consultarCodigoQr(token: string): Promise<ConsultarCodigoQrResponse> {
  const res = await fetch(`${API_BASE}/qr/consultar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return handleResponse<ConsultarCodigoQrResponse>(res)
}

export async function solicitarInvitacionQr(token: string, email: string): Promise<SolicitarInvitacionQrResponse> {
  const res = await fetch(`${API_BASE}/qr/solicitar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email }),
  })
  return handleResponse<SolicitarInvitacionQrResponse>(res)
}

// Contraparte DIRECTO de solicitarInvitacionQr: da de alta la cuenta en el
// acto. El llamador inicia sesión después con las mismas credenciales (no hay
// token de sesión en esta respuesta) — igual que el flujo de aceptar una
// invitación normal.
export async function registrarConQrDirecto(
  token: string,
  data: { name: string; email: string; password: string },
): Promise<RegistrarConQrDirectoResponse> {
  const res = await fetch(`${API_BASE}/qr/registrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...data }),
  })
  return handleResponse<RegistrarConQrDirectoResponse>(res)
}

// ─── Usuarios (solo administrador) ────────────────────────────────────────────

export async function listarUsuarios(): Promise<UsuarioAdmin[]> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: authHeaders(),
  })
  return handleResponse<UsuarioAdmin[]>(res)
}

export async function cambiarRolUsuario(id: string, rol: Rol): Promise<UsuarioAdmin> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/rol`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ rol }),
  })
  return handleResponse<UsuarioAdmin>(res)
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`)
  return handleResponse<{ status: string }>(res)
}

// ─── Preferencias de navegación (por socio) ──────────────────────────────────

export interface NavPreferences {
  /** Pestañas de la barra inferior, en orden. */
  tabs: string[]
  /** Accesos rápidos visibles, en orden. */
  quick: string[]
}

// null = el usuario nunca personalizó, así que manda el orden por defecto del
// frontend. Es distinto de unas preferencias guardadas que casualmente
// coinciden con el default: esas sobreviven a un cambio del default.
export async function fetchNavPreferences(): Promise<NavPreferences | null> {
  const res = await fetch(`${API_BASE}/me/nav-preferences`, { headers: authHeaders() })
  const data = await handleResponse<{ preferences: NavPreferences | null }>(res)
  return data.preferences
}

export async function saveNavPreferences(prefs: NavPreferences): Promise<NavPreferences> {
  const res = await fetch(`${API_BASE}/me/nav-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(prefs),
  })
  const data = await handleResponse<{ preferences: NavPreferences }>(res)
  return data.preferences
}

export async function resetNavPreferences(): Promise<void> {
  const res = await fetch(`${API_BASE}/me/nav-preferences`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  await handleResponse<{ preferences: null }>(res)
}

// ─── Clubes: marca pública y logo propio (branding) ──────────────────────────

// Público, sin sesión a propósito: lo consume AuthPage antes de autenticar
// (ver club-preferido.ts) para pintar el logo y el nombre del club preferido.
export async function fetchMarcaClub(slug: string): Promise<OrganizationBrand> {
  const res = await fetch(`${API_BASE}/clubes/${encodeURIComponent(slug)}/marca`)
  return handleResponse<OrganizationBrand>(res)
}

export interface OrganizacionLogoResponse {
  hasLogo: boolean
  logoVersion: string | null
}

// Solo ADMIN. El campo del FormData se llama "file" — busboy no valida su
// nombre (ver uploadOrganizacionLogo en el backend), pero se mantiene el
// mismo nombre que el resto de los uploads (uploadGpx, uploadDocumento).
export async function uploadOrganizacionLogo(file: File): Promise<OrganizacionLogoResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/organizacion/logo`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse<OrganizacionLogoResponse>(res)
}

export async function deleteOrganizacionLogo(): Promise<{ hasLogo: false }> {
  const res = await fetch(`${API_BASE}/organizacion/logo`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse<{ hasLogo: false }>(res)
}

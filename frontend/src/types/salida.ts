// ─── Auth types ───────────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  picture?: string
  // Opcional: sesiones guardadas antes del módulo de eventos no lo traen
  rol?: 'SOCIO' | 'ADMIN'
  // Categorías de eventos que el usuario gestiona (gestores por categoría)
  gestorCategorias?: { categoriaId: number; slug: string }[]
}

export interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
}

// ─── Salida data model ────────────────────────────────────────────────────────

export type AvisoExterno = 'CARABINEROS' | 'SOCORRO_ANDINO' | 'FAMILIAR_OTRO'

export type MedioComunicacion =
  | 'RADIO_VHF_UHF'
  | 'TELEFONO_SATELITAL'
  | 'INREACH_SPOT'
  | 'CELULAR'
  | 'NINGUNO'

export type EquipoColectivoSeguridad =
  | 'CUERDAS'
  | 'BOTIQUIN_GRUPAL'
  | 'GPS'
  | 'MAPA_BRUJULA'
  | 'RESCATE_GRIETAS'
  | 'ARVA_PALA_SONDA'
  | 'SIN_EQUIPO'
  | 'OTRO'

export type RiesgoIdentificado =
  | 'AVALANCHAS'
  | 'DESPRENDIMIENTO_ROCAS'
  | 'CRUCE_RIOS'
  | 'FRIO_EXTREMO'
  | 'MAL_ALTURA'
  | 'CAIDA_DISTINTO_NIVEL'
  | 'CALOR_EXTREMO'
  | 'OTRO'

export type TipoSalida =
  | 'OFICIAL_CLUB'
  | 'NO_OFICIAL'
  | 'EXPEDICION_PARTICULAR'

export type Disciplina =
  | 'TREKKING'
  | 'MEDIA_MONTANA'
  | 'ALTA_MONTANA'
  | 'ESCALADA_ROCA'
  | 'ESCALADA_HIELO'
  | 'ESQUI_MONTANA'
  | 'TRAIL_SKY_RUNNING'

export type Temporada = 'estival' | 'invernal'

export type SalidaStatus =
  | 'BORRADOR'
  | 'CONFIRMADA'
  | 'EN_CURSO'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'INCIDENTE'

export type MembresiaClub =
  | 'SOCIO_ANDINO_PAMIR'
  | 'SOCIO_EL_MONTANISTA'
  | 'SOCIO_OTRO_CLUB'
  | 'POSTULANTE_CLUB'
  | 'NO_PERTENECE'

// membresiaClub is optional: participants added before this field existed
// (old records and in-flight localStorage drafts) simply render without badge
export interface Participante {
  rut: string
  nombre: string
  membresiaClub?: MembresiaClub
  // Express participant: temporary attendee with no registered ficha (Integrante),
  // associated only to this salida. Present only on express entries.
  esExpress?: boolean
  telefono?: string
  email?: string
  agregadoPor?: string // stamped by the backend on create: email of the leader who added them
  agregadoEn?: string // stamped by the backend on create: ISO timestamp
}

export interface SalidaFormData {
  // Step 1 – Clasificación de la Salida
  tipoSalida: TipoSalida
  disciplina: Disciplina
  temporada: Temporada
  nombreActividad: string
  ubicacionGeografica: string

  // Step 2 – Cronología y Seguridad
  fechaInicio: string
  horaInicio: string
  fechaRetornoEstimada: string
  horaRetornoEstimada: string
  horaAlerta: string
  avisosExternos: AvisoExterno[]
  retenCarabineros?: string
  nombreFamiliar?: string
  telefonoFamiliar?: string

  // Step 3 – Equipo Humano
  liderCordada: string
  participantes: Participante[]
  coordinacionGrupal: boolean
  matrizRiesgos: boolean

  // Step 4 – Comunicaciones y Equipo Crítico
  mediosComunicacion: MedioComunicacion[]
  idDispositivoFrecuencia: string
  equipoColectivo: EquipoColectivoSeguridad[]
  equipoColectivoOtro: string

  // Step 5 – Planificación Técnica
  pronosticoMeteorologico: string
  riesgosIdentificados: RiesgoIdentificado[]
  riesgosOtro: string
  planEvacuacion: string

  // Status & incidents (set by default, not shown in wizard)
  status: SalidaStatus
  incidentReport: string

  // Admin-only: backdated record that does not notify integrantes
  esRegistroHistorico?: boolean
}

// ─── API response types ───────────────────────────────────────────────────────

export interface SalidaRecord {
  id: string
  // optional: defensive against responses cached before the migration ran
  numeroSalida?: number
  tipoSalida: TipoSalida
  disciplina: Disciplina
  temporada?: Temporada
  nombreActividad: string
  ubicacionGeografica: string
  fechaInicio: string
  horaInicio?: string
  fechaRetornoEstimada: string
  horaRetornoEstimada: string
  horaAlerta: string
  avisosExternos: AvisoExterno[]
  retenCarabineros?: string | null
  nombreFamiliar?: string | null
  telefonoFamiliar?: string | null
  liderCordada: string
  participantes: Participante[]
  coordinacionGrupal: boolean
  matrizRiesgos: boolean
  gpxFileId?: string
  gpxFileName?: string
  gpxFileUrl?: string
  mediosComunicacion: MedioComunicacion[]
  idDispositivoFrecuencia?: string
  equipoColectivo: EquipoColectivoSeguridad[]
  equipoColectivoOtro?: string
  pronosticoMeteorologico?: string
  pronosticoFileId?: string
  pronosticoFileName?: string
  pronosticoFileUrl?: string
  riesgosIdentificados?: RiesgoIdentificado[]
  riesgosOtro?: string
  planEvacuacion?: string
  status: SalidaStatus
  incidentReport?: string
  leccionesAprendidas?: string
  recomendacionesFuturos?: string
  sugerenciasClub?: string
  createdAt: string
  updatedAt: string
  userId: string
  // Admin-only fields (populated by the admin branch of GET /api/salidas)
  alertaEnviadaAt?: string | null
  esRegistroHistorico?: boolean
  _count?: { cierres: number }
}

export interface GpxUploadResponse {
  message: string
  gpxFileId: string
  gpxFileName: string
  gpxFileUrl: string
}

export interface PronosticoUploadResponse {
  message: string
  pronosticoFileId: string
  pronosticoFileName: string
  pronosticoFileUrl: string
}

// ─── Integrante (registered club member) ─────────────────────────────────────

export interface IntegranteRecord {
  id: string
  nombreCompleto: string
  rut: string
  email: string
  membresiaClub?: MembresiaClub
  nombreClub?: string | null
  createdAt: string
}

export const CLUB_BADGE_LABELS: Record<MembresiaClub, string> = {
  SOCIO_ANDINO_PAMIR: 'ACP',
  SOCIO_EL_MONTANISTA: 'CAEM',
  SOCIO_OTRO_CLUB: 'SOC',
  POSTULANTE_CLUB: 'POST',
  NO_PERTENECE: 'NA',
}

// Readable labels for the admin dashboard club filter dropdown. Being a
// Record<MembresiaClub, string>, adding a new club to the enum forces a label
// here (compile error otherwise), so the filter incorporates it automatically.
export const CLUB_FILTER_LABELS: Record<MembresiaClub, string> = {
  SOCIO_ANDINO_PAMIR: 'Socio Andino Club Pamir',
  SOCIO_EL_MONTANISTA: 'Socio Club El Montañista',
  SOCIO_OTRO_CLUB: 'Socio otro club',
  POSTULANTE_CLUB: 'Postulante a un club',
  NO_PERTENECE: 'No pertenece',
}

export const STATUS_LABELS: Record<SalidaStatus, string> = {
  BORRADOR: 'Borrador',
  CONFIRMADA: 'Confirmada',
  EN_CURSO: 'En Curso',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  INCIDENTE: 'Incidente',
}

export const STATUS_COLORS: Record<SalidaStatus, string> = {
  BORRADOR: 'bg-[#f0f4fb] text-[#757874]',
  CONFIRMADA: 'bg-[#e8eef7] text-[#264c99]',
  EN_CURSO: 'bg-[#e8eef7] text-[#1e3c7a]',
  COMPLETADA: 'bg-[#edf2fb] text-[#4a6fad]',
  CANCELADA: 'bg-[#f5e8ea] text-[#A4636E]',
  INCIDENTE: 'bg-[#f5e8ea] text-[#8b3a44]',
}

export const AVISO_EXTERNO_LABELS: Record<AvisoExterno, string> = {
  CARABINEROS: 'Carabineros',
  SOCORRO_ANDINO: 'Socorro Andino',
  FAMILIAR_OTRO: 'Familiar u otra persona',
}

export const TIPO_SALIDA_LABELS: Record<TipoSalida, string> = {
  OFICIAL_CLUB: 'Oficial del Club',
  NO_OFICIAL: 'No Oficial',
  EXPEDICION_PARTICULAR: 'Expedición Particular',
}

export const DISCIPLINA_LABELS: Record<Disciplina, string> = {
  TREKKING: 'Trekking',
  MEDIA_MONTANA: 'Media Montaña',
  ALTA_MONTANA: 'Alta Montaña',
  ESCALADA_ROCA: 'Escalada en Roca',
  ESCALADA_HIELO: 'Escalada en Hielo',
  ESQUI_MONTANA: 'Esquí de Montaña',
  TRAIL_SKY_RUNNING: 'Trail / Sky Running',
}

export const TEMPORADA_LABELS: Record<Temporada, string> = {
  estival: 'Estival',
  invernal: 'Invernal',
}

export const MEDIO_COMUNICACION_LABELS: Record<MedioComunicacion, string> = {
  RADIO_VHF_UHF: 'Radio VHF / UHF',
  TELEFONO_SATELITAL: 'Teléfono Satelital',
  INREACH_SPOT: 'Dispositivo inReach / Spot',
  CELULAR: 'Celular',
  NINGUNO: 'Ninguno',
}

export const RIESGO_IDENTIFICADO_LABELS: Record<RiesgoIdentificado, string> = {
  AVALANCHAS: 'Avalanchas',
  DESPRENDIMIENTO_ROCAS: 'Desprendimiento de rocas',
  CRUCE_RIOS: 'Cruce de ríos',
  FRIO_EXTREMO: 'Frío extremo',
  MAL_ALTURA: 'Mal de altura',
  CAIDA_DISTINTO_NIVEL: 'Caída a distinto nivel',
  CALOR_EXTREMO: 'Calor Extremo',
  OTRO: 'Otro',
}

export const EQUIPO_COLECTIVO_LABELS: Record<EquipoColectivoSeguridad, string> = {
  CUERDAS: 'Cuerdas',
  BOTIQUIN_GRUPAL: 'Botiquín Grupal',
  GPS: 'GPS',
  MAPA_BRUJULA: 'Mapa y Brújula',
  RESCATE_GRIETAS: 'Equipo de Rescate en Grietas',
  ARVA_PALA_SONDA: 'ARVA / Pala / Sonda',
  SIN_EQUIPO: 'No cuenta con equipo colectivo de seguridad',
  OTRO: 'Otro',
}

// ─── Ficha de Cierre ──────────────────────────────────────────────────────────

export type EstadoCierre =
  | 'COMPLETADA_SEGUN_PLAN'
  | 'COMPLETADA_CON_VARIACIONES'
  | 'ABORTADA_INCOMPLETA'

export type MotivoAbandono =
  | 'METEOROLOGIA'
  | 'SALUD_INTEGRANTE'
  | 'MAL_ESTADO_RUTA'
  | 'FALLO_EQUIPO'
  | 'ERROR_PLANIFICACION'
  | 'FALTA_TIEMPO'

export type MotivoCambio =
  | 'CLIMA_ADVERSO'
  | 'ERROR_NAVEGACION'
  | 'FATIGA_FISICA'
  | 'FALTA_EQUIPO_TECNICO'
  | 'FALTA_TIEMPO'
  | 'OTRO'

export type TipoIncidente =
  | 'EXTRAVIO'
  | 'CAIDA_SIN_LESION'
  | 'GOLPE_LEVE'
  | 'FALLA_EQUIPAMIENTO'
  | 'CLIMA_ADVERSO'
  | 'PROBLEMA_COMUNICACION'
  | 'INICIO_MAL_ALTURA'
  | 'DESCENSO_PREVENTIVO'
  | 'OTRO'

export type TipoAccidente =
  | 'CAIDA_CON_LESION'
  | 'GOLPE_ROCA'
  | 'HIPOTERMIA'
  | 'MAL_AGUDO_MONTANA'
  | 'DESHIDRATACION_SEVERA'
  | 'CONGELAMIENTO'
  | 'QUEMADURA_SOLAR'
  | 'AVALANCHA'
  | 'GRAVE_FATAL'
  | 'OTRO'

export type DesempenoEquipo = 'TODO_FUNCIONO' | 'FALLO_EQUIPO'

export interface FichaCierreFormData {
  salidaId: string
  fechaFinalizacionReal: string
  estadoCierre: EstadoCierre
  motivoAbandono?: MotivoAbandono
  // Paso 2 – Evaluación de la planificación
  huboCambios: 'SI' | 'NO'
  motivosCambios?: MotivoCambio[]
  motivosCambiosOtro?: string
  // Paso 3 – Gestión de Incidentes y Accidentes
  ocurrioIncidente: 'SI' | 'NO'
  ocurrioAccidente: 'SI' | 'NO'
  tiposIncidente?: TipoIncidente[]
  incidenteOtroDescripcion?: string
  tiposAccidente?: TipoAccidente[]
  accidenteOtroDescripcion?: string
  // Paso 4 – Análisis Técnico y de Equipo
  desempenoEquipo: DesempenoEquipo
  detalleFallaEquipo?: string
  observacionesRuta: string
  precisionPronostico: number
  // Paso 5 – Lecciones Aprendidas y Recomendaciones
  leccionesAprendidas: string
  recomendacionesFuturos?: string
  sugerenciasClub?: string
}

export interface FichaCierreRecord extends FichaCierreFormData {
  id: string
  salidaNombre: string
  createdAt: string
  userId: string
}

export const ESTADO_CIERRE_LABELS: Record<EstadoCierre, string> = {
  COMPLETADA_SEGUN_PLAN: 'Completada según lo previsto',
  COMPLETADA_CON_VARIACIONES: 'Completada con variaciones',
  ABORTADA_INCOMPLETA: 'Abortada/Incompleta',
}

export const MOTIVO_ABANDONO_LABELS: Record<MotivoAbandono, string> = {
  METEOROLOGIA: 'Meteorología',
  SALUD_INTEGRANTE: 'Salud de un integrante',
  MAL_ESTADO_RUTA: 'Mal estado de la ruta',
  FALLO_EQUIPO: 'Fallo de equipo',
  ERROR_PLANIFICACION: 'Error de planificación',
  FALTA_TIEMPO: 'Falta de tiempo',
}

export const MOTIVO_CAMBIO_LABELS: Record<MotivoCambio, string> = {
  CLIMA_ADVERSO: 'Clima adverso',
  ERROR_NAVEGACION: 'Error de navegación/ruta',
  FATIGA_FISICA: 'Fatiga física de algún miembro',
  FALTA_EQUIPO_TECNICO: 'Falta de equipo técnico',
  FALTA_TIEMPO: 'Horario (falta de tiempo)',
  OTRO: 'Otro',
}

export const TIPO_INCIDENTE_LABELS: Record<TipoIncidente, string> = {
  EXTRAVIO: 'Extravío o pérdida temporal de orientación',
  CAIDA_SIN_LESION: 'Caída sin lesión, ya sea de persona o material',
  GOLPE_LEVE: 'Golpe o contusión leve sin consecuencias',
  FALLA_EQUIPAMIENTO: 'Falla de equipamiento, por ejemplo cuerda, arnés, crampones, etc.',
  CLIMA_ADVERSO: 'Condiciones climáticas adversas imprevistas',
  PROBLEMA_COMUNICACION: 'Problema de comunicación o señal',
  INICIO_MAL_ALTURA: 'Inicio de mal de altura sin derivar en accidente',
  DESCENSO_PREVENTIVO: 'Decisión de descenso preventivo',
  OTRO: 'Otro',
}

export const TIPO_ACCIDENTE_LABELS: Record<TipoAccidente, string> = {
  CAIDA_CON_LESION: 'Caída con lesión, por ejemplo esguince, fractura o contusión',
  GOLPE_ROCA: 'Golpe de roca o caída de material',
  HIPOTERMIA: 'Hipotermia',
  MAL_AGUDO_MONTANA: 'Mal agudo de montaña, AMS / HACE / HAPE',
  DESHIDRATACION_SEVERA: 'Deshidratación severa',
  CONGELAMIENTO: 'Congelamiento',
  QUEMADURA_SOLAR: 'Quemadura solar grave',
  AVALANCHA: 'Accidente de avalancha',
  GRAVE_FATAL: 'Accidente grave o fatal',
  OTRO: 'Otro',
}

export const DESEMPENO_EQUIPO_LABELS: Record<DesempenoEquipo, string> = {
  TODO_FUNCIONO: 'Todo funcionó correctamente',
  FALLO_EQUIPO: 'Algún equipamiento falló o se dañó',
}


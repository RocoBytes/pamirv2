interface IntegranteEmailData {
  nombreCompleto: string;
  rut: string;
  nacionalidad: string;
  genero: string;
  fechaNacimiento: string;
  direccion: string;
  comuna: string;
  region: string;
  telefonoCelular: string;
  email: string;
  previsionSalud: string;
  nombreContacto: string;
  parentesco: string;
  telefonoContacto: string;
  grupoSanguineo: string;
  alergiasTiene: boolean;
  alergiasDetalle?: string;
  enfermedadesCronicasTiene: boolean;
  enfermedadesCronicasDetalle?: string;
  medicamentosTiene: boolean;
  medicamentosDetalle?: string;
  cirugiasLesionesTiene: boolean;
  cirugiasLesionesDetalle?: string;
  fuma: boolean;
  usaLentes: boolean;
  declaracionSalud: boolean;
  aceptacionRiesgo: boolean;
  consentimientoDatos: boolean;
  derechoImagen: boolean;
}

const CONTACT_NAME = process.env.CONTACT_NAME ?? 'el equipo de Pamir';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? '';

function contactLine(): string {
  if (CONTACT_EMAIL) {
    return `comunícate con <strong>${escapeHtml(CONTACT_NAME)}</strong> al correo <a href="mailto:${CONTACT_EMAIL}" style="color:${GREEN};">${CONTACT_EMAIL}</a>`;
  }
  return `comunícate con <strong>${escapeHtml(CONTACT_NAME)}</strong>`;
}

const GREEN = '#264c99';
const LIGHT_GREEN = '#e8eef7';
const GRAY = '#757874';
const BORDER = '#d1d5db';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 12px;color:${GRAY};font-size:13px;width:45%;border-bottom:1px solid ${BORDER};">${label}</td>
      <td style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">${escapeHtml(value)}</td>
    </tr>`;
}

function boolRow(label: string, value: boolean, detail?: string): string {
  const safeDetail = detail ? escapeHtml(detail) : undefined;
  const display = value ? `Sí${safeDetail ? ` — ${safeDetail}` : ''}` : 'No';
  // display ya está escapado — pasarlo sin doble-escape a row() requiere una variante raw
  return `
    <tr>
      <td style="padding:8px 12px;color:${GRAY};font-size:13px;width:45%;border-bottom:1px solid ${BORDER};">${label}</td>
      <td style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">${display}</td>
    </tr>`;
}

function sectionHeader(title: string): string {
  return `
    <tr>
      <td colspan="2" style="background:${LIGHT_GREEN};padding:10px 12px;font-weight:700;font-size:13px;color:${GREEN};letter-spacing:0.05em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">
        ${escapeHtml(title)}
      </td>
    </tr>`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatGenero(g: string): string {
  const map: Record<string, string> = {
    FEMENINO: 'Femenino',
    MASCULINO: 'Masculino',
    PREFIERO_NO_DECIRLO: 'Prefiero no decirlo',
  };
  return map[g] ?? g;
}

function clausulaBlock(number: string, title: string, body: string, accepted: boolean): string {
  const icon = accepted ? '&#10003;' : '&#10007;';
  const checkColor = accepted ? '#4E805D' : '#dc2626';
  const checkLabel = accepted ? 'He leído y estoy de acuerdo' : 'No aceptado';
  return `
    <tr>
      <td colspan="2" style="padding:14px 12px 6px;border-bottom:1px solid ${BORDER};">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:0.05em;">${number}. ${title}</p>
        <p style="margin:0 0 10px;font-size:12px;color:#374151;line-height:1.6;">${body}</p>
        <span style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid ${checkColor}33;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:600;color:${checkColor};">
          <span style="font-size:14px;">${icon}</span> ${checkLabel}
        </span>
      </td>
    </tr>`;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SalidaEmailData {
  nombreActividad: string;
  tipoSalida: string;
  disciplina: string;
  ubicacionGeografica: string;
  fechaInicio: Date | string;
  fechaRetornoEstimada: Date | string;
  horaRetornoEstimada: string;
  horaAlerta: string;
  avisosExternos: unknown;
  retenCarabineros?: string | null;
  nombreFamiliar?: string | null;
  telefonoFamiliar?: string | null;
  liderCordada: string;
  participantes: unknown;
  coordinacionGrupal: boolean;
  matrizRiesgos: boolean;
  mediosComunicacion: unknown;
  idDispositivoFrecuencia?: string | null;
  equipoColectivo: unknown;
  equipoColectivoOtro?: string | null;
  pronosticoMeteorologico?: string | null;
  riesgosIdentificados: unknown;
  riesgosOtro?: string | null;
  planEvacuacion?: string | null;
}

interface CierreEmailData {
  fechaFinalizacionReal: Date | string;
  estadoCierre: string;
  motivoAbandono?: string | null;
  huboCambios: string;
  motivosCambios?: unknown;
  motivosCambiosOtro?: string | null;
  ocurrioIncidente: string;
  ocurrioAccidente: string;
  tiposIncidente?: unknown;
  incidenteOtroDescripcion?: string | null;
  tiposAccidente?: unknown;
  accidenteOtroDescripcion?: string | null;
  desempenoEquipo: string;
  detalleFallaEquipo?: string | null;
  observacionesRuta: string;
  precisionPronostico: number;
  leccionesAprendidas: string;
  recomendacionesFuturos?: string | null;
  sugerenciasClub?: string | null;
}

// ─── Label maps ───────────────────────────────────────────────────────────────

const TIPO_SALIDA_MAP: Record<string, string> = {
  OFICIAL_CLUB: 'Oficial del Club',
  NO_OFICIAL: 'No Oficial',
  EXPEDICION_PARTICULAR: 'Expedición Particular',
};

const DISCIPLINA_MAP: Record<string, string> = {
  TREKKING: 'Trekking',
  MEDIA_MONTANA: 'Media Montaña',
  ALTA_MONTANA: 'Alta Montaña',
  MEDIA_ALTA_MONTANA: 'Media / Alta Montaña',
  ESCALADA_ROCA: 'Escalada en Roca',
  ESCALADA_HIELO: 'Escalada en Hielo',
  ESQUI_MONTANA: 'Esquí de Montaña',
  TRAIL_SKY_RUNNING: 'Trail / Sky Running',
};

const AVISO_MAP: Record<string, string> = {
  CARABINEROS: 'Carabineros',
  SOCORRO_ANDINO: 'Socorro Andino',
  FAMILIAR_OTRO: 'Familiar u otra persona',
};

const MEDIO_COM_MAP: Record<string, string> = {
  RADIO_VHF_UHF: 'Radio VHF / UHF',
  TELEFONO_SATELITAL: 'Teléfono Satelital',
  INREACH_SPOT: 'Dispositivo inReach / Spot',
  CELULAR: 'Celular',
  NINGUNO: 'Ninguno',
};

const EQUIPO_MAP: Record<string, string> = {
  CUERDAS: 'Cuerdas',
  BOTIQUIN_GRUPAL: 'Botiquín Grupal',
  GPS: 'GPS',
  MAPA_BRUJULA: 'Mapa y Brújula',
  RESCATE_GRIETAS: 'Equipo de Rescate en Grietas',
  ARVA_PALA_SONDA: 'ARVA / Pala / Sonda',
  SIN_EQUIPO: 'Sin equipo colectivo',
  OTRO: 'Otro',
};

const RIESGO_MAP: Record<string, string> = {
  AVALANCHAS: 'Avalanchas',
  DESPRENDIMIENTO_ROCAS: 'Desprendimiento de rocas',
  CRUCE_RIOS: 'Cruce de ríos',
  FRIO_EXTREMO: 'Frío extremo',
  MAL_ALTURA: 'Mal de altura',
  CAIDA_DISTINTO_NIVEL: 'Caída a distinto nivel',
  CALOR_EXTREMO: 'Calor extremo',
  OTRO: 'Otro',
};

const ESTADO_CIERRE_MAP: Record<string, string> = {
  COMPLETADA_SEGUN_PLAN: 'Completada según lo previsto',
  COMPLETADA_CON_VARIACIONES: 'Completada con variaciones',
  ABORTADA_INCOMPLETA: 'Abortada / Incompleta',
};

const MOTIVO_ABANDONO_MAP: Record<string, string> = {
  METEOROLOGIA: 'Meteorología adversa',
  SALUD_INTEGRANTE: 'Salud de un integrante',
  MAL_ESTADO_RUTA: 'Mal estado de la ruta',
  FALLO_EQUIPO: 'Fallo de equipo',
  ERROR_PLANIFICACION: 'Error de planificación',
  FALTA_TIEMPO: 'Falta de tiempo',
};

const MOTIVO_CAMBIO_MAP: Record<string, string> = {
  CLIMA_ADVERSO: 'Clima adverso',
  ERROR_NAVEGACION: 'Error de navegación / ruta',
  FATIGA_FISICA: 'Fatiga física',
  FALTA_EQUIPO_TECNICO: 'Falta de equipo técnico',
  FALTA_TIEMPO: 'Falta de tiempo',
  OTRO: 'Otro',
};

const SI_NO_MAP: Record<string, string> = {
  SI: 'Sí',
  NO: 'No',
};

const TIPO_INCIDENTE_MAP: Record<string, string> = {
  EXTRAVIO: 'Extravío o pérdida temporal de orientación',
  CAIDA_SIN_LESION: 'Caída sin lesión (persona o material)',
  GOLPE_LEVE: 'Golpe o contusión leve sin consecuencias',
  FALLA_EQUIPAMIENTO: 'Falla de equipamiento',
  CLIMA_ADVERSO: 'Condiciones climáticas adversas imprevistas',
  PROBLEMA_COMUNICACION: 'Problema de comunicación o señal',
  INICIO_MAL_ALTURA: 'Inicio de mal de altura sin derivar en accidente',
  DESCENSO_PREVENTIVO: 'Decisión de descenso preventivo',
  OTRO: 'Otro',
};

const TIPO_ACCIDENTE_MAP: Record<string, string> = {
  CAIDA_CON_LESION: 'Caída con lesión (esguince, fractura o contusión)',
  GOLPE_ROCA: 'Golpe de roca o caída de material',
  HIPOTERMIA: 'Hipotermia',
  MAL_AGUDO_MONTANA: 'Mal agudo de montaña (AMS / HACE / HAPE)',
  DESHIDRATACION_SEVERA: 'Deshidratación severa',
  CONGELAMIENTO: 'Congelamiento',
  QUEMADURA_SOLAR: 'Quemadura solar grave',
  AVALANCHA: 'Accidente de avalancha',
  GRAVE_FATAL: 'Accidente grave o fatal',
  OTRO: 'Otro',
};

const DESEMPENO_MAP: Record<string, string> = {
  TODO_FUNCIONO: 'Todo funcionó correctamente',
  FALLO_EQUIPO: 'Algún equipamiento falló o se dañó',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function opt(value: string | null | undefined, fallback = 'No especificado'): string {
  return value?.trim() ? value.trim() : fallback;
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string');
}

function safeParticipantNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null && 'nombre' in item) {
      return String((item as { nombre: unknown }).nombre);
    }
    return '';
  }).filter(Boolean);
}

function listRow(label: string, items: string[]): string {
  if (!items.length) return row(label, 'Ninguno');
  const bullets = items.map((i) => `<li style="margin-bottom:2px;">${escapeHtml(i)}</li>`).join('');
  return `
    <tr>
      <td style="padding:8px 12px;color:${GRAY};font-size:13px;width:45%;border-bottom:1px solid ${BORDER};vertical-align:top;">${label}</td>
      <td style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">
        <ul style="margin:0;padding-left:18px;">${bullets}</ul>
      </td>
    </tr>`;
}

function pronosticoRow(score: number): string {
  const filled = '★'.repeat(Math.min(5, Math.max(0, score)));
  const empty = '☆'.repeat(5 - Math.min(5, Math.max(0, score)));
  return row('Precisión del pronóstico', `${filled}${empty} (${score}/5)`);
}

// ─── Email shell ──────────────────────────────────────────────────────────────

function emailShell(subtitle: string, introHtml: string, tableHtml: string, footerNote: string, afterTableHtml = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:600px;width:100%;">
        <tr>
          <td style="background:${GREEN};padding:28px 32px;">
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Pamir</p>
            <p style="margin:6px 0 0;color:#c8dccb;font-size:14px;">${subtitle}</p>
          </td>
        </tr>
        <tr><td style="padding:24px 32px 16px;">${introHtml}</td></tr>
        <tr>
          <td style="padding:0 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:6px;overflow:hidden;border-collapse:collapse;">
              ${tableHtml}
            </table>
          </td>
        </tr>
        ${afterTableHtml}
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid ${BORDER};">
            <p style="margin:0;color:${GRAY};font-size:12px;line-height:1.6;">
              ${footerNote}<br>
              Si tienes dudas, ${contactLine()}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function evaluacionCtaBlock(evaluacionUrl: string): string {
  return `
        <tr>
          <td style="padding:0 32px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT_GREEN};border:1px solid ${BORDER};border-radius:8px;">
              <tr>
                <td style="padding:20px 24px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${GREEN};">¿Cómo estuvo la salida?</p>
                  <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.6;">
                    Ayúdanos a mejorar respondiendo una evaluación express de <strong>1 minuto</strong>.
                    Es <strong>100% anónima</strong>: tu respuesta no queda asociada a tu nombre.
                  </p>
                  <a href="${evaluacionUrl}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">Evaluar esta salida (anónimo)</a>
                  <p style="margin:14px 0 0;color:#6b7280;font-size:11px;word-break:break-all;">
                    Si el botón no funciona, copia este enlace: ${evaluacionUrl}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function feedbackCierreBlock(): string {
  const replyHint = CONTACT_EMAIL
    ? `escríbenos a <a href="mailto:${CONTACT_EMAIL}" style="color:${GREEN};font-weight:600;">${CONTACT_EMAIL}</a> o responde directamente este correo`
    : 'responde directamente este correo';
  return `
        <tr>
          <td style="padding:0 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #f1d48a;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#92600a;">¿Algo que agregar o corregir?</p>
                  <p style="margin:0;font-size:12px;color:#78350f;line-height:1.6;">
                    Si hay algo que quieras agregar o modificar en este cierre, o si no estás de acuerdo
                    con algún dato de la salida o con algo de la aplicación, ${replyHint}.
                    Tu observación quedará registrada con tu nombre y nos ayuda a corregir el registro oficial.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

// ─── Salida notification ──────────────────────────────────────────────────────

export function buildSalidaNotificationEmail(nombreCompleto: string, salida: SalidaEmailData): string {
  const avisosArr = safeStringArray(salida.avisosExternos);
  const participantesArr = safeParticipantNames(salida.participantes);
  const mediosArr = safeStringArray(salida.mediosComunicacion);
  const equipoArr = safeStringArray(salida.equipoColectivo);
  const riesgosArr = safeStringArray(salida.riesgosIdentificados);

  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombreCompleto)}</strong>, has sido registrado/a como integrante en la siguiente salida de montaña.
    A continuación encontrarás el resumen completo de la actividad.
  </p>`;

  const tabla = `
    ${sectionHeader('I. Clasificación de la Salida')}
    ${row('Nombre de la actividad', salida.nombreActividad)}
    ${row('Tipo de salida', TIPO_SALIDA_MAP[salida.tipoSalida] ?? salida.tipoSalida)}
    ${row('Disciplina', DISCIPLINA_MAP[salida.disciplina] ?? salida.disciplina)}
    ${row('Ubicación geográfica', salida.ubicacionGeografica)}

    ${sectionHeader('II. Cronología y Seguridad')}
    ${row('Fecha de inicio', formatDate(String(salida.fechaInicio)))}
    ${row('Fecha de retorno estimada', formatDate(String(salida.fechaRetornoEstimada)))}
    ${row('Hora de retorno estimada', salida.horaRetornoEstimada)}
    ${row('Hora de alerta', salida.horaAlerta)}
    ${listRow('Avisos externos', avisosArr.map((a) => AVISO_MAP[a] ?? a))}
    ${avisosArr.includes('CARABINEROS') ? row('Retén de Carabineros', opt(salida.retenCarabineros)) : ''}
    ${avisosArr.includes('FAMILIAR_OTRO') ? row('Nombre del familiar/contacto', opt(salida.nombreFamiliar)) : ''}
    ${avisosArr.includes('FAMILIAR_OTRO') ? row('Teléfono del familiar/contacto', opt(salida.telefonoFamiliar)) : ''}

    ${sectionHeader('III. Equipo Humano')}
    ${listRow('Nómina de participantes', participantesArr.length ? participantesArr : [])}
    ${row('Líder de cordada', opt(salida.liderCordada))}
    ${row('Coordinación grupal previa', salida.coordinacionGrupal ? 'Sí' : 'No')}
    ${row('Matriz de riesgos completada', salida.matrizRiesgos ? 'Sí' : 'No')}

    ${sectionHeader('IV. Comunicaciones y Equipo Crítico')}
    ${listRow('Medios de comunicación', mediosArr.map((m) => MEDIO_COM_MAP[m] ?? m))}
    ${row('ID dispositivo / frecuencia', opt(salida.idDispositivoFrecuencia))}
    ${listRow('Equipo colectivo de seguridad', equipoArr.map((e) => EQUIPO_MAP[e] ?? e))}
    ${row('Otro equipo', opt(salida.equipoColectivoOtro))}

    ${sectionHeader('V. Planificación Técnica')}
    ${row('Pronóstico meteorológico', opt(salida.pronosticoMeteorologico))}
    ${listRow('Riesgos identificados', riesgosArr.map((r) => RIESGO_MAP[r] ?? r))}
    ${row('Otros riesgos', opt(salida.riesgosOtro))}
    ${row('Plan de evacuación', opt(salida.planEvacuacion))}
  `;

  return emailShell(
    'Registro en salida de montaña',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
  );
}

// ─── Cierre notification ──────────────────────────────────────────────────────

export function buildCierreNotificationEmail(nombreCompleto: string, salida: SalidaEmailData, cierre: CierreEmailData, evaluacionUrl?: string): string {
  const hayIncidente = cierre.ocurrioIncidente === 'SI';
  const hayAccidente = cierre.ocurrioAccidente === 'SI';
  const abortada = cierre.estadoCierre === 'ABORTADA_INCOMPLETA';
  const huboCambios = cierre.huboCambios === 'SI';
  const motivosCambiosArr = safeStringArray(cierre.motivosCambios);
  const tiposIncidenteArr = safeStringArray(cierre.tiposIncidente);
  const tiposAccidenteArr = safeStringArray(cierre.tiposAccidente);

  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombreCompleto)}</strong>, la salida en la que participaste ha sido oficialmente cerrada.
    A continuación encontrarás el resumen completo del cierre.
  </p>`;

  const tabla = `
    ${sectionHeader('I. Actividad')}
    ${row('Nombre de la actividad', salida.nombreActividad)}
    ${row('Tipo de salida', TIPO_SALIDA_MAP[salida.tipoSalida] ?? salida.tipoSalida)}
    ${row('Disciplina', DISCIPLINA_MAP[salida.disciplina] ?? salida.disciplina)}
    ${row('Ubicación geográfica', salida.ubicacionGeografica)}
    ${row('Fecha de inicio', formatDate(String(salida.fechaInicio)))}
    ${row('Fecha de retorno estimada', formatDate(String(salida.fechaRetornoEstimada)))}

    ${sectionHeader('II. Resultado del Cierre')}
    ${row('Estado', ESTADO_CIERRE_MAP[cierre.estadoCierre] ?? cierre.estadoCierre)}
    ${row('Fecha de finalización real', formatDate(String(cierre.fechaFinalizacionReal)))}
    ${abortada ? row('Motivo de abandono', MOTIVO_ABANDONO_MAP[cierre.motivoAbandono ?? ''] ?? opt(cierre.motivoAbandono)) : ''}

    ${sectionHeader('III. Evaluación de la Planificación')}
    ${row('¿Hubo cambios significativos?', huboCambios ? 'Sí' : 'No')}
    ${huboCambios ? listRow('Motivos de los cambios', motivosCambiosArr.map((m) => MOTIVO_CAMBIO_MAP[m] ?? m)) : ''}
    ${huboCambios ? row('Otros motivos', opt(cierre.motivosCambiosOtro)) : ''}

    ${sectionHeader('IV. Gestión de Incidentes y Accidentes')}
    ${row('¿Hubo un incidente?', SI_NO_MAP[cierre.ocurrioIncidente] ?? cierre.ocurrioIncidente)}
    ${hayIncidente ? listRow('Tipos de incidente', tiposIncidenteArr.map((t) => TIPO_INCIDENTE_MAP[t] ?? t)) : ''}
    ${hayIncidente && tiposIncidenteArr.includes('OTRO') ? row('Descripción del incidente', opt(cierre.incidenteOtroDescripcion)) : ''}
    ${row('¿Hubo un accidente?', SI_NO_MAP[cierre.ocurrioAccidente] ?? cierre.ocurrioAccidente)}
    ${hayAccidente ? listRow('Tipos de accidente', tiposAccidenteArr.map((t) => TIPO_ACCIDENTE_MAP[t] ?? t)) : ''}
    ${hayAccidente && tiposAccidenteArr.includes('OTRO') ? row('Descripción del accidente', opt(cierre.accidenteOtroDescripcion)) : ''}

    ${sectionHeader('V. Análisis Técnico y de Equipamiento')}
    ${row('Desempeño del equipamiento', DESEMPENO_MAP[cierre.desempenoEquipo] ?? cierre.desempenoEquipo)}
    ${cierre.desempenoEquipo === 'FALLO_EQUIPO' ? row('Detalle de la falla', opt(cierre.detalleFallaEquipo)) : ''}
    ${row('Observaciones de la ruta', opt(cierre.observacionesRuta))}
    ${pronosticoRow(cierre.precisionPronostico)}

    ${sectionHeader('VI. Lecciones Aprendidas')}
    ${row('Lecciones aprendidas', opt(cierre.leccionesAprendidas))}
    ${row('Recomendaciones para futuros montañistas', opt(cierre.recomendacionesFuturos))}
    ${row('Sugerencias al club', opt(cierre.sugerenciasClub))}
  `;

  return emailShell(
    'Cierre de salida de montaña',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
    (evaluacionUrl ? evaluacionCtaBlock(evaluacionUrl) : '') + feedbackCierreBlock(),
  );
}

export function buildConfirmationEmail(data: IntegranteEmailData): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:${GREEN};padding:28px 32px;">
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Pamir</p>
            <p style="margin:6px 0 0;color:#c8dccb;font-size:14px;">Confirmación de registro de integrante</p>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:24px 32px 16px;">
            <p style="margin:0;color:#1f2937;font-size:15px;">
              Hola <strong>${escapeHtml(data.nombreCompleto)}</strong>, tu registro en el sistema Pamir se completó exitosamente.
              A continuación encontrarás el resumen de los datos ingresados.
            </p>
          </td>
        </tr>

        <!-- Data Table -->
        <tr>
          <td style="padding:0 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:6px;overflow:hidden;border-collapse:collapse;">

              ${sectionHeader('I. Datos personales y de contacto')}
              ${row('Nombre completo', data.nombreCompleto)}
              ${row('RUT', data.rut)}
              ${row('Nacionalidad', data.nacionalidad)}
              ${row('Género', formatGenero(data.genero))}
              ${row('Fecha de nacimiento', formatDate(data.fechaNacimiento))}
              ${row('Dirección', `${data.direccion}, ${data.comuna}, ${data.region}`)}
              ${row('Teléfono celular', data.telefonoCelular)}
              ${row('Email', data.email)}
              ${row('Previsión de salud', data.previsionSalud)}

              ${sectionHeader('II. Contacto de emergencia')}
              ${row('Nombre', data.nombreContacto)}
              ${row('Parentesco', data.parentesco)}
              ${row('Teléfono', data.telefonoContacto)}

              ${sectionHeader('III. Perfil médico')}
              ${row('Grupo sanguíneo', data.grupoSanguineo)}
              ${boolRow('Alergias', data.alergiasTiene, data.alergiasDetalle)}
              ${boolRow('Enfermedades crónicas', data.enfermedadesCronicasTiene, data.enfermedadesCronicasDetalle)}
              ${boolRow('Medicamentos', data.medicamentosTiene, data.medicamentosDetalle)}
              ${boolRow('Cirugías / lesiones', data.cirugiasLesionesTiene, data.cirugiasLesionesDetalle)}
              ${row('Fuma', data.fuma ? 'Sí' : 'No')}
              ${row('Usa lentes / lentes de contacto', data.usaLentes ? 'Sí' : 'No')}

              ${sectionHeader('IV. Cláusulas Legales y Consentimiento Informado')}
              ${clausulaBlock(
                '1', 'Declaración de Salud y Aptitud Física',
                'El firmante declara que se encuentra en condiciones físicas y psíquicas aptas para la práctica de deportes de montaña (senderismo, escalada, montañismo y otras actividades relacionadas). Declara que la información proporcionada en este formulario es veraz y completa, asumiendo que la ocultación de antecedentes médicos puede comprometer su seguridad y la del grupo.',
                data.declaracionSalud
              )}
              ${clausulaBlock(
                '2', 'Aceptación de Riesgo y Exención de Responsabilidad',
                'Reconozco que las actividades de montaña son intrínsecamente riesgosas y pueden implicar peligros derivados del terreno, clima extremo, caída de rocas, fallas de equipo y otros factores objetivos y subjetivos que pueden resultar en lesiones graves o la muerte. <strong>Exención:</strong> Libero de toda responsabilidad civil y criminal al Club, a sus directivos, guías, instructores y miembros, por cualquier accidente o incidente derivado de los riesgos propios de la actividad o de mi propia negligencia, siempre que el club haya actuado bajo los protocolos de seguridad estándar. El Club no se hace responsable por accidentes derivados de la omisión de información o negligencia de los participantes.',
                data.aceptacionRiesgo
              )}
              ${clausulaBlock(
                '3', 'Consentimiento de Uso de Datos Personales (Ley 19.628)',
                'En cumplimiento con la Ley N° 19.628 sobre Protección de la Vida Privada, autorizo expresamente al Club para: (a) Tratar mis datos personales y sensibles (salud) con el fin exclusivo de gestionar mi participación en actividades y responder ante emergencias médicas. (b) Almacenar de forma segura esta información, la cual solo será accesible por el cuerpo técnico o servicios de emergencia en caso de ser necesario. (c) Comunicar estos datos a centros de salud o cuerpos de socorro en caso de rescate o atención urgente. Los datos serán utilizados exclusivamente para la gestión de seguridad en montaña, coordinación de rescates, registro estadístico de incidentes y cumplimiento de protocolos internos del club.',
                data.consentimientoDatos
              )}
              ${clausulaBlock(
                '4', 'Derecho de Imagen',
                'Autorizo el uso de fotografías o videos capturados durante las salidas para fines promocionales o educativos del club, sin derecho a compensación económica.',
                data.derechoImagen
              )}

            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid ${BORDER};">
            <p style="margin:0;color:${GRAY};font-size:12px;line-height:1.6;">
              Este correo es un comprobante automático de tu registro en la aplicación de PAMIR.<br>
              Si no realizaste este registro o tienes dudas, ${contactLine()}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Alerta salida sin cierre ─────────────────────────────────────────────────

interface AlertaSalidaEmailData {
  nombreActividad: string;
  ubicacionGeografica: string;
  fechaInicio: Date | string;
  fechaRetornoEstimada: Date | string;
  horaRetornoEstimada: string;
  horaAlerta: string;
  liderCordada: string;
  participantes: unknown;
  creatorEmail?: string | null;
}

// String(date) yields "Thu Jul 15 2026..." which formatDate cannot parse
// reliably; normalize Date instances to ISO before formatting.
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function buildAlertaSalidaEmail(salida: AlertaSalidaEmailData): string {
  const participantesArr: Array<{ nombre?: string; rut?: string }> = Array.isArray(salida.participantes)
    ? (salida.participantes as Array<{ nombre?: string; rut?: string }>)
    : [];

  const participantRows = participantesArr.length
    ? participantesArr
        .map((p) =>
          `<li style="margin-bottom:2px;">${escapeHtml(p.nombre ?? '')}${p.rut ? ` <span style="color:${GRAY};font-size:12px;">(${escapeHtml(p.rut)})</span>` : ''}</li>`,
        )
        .join('')
    : `<li style="color:${GRAY};">Sin participantes registrados</li>`;

  const intro = `
    <p style="margin:0 0 12px;color:#1f2937;font-size:15px;">
      Se ha superado la <strong>hora de alerta</strong> de la siguiente salida de montaña
      <strong>sin que se haya registrado un cierre</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;margin-bottom:0;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.05em;">⚠ Acción requerida</p>
          <p style="margin:6px 0 0;font-size:13px;color:#7f1d1d;line-height:1.6;">
            Verifica el estado de la cordada. Si el grupo ya retornó, registra el cierre en el sistema PAMIR.
            Si no has recibido noticias, activa el protocolo de búsqueda y rescate.
          </p>
        </td>
      </tr>
    </table>`;

  const tabla = `
    ${sectionHeader('I. Identificación de la Salida')}
    ${row('Nombre de la actividad', salida.nombreActividad)}
    ${row('Ubicación geográfica', salida.ubicacionGeografica)}
    ${row('Líder de cordada', salida.liderCordada)}
    ${salida.creatorEmail ? row('Contacto creador', salida.creatorEmail) : ''}

    ${sectionHeader('II. Cronología')}
    ${row('Fecha de inicio', formatDate(toIsoString(salida.fechaInicio)))}
    ${row('Fecha de retorno estimada', formatDate(toIsoString(salida.fechaRetornoEstimada)))}
    ${row('Hora de retorno estimada', salida.horaRetornoEstimada)}
    ${row('Hora de alerta (umbral superado)', salida.horaAlerta)}

    ${sectionHeader('III. Participantes')}
    <tr>
      <td colspan="2" style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">
        <ul style="margin:0;padding-left:18px;">${participantRows}</ul>
      </td>
    </tr>
  `;

  return emailShell(
    'ALERTA — Salida sin cierre registrado',
    intro,
    tabla,
    'Esta alerta fue generada automáticamente por el sistema PAMIR. Hora de la alerta superada sin cierre.',
  );
}

// ─── Recordatorio de cierre (1h antes de la alerta → líder) ───────────────────

export function buildRecordatorioCierreEmail(salida: AlertaSalidaEmailData): string {
  const participantesArr: Array<{ nombre?: string; rut?: string }> = Array.isArray(salida.participantes)
    ? (salida.participantes as Array<{ nombre?: string; rut?: string }>)
    : [];

  const participantRows = participantesArr.length
    ? participantesArr
        .map((p) =>
          `<li style="margin-bottom:2px;">${escapeHtml(p.nombre ?? '')}${p.rut ? ` <span style="color:${GRAY};font-size:12px;">(${escapeHtml(p.rut)})</span>` : ''}</li>`,
        )
        .join('')
    : `<li style="color:${GRAY};">Sin participantes registrados</li>`;

  const intro = `
    <p style="margin:0 0 12px;color:#1f2937;font-size:15px;">
      Hola <strong>${escapeHtml(salida.liderCordada)}</strong>, se acerca la
      <strong>hora de alerta</strong> de tu salida de montaña.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:2px solid #f1d48a;border-radius:8px;margin-bottom:0;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#92600a;text-transform:uppercase;letter-spacing:0.05em;">⏰ Cierra tu salida</p>
          <p style="margin:6px 0 0;font-size:13px;color:#78350f;line-height:1.6;">
            Si tu grupo ya retornó, registra el <strong>formulario de cierre</strong> en el sistema PAMIR antes
            de la hora de alerta. Si no se completa el cierre a esa hora, se activará automáticamente la
            <strong>ALERTA: Salida sin cierre</strong> hacia el equipo de seguridad.
          </p>
        </td>
      </tr>
    </table>`;

  const tabla = `
    ${sectionHeader('I. Identificación de la Salida')}
    ${row('Nombre de la actividad', salida.nombreActividad)}
    ${row('Ubicación geográfica', salida.ubicacionGeografica)}
    ${row('Líder de cordada', salida.liderCordada)}

    ${sectionHeader('II. Cronología')}
    ${row('Fecha de inicio', formatDate(toIsoString(salida.fechaInicio)))}
    ${row('Fecha de retorno estimada', formatDate(toIsoString(salida.fechaRetornoEstimada)))}
    ${row('Hora de retorno estimada', salida.horaRetornoEstimada)}
    ${row('Hora de alerta', salida.horaAlerta)}

    ${sectionHeader('III. Participantes')}
    <tr>
      <td colspan="2" style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">
        <ul style="margin:0;padding-left:18px;">${participantRows}</ul>
      </td>
    </tr>
  `;

  return emailShell(
    'Recordatorio — Cierra tu salida',
    intro,
    tabla,
    'Este recordatorio fue generado automáticamente por el sistema PAMIR antes de la hora de alerta.',
  );
}

// ─── Salud summary (admin → responsable) ─────────────────────────────────────

export interface ParticipanteSaludEmailData {
  rut: string;
  nombre: string;
  fichaEncontrada: boolean;
  salud?: {
    grupoSanguineo: string;
    alergiasTiene: boolean;
    alergiasDetalle?: string | null;
    enfermedadesCronicasTiene: boolean;
    enfermedadesCronicasDetalle?: string | null;
    medicamentosTiene: boolean;
    medicamentosDetalle?: string | null;
    cirugiasLesionesTiene: boolean;
    cirugiasLesionesDetalle?: string | null;
    fuma: boolean;
    usaLentes: boolean;
    previsionSalud: string;
    nombreContacto: string;
    parentesco: string;
    telefonoContacto: string;
  } | null;
}

export function buildSaludSalidaEmail(
  nombreActividad: string,
  liderCordada: string,
  participantes: ParticipanteSaludEmailData[],
): string {
  const conFicha = participantes.filter((p) => p.fichaEncontrada);
  const sinFicha = participantes.filter((p) => !p.fichaEncontrada);

  const participantBlocks = conFicha.map((p) => {
    const s = p.salud!;
    return `
    ${sectionHeader(`${p.nombre} — RUT: ${p.rut}`)}
    ${row('Grupo sanguíneo', s.grupoSanguineo)}
    ${boolRow('Alergias', s.alergiasTiene, s.alergiasDetalle ?? undefined)}
    ${boolRow('Enfermedades crónicas', s.enfermedadesCronicasTiene, s.enfermedadesCronicasDetalle ?? undefined)}
    ${boolRow('Medicamentos', s.medicamentosTiene, s.medicamentosDetalle ?? undefined)}
    ${boolRow('Cirugías / lesiones', s.cirugiasLesionesTiene, s.cirugiasLesionesDetalle ?? undefined)}
    ${row('Fuma', s.fuma ? 'Sí' : 'No')}
    ${row('Usa lentes / lentes de contacto', s.usaLentes ? 'Sí' : 'No')}
    ${row('Previsión de salud', s.previsionSalud)}
    <tr>
      <td style="padding:8px 12px;color:${GRAY};font-size:13px;width:45%;border-bottom:1px solid ${BORDER};">Contacto de emergencia</td>
      <td style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">${escapeHtml(s.nombreContacto)} (${escapeHtml(s.parentesco)}) — ${escapeHtml(s.telefonoContacto)}</td>
    </tr>
    `;
  }).join('');

  const sinFichaRows = sinFicha.length
    ? `
    ${sectionHeader('Participantes sin ficha de salud registrada')}
    ${sinFicha.map((p) => `
    <tr>
      <td colspan="2" style="padding:8px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid ${BORDER};">
        ${escapeHtml(p.nombre)} <span style="color:${GRAY};font-size:12px;">(RUT: ${escapeHtml(p.rut)})</span>
        <span style="margin-left:8px;display:inline-block;background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:2px 8px;font-size:11px;color:#991b1b;font-weight:600;">Sin ficha de salud</span>
      </td>
    </tr>`).join('')}
    `
    : '';

  const intro = `
    <p style="margin:0 0 12px;color:#1f2937;font-size:15px;">
      Estimado/a responsable de la salida <strong>${escapeHtml(nombreActividad)}</strong>,<br>
      A continuación encontrará el resumen de fichas de salud de los participantes,
      validado y enviado por la administración del club. Líder de cordada: <strong>${escapeHtml(liderCordada)}</strong>.
    </p>`;

  const tabla = `
    ${participantBlocks}
    ${sinFichaRows}
  `;

  const footerNote = `
    Este correo contiene información médica confidencial de los participantes de la salida.
    Por favor, trátela con la debida reserva y utilícela exclusivamente para la gestión de
    seguridad en montaña. Esta información fue validada y enviada por la administración del
    club en cumplimiento con los protocolos de seguridad de Andino Club Pamir.
    No comparta este correo con terceros.
  `;

  return emailShell(
    `Resumen de fichas de salud — ${escapeHtml(nombreActividad)}`,
    intro,
    tabla,
    footerNote,
  );
}

export function buildVerificationEmail(name: string, verificationUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:${GREEN};padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Pamir — Confirma tu cuenta</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${escapeHtml(name)}</strong>,</p>
          <p style="color:#374151;font-size:15px;margin:0 0 24px;">Gracias por registrarte en Pamir. Para activar tu cuenta haz clic en el botón de abajo:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${verificationUrl}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;">Verificar mi cuenta</a>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:</p>
          <p style="color:#4a6fad;font-size:12px;word-break:break-all;margin:0 0 24px;">${verificationUrl}</p>
          <p style="color:#9ca3af;font-size:12px;margin:0;">Este enlace es de un solo uso. Si no creaste esta cuenta, ignora este correo.</p>
        </td></tr>
        <tr><td style="background:${LIGHT_GREEN};padding:16px 32px;text-align:center;">
          <p style="margin:0;color:${GRAY};font-size:12px;">Sistema de registro alpino — Pamir Andino Club</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetEmail(name: string, resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:${GREEN};padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Pamir — Restablece tu contraseña</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${escapeHtml(name)}</strong>,</p>
          <p style="color:#374151;font-size:15px;margin:0 0 24px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón de abajo:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${resetUrl}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;">Restablecer contraseña</a>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:</p>
          <p style="color:#4a6fad;font-size:12px;word-break:break-all;margin:0 0 24px;">${resetUrl}</p>
          <p style="color:#ef4444;font-size:13px;font-weight:600;margin:0 0 8px;">⚠ Este enlace expira en 1 hora.</p>
          <p style="color:#9ca3af;font-size:12px;margin:0;">Si no solicitaste restablecer tu contraseña, ignora este correo. Tu contraseña no cambiará.</p>
        </td></tr>
        <tr><td style="background:${LIGHT_GREEN};padding:16px 32px;text-align:center;">
          <p style="margin:0;color:${GRAY};font-size:12px;">Sistema de registro alpino — Pamir Andino Club</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Eventos del club ─────────────────────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

interface EventoEmailData {
  titulo: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  fechaCorte: Date | null;
  ubicacion: string | null;
}

interface InscripcionEmailData {
  tieneVehiculo: boolean;
  cuposVehiculo: number | null;
}

// Día calendario (dd-mm-yyyy) desde la parte UTC del Date, sin depender del
// timezone del servidor (las fechas de eventos son medianoche UTC del día elegido)
function fechaCalendarioEvento(d: Date): string {
  const [y = '', m = '', day = ''] = d.toISOString().slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
}

export function rangoFechasEvento(evento: { fechaInicio: Date | null; fechaFin: Date | null }): string {
  if (!evento.fechaInicio) return 'Por confirmar';
  const inicio = fechaCalendarioEvento(evento.fechaInicio);
  if (!evento.fechaFin) return inicio;
  const fin = fechaCalendarioEvento(evento.fechaFin);
  return inicio === fin ? inicio : `${inicio} al ${fin}`;
}

// Ficha ampliada para los correos del ciclo de vida (selección / cancelación)
interface EventoLifecycleEmailData {
  titulo: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  horaInicio: string | null;
  ubicacion: string | null;
  reunionCoordinacion: string | null;
  organizadorNombre: string | null;
  motivoCancelacion: string | null;
}

// fechaCorte es un instante real: se muestra en hora de Santiago
function fechaHoraSantiago(d: Date): string {
  const texto = d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${texto} hrs (hora de Santiago)`;
}

function eventoCtaBlock(): string {
  return `
        <tr>
          <td style="padding:0 32px 28px;text-align:center;">
            <a href="${FRONTEND_URL}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">Ingresar a la aplicación</a>
          </td>
        </tr>`;
}

export function buildEventoInscripcionConfirmadaEmail(
  nombre: string,
  evento: EventoEmailData,
  inscripcion: InscripcionEmailData,
): string {
  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombre)}</strong>, recibimos tu postulación a la siguiente actividad del club.
  </p>`;

  const tabla = `
    ${row('Evento', evento.titulo)}
    ${row('Fecha', rangoFechasEvento(evento))}
    ${evento.ubicacion ? row('Ubicación', evento.ubicacion) : ''}
    ${row('Vehículo propio', inscripcion.tieneVehiculo ? 'Sí' : 'No')}
    ${inscripcion.tieneVehiculo ? row('Cupos ofrecidos', String(inscripcion.cuposVehiculo ?? 0)) : ''}
    ${evento.fechaCorte ? row('Cierre de inscripciones', fechaHoraSantiago(evento.fechaCorte)) : ''}
  `;

  const nota = `
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0 0 8px;color:#374151;font-size:13px;line-height:1.6;">
              El organizador selecciona entre los postulantes al cierre de inscripciones;
              te avisaremos por este medio.
            </p>
            <p style="margin:0;color:${GRAY};font-size:13px;line-height:1.6;">
              Si cambias de opinión puedes retirar tu postulación desde la aplicación.
            </p>
          </td>
        </tr>
        ${eventoCtaBlock()}`;

  return emailShell(
    'Postulación recibida',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
    nota,
  );
}

export function buildEventoSeleccionadoEmail(nombre: string, evento: EventoLifecycleEmailData): string {
  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombre)}</strong>, ¡buenas noticias!
    Quedaste <strong>seleccionado/a</strong> para participar en la siguiente actividad del club.
  </p>`;

  const fecha = evento.horaInicio
    ? `${rangoFechasEvento(evento)} · ${evento.horaInicio} h`
    : rangoFechasEvento(evento);

  const tabla = `
    ${row('Evento', evento.titulo)}
    ${row('Fecha', fecha)}
    ${evento.ubicacion ? row('Ubicación', evento.ubicacion) : ''}
    ${evento.reunionCoordinacion ? row('Reunión de coordinación (obligatoria)', evento.reunionCoordinacion) : ''}
    ${evento.organizadorNombre ? row('Organizador', evento.organizadorNombre) : ''}
  `;

  const nota = `
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0 0 8px;color:#374151;font-size:13px;line-height:1.6;">
              Recuerda revisar el <strong>equipo mínimo</strong> indicado en la ficha de la actividad
              y mantener al día tu ficha de socio.
            </p>
            <p style="margin:0;color:${GRAY};font-size:13px;line-height:1.6;">
              Si no puedes asistir, avisa al organizador a la brevedad para liberar tu cupo.
            </p>
          </td>
        </tr>
        ${eventoCtaBlock()}`;

  return emailShell(
    'Selección confirmada',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
    nota,
  );
}

export function buildEventoNoSeleccionadoEmail(
  nombre: string,
  evento: EventoLifecycleEmailData,
  resumen: { cupos: number | null; postulantes: number },
): string {
  const cuposTexto = resumen.cupos != null ? `${resumen.cupos} cupos` : 'cupos limitados';

  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombre)}</strong>, gracias por postular a esta actividad.
    Esta vez no quedaste dentro del cupo (${escapeHtml(cuposTexto)}, ${resumen.postulantes} postulantes).
  </p>`;

  const tabla = `
    ${row('Evento', evento.titulo)}
    ${row('Fecha', rangoFechasEvento(evento))}
  `;

  const nota = `
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">
              Valoramos mucho tu interés. Te invitamos a revisar el calendario:
              cada mes hay nuevas actividades del club.
            </p>
          </td>
        </tr>
        ${eventoCtaBlock()}`;

  return emailShell(
    'Resultado de tu postulación',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
    nota,
  );
}

export function buildEventoCanceladoEmail(nombre: string, evento: EventoLifecycleEmailData): string {
  const intro = `<p style="margin:0;color:#1f2937;font-size:15px;">
    Hola <strong>${escapeHtml(nombre)}</strong>, lamentamos informarte que la siguiente
    actividad fue <strong>cancelada</strong>.
  </p>`;

  const tabla = `
    ${row('Evento', evento.titulo)}
    ${row('Fecha', rangoFechasEvento(evento))}
    ${evento.motivoCancelacion ? row('Motivo', evento.motivoCancelacion) : ''}
  `;

  const nota = `
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">
              Sentimos los inconvenientes que esto pueda causarte. Te invitamos a revisar
              el calendario de próximas actividades del club.
            </p>
          </td>
        </tr>
        ${eventoCtaBlock()}`;

  return emailShell(
    'Evento cancelado',
    intro,
    tabla,
    'Este correo es una notificación automática del sistema PAMIR.',
    nota,
  );
}

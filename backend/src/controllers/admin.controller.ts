import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { Prisma, SalidaStatus } from '../generated/prisma/client.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildSaludSalidaEmail, type ParticipanteSaludEmailData } from '../lib/email-templates.js';
import {
  getEstadoCredencial,
  guardarRefreshToken,
  probarRefreshToken,
} from '../lib/google-credentials.js';

interface MesRow {
  // DATE_TRUNC returns timestamp-without-tz; some driver versions deliver
  // it as a string instead of a Date — handle both defensively.
  mes: Date | string;
  total: bigint;
}

// GET /api/admin/stats
export async function getStats(_req: Request, res: Response): Promise<void> {
  try {
    const [
      totalSalidas,
      porStatus,
      totalCierres,
      incidentes,
      accidentes,
      porMesRaw,
      topDisciplinasRaw,
    ] = await prisma.$transaction([
      prisma.salida.count(),
      prisma.salida.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.cierre.count(),
      prisma.cierre.count({ where: { ocurrioIncidente: 'SI' } }),
      prisma.cierre.count({ where: { ocurrioAccidente: 'SI' } }),
      // Salidas per month over the last 12 months (table mapped as "salidas").
      // Timezone contract: fecha_inicio is stored as midnight UTC of the
      // user's intended calendar date, so UTC DATE_TRUNC yields the intended
      // month directly — converting with AT TIME ZONE would shift it wrong.
      prisma.$queryRaw<MesRow[]>`
        SELECT DATE_TRUNC('month', fecha_inicio) AS mes, COUNT(*) AS total
        FROM "salidas"
        WHERE fecha_inicio >= NOW() - INTERVAL '12 months'
        GROUP BY mes
        ORDER BY mes DESC
      `,
      prisma.salida.groupBy({
        by: ['disciplina'],
        _count: { _all: true },
        // Prisma's aggregate orderBy only accepts field names (no _all);
        // disciplina is non-nullable so its count equals the row count.
        orderBy: { _count: { disciplina: 'desc' } },
        take: 5,
      }),
    ]);

    const countFor = (status: string): number =>
      porStatus.find((s) => s.status === status)?._count._all ?? 0;

    const salidasAbiertas = countFor('EN_CURSO');
    const salidasCompletadas = countFor('COMPLETADA');
    // Salida-form vs cierre-form relation: how many salidas have a cierre filed
    const pctConCierre =
      totalSalidas > 0 ? Math.round((totalCierres / totalSalidas) * 100) : 0;

    // $queryRaw COUNT returns BigInt — convert before JSON serialization
    const porMes = porMesRaw.map((r) => ({
      mes: typeof r.mes === 'string' ? r.mes : r.mes.toISOString(),
      total: Number(r.total),
    }));

    const topDisciplinas = topDisciplinasRaw.map((d) => ({
      disciplina: d.disciplina,
      total: d._count._all,
    }));

    res.json({
      totalSalidas,
      salidasAbiertas,
      salidasCompletadas,
      totalCierres,
      pctConCierre,
      incidentes,
      accidentes,
      porMes,
      topDisciplinas,
    });
  } catch (error) {
    console.error('[getStats]', error);
    res.status(500).json({ error: 'No se pudieron obtener las estadísticas' });
  }
}

// ─── Analytics dashboard ────────────────────────────────────────────────────────

const SALIDA_STATUSES: SalidaStatus[] = [
  'BORRADOR',
  'CONFIRMADA',
  'EN_CURSO',
  'COMPLETADA',
  'CANCELADA',
  'INCIDENTE',
];

// Statuses that are expected to eventually file a cierre. BORRADOR/CANCELADA
// salidas without a cierre are NOT "pending closure".
const PENDING_CLOSE_STATUSES = new Set<string>(['CONFIRMADA', 'EN_CURSO', 'INCIDENTE', 'COMPLETADA']);

// Average of the three 1-5 notas below this counts as a low-rated salida.
const LOW_RATING_THRESHOLD = 3;

interface DashboardParticipante {
  rut?: string;
  nombre?: string;
  esExpress?: boolean;
  membresiaClub?: string;
}

// Allowed club membership values (mirrors the MembresiaClub enum on the
// frontend). The dashboard club filter validates against this whitelist.
const MEMBRESIA_CLUBS = [
  'SOCIO_ANDINO_PAMIR',
  'SOCIO_EL_MONTANISTA',
  'SOCIO_OTRO_CLUB',
  'POSTULANTE_CLUB',
  'NO_PERTENECE',
] as const;

function pickString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function pickBool(v: unknown): boolean | undefined {
  const s = pickString(v);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

// fechaInicio is stored as midnight UTC of the intended calendar date, so the
// UTC month is the intended month directly (same contract as getStats).
function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function parseParticipantes(v: unknown): DashboardParticipante[] {
  return Array.isArray(v) ? (v as DashboardParticipante[]) : [];
}

function parseStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function distinctSorted(values: (string | null)[]): string[] {
  const set = new Set(
    values.filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  );
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

// GET /api/admin/dashboard
// Consolidated analytics relating the Salida form with the Cierre form, with
// dynamic filters. The dataset is small (mountain club) so aggregation runs in
// JS instead of multiple raw SQL queries with JSON operators.
export async function getDashboard(req: Request, res: Response): Promise<void> {
  try {
    // ── Parse filters ──
    const desde = pickString(req.query['desde']);
    const hasta = pickString(req.query['hasta']);
    const statusCsv = pickString(req.query['status']);
    const lider = pickString(req.query['lider']);
    const disciplina = pickString(req.query['disciplina']);
    const tipoSalida = pickString(req.query['tipoSalida']);
    const temporada = pickString(req.query['temporada']);
    const conCierre = pickBool(req.query['conCierre']);
    const conIncidente = pickBool(req.query['conIncidente']);
    const conAccidente = pickBool(req.query['conAccidente']);
    const conExpress = pickBool(req.query['conExpress']);
    const clubRaw = pickString(req.query['club']);
    const club =
      clubRaw && (MEMBRESIA_CLUBS as readonly string[]).includes(clubRaw) ? clubRaw : undefined;
    const calidadMinRaw = pickString(req.query['calidadMin']);
    const calidadMinParsed = calidadMinRaw ? Number(calidadMinRaw) : NaN;
    const calidadMin = Number.isFinite(calidadMinParsed) ? calidadMinParsed : undefined;

    const statuses = (statusCsv ? statusCsv.split(',') : [])
      .map((s) => s.trim())
      .filter((s): s is SalidaStatus => (SALIDA_STATUSES as string[]).includes(s));

    // ── Build Prisma where from scalar filters ──
    const where: Prisma.SalidaWhereInput = {};
    if (desde || hasta) {
      const range: Prisma.DateTimeFilter = {};
      if (desde) range.gte = new Date(desde);
      if (hasta) range.lte = new Date(hasta);
      where.fechaInicio = range;
    }
    if (statuses.length > 0) where.status = { in: statuses };
    if (lider) where.liderCordada = lider;
    if (disciplina) where.disciplina = disciplina;
    if (tipoSalida) where.tipoSalida = tipoSalida;
    if (temporada) where.temporada = temporada;
    if (conCierre === true) where.cierres = { some: {} };
    if (conCierre === false) where.cierres = { none: {} };

    // ── Fetch filtered salidas (+ cierres) and the full set for filter dropdowns ──
    const [salidas, filtroRows] = await Promise.all([
      prisma.salida.findMany({
        where,
        select: {
          id: true,
          status: true,
          fechaInicio: true,
          disciplina: true,
          tipoSalida: true,
          temporada: true,
          liderCordada: true,
          participantes: true,
          integrantesAuditLog: true,
          cierres: {
            select: {
              ocurrioIncidente: true,
              ocurrioAccidente: true,
              tiposIncidente: true,
              tiposAccidente: true,
            },
          },
        },
      }),
      prisma.salida.findMany({
        select: { disciplina: true, tipoSalida: true, temporada: true, liderCordada: true },
      }),
    ]);

    // ── JS-side refinement for filters that depend on JSON / cierre details ──
    let filtered = salidas;
    if (conExpress !== undefined) {
      filtered = filtered.filter((s) => {
        const hasExpress = parseParticipantes(s.participantes).some((p) => p?.esExpress === true);
        return conExpress ? hasExpress : !hasExpress;
      });
    }
    // Club filter: keep salidas with at least one participant in the selected
    // club (express participants carry no membresiaClub, so they never match).
    if (club !== undefined) {
      filtered = filtered.filter((s) =>
        parseParticipantes(s.participantes).some((p) => p?.membresiaClub === club),
      );
    }
    if (conIncidente !== undefined) {
      filtered = filtered.filter((s) => {
        const has = s.cierres.some((c) => c.ocurrioIncidente === 'SI');
        return conIncidente ? has : !has;
      });
    }
    if (conAccidente !== undefined) {
      filtered = filtered.filter((s) => {
        const has = s.cierres.some((c) => c.ocurrioAccidente === 'SI');
        return conAccidente ? has : !has;
      });
    }

    // ── Calidad de experiencia: anonymous EvaluacionRespuesta (1-5), per salida ──
    const candidateIds = filtered.map((s) => s.id);
    const evaluaciones = candidateIds.length
      ? await prisma.evaluacionRespuesta.findMany({
          where: { salidaId: { in: candidateIds } },
          select: { salidaId: true, notaObjetivos: true, notaItinerario: true, notaLider: true },
        })
      : [];

    // Per-salida average of the per-response 3-nota mean.
    const evalAcc = new Map<string, { sum: number; count: number }>();
    for (const e of evaluaciones) {
      const respAvg = (e.notaObjetivos + e.notaItinerario + e.notaLider) / 3;
      const acc = evalAcc.get(e.salidaId) ?? { sum: 0, count: 0 };
      acc.sum += respAvg;
      acc.count += 1;
      evalAcc.set(e.salidaId, acc);
    }
    const salidaCalidadAvg = (id: string): number | null => {
      const acc = evalAcc.get(id);
      return acc && acc.count > 0 ? acc.sum / acc.count : null;
    };

    // calidadMin trims salidas whose average rating is below the floor (salidas
    // without evaluations don't meet the bar).
    let finalSalidas = filtered;
    let finalEvaluaciones = evaluaciones;
    if (calidadMin !== undefined) {
      finalSalidas = filtered.filter((s) => {
        const avg = salidaCalidadAvg(s.id);
        return avg !== null && avg >= calidadMin;
      });
      const keep = new Set(finalSalidas.map((s) => s.id));
      finalEvaluaciones = evaluaciones.filter((e) => keep.has(e.salidaId));
    }

    // ── Aggregations ──
    const totalSalidas = finalSalidas.length;
    const salidaMonth = new Map<string, string>();
    const estadoCount = new Map<string, number>();
    const mesCount = new Map<string, number>();
    const incidentesPorMesMap = new Map<string, { incidentes: number; accidentes: number }>();
    const liderCount = new Map<string, number>();
    const tipoIncidenteCount = new Map<string, number>();
    const tipoAccidenteCount = new Map<string, number>();

    let canceladas = 0;
    let conCierreCount = 0;
    let pendientesCierre = 0;
    let totalParticipantes = 0;
    let totalExpress = 0;
    let incidentesSalidas = 0;
    let accidentesSalidas = 0;
    let conCambiosRoster = 0;
    let salidasEvalBaja = 0;

    for (const s of finalSalidas) {
      const mes = monthKey(s.fechaInicio);
      salidaMonth.set(s.id, mes);

      estadoCount.set(s.status, (estadoCount.get(s.status) ?? 0) + 1);
      mesCount.set(mes, (mesCount.get(mes) ?? 0) + 1);

      if (s.status === 'CANCELADA') canceladas += 1;

      const tieneCierre = s.cierres.length > 0;
      if (tieneCierre) conCierreCount += 1;
      else if (PENDING_CLOSE_STATUSES.has(s.status)) pendientesCierre += 1;

      const participantes = parseParticipantes(s.participantes);
      totalParticipantes += participantes.length;
      totalExpress += participantes.filter((p) => p?.esExpress === true).length;

      const tieneIncidente = s.cierres.some((c) => c.ocurrioIncidente === 'SI');
      const tieneAccidente = s.cierres.some((c) => c.ocurrioAccidente === 'SI');
      if (tieneIncidente) incidentesSalidas += 1;
      if (tieneAccidente) accidentesSalidas += 1;

      const mesInc = incidentesPorMesMap.get(mes) ?? { incidentes: 0, accidentes: 0 };
      if (tieneIncidente) mesInc.incidentes += 1;
      if (tieneAccidente) mesInc.accidentes += 1;
      incidentesPorMesMap.set(mes, mesInc);

      for (const c of s.cierres) {
        for (const t of parseStringArray(c.tiposIncidente)) {
          tipoIncidenteCount.set(t, (tipoIncidenteCount.get(t) ?? 0) + 1);
        }
        for (const t of parseStringArray(c.tiposAccidente)) {
          tipoAccidenteCount.set(t, (tipoAccidenteCount.get(t) ?? 0) + 1);
        }
      }

      if (s.liderCordada && s.liderCordada.trim() !== '') {
        liderCount.set(s.liderCordada, (liderCount.get(s.liderCordada) ?? 0) + 1);
      }

      // integrantesAuditLog is a JSON array of change objects; a non-empty log
      // means the roster was edited after creation.
      if (Array.isArray(s.integrantesAuditLog) && s.integrantesAuditLog.length > 0) {
        conCambiosRoster += 1;
      }

      const avgCalidad = salidaCalidadAvg(s.id);
      if (avgCalidad !== null && avgCalidad < LOW_RATING_THRESHOLD) salidasEvalBaja += 1;
    }

    // Calidad: overall average + 1-5 distribution + monthly average.
    let calidadSum = 0;
    const distribucionMap = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    const calidadMesAcc = new Map<string, { sum: number; count: number }>();
    for (const e of finalEvaluaciones) {
      const respAvg = (e.notaObjetivos + e.notaItinerario + e.notaLider) / 3;
      calidadSum += respAvg;
      const bucket = Math.min(5, Math.max(1, Math.round(respAvg)));
      distribucionMap.set(bucket, (distribucionMap.get(bucket) ?? 0) + 1);
      const mes = salidaMonth.get(e.salidaId);
      if (mes) {
        const acc = calidadMesAcc.get(mes) ?? { sum: 0, count: 0 };
        acc.sum += respAvg;
        acc.count += 1;
        calidadMesAcc.set(mes, acc);
      }
    }
    const promedioCalidad =
      finalEvaluaciones.length > 0
        ? Math.round((calidadSum / finalEvaluaciones.length) * 100) / 100
        : null;

    const sortMonthsAsc = (a: string, b: string): number => a.localeCompare(b);

    const porMes = Array.from(mesCount.entries())
      .sort(([a], [b]) => sortMonthsAsc(a, b))
      .map(([mes, total]) => ({ mes, total }));

    const incidentesPorMes = Array.from(incidentesPorMesMap.entries())
      .sort(([a], [b]) => sortMonthsAsc(a, b))
      .map(([mes, v]) => ({ mes, incidentes: v.incidentes, accidentes: v.accidentes }));

    const calidadPorMes = Array.from(calidadMesAcc.entries())
      .sort(([a], [b]) => sortMonthsAsc(a, b))
      .map(([mes, v]) => ({ mes, promedio: Math.round((v.sum / v.count) * 100) / 100 }));

    const porEstado = SALIDA_STATUSES.map((estado) => ({
      estado,
      total: estadoCount.get(estado) ?? 0,
    }));

    const porLider = Array.from(liderCount.entries())
      .map(([liderNombre, total]) => ({ lider: liderNombre, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const tiposIncidente = Array.from(tipoIncidenteCount.entries())
      .map(([tipo, total]) => ({ tipo, total }))
      .sort((a, b) => b.total - a.total);

    const tiposAccidente = Array.from(tipoAccidenteCount.entries())
      .map(([tipo, total]) => ({ tipo, total }))
      .sort((a, b) => b.total - a.total);

    const distribucion = Array.from(distribucionMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([nota, total]) => ({ nota, total }));

    const promedioParticipantes =
      totalSalidas > 0 ? Math.round((totalParticipantes / totalSalidas) * 10) / 10 : 0;
    const pctConCierre =
      totalSalidas > 0 ? Math.round((conCierreCount / totalSalidas) * 100) : 0;

    res.json({
      metrics: {
        totalSalidas,
        pendientesCierre,
        conCierre: conCierreCount,
        canceladas,
        totalParticipantes,
        promedioParticipantes,
        totalExpress,
        pctConCierre,
        incidentes: incidentesSalidas,
        accidentes: accidentesSalidas,
        promedioCalidad,
        salidasEvalBaja,
      },
      porEstado,
      porMes,
      incidentesPorMes,
      participantesPorTipo: {
        registrados: totalParticipantes - totalExpress,
        express: totalExpress,
      },
      calidad: {
        promedio: promedioCalidad,
        totalRespuestas: finalEvaluaciones.length,
        distribucion,
        porMes: calidadPorMes,
      },
      porLider,
      tiposIncidente,
      tiposAccidente,
      salidaVsCierre: {
        conCierre: conCierreCount,
        sinCierre: totalSalidas - conCierreCount,
        conCambiosRoster,
        conIncidentes: incidentesSalidas,
        conAccidentes: accidentesSalidas,
      },
      filtros: {
        lideres: distinctSorted(filtroRows.map((r) => r.liderCordada)),
        disciplinas: distinctSorted(filtroRows.map((r) => r.disciplina)),
        tipos: distinctSorted(filtroRows.map((r) => r.tipoSalida)),
        temporadas: distinctSorted(filtroRows.map((r) => r.temporada)),
      },
    });
  } catch (error) {
    console.error('[getDashboard]', error);
    res.status(500).json({ error: 'No se pudo obtener el dashboard' });
  }
}

// ─── Health data helpers ──────────────────────────────────────────────────────

const SALUD_SELECT = {
  rut: true,
  grupoSanguineo: true,
  alergiasTiene: true,
  alergiasDetalle: true,
  enfermedadesCronicasTiene: true,
  enfermedadesCronicasDetalle: true,
  medicamentosTiene: true,
  medicamentosDetalle: true,
  cirugiasLesionesTiene: true,
  cirugiasLesionesDetalle: true,
  fuma: true,
  usaLentes: true,
  previsionSalud: true,
  nombreContacto: true,
  parentesco: true,
  telefonoContacto: true,
} as const;

type SalidaParticipanteJson = { rut?: string; nombre?: string; membresiaClub?: string };

// Health data is only exposed for salidas that are currently active
const ACTIVE_SALUD_STATUSES = ['EN_CURSO', 'CONFIRMADA'];

/**
 * Loads health data for all participants of a salida.
 * Names come from the salida.participantes JSON (source of truth for the trip),
 * health records from the Integrante model keyed by RUT.
 */
async function buildParticipantesSalud(
  salidaId: string,
): Promise<
  | { notFound: true }
  | { notActive: true }
  | {
      salida: { id: string; nombreActividad: string; liderCordada: string; creatorEmail: string | null; userId: string | null };
      participantes: ParticipanteSaludEmailData[];
    }
> {
  const salida = await prisma.salida.findUnique({
    where: { id: salidaId },
    select: {
      id: true,
      nombreActividad: true,
      liderCordada: true,
      creatorEmail: true,
      userId: true,
      participantes: true,
      status: true,
    },
  });

  if (!salida) return { notFound: true };
  if (!ACTIVE_SALUD_STATUSES.includes(salida.status)) return { notActive: true };

  const participantesJson = (Array.isArray(salida.participantes)
    ? (salida.participantes as SalidaParticipanteJson[])
    : []
  ).filter((p) => Boolean(p.rut) || Boolean(p.nombre));

  const ruts = participantesJson
    .map((p) => p.rut)
    .filter((r): r is string => typeof r === 'string' && r.length > 0);

  const integrantes = await prisma.integrante.findMany({
    where: { rut: { in: ruts } },
    select: SALUD_SELECT,
  });

  const integranteByRut = new Map(integrantes.map((i) => [i.rut, i]));

  const participantes: ParticipanteSaludEmailData[] = participantesJson.map((p) => {
    const rut = p.rut ?? '';
    const nombre = p.nombre ?? rut;
    const integrante = integranteByRut.get(rut);

    if (!integrante) {
      return { rut, nombre, fichaEncontrada: false, salud: null };
    }

    return {
      rut,
      nombre,
      fichaEncontrada: true,
      salud: {
        grupoSanguineo: integrante.grupoSanguineo,
        alergiasTiene: integrante.alergiasTiene,
        alergiasDetalle: integrante.alergiasDetalle,
        enfermedadesCronicasTiene: integrante.enfermedadesCronicasTiene,
        enfermedadesCronicasDetalle: integrante.enfermedadesCronicasDetalle,
        medicamentosTiene: integrante.medicamentosTiene,
        medicamentosDetalle: integrante.medicamentosDetalle,
        cirugiasLesionesTiene: integrante.cirugiasLesionesTiene,
        cirugiasLesionesDetalle: integrante.cirugiasLesionesDetalle,
        fuma: integrante.fuma,
        usaLentes: integrante.usaLentes,
        previsionSalud: integrante.previsionSalud,
        nombreContacto: integrante.nombreContacto,
        parentesco: integrante.parentesco,
        telefonoContacto: integrante.telefonoContacto,
      },
    };
  });

  return {
    salida: {
      id: salida.id,
      nombreActividad: salida.nombreActividad,
      liderCordada: salida.liderCordada,
      creatorEmail: salida.creatorEmail,
      userId: salida.userId,
    },
    participantes,
  };
}

// GET /api/admin/salidas/:id/salud
export async function getSaludSalida(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const result = await buildParticipantesSalud(id);

    if ('notFound' in result) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    if ('notActive' in result) {
      res.status(422).json({ error: 'La salida no está activa' });
      return;
    }

    // The browser UI never renders the emergency contact — keep it out of
    // the API response; it only flows into the email built server-side.
    const participantes = result.participantes.map((p) => ({
      rut: p.rut,
      nombre: p.nombre,
      fichaEncontrada: p.fichaEncontrada,
      salud: p.salud
        ? {
            grupoSanguineo: p.salud.grupoSanguineo,
            alergiasTiene: p.salud.alergiasTiene,
            alergiasDetalle: p.salud.alergiasDetalle,
            enfermedadesCronicasTiene: p.salud.enfermedadesCronicasTiene,
            enfermedadesCronicasDetalle: p.salud.enfermedadesCronicasDetalle,
            medicamentosTiene: p.salud.medicamentosTiene,
            medicamentosDetalle: p.salud.medicamentosDetalle,
            cirugiasLesionesTiene: p.salud.cirugiasLesionesTiene,
            cirugiasLesionesDetalle: p.salud.cirugiasLesionesDetalle,
            fuma: p.salud.fuma,
            usaLentes: p.salud.usaLentes,
            previsionSalud: p.salud.previsionSalud,
          }
        : null,
    }));

    res.json({
      salidaId: result.salida.id,
      nombreActividad: result.salida.nombreActividad,
      liderCordada: result.salida.liderCordada,
      creatorEmail: result.salida.creatorEmail,
      participantes,
    });
  } catch (error) {
    console.error('[getSaludSalida]', error);
    res.status(500).json({ error: 'No se pudieron obtener las fichas de salud' });
  }
}

// POST /api/admin/salidas/:id/enviar-salud
export async function enviarSaludSalida(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const result = await buildParticipantesSalud(id);

    if ('notFound' in result) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    if ('notActive' in result) {
      res.status(422).json({ error: 'La salida no está activa' });
      return;
    }

    // Resolve target email: creatorEmail first, then User.email via userId
    let targetEmail = result.salida.creatorEmail ?? null;

    if (!targetEmail && result.salida.userId) {
      const user = await prisma.user.findUnique({
        where: { id: result.salida.userId },
        select: { email: true },
      });
      targetEmail = user?.email ?? null;
    }

    if (!targetEmail) {
      res.status(422).json({ error: 'La salida no tiene un correo de responsable' });
      return;
    }

    const subject = `Resumen de fichas de salud — ${result.salida.nombreActividad}`;
    const htmlBody = buildSaludSalidaEmail(
      result.salida.nombreActividad,
      result.salida.liderCordada,
      result.participantes,
    );

    try {
      await sendEmail(targetEmail, subject, htmlBody);
    } catch (sendError) {
      console.error('[enviarSaludSalida] sendEmail failed', sendError);
      res.status(502).json({ error: 'No se pudo enviar el correo. Intenta nuevamente más tarde.' });
      return;
    }

    const participantesConFicha = result.participantes.filter((p) => p.fichaEncontrada).length;
    const participantesSinFicha = result.participantes.filter((p) => !p.fichaEncontrada).length;

    res.json({
      sent: true,
      to: targetEmail,
      participantesConFicha,
      participantesSinFicha,
    });
  } catch (error) {
    console.error('[enviarSaludSalida]', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}

// ─── Credencial de Google (refresh token rotable desde el panel) ────────────────

// Un refresh token de Google empieza por "1//" y ronda los 100 caracteres. El
// tope alto sólo evita que un pegado accidental enorme llegue a la validación.
const guardarCredencialSchema = z.object({
  refreshToken: z.string().trim().min(20).max(2048),
});

// GET /api/admin/google-credencial
export async function getGoogleCredencial(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await getEstadoCredencial());
  } catch (error) {
    console.error('[getGoogleCredencial]', error);
    res.status(500).json({ error: 'No se pudo obtener el estado de la credencial' });
  }
}

// PUT /api/admin/google-credencial
export async function saveGoogleCredencial(req: Request, res: Response): Promise<void> {
  try {
    const parsed = guardarCredencialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'El refresh token no tiene un formato válido' });
      return;
    }

    const refreshToken = parsed.data.refreshToken;

    // Se prueba contra Google ANTES de guardar: una errata al pegar dejaría la
    // integración rota en silencio, que es justo el fallo que esto viene a cerrar.
    const prueba = await probarRefreshToken(refreshToken);
    if (!prueba.ok) {
      res.status(422).json({ error: `Google rechazó el token: ${prueba.motivo}` });
      return;
    }

    await guardarRefreshToken(refreshToken, req.user!.email);

    res.json(await getEstadoCredencial());
  } catch (error) {
    // Nunca `error` a secas: si viniera de gaxios arrastraría el token pegado.
    console.error(
      '[saveGoogleCredencial]',
      error instanceof Error ? error.message : 'error desconocido',
    );
    res.status(500).json({ error: 'No se pudo guardar la credencial' });
  }
}

// ─── Dashboard layout (per-admin customizable grid) ─────────────────────────────

const ADMIN_DASHBOARD_KEY = 'admin_analytics';
const GRID_COLS = 12;
const MAX_H = 50;

// Allowlist of widget ids. MUST stay in sync with the frontend registry in
// frontend/src/components/admin/dashboardWidgets.tsx. Unknown ids are dropped.
const WIDGET_IDS = new Set<string>([
  // metric tiles
  'total_salidas',
  'pendientes_cierre',
  'con_cierre',
  'canceladas',
  'total_participantes',
  'promedio_participantes',
  'participantes_express',
  'salidas_incidentes',
  'salidas_accidentes',
  'calidad_promedio',
  'eval_baja',
  // charts
  'salidas_por_estado',
  'salidas_por_mes',
  'incidentes_accidentes',
  'participantes_tipo',
  'calidad_distribucion',
  'calidad_evolucion',
  'salidas_por_lider',
  'comparacion_salida_cierre',
]);

const layoutItemSchema = z.object({
  widgetId: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
  visible: z.boolean().optional(),
});

const saveLayoutSchema = z.object({
  // Upper-bounded well above the ~19 known widgets so a tampered payload can't
  // force large in-memory parsing; unknown ids are dropped afterwards anyway.
  layout: z.array(layoutItemSchema).max(50),
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// GET /api/admin/dashboard-layout
export async function getDashboardLayout(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const row = await prisma.dashboardLayout.findUnique({
      where: { userId_dashboardKey: { userId, dashboardKey: ADMIN_DASHBOARD_KEY } },
    });
    if (!row) {
      res.json({ layout: null });
      return;
    }
    res.json({ layout: row.layout, updatedAt: row.updatedAt });
  } catch (error) {
    console.error('[getDashboardLayout]', error);
    res.status(500).json({ error: 'No se pudo obtener la configuración del dashboard' });
  }
}

// PUT /api/admin/dashboard-layout
export async function saveDashboardLayout(req: Request, res: Response): Promise<void> {
  try {
    const parsed = saveLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Configuración de dashboard inválida' });
      return;
    }

    // Keep only known widgets and clamp geometry into grid bounds so a tampered
    // payload can never store out-of-range positions.
    const sanitized = parsed.data.layout
      .filter((item) => WIDGET_IDS.has(item.widgetId))
      .map((item) => ({
        widgetId: item.widgetId,
        x: clamp(item.x, 0, GRID_COLS - 1),
        y: Math.max(item.y, 0),
        w: clamp(item.w, 1, GRID_COLS),
        h: clamp(item.h, 1, MAX_H),
        ...(item.visible === undefined ? {} : { visible: item.visible }),
      }));

    const userId = req.user!.id;
    const saved = await prisma.dashboardLayout.upsert({
      where: { userId_dashboardKey: { userId, dashboardKey: ADMIN_DASHBOARD_KEY } },
      create: {
        userId,
        dashboardKey: ADMIN_DASHBOARD_KEY,
        layout: sanitized as Prisma.JsonArray,
      },
      update: { layout: sanitized as Prisma.JsonArray },
    });
    res.json({ layout: saved.layout, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error('[saveDashboardLayout]', error);
    res.status(500).json({ error: 'No se pudo guardar la configuración del dashboard' });
  }
}

// DELETE /api/admin/dashboard-layout — restore default by forgetting saved config
export async function deleteDashboardLayout(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    await prisma.dashboardLayout.deleteMany({
      where: { userId, dashboardKey: ADMIN_DASHBOARD_KEY },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[deleteDashboardLayout]', error);
    res.status(500).json({ error: 'No se pudo restaurar la configuración del dashboard' });
  }
}

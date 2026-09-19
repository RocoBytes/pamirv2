import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { Prisma, SalidaStatus, Salida } from '../generated/prisma/client.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildSalidaNotificationEmail } from '../lib/email-templates.js';
import { ADMIN_EMAIL } from '../lib/constants.js';
import { instanteSantiago } from '../lib/santiago-time.js';
import { errorFechaCalendario } from '../lib/fecha-calendario.js';

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

interface ParticipanteInput {
  rut?: string;
  nombre?: string;
  membresiaClub?: string;
  esExpress?: boolean;
  telefono?: string;
  email?: string;
  agregadoPor?: string | null;
  agregadoEn?: string;
}

async function sendSalidaParticipantEmails(participantObjs: unknown[], salida: Salida): Promise<void> {
  const participants = participantObjs as ParticipanteInput[];

  const recipients: { email: string; nombre: string }[] = [];

  // Registered integrantes: resolve their email by RUT (express entries excluded).
  const ruts = participants
    .filter((p) => p && !p.esExpress && p.rut)
    .map((p) => p.rut as string);
  if (ruts.length > 0) {
    const integrantes = await prisma.integrante.findMany({
      where: { rut: { in: ruts } },
      select: { email: true, nombreCompleto: true },
    });
    for (const i of integrantes) {
      recipients.push({ email: i.email, nombre: i.nombreCompleto });
    }
  }

  // Express participants: notify using the email captured in the express form.
  for (const p of participants) {
    if (p && p.esExpress && p.email && p.nombre) {
      recipients.push({ email: p.email, nombre: p.nombre });
    }
  }

  if (recipients.length === 0) return;

  for (const r of recipients) {
    await sendEmail(
      r.email,
      `Has sido registrado en la salida "${salida.nombreActividad}" — Pamir`,
      buildSalidaNotificationEmail(r.nombre, salida),
    ).catch((err) => console.error(`[salida-email] Fallo al enviar a ${r.email}:`, err));
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

// Express participants carry no ficha; stamp who added them and when so the
// salida keeps an auditable record. Trust server-side values, not the client.
// On re-save (edits) the original stamp is preserved — only new express entries
// get stamped.
function normalizeParticipantes(participantObjs: unknown[], addedBy: string | null): ParticipanteInput[] {
  const nowIso = new Date().toISOString();
  return (participantObjs as ParticipanteInput[]).map((p) => {
    if (p && p.esExpress === true) {
      return {
        ...p,
        esExpress: true,
        agregadoPor: p.agregadoPor ?? addedBy,
        agregadoEn: p.agregadoEn ?? nowIso,
      };
    }
    return p;
  });
}

/**
 * Scheduled departure instant of a salida, in Santiago time. fechaInicio is
 * stored as midnight UTC of the chosen calendar date; horaInicio is "HH:MM".
 * Legacy salidas without horaInicio fall back to 23:59 (editable through the day).
 */
function departureMoment(salida: Salida): Date {
  const dateStr = salida.fechaInicio.toISOString().slice(0, 10);
  const hora = salida.horaInicio ?? '23:59';
  return instanteSantiago(dateStr, hora);
}

// Los integrantes son editables solo si la salida está EN_CURSO y la fecha+hora
// de salida todavía no se alcanzó.
function isIntegrantesEditable(salida: Salida, now: Date): boolean {
  return salida.status === 'EN_CURSO' && now < departureMoment(salida);
}

type AuditAccion = 'agrego' | 'elimino' | 'modifico';

interface IntegranteAuditEntry {
  accion: AuditAccion;
  rut: string;
  nombre: string;
  por: string | null;
  en: string;
}

function participanteChanged(a: ParticipanteInput, b: ParticipanteInput): boolean {
  return (
    (a.nombre ?? '') !== (b.nombre ?? '') ||
    Boolean(a.esExpress) !== Boolean(b.esExpress) ||
    (a.telefono ?? '') !== (b.telefono ?? '') ||
    (a.email ?? '') !== (b.email ?? '') ||
    (a.membresiaClub ?? '') !== (b.membresiaClub ?? '')
  );
}

// Diff participantes by RUT to build the audit trail (added / removed / modified).
function diffIntegrantesAudit(
  prev: ParticipanteInput[],
  next: ParticipanteInput[],
  por: string | null,
): IntegranteAuditEntry[] {
  const nowIso = new Date().toISOString();
  const entries: IntegranteAuditEntry[] = [];
  const prevByRut = new Map(prev.filter((p) => p?.rut).map((p) => [p.rut as string, p]));
  const nextByRut = new Map(next.filter((p) => p?.rut).map((p) => [p.rut as string, p]));

  for (const [rut, p] of nextByRut) {
    const before = prevByRut.get(rut);
    if (!before) {
      entries.push({ accion: 'agrego', rut, nombre: p.nombre ?? '', por, en: nowIso });
    } else if (participanteChanged(before, p)) {
      entries.push({ accion: 'modifico', rut, nombre: p.nombre ?? before.nombre ?? '', por, en: nowIso });
    }
  }
  for (const [rut, p] of prevByRut) {
    if (!nextByRut.has(rut)) {
      entries.push({ accion: 'elimino', rut, nombre: p.nombre ?? '', por, en: nowIso });
    }
  }
  return entries;
}

interface CreateSalidaBody {
  // Paso 1
  tipoSalida: string;
  disciplina: string;
  temporada: string;
  nombreActividad: string;
  ubicacionGeografica: string;
  // Paso 2
  fechaInicio: string;
  horaInicio?: string;
  fechaRetornoEstimada: string;
  horaRetornoEstimada: string;
  horaAlerta: string;
  avisosExternos?: string[];
  retenCarabineros?: string;
  nombreFamiliar?: string;
  telefonoFamiliar?: string;
  // Paso 3
  liderCordada: string;
  participantes?: unknown[];
  coordinacionGrupal?: boolean;
  matrizRiesgos?: boolean;
  // Paso 4
  mediosComunicacion?: string[];
  idDispositivoFrecuencia?: string;
  equipoColectivo?: string[];
  equipoColectivoOtro?: string;
  // Paso 5
  pronosticoMeteorologico?: string;
  riesgosIdentificados?: string[];
  riesgosOtro?: string;
  planEvacuacion?: string;
  // GPX
  gpxFileUrl?: string;
  // Estado
  status?: SalidaStatus;
  incidentReport?: string;
  // Registro histórico (solo admin): fecha pasada permitida, sin notificaciones
  esRegistroHistorico?: boolean;
}

export async function createSalida(req: Request, res: Response): Promise<void> {
  try {
    const data = req.body as CreateSalidaBody;
    const userId = req.user?.id ?? null;
    const isAdmin = req.user?.email === ADMIN_EMAIL;
    // Solo el admin puede crear registros históricos (fecha pasada, sin notificaciones).
    const esRegistroHistorico = isAdmin && data.esRegistroHistorico === true;

    if (!data.pronosticoMeteorologico?.trim()) {
      res.status(400).json({ error: 'El pronóstico meteorológico es obligatorio' });
      return;
    }

    // Un usuario no-admin nunca puede marcar una salida como registro histórico.
    if (!isAdmin && data.esRegistroHistorico) {
      res.status(403).json({ error: 'No tienes permiso para crear registros históricos' });
      return;
    }

    const errorFecha =
      errorFechaCalendario('Fecha de inicio', data.fechaInicio) ??
      errorFechaCalendario('Fecha de retorno', data.fechaRetornoEstimada);
    if (errorFecha) {
      res.status(400).json({ error: errorFecha });
      return;
    }

    // Las fechas pasadas solo se permiten en registros históricos del admin.
    if (!esRegistroHistorico) {
      const todayStr = new Date().toISOString().split('T')[0];
      const fechaInicioStr = String(data.fechaInicio).slice(0, 10);
      if (fechaInicioStr < todayStr) {
        res.status(400).json({ error: 'No se puede crear una salida con fecha de inicio en el pasado' });
        return;
      }
    }

    const participantesNormalizados = normalizeParticipantes(
      data.participantes ?? [],
      req.user?.email ?? data.liderCordada ?? null,
    );

    const salida = await prisma.salida.create({
      data: {
        userId,
        creatorEmail: req.user?.email ?? null,
        tipoSalida: data.tipoSalida,
        disciplina: data.disciplina,
        temporada: data.temporada,
        nombreActividad: data.nombreActividad,
        ubicacionGeografica: data.ubicacionGeografica,
        fechaInicio: new Date(data.fechaInicio),
        horaInicio: data.horaInicio || null,
        fechaRetornoEstimada: new Date(data.fechaRetornoEstimada),
        horaRetornoEstimada: data.horaRetornoEstimada,
        horaAlerta: data.horaAlerta,
        avisosExternos: asJson(data.avisosExternos ?? []),
        retenCarabineros: data.retenCarabineros || null,
        nombreFamiliar: data.nombreFamiliar || null,
        telefonoFamiliar: data.telefonoFamiliar || null,
        liderCordada: data.liderCordada,
        participantes: asJson(participantesNormalizados),
        coordinacionGrupal: data.coordinacionGrupal ?? false,
        matrizRiesgos: data.matrizRiesgos ?? false,
        mediosComunicacion: asJson(data.mediosComunicacion ?? []),
        idDispositivoFrecuencia: data.idDispositivoFrecuencia,
        equipoColectivo: asJson(data.equipoColectivo ?? []),
        equipoColectivoOtro: data.equipoColectivoOtro,
        pronosticoMeteorologico: data.pronosticoMeteorologico,
        riesgosIdentificados: asJson(data.riesgosIdentificados ?? []),
        riesgosOtro: data.riesgosOtro,
        planEvacuacion: data.planEvacuacion,
        gpxFileUrl: data.gpxFileUrl,
        status: data.status ?? 'EN_CURSO',
        incidentReport: data.incidentReport,
        esRegistroHistorico,
      },
    });

    res.status(201).json(salida);

    // Los registros históricos del admin no notifican a los integrantes.
    if (!esRegistroHistorico) {
      sendSalidaParticipantEmails(
        participantesNormalizados as unknown[],
        salida,
      ).catch((err) => console.error('[salida-email]', err));
    }
  } catch (error) {
    console.error('[createSalida]', error);
    res.status(500).json({ error: 'No se pudo crear la salida' });
  }
}

export async function getSalidas(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId) {
      const salidas = await prisma.salida.findMany({
        where: { userId: null, status: 'EN_CURSO' },
        orderBy: { createdAt: 'desc' },
      });
      res.json(salidas);
      return;
    }

    // El admin ve todas las salidas (incluidas COMPLETADAS) para poder
    // revisar evaluaciones y cierres de cualquier líder.
    // _count.cierres allows the AdminPanel to detect open salidas without a cierre.
    if (userEmail === ADMIN_EMAIL) {
      const salidas = await prisma.salida.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { cierres: true } } },
      });
      res.json(salidas);
      return;
    }

    let userRut: string | null = null;
    if (userEmail) {
      const integrante = await prisma.integrante.findFirst({
        where: { email: userEmail },
        select: { rut: true },
      });
      if (integrante) {
        userRut = integrante.rut;
      }
    }

    // Históricos: el desplegable del Dashboard pide ?historico=true para ver
    // las salidas ya cerradas (COMPLETADA) en las que el usuario participó.
    // Sin el flag se mantiene el comportamiento actual: solo salidas EN_CURSO.
    const historico =
      req.query['historico'] === 'true' || req.query['historico'] === '1';

    const whereClause: Prisma.SalidaWhereInput = {
      status: historico ? 'COMPLETADA' : 'EN_CURSO',
      OR: [
        { userId: userId },
      ],
    };

    if (userRut) {
      whereClause.OR!.push({
        participantes: {
          array_contains: [{ rut: userRut }],
        },
      });
    }

    const salidas = await prisma.salida.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    res.json(salidas);
  } catch (error) {
    console.error('[getSalidas]', error);
    res.status(500).json({ error: 'No se pudieron obtener las salidas' });
  }
}

export async function claimSalida(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Debes iniciar sesión para reclamar una salida' });
      return;
    }

    const salida = await prisma.salida.findUnique({ where: { id } });

    if (!salida) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    if (salida.userId !== null) {
      res.status(409).json({ error: 'Esta salida ya tiene un propietario' });
      return;
    }

    const updated = await prisma.salida.update({
      where: { id },
      data: { userId, creatorEmail: req.user!.email },
    });

    res.json(updated);
  } catch (error) {
    console.error('[claimSalida]', error);
    res.status(500).json({ error: 'No se pudo reclamar la salida' });
  }
}

export async function getSalidaById(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const requestUserId = req.user?.id ?? null;
    const requestUserEmail = req.user?.email ?? null;

    const salida = await prisma.salida.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } } },
    });

    if (!salida) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }

    // El administrador puede ver el detalle de cualquier salida.
    const isAdmin = requestUserEmail === ADMIN_EMAIL;

    let isParticipant = false;
    if (requestUserEmail) {
      const integrante = await prisma.integrante.findFirst({
        where: { email: requestUserEmail },
        select: { rut: true },
      });
      if (integrante && integrante.rut) {
        const parts = (salida.participantes ?? []) as { rut?: string }[];
        if (parts.some((p) => p.rut === integrante.rut)) {
          isParticipant = true;
        }
      }
    }

    if (!isAdmin && salida.userId !== null && salida.userId !== requestUserId && !isParticipant) {
      res.status(403).json({ error: 'No tienes permiso para ver esta salida' });
      return;
    }

    res.json(salida);
  } catch (error) {
    console.error('[getSalidaById]', error);
    res.status(500).json({ error: 'No se pudo obtener la salida' });
  }
}

export async function updateSalida(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const requestUserId = req.user?.id ?? null;
    const requestUserEmail = req.user?.email ?? null;
    const isAdmin = requestUserEmail === ADMIN_EMAIL;

    const existing = await prisma.salida.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    // Solo el dueño o el administrador pueden editar una salida.
    if (!isAdmin && existing.userId !== null && existing.userId !== requestUserId) {
      res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
      return;
    }
    // Solo se pueden editar salidas en curso (no cerradas, canceladas, etc.).
    if (existing.status !== 'EN_CURSO') {
      res.status(409).json({ error: 'Solo se pueden editar salidas en curso' });
      return;
    }

    // Whitelist explícita — nunca exponer campos de sistema al cliente
    const body = req.body as Partial<CreateSalidaBody>;

    const errorFecha =
      (body.fechaInicio !== undefined ? errorFechaCalendario('Fecha de inicio', body.fechaInicio) : null) ??
      (body.fechaRetornoEstimada !== undefined
        ? errorFechaCalendario('Fecha de retorno', body.fechaRetornoEstimada)
        : null);
    if (errorFecha) {
      res.status(400).json({ error: errorFecha });
      return;
    }

    const salida = await prisma.salida.update({
      where: { id },
      data: {
        ...(body.tipoSalida !== undefined && { tipoSalida: body.tipoSalida }),
        ...(body.disciplina !== undefined && { disciplina: body.disciplina }),
        ...(body.temporada !== undefined && { temporada: body.temporada }),
        ...(body.nombreActividad !== undefined && { nombreActividad: body.nombreActividad }),
        ...(body.ubicacionGeografica !== undefined && { ubicacionGeografica: body.ubicacionGeografica }),
        ...(body.fechaInicio !== undefined && { fechaInicio: new Date(body.fechaInicio) }),
        ...(body.horaInicio !== undefined && { horaInicio: body.horaInicio || null }),
        ...(body.fechaRetornoEstimada !== undefined && { fechaRetornoEstimada: new Date(body.fechaRetornoEstimada) }),
        ...(body.horaRetornoEstimada !== undefined && { horaRetornoEstimada: body.horaRetornoEstimada }),
        ...(body.horaAlerta !== undefined && { horaAlerta: body.horaAlerta }),
        ...(body.avisosExternos !== undefined && { avisosExternos: asJson(body.avisosExternos) }),
        ...(body.retenCarabineros !== undefined && { retenCarabineros: body.retenCarabineros || null }),
        ...(body.nombreFamiliar !== undefined && { nombreFamiliar: body.nombreFamiliar || null }),
        ...(body.telefonoFamiliar !== undefined && { telefonoFamiliar: body.telefonoFamiliar || null }),
        // `liderCordada` y `participantes` (grupo humano) NO son editables por este endpoint.
        ...(body.coordinacionGrupal !== undefined && { coordinacionGrupal: body.coordinacionGrupal }),
        ...(body.matrizRiesgos !== undefined && { matrizRiesgos: body.matrizRiesgos }),
        ...(body.mediosComunicacion !== undefined && { mediosComunicacion: asJson(body.mediosComunicacion) }),
        ...(body.idDispositivoFrecuencia !== undefined && { idDispositivoFrecuencia: body.idDispositivoFrecuencia }),
        ...(body.equipoColectivo !== undefined && { equipoColectivo: asJson(body.equipoColectivo) }),
        ...(body.equipoColectivoOtro !== undefined && { equipoColectivoOtro: body.equipoColectivoOtro }),
        ...(body.pronosticoMeteorologico !== undefined && { pronosticoMeteorologico: body.pronosticoMeteorologico }),
        ...(body.riesgosIdentificados !== undefined && { riesgosIdentificados: asJson(body.riesgosIdentificados) }),
        ...(body.riesgosOtro !== undefined && { riesgosOtro: body.riesgosOtro }),
        ...(body.planEvacuacion !== undefined && { planEvacuacion: body.planEvacuacion }),
        // `status` NO es editable acá: la transición a COMPLETADA ocurre solo al crear el cierre.
        ...(body.incidentReport !== undefined && { incidentReport: body.incidentReport }),
      },
    });

    res.json(salida);
  } catch (error) {
    console.error('[updateSalida]', error);
    res.status(500).json({ error: 'No se pudo actualizar la salida' });
  }
}

/**
 * PUT /api/salidas/:id/integrantes
 *
 * Edita el apartado de integrantes (participantes + líder) de una salida.
 * Permitido solo para admin o el dueño, mientras la salida esté EN_CURSO y la
 * fecha+hora de salida todavía no se haya alcanzado. Deja un registro de
 * auditoría con cada cambio y notifica solo a los recién agregados.
 */
export async function updateSalidaIntegrantes(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const requestUserId = req.user?.id ?? null;
    const requestUserEmail = req.user?.email ?? null;
    const isAdmin = requestUserEmail === ADMIN_EMAIL;

    const existing = await prisma.salida.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }

    // Solo el dueño o el administrador pueden editar los integrantes.
    if (!isAdmin && existing.userId !== null && existing.userId !== requestUserId) {
      res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
      return;
    }
    if (existing.status !== 'EN_CURSO') {
      res.status(409).json({ error: 'Solo se pueden editar salidas en curso' });
      return;
    }
    // Gate de fecha+hora de salida: una vez alcanzada, queda en solo lectura.
    if (!isIntegrantesEditable(existing, new Date())) {
      res.status(409).json({
        error:
          'La edición de integrantes ya no está disponible porque la salida ya comenzó o la hora programada de salida ya fue alcanzada.',
      });
      return;
    }

    const body = req.body as { participantes?: unknown[]; liderCordada?: string };
    if (!Array.isArray(body.participantes)) {
      res.status(400).json({ error: 'participantes es obligatorio' });
      return;
    }

    const addedBy = requestUserEmail ?? existing.liderCordada;
    const prevParticipantes = (existing.participantes as unknown as ParticipanteInput[]) ?? [];
    const nextParticipantes = normalizeParticipantes(body.participantes, addedBy);

    const auditEntries = diffIntegrantesAudit(prevParticipantes, nextParticipantes, addedBy);
    const prevLog = Array.isArray(existing.integrantesAuditLog)
      ? (existing.integrantesAuditLog as unknown[])
      : [];
    const nextLog = [...prevLog, ...auditEntries];

    const salida = await prisma.salida.update({
      where: { id },
      data: {
        participantes: asJson(nextParticipantes),
        ...(typeof body.liderCordada === 'string' && body.liderCordada.trim()
          ? { liderCordada: body.liderCordada }
          : {}),
        integrantesAuditLog: asJson(nextLog),
      },
    });

    res.json(salida);

    // Notificar solo a los recién agregados (no re-enviar a los ya existentes).
    const prevRuts = new Set(
      prevParticipantes.filter((p) => p?.rut).map((p) => p.rut as string),
    );
    const added = nextParticipantes.filter((p) => p?.rut && !prevRuts.has(p.rut as string));
    if (added.length > 0) {
      sendSalidaParticipantEmails(added as unknown[], salida).catch((err) =>
        console.error('[salida-email]', err),
      );
    }
  } catch (error) {
    console.error('[updateSalidaIntegrantes]', error);
    res.status(500).json({ error: 'No se pudieron actualizar los integrantes' });
  }
}

export async function deleteSalida(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const requestUserId = req.user?.id ?? null;

    const existing = await prisma.salida.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    if (existing.userId !== null && existing.userId !== requestUserId) {
      res.status(403).json({ error: 'No tienes permiso para eliminar esta salida' });
      return;
    }

    await prisma.salida.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('[deleteSalida]', error);
    res.status(500).json({ error: 'No se pudo eliminar la salida' });
  }
}

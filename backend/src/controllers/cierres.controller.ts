import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { Prisma, Cierre } from '../generated/prisma/client.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildCierreNotificationEmail } from '../lib/email-templates.js';
import { ADMIN_EMAIL } from '../lib/constants.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

async function sendCierreParticipantEmails(salidaId: string, cierre: Cierre): Promise<void> {
  const salida = await prisma.salida.findUnique({ where: { id: salidaId } });
  if (!salida) return;

  const ruts = (salida.participantes as { rut?: string }[])
    .map((p) => p.rut)
    .filter((r): r is string => Boolean(r));
  if (ruts.length === 0) return;

  const integrantes = await prisma.integrante.findMany({
    where: { rut: { in: ruts } },
    select: { email: true, nombreCompleto: true },
  });

  for (const i of integrantes) {
    let evaluacionUrl: string | undefined;
    try {
      const evalToken = await prisma.evaluacionToken.create({
        data: { token: randomUUID(), salidaId, email: i.email },
      });
      evaluacionUrl = `${FRONTEND_URL}?evaluacion=${evalToken.token}`;
    } catch (err) {
      console.error(`[cierre-email] No se pudo crear token de evaluación para ${i.email}:`, err);
    }

    await sendEmail(
      i.email,
      `Cierre de la salida "${salida.nombreActividad}" — Pamir`,
      buildCierreNotificationEmail(i.nombreCompleto, salida, cierre, evaluacionUrl),
    ).catch((err) => console.error(`[cierre-email] Fallo al enviar a ${i.email}:`, err));
    await new Promise((r) => setTimeout(r, 350));
  }
}

interface CreateCierreBody {
  salidaId: string;
  fechaFinalizacionReal: string;
  estadoCierre: string;
  altitudMaxima: number;
  motivoAbandono?: string;
  huboCambios: string;
  motivosCambios?: unknown[];
  motivosCambiosOtro?: string;
  ocurrioIncidente: string;
  ocurrioAccidente: string;
  tiposIncidente?: unknown[];
  incidenteOtroDescripcion?: string;
  tiposAccidente?: unknown[];
  accidenteOtroDescripcion?: string;
  desempenoEquipo: string;
  detalleFallaEquipo?: string;
  observacionesRuta: string;
  precisionPronostico: number;
  leccionesAprendidas: string;
  recomendacionesFuturos?: string;
  sugerenciasClub?: string;
}

export async function createCierre(req: Request, res: Response): Promise<void> {
  try {
    const data = req.body as CreateCierreBody;
    const userId = req.user!.id;
    const isAdmin = req.user!.email === ADMIN_EMAIL;

    const salida = await prisma.salida.findUnique({ where: { id: data.salidaId } });
    if (!salida) {
      res.status(404).json({ error: 'Salida no encontrada' });
      return;
    }
    // El dueño o el administrador pueden cerrar; nadie más.
    if (!isAdmin && salida.userId !== null && salida.userId !== userId) {
      res.status(403).json({ error: 'No tienes permiso para cerrar esta salida' });
      return;
    }
    // Solo se pueden cerrar salidas en curso.
    if (salida.status !== 'EN_CURSO') {
      res.status(409).json({ error: 'Solo se pueden cerrar salidas en curso' });
      return;
    }

    const existingCierre = await prisma.cierre.findFirst({ where: { salidaId: data.salidaId } });
    if (existingCierre) {
      res.status(409).json({ error: 'Esta salida ya tiene un cierre registrado' });
      return;
    }

    // El cierre y la transición a COMPLETADA deben ser atómicos: crear la ficha
    // de cierre es el único método para completar una salida.
    const [cierre] = await prisma.$transaction([
      prisma.cierre.create({
        data: {
          salidaId: data.salidaId,
          userId,
          fechaFinalizacionReal: new Date(data.fechaFinalizacionReal),
          estadoCierre: data.estadoCierre,
          altitudMaxima: data.altitudMaxima,
          motivoAbandono: data.motivoAbandono,
          huboCambios: data.huboCambios,
          motivosCambios: asJson(data.motivosCambios ?? []),
          motivosCambiosOtro: data.motivosCambiosOtro,
          ocurrioIncidente: data.ocurrioIncidente,
          ocurrioAccidente: data.ocurrioAccidente ?? 'NO',
          tiposIncidente: asJson(data.tiposIncidente ?? []),
          incidenteOtroDescripcion: data.incidenteOtroDescripcion || null,
          tiposAccidente: asJson(data.tiposAccidente ?? []),
          accidenteOtroDescripcion: data.accidenteOtroDescripcion || null,
          desempenoEquipo: data.desempenoEquipo,
          detalleFallaEquipo: data.detalleFallaEquipo,
          observacionesRuta: data.observacionesRuta,
          precisionPronostico: data.precisionPronostico,
          leccionesAprendidas: data.leccionesAprendidas,
          recomendacionesFuturos: data.recomendacionesFuturos,
          sugerenciasClub: data.sugerenciasClub,
        },
      }),
      prisma.salida.update({
        where: { id: data.salidaId },
        data: { status: 'COMPLETADA' },
      }),
    ]);

    res.status(201).json(cierre);

    // Silenciar el correo de cierre cuando lo cierra el admin y la salida es un
    // registro histórico, o su retorno estimado fue hace más de 5 días.
    const retornoStr = salida.fechaRetornoEstimada.toISOString().slice(0, 10);
    const cutoffStr = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const silenciarCierre = isAdmin && (salida.esRegistroHistorico || retornoStr < cutoffStr);

    if (!silenciarCierre) {
      sendCierreParticipantEmails(data.salidaId, cierre)
        .catch((err) => console.error('[cierre-email]', err));
    }
  } catch (error) {
    console.error('[createCierre]', error);
    res.status(500).json({ error: 'No se pudo crear el cierre' });
  }
}

export async function getCierres(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;

    // Sin autenticación no hay cierres que mostrar — evita exponer datos de toda la plataforma
    if (!userId) {
      res.json({ data: [], total: 0, page: 1, limit: 50 });
      return;
    }

    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const skip = (page - 1) * limit;

    const [cierres, total] = await prisma.$transaction([
      prisma.cierre.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: { salida: { select: { nombreActividad: true } } },
      }),
      prisma.cierre.count({ where: { userId } }),
    ]);

    res.json({ data: cierres, total, page, limit });
  } catch (error) {
    console.error('[getCierres]', error);
    res.status(500).json({ error: 'No se pudieron obtener los cierres' });
  }
}

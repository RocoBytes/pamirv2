import { prisma } from './prisma.js';
import { sendClubEmail } from './email/club-email.js';
import {
  buildEventoInscripcionConfirmadaEmail,
  buildEventoSeleccionadoEmail,
  buildEventoNoSeleccionadoEmail,
  buildEventoCanceladoEmail,
  brandingFor,
} from './email-templates.js';
import {
  subjectEventoInscripcionConfirmada,
  subjectEventoSeleccionado,
  subjectEventoNoSeleccionado,
  subjectEventoCancelado,
} from './email/subjects.js';
import { TipoNotificacion, Notificacion, Inscripcion, User, Evento, Organization } from '../generated/prisma/client.js';
import type { OrganizationSummary } from '../types/index.js';

// Cola idempotente de correos de eventos: el unique (inscripcionId, tipo)
// garantiza una fila por correo; encolar dos veces no duplica nada.

export class DispatchEnCursoError extends Error {
  constructor(eventoId: string) {
    super(`Ya hay un despacho de notificaciones en curso para el evento ${eventoId}`);
    this.name = 'DispatchEnCursoError';
  }
}

export async function encolarNotificacion(
  organizationId: string,
  inscripcionId: string,
  tipo: TipoNotificacion,
): Promise<void> {
  await prisma.notificacion.createMany({
    data: [{ organizationId, inscripcionId, tipo }],
    skipDuplicates: true,
  });
}

function toOrgSummary(org: Organization): OrganizationSummary {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    shortName: org.shortName,
    membresiaPropia: org.membresiaPropia,
    alertEmail: org.alertEmail,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
  };
}

type NotificacionConContexto = Notificacion & {
  inscripcion: Inscripcion & { usuario: User; evento: Evento };
  organization: Organization;
};

function buildEmailPorTipo(
  notif: NotificacionConContexto,
  extra: { postulantesResueltos: number | null },
): { asunto: string; html: string } {
  const { usuario, evento } = notif.inscripcion;
  const branding = brandingFor(toOrgSummary(notif.organization));
  switch (notif.tipo) {
    case 'INSCRIPCION_CONFIRMADA':
      return {
        asunto: subjectEventoInscripcionConfirmada(evento),
        html: buildEventoInscripcionConfirmadaEmail(usuario.name, evento, notif.inscripcion, branding),
      };
    case 'SELECCIONADO':
      return {
        asunto: subjectEventoSeleccionado(evento),
        html: buildEventoSeleccionadoEmail(usuario.name, evento, branding),
      };
    case 'NO_SELECCIONADO':
      return {
        asunto: subjectEventoNoSeleccionado(evento),
        html: buildEventoNoSeleccionadoEmail(
          usuario.name,
          evento,
          { cupos: evento.cupos, postulantes: extra.postulantesResueltos ?? 0 },
          branding,
        ),
      };
    case 'EVENTO_CANCELADO':
      return {
        asunto: subjectEventoCancelado(evento),
        html: buildEventoCanceladoEmail(usuario.name, evento, branding),
      };
  }
}

// Lock en memoria por evento. Válido solo porque el backend corre en UNA
// réplica (restricción de infraestructura): jamás escalar este servicio.
const dispatchLocks = new Set<string>();

export async function despacharNotificacionesPendientes(
  eventoId: string,
): Promise<{ despachadas: number; fallidas: number }> {
  if (dispatchLocks.has(eventoId)) throw new DispatchEnCursoError(eventoId);
  dispatchLocks.add(eventoId);

  try {
    const pendientes = await prisma.notificacion.findMany({
      where: {
        estado: { in: ['PENDIENTE', 'ERROR'] },
        intentos: { lt: 5 },
        inscripcion: { eventoId },
      },
      // El club dueño de la notificación (no necesariamente el del llamador
      // actual: este despacho corre en background, sin request asociado) se
      // trae acá para poder enviar el correo "como" ese club.
      include: { inscripcion: { include: { usuario: true, evento: true } }, organization: true },
      orderBy: { creadaAt: 'asc' },
    });

    let despachadas = 0;
    let fallidas = 0;

    // Total de postulaciones resueltas del evento, calculado una sola vez por
    // corrida (lo usa el correo de no seleccionado: "N cupos, M postulantes")
    let postulantesResueltos: number | null = null;
    if (pendientes.some((n) => n.tipo === 'NO_SELECCIONADO')) {
      postulantesResueltos = await prisma.inscripcion.count({
        where: { eventoId, estado: { in: ['SELECCIONADO', 'NO_SELECCIONADO'] } },
      });
    }

    for (const notif of pendientes) {
      try {
        const { asunto, html } = buildEmailPorTipo(notif, { postulantesResueltos });
        // idempotencyKey = id de la propia notificación: un reintento de esta
        // misma fila (p.ej. tras un error de red ya registrado) nunca duplica
        // el correo en el proveedor.
        const proveedorId = await sendClubEmail(toOrgSummary(notif.organization), {
          to: notif.inscripcion.usuario.email,
          subject: asunto,
          html,
          kind: 'notificacion',
          idempotencyKey: notif.id,
        });
        await prisma.notificacion.update({
          where: { id: notif.id },
          data: {
            estado: 'ENVIADA',
            enviadaAt: new Date(),
            proveedorId: proveedorId ?? null,
          },
        });
        despachadas++;
      } catch (err) {
        await prisma.notificacion.update({
          where: { id: notif.id },
          data: {
            estado: 'ERROR',
            intentos: { increment: 1 },
            ultimoError: String(err).slice(0, 500),
          },
        });
        fallidas++;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    return { despachadas, fallidas };
  } finally {
    dispatchLocks.delete(eventoId);
  }
}

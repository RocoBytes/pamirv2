import { prisma } from './prisma.js';
import { sendEmail } from './google-gmail.js';
import {
  buildEventoInscripcionConfirmadaEmail,
  buildEventoSeleccionadoEmail,
  buildEventoNoSeleccionadoEmail,
  buildEventoCanceladoEmail,
  rangoFechasEvento,
} from './email-templates.js';
import { TipoNotificacion, Notificacion, Inscripcion, User, Evento } from '../generated/prisma/client.js';

// Cola idempotente de correos de eventos: el unique (inscripcionId, tipo)
// garantiza una fila por correo; encolar dos veces no duplica nada.

export class DispatchEnCursoError extends Error {
  constructor(eventoId: string) {
    super(`Ya hay un despacho de notificaciones en curso para el evento ${eventoId}`);
    this.name = 'DispatchEnCursoError';
  }
}

export async function encolarNotificacion(
  inscripcionId: string,
  tipo: TipoNotificacion,
): Promise<void> {
  await prisma.notificacion.createMany({
    data: [{ inscripcionId, tipo }],
    skipDuplicates: true,
  });
}

type NotificacionConContexto = Notificacion & {
  inscripcion: Inscripcion & { usuario: User; evento: Evento };
};

function buildEmailPorTipo(
  notif: NotificacionConContexto,
  extra: { postulantesResueltos: number | null },
): { asunto: string; html: string } {
  const { usuario, evento } = notif.inscripcion;
  switch (notif.tipo) {
    case 'INSCRIPCION_CONFIRMADA':
      return {
        asunto: `Recibimos tu postulación: ${evento.titulo}`,
        html: buildEventoInscripcionConfirmadaEmail(usuario.name, evento, notif.inscripcion),
      };
    case 'SELECCIONADO':
      return {
        asunto: `Quedaste seleccionado/a: ${evento.titulo} · ${rangoFechasEvento(evento)}`,
        html: buildEventoSeleccionadoEmail(usuario.name, evento),
      };
    case 'NO_SELECCIONADO':
      return {
        asunto: `Resultado de tu postulación: ${evento.titulo}`,
        html: buildEventoNoSeleccionadoEmail(usuario.name, evento, {
          cupos: evento.cupos,
          postulantes: extra.postulantesResueltos ?? 0,
        }),
      };
    case 'EVENTO_CANCELADO':
      return {
        asunto: `Evento cancelado: ${evento.titulo}`,
        html: buildEventoCanceladoEmail(usuario.name, evento),
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
      include: { inscripcion: { include: { usuario: true, evento: true } } },
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
        const proveedorId = await sendEmail(notif.inscripcion.usuario.email, asunto, html);
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

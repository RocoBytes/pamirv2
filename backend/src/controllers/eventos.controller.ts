import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { encolarNotificacion, despacharNotificacionesPendientes } from '../lib/notificaciones.js';

const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Medianoche UTC de la fecha calendario actual en Santiago — convención Salida:
// las fechas de eventos se guardan como medianoche UTC del día elegido.
function hoySantiagoUtc(): Date {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  return new Date(`${hoy}T00:00:00.000Z`);
}

export async function getCategorias(_req: Request, res: Response): Promise<void> {
  try {
    const categorias = await prisma.categoriaEvento.findMany({
      where: { activa: true },
      orderBy: { orden: 'asc' },
    });
    res.json(categorias);
  } catch (error) {
    console.error('[getCategorias]', error);
    res.status(500).json({ error: 'Error al obtener las categorías' });
  }
}

export async function getEventos(req: Request, res: Response): Promise<void> {
  try {
    const isAdmin = req.user!.rol === 'ADMIN';

    const mes = req.query['mes'];
    if (mes !== undefined && (typeof mes !== 'string' || !MES_REGEX.test(mes))) {
      res.status(400).json({ error: 'Formato de mes inválido (se espera YYYY-MM)' });
      return;
    }

    const rawCategoria = req.query['categoria'];
    const slugs = (Array.isArray(rawCategoria) ? rawCategoria : rawCategoria ? [rawCategoria] : [])
      .filter((s): s is string => typeof s === 'string');

    const incluirPasados = req.query['incluirPasados'] === 'true';

    // Los gestores ven además los BORRADOR/CANCELADO de sus categorías (una
    // consulta indexada por request para no-admins; los socios pagan lo mismo
    // y obtienen lista vacía).
    let gestorIds: number[] = [];
    if (!isAdmin) {
      const filas = await prisma.gestorCategoria.findMany({
        where: { usuarioId: req.user!.id },
        select: { categoriaId: true },
      });
      gestorIds = filas.map((f) => f.categoriaId);
    }
    const esGestor = gestorIds.length > 0;

    const condiciones: Prisma.EventoWhereInput[] = [];
    if (!isAdmin) {
      condiciones.push(
        esGestor
          ? {
              OR: [
                { estado: { in: ['PUBLICADO', 'FINALIZADO'] } },
                { estado: { in: ['BORRADOR', 'CANCELADO'] }, categoriaId: { in: gestorIds } },
              ],
            }
          : { estado: { in: ['PUBLICADO', 'FINALIZADO'] } },
      );
    }
    if (slugs.length > 0) {
      condiciones.push({ categoria: { slug: { in: slugs } } });
    }

    // Ventana temporal: mes usa semántica de solapamiento; por defecto se
    // ocultan los eventos ya terminados. Los borradores sin fechas del admin o
    // del gestor (en sus categorías) deben aparecer siempre.
    let ventana: Prisma.EventoWhereInput | null = null;
    if (typeof mes === 'string') {
      const [anio, mesNum] = mes.split('-').map(Number) as [number, number];
      const inicioMes = new Date(Date.UTC(anio, mesNum - 1, 1));
      const finMes = new Date(Date.UTC(anio, mesNum, 0));
      ventana = { fechaInicio: { lte: finMes }, fechaFin: { gte: inicioMes } };
    } else if (!incluirPasados) {
      ventana = { fechaFin: { gte: hoySantiagoUtc() } };
    }
    if (ventana) {
      if (isAdmin) {
        condiciones.push({ OR: [ventana, { estado: 'BORRADOR', fechaInicio: null }] });
      } else if (esGestor) {
        condiciones.push({
          OR: [ventana, { estado: 'BORRADOR', fechaInicio: null, categoriaId: { in: gestorIds } }],
        });
      } else {
        condiciones.push(ventana);
      }
    }

    const eventos = await prisma.evento.findMany({
      where: { AND: condiciones },
      orderBy: { fechaInicio: 'asc' },
      include: {
        categoria: true,
        _count: { select: { inscripciones: { where: { estado: 'POSTULADO' } } } },
      },
    });

    const mias = await prisma.inscripcion.findMany({
      where: { usuarioId: req.user!.id, eventoId: { in: eventos.map((e) => e.id) } },
      select: { eventoId: true, estado: true },
    });
    const miEstadoPorEvento = new Map(mias.map((i) => [i.eventoId, i.estado]));

    res.json(
      eventos.map(({ _count, ...evento }) => ({
        ...evento,
        totalPostulantes: _count.inscripciones,
        miInscripcion: miEstadoPorEvento.has(evento.id)
          ? { estado: miEstadoPorEvento.get(evento.id) }
          : null,
      })),
    );
  } catch (error) {
    console.error('[getEventos]', error);
    res.status(500).json({ error: 'Error al obtener los eventos' });
  }
}

export async function getEventoById(req: Request, res: Response): Promise<void> {
  const id = req.params['id'] as string;

  try {
    const evento = await prisma.evento.findUnique({
      where: { id },
      include: {
        categoria: true,
        _count: { select: { inscripciones: { where: { estado: 'POSTULADO' } } } },
      },
    });

    // Un borrador no existe para quien no puede gestionarlo (no filtrar
    // existencia). Gestores: consulta puntual solo al tocar un borrador.
    if (!evento) {
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }
    if (evento.estado === 'BORRADOR' && req.user!.rol !== 'ADMIN') {
      const esGestorDeCategoria =
        evento.categoriaId !== null &&
        (await prisma.gestorCategoria.count({
          where: { usuarioId: req.user!.id, categoriaId: evento.categoriaId },
        })) > 0;
      if (!esGestorDeCategoria) {
        res.status(404).json({ error: 'Evento no encontrado' });
        return;
      }
    }

    const [mia, declaracionVigente] = await Promise.all([
      prisma.inscripcion.findUnique({
        where: { eventoId_usuarioId: { eventoId: evento.id, usuarioId: req.user!.id } },
        select: { estado: true },
      }),
      prisma.declaracionJuradaVersion.findFirst({
        where: { vigenteHasta: null },
        orderBy: { vigenteDesde: 'desc' },
        select: { id: true, version: true, titulo: true, items: true },
      }),
    ]);

    const { _count, ...rest } = evento;
    res.json({
      ...rest,
      totalPostulantes: _count.inscripciones,
      miInscripcion: mia ? { estado: mia.estado } : null,
      declaracionVigente,
    });
  } catch (error) {
    console.error('[getEventoById]', error);
    res.status(500).json({ error: 'Error al obtener el evento' });
  }
}

// ─── Inscripción ──────────────────────────────────────────────────────────────

const inscripcionSchema = z.object({
  tieneVehiculo: z.boolean({ error: 'Indica si cuentas con vehículo' }),
  cuposVehiculo: z
    .number()
    .int('Los cupos de vehículo deben ser un número entero')
    .min(0, 'Los cupos de vehículo deben estar entre 0 y 30')
    .max(30, 'Los cupos de vehículo deben estar entre 0 y 30')
    .nullable()
    .optional(),
  declaracionVersionId: z.number().int(),
  itemsAceptados: z.array(z.boolean()),
});

export async function inscribirse(req: Request, res: Response): Promise<void> {
  const id = req.params['id'] as string;

  const parsed = inscripcionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    return;
  }
  const { tieneVehiculo, declaracionVersionId, itemsAceptados } = parsed.data;
  const cuposVehiculo = parsed.data.cuposVehiculo ?? null;

  try {
    const evento = await prisma.evento.findUnique({ where: { id } });
    if (!evento || (evento.estado === 'BORRADOR' && req.user!.rol !== 'ADMIN')) {
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }
    // I2: solo un PUBLICADO con el cierre en el futuro acepta postulaciones
    if (evento.estado !== 'PUBLICADO') {
      res.status(409).json({ error: 'El evento no acepta inscripciones' });
      return;
    }
    if (!evento.fechaCorte || evento.fechaCorte.getTime() <= Date.now()) {
      res.status(409).json({ error: 'Las inscripciones están cerradas' });
      return;
    }

    // I3: los cupos de vehículo van atados a tener vehículo
    if (tieneVehiculo && cuposVehiculo === null) {
      res.status(422).json({ error: 'Indica cuántos cupos ofreces en tu vehículo' });
      return;
    }
    if (!tieneVehiculo && cuposVehiculo !== null) {
      res.status(422).json({ error: 'Los cupos de vehículo solo aplican si tienes vehículo' });
      return;
    }

    // I4: la declaración aceptada debe ser la vigente, con todos sus puntos
    const vigente = await prisma.declaracionJuradaVersion.findFirst({
      where: { vigenteHasta: null },
      orderBy: { vigenteDesde: 'desc' },
    });
    const totalItems = Array.isArray(vigente?.items) ? vigente.items.length : 0;
    if (
      !vigente ||
      declaracionVersionId !== vigente.id ||
      itemsAceptados.length !== totalItems ||
      !itemsAceptados.every(Boolean)
    ) {
      res.status(422).json({ error: 'Debes aceptar todos los puntos de la declaración vigente' });
      return;
    }

    const ahora = new Date();
    const declaracionIp = req.ip ?? null;
    const declaracionUserAgent = String(req.headers['user-agent'] ?? '').slice(0, 300) || null;

    const existente = await prisma.inscripcion.findUnique({
      where: { eventoId_usuarioId: { eventoId: id, usuarioId: req.user!.id } },
    });
    if (existente && existente.estado !== 'RETIRADO') {
      res.status(409).json({ error: 'Ya estás inscrito/a en este evento' });
      return;
    }

    let inscripcion;
    if (existente) {
      // Re-postulación tras un retiro: misma fila, declaración y postulación frescas
      inscripcion = await prisma.inscripcion.update({
        where: { id: existente.id },
        data: {
          estado: 'POSTULADO',
          tieneVehiculo,
          cuposVehiculo,
          declaracionVersionId,
          declaracionAceptadaAt: ahora,
          declaracionIp,
          declaracionUserAgent,
          postuladoAt: ahora,
          retiradoAt: null,
        },
      });
    } else {
      try {
        inscripcion = await prisma.inscripcion.create({
          data: {
            eventoId: id,
            usuarioId: req.user!.id,
            tieneVehiculo,
            cuposVehiculo,
            declaracionVersionId,
            declaracionAceptadaAt: ahora,
            declaracionIp,
            declaracionUserAgent,
          },
        });
      } catch (err) {
        // I5: doble submit concurrente contra el unique (eventoId, usuarioId)
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          res.status(409).json({ error: 'Ya estás inscrito/a en este evento' });
          return;
        }
        throw err;
      }
    }

    // La cola es idempotente: una re-postulación ya tiene su fila de
    // confirmación enviada y no genera un segundo correo.
    await encolarNotificacion(inscripcion.id, 'INSCRIPCION_CONFIRMADA');

    res.status(201).json({ inscripcion });

    despacharNotificacionesPendientes(id).catch((err) =>
      console.error('[inscribirse] dispatch:', err),
    );
  } catch (error) {
    console.error('[inscribirse]', error);
    res.status(500).json({ error: 'Error al procesar la inscripción' });
  }
}

export async function retirarse(req: Request, res: Response): Promise<void> {
  const id = req.params['id'] as string;

  try {
    const inscripcion = await prisma.inscripcion.findUnique({
      where: { eventoId_usuarioId: { eventoId: id, usuarioId: req.user!.id } },
      include: { evento: true },
    });
    if (!inscripcion) {
      res.status(404).json({ error: 'No estás inscrito/a en este evento' });
      return;
    }
    // I6: solo un POSTULADO de un evento PUBLICADO puede retirarse. Sin chequeo
    // de fechaCorte a propósito: el retiro sigue permitido tras el cierre
    // mientras el organizador no finalice la selección.
    if (inscripcion.estado !== 'POSTULADO' || inscripcion.evento.estado !== 'PUBLICADO') {
      res.status(409).json({ error: 'La postulación ya no puede retirarse' });
      return;
    }

    const actualizada = await prisma.inscripcion.update({
      where: { id: inscripcion.id },
      data: { estado: 'RETIRADO', retiradoAt: new Date() },
    });
    res.json({ inscripcion: actualizada });
  } catch (error) {
    console.error('[retirarse]', error);
    res.status(500).json({ error: 'Error al retirar la postulación' });
  }
}

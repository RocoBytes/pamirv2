// Implementación real (Prisma) de CodigosQrRepo. Separada de la lógica de
// negocio (codigos-qr.service.ts) por la misma razón que invitaciones.repo.
// prisma.ts: así el servicio se puede probar con un repositorio en memoria.
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import type { CodigosQrRepo, CodigoQrConCreador } from './codigos-qr.service.js';

export const codigosQrRepoPrisma: CodigosQrRepo = {
  async create(data) {
    return prisma.codigoQrInvitacion.create({ data });
  },

  async list({ creadoPorId }) {
    const rows = await prisma.codigoQrInvitacion.findMany({
      where: creadoPorId ? { creadoPorId } : {},
      orderBy: { createdAt: 'desc' },
      include: { creadoPor: { select: { name: true } } },
    });
    return rows.map(({ creadoPor, ...row }): CodigoQrConCreador => ({
      ...row,
      creadoPorNombre: creadoPor?.name ?? null,
    }));
  },

  async findById(id) {
    return prisma.codigoQrInvitacion.findUnique({ where: { id } });
  },

  async findByTokenHash(tokenHash) {
    return prisma.codigoQrInvitacion.findUnique({ where: { tokenHash } });
  },

  async markRevoked(id, now) {
    await prisma.codigoQrInvitacion.update({ where: { id }, data: { revocadoAt: now } });
  },

  async findUserById(id) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, rol: true, email: true } });
  },

  // SIEMPRE en contexto de plataforma, sin importar el contexto del llamador:
  // User.email es único en TODA la plataforma, no por club — mismo motivo que
  // invitacionesRepoPrisma.findUserByEmail.
  async findUserByEmail(email) {
    return runAsPlatform(() =>
      prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, rol: true },
      }),
    );
  },

  async hasPendingInvitacion(email, now) {
    const pending = await prisma.invitacion.findFirst({
      where: { email, aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    return pending !== null;
  },

  async mintInvitacion({ codigoQrId, organizationId, email, rol, tokenHash, expiresAt, invitadoPorId, now }) {
    return prisma.$transaction(async (tx) => {
      // Update condicional: solo decrementa si el código sigue activo en este
      // instante (no revocado, no expirado, con usos disponibles). count !== 1
      // significa que otra solicitud concurrente ya consumió el último uso
      // entre verificarVigenciaQr y este punto — el llamador no envía correo.
      const { count } = await tx.codigoQrInvitacion.updateMany({
        where: { id: codigoQrId, revocadoAt: null, expiresAt: { gt: now }, usosRestantes: { gt: 0 } },
        data: { usosRestantes: { decrement: 1 } },
      });
      if (count !== 1) {
        return null;
      }

      return tx.invitacion.create({
        data: {
          organizationId,
          email,
          rol,
          tokenHash,
          expiresAt,
          invitadoPorId,
          emitidaPorPlataforma: false,
          codigoQrId,
        },
      });
    });
  },

  async registrarUsuarioQrDirecto({ codigoQrId, organizationId, email, name, passwordHash, rol, now }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Update condicional, igual que mintInvitacion: solo decrementa si el
        // código sigue siendo DIRECTO, activo y con su único uso disponible.
        // count !== 1 significa que otra request ya lo consumió (o lo revocó)
        // entre verificarVigenciaQr y este punto.
        const { count } = await tx.codigoQrInvitacion.updateMany({
          where: {
            id: codigoQrId,
            modo: 'DIRECTO',
            revocadoAt: null,
            expiresAt: { gt: now },
            usosRestantes: { gt: 0 },
          },
          data: { usosRestantes: { decrement: 1 } },
        });
        if (count !== 1) {
          return { kind: 'agotado' };
        }

        // Mismo shape que acceptInvitacion (acá arriba): mismo costo de
        // bcrypt, mismos campos, emailVerified true — el QR de un solo uso,
        // mostrado en persona, reemplaza el paso de verificación por correo.
        const user = await tx.user.create({
          data: { organizationId, email, name, passwordHash, rol, emailVerified: true },
          select: { id: true, email: true, name: true, rol: true },
        });
        // Dual write — mismo motivo que invitaciones.repo.prisma.ts.
        await tx.membresia.create({
          data: { organizationId, usuarioId: user.id, rol },
        });

        await tx.codigoQrInvitacion.update({
          where: { id: codigoQrId },
          data: { registradoUsuarioId: user.id },
        });

        return { kind: 'ok', user };
      });
    } catch (error) {
      // P2002: violación del unique de User.email — otra request ganó la
      // carrera para el mismo correo entre el chequeo previo del servicio y
      // este punto. La transacción ya revirtió el decremento de usosRestantes.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: 'email-en-uso' };
      }
      throw error;
    }
  },
};

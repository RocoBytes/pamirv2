// Implementación real (Prisma) de InvitacionesRepo. Mantenida separada del
// servicio para que la lógica de negocio (invitaciones.service.ts) se pueda
// probar con un repositorio en memoria, sin tocar la base de datos.
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import type {
  InvitacionesRepo,
  InvitacionConInvitador,
} from './invitaciones.service.js';

export const invitacionesRepoPrisma: InvitacionesRepo = {
  async findUserById(id) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, rol: true },
    });
  },

  // Dos consultas de plataforma SIEMPRE, lanzadas en paralelo (Promise.all,
  // nunca una tras otra) sin importar si la cuenta existe (Ruling 2 del plan
  // de esta PR): con el generador sin `relationJoins`, un `include`/`select`
  // anidado sobre una relación es, por debajo, una segunda consulta que
  // Prisma solo emite cuando la primera encontró una fila — eso es
  // exactamente el canal de tiempo que el diseño prohíbe (el admin que
  // invita podría medir "una consulta" vs. "dos consultas" y deducir si el
  // correo tiene cuenta en otro club). Al crear ambas promesas antes de
  // esperar cualquiera, las dos viajan siempre, exista o no la cuenta.
  async findAccountMembershipStatus(email, organizationId) {
    return runAsPlatform(async () => {
      const [user, membresia] = await Promise.all([
        prisma.user.findUnique({ where: { email }, select: { id: true } }),
        prisma.membresia.findFirst({ where: { organizationId, usuario: { email } }, select: { id: true } }),
      ]);
      if (!user) return { cuentaExiste: false, esSocioDeEsteClub: false };
      return { cuentaExiste: true, esSocioDeEsteClub: membresia !== null };
    });
  },

  async findAccountForOwnershipProof(email) {
    return runAsPlatform(() =>
      prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      }),
    );
  },

  async revokePendingForEmail(email, now) {
    await prisma.invitacion.updateMany({
      where: { email, aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
      data: { revocadaAt: now },
    });
  },

  async createInvitacion(data) {
    return prisma.invitacion.create({ data });
  },

  async findByTokenHash(tokenHash) {
    return prisma.invitacion.findUnique({ where: { tokenHash } });
  },

  async findById(id) {
    return prisma.invitacion.findUnique({ where: { id } });
  },

  async list({ invitadoPorId }) {
    const rows = await prisma.invitacion.findMany({
      where: invitadoPorId ? { invitadoPorId } : {},
      orderBy: { createdAt: 'desc' },
      include: { invitadoPor: { select: { name: true } } },
    });
    return rows.map(({ invitadoPor, ...row }): InvitacionConInvitador => ({
      ...row,
      invitadoPorNombre: invitadoPor?.name ?? null,
    }));
  },

  async markRevoked(id, now) {
    await prisma.invitacion.update({ where: { id }, data: { revocadaAt: now } });
  },

  async acceptInvitacion({ invitacionId, organizationId, email, name, passwordHash, rol, now }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Update condicional: solo avanza si la invitación sigue pendiente y
        // vigente. affected rows !== 1 significa que alguien más ya la aceptó,
        // la revocó, o expiró entre la validación y este punto (carrera).
        const { count } = await tx.invitacion.updateMany({
          where: { id: invitacionId, aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
          data: { aceptadaAt: now },
        });
        if (count !== 1) {
          return null;
        }

        // El club del usuario nuevo es siempre el de la invitación, nunca el
        // del body de la request (que aceptarInvitacion ya ignora).
        const user = await tx.user.create({
          data: { organizationId, email, name, passwordHash, rol, emailVerified: true },
          select: { id: true, email: true, name: true, rol: true },
        });
        // Dual write (fase de expansión del multi-club, ver schema.prisma):
        // toda alta de User crea su Membresia en la misma transacción.
        await tx.membresia.create({
          data: { organizationId, usuarioId: user.id, rol },
        });
        await tx.invitacion.update({ where: { id: invitacionId }, data: { usuarioId: user.id } });

        return user;
      });
    } catch (error) {
      // P2002: violación del unique de User.email — otra invitación para el
      // mismo correo ganó la carrera entre la validación y este punto. La
      // transacción ya revirtió el update de aceptadaAt.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  },

  async acceptInvitacionExistente({ invitacionId, organizationId, usuarioId, rol, now }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Mismo update condicional que acceptInvitacion: solo avanza si la
        // invitación sigue pendiente y vigente.
        const { count } = await tx.invitacion.updateMany({
          where: { id: invitacionId, aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
          data: { aceptadaAt: now },
        });
        if (count !== 1) {
          return false;
        }

        // A diferencia de acceptInvitacion: NUNCA se toca User acá — solo la
        // Membresia nueva (Ruling del plan de esta PR: la cuenta existente
        // nunca se sobreescribe).
        await tx.membresia.create({ data: { organizationId, usuarioId, rol } });
        await tx.invitacion.update({ where: { id: invitacionId }, data: { usuarioId } });

        return true;
      });
    } catch (error) {
      // P2002: la Membresia (organizationId, usuarioId) ya existía — una
      // carrera concurrente contra ESTA MISMA invitación (el update
      // condicional de arriba solo protege el conteo de filas de
      // Invitacion, no la unicidad de Membresia). La transacción ya revirtió
      // el update de aceptadaAt.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  },
};

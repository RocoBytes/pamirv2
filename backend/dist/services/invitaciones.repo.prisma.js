// Implementación real (Prisma) de InvitacionesRepo. Mantenida separada del
// servicio para que la lógica de negocio (invitaciones.service.ts) se pueda
// probar con un repositorio en memoria, sin tocar la base de datos.
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
export const invitacionesRepoPrisma = {
    async findUserByEmail(email) {
        return prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, rol: true },
        });
    },
    async findUserById(id) {
        return prisma.user.findUnique({
            where: { id },
            select: { id: true, name: true, rol: true },
        });
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
        return rows.map(({ invitadoPor, ...row }) => ({
            ...row,
            invitadoPorNombre: invitadoPor?.name ?? null,
        }));
    },
    async markRevoked(id, now) {
        await prisma.invitacion.update({ where: { id }, data: { revocadaAt: now } });
    },
    async acceptInvitacion({ invitacionId, email, name, passwordHash, rol, now }) {
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
                const user = await tx.user.create({
                    data: { email, name, passwordHash, rol, emailVerified: true },
                    select: { id: true, email: true, name: true, rol: true },
                });
                await tx.invitacion.update({ where: { id: invitacionId }, data: { usuarioId: user.id } });
                return user;
            });
        }
        catch (error) {
            // P2002: violación del unique de User.email — otra invitación para el
            // mismo correo ganó la carrera entre la validación y este punto. La
            // transacción ya revirtió el update de aceptadaAt.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return null;
            }
            throw error;
        }
    },
};

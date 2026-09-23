// Implementación real (Prisma) de CodigosQrRepo. Separada de la lógica de
// negocio (codigos-qr.service.ts) por la misma razón que invitaciones.repo.
// prisma.ts: así el servicio se puede probar con un repositorio en memoria.
import { prisma } from '../lib/prisma.js';
import { runAsPlatform } from '../lib/tenant-context.js';
export const codigosQrRepoPrisma = {
    async create(data) {
        return prisma.codigoQrInvitacion.create({ data });
    },
    async list({ creadoPorId }) {
        const rows = await prisma.codigoQrInvitacion.findMany({
            where: creadoPorId ? { creadoPorId } : {},
            orderBy: { createdAt: 'desc' },
            include: { creadoPor: { select: { name: true } } },
        });
        return rows.map(({ creadoPor, ...row }) => ({
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
        return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, rol: true } });
    },
    // SIEMPRE en contexto de plataforma, sin importar el contexto del llamador:
    // User.email es único en TODA la plataforma, no por club — mismo motivo que
    // invitacionesRepoPrisma.findUserByEmail.
    async findUserByEmail(email) {
        return runAsPlatform(() => prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, rol: true },
        }));
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
};

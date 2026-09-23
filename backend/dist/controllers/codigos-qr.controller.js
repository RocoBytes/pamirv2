import { z } from 'zod';
import { crearCodigoQr as crearCodigoQrService, listarCodigosQr as listarCodigosQrService, verCodigoQr as verCodigoQrService, revocarCodigoQr as revocarCodigoQrService, consultarCodigoQr as consultarCodigoQrService, solicitarInvitacionQr as solicitarInvitacionQrService, } from '../services/codigos-qr.service.js';
import { codigosQrRepoPrisma } from '../services/codigos-qr.repo.prisma.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildInvitationEmail, brandingFor } from '../lib/email-templates.js';
import { subjectInvitacion } from '../lib/email/subjects.js';
import { FRONTEND_URL } from '../lib/config.js';
import { requireJwtSecret } from '../lib/jwt.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { prisma } from '../lib/prisma.js';
import { isOrganizationSuspended } from '../lib/organization-status.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';
// Cableado real: repositorio Prisma y reloj real. El envío de correo se arma
// por request porque el club de quien invita (por QR, cualquiera puede
// resolverlo recién al leer el token) nunca es fijo a nivel de módulo — mismo
// motivo que buildDeps en invitaciones.controller.ts.
function buildDeps(organization) {
    return {
        repo: codigosQrRepoPrisma,
        sendInvitationEmail: async (_organizationId, params) => {
            const branding = brandingFor(organization);
            await sendClubEmail(organization, {
                to: params.to,
                subject: subjectInvitacion(branding),
                html: buildInvitationEmail(params, branding, { viaQr: true }),
                kind: 'notificacion',
            });
        },
        getOrganizationPublic: async () => ({
            brand: toPublicOrganizationBrand(organization),
            suspended: false,
        }),
        withOrganization: async (organizationId, fn) => runWithOrganization(organizationId, fn),
        now: () => new Date(),
        frontendUrl: FRONTEND_URL,
        jwtSecret: requireJwtSecret(),
        logError: (error) => console.error('[codigos-qr] Error al enviar el correo de invitación:', error),
    };
}
// Deps para los flujos públicos (sin req.user): el club se resuelve recién
// al leer el token, así que sendInvitationEmail/getOrganizationPublic cargan
// la Organization por id en vez de recibirla ya armada.
function buildPublicDeps() {
    return {
        repo: codigosQrRepoPrisma,
        sendInvitationEmail: async (organizationId, params) => {
            const organization = await loadOrganizationSummary(organizationId);
            if (!organization) {
                throw new Error(`[codigos-qr] No se encontró la organización "${organizationId}" para enviar el correo`);
            }
            const branding = brandingFor(organization);
            await sendClubEmail(organization, {
                to: params.to,
                subject: subjectInvitacion(branding),
                html: buildInvitationEmail(params, branding, { viaQr: true }),
                kind: 'notificacion',
            });
        },
        getOrganizationPublic: async (organizationId) => {
            const org = await prisma.organization.findUnique({
                where: { id: organizationId },
                select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true },
            });
            if (!org)
                return null;
            return { brand: toPublicOrganizationBrand(org), suspended: isOrganizationSuspended(org.status) };
        },
        withOrganization: async (organizationId, fn) => runWithOrganization(organizationId, fn),
        now: () => new Date(),
        frontendUrl: FRONTEND_URL,
        jwtSecret: requireJwtSecret(),
        logError: (error) => console.error('[codigos-qr] Error al enviar el correo de invitación:', error),
    };
}
async function loadOrganizationSummary(organizationId) {
    return prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            id: true,
            slug: true,
            name: true,
            shortName: true,
            membresiaPropia: true,
            alertEmail: true,
            contactName: true,
            contactEmail: true,
            logoObjectKey: true,
        },
    });
}
function toRequester(req) {
    const { id, organizationId, name, rol } = req.user;
    return { id, organizationId, name, rol };
}
function respond(res, result) {
    if (result.ok) {
        res.status(result.status).json(result.body);
        return;
    }
    res.status(result.status).json({ error: result.error });
}
const tokenField = z.string().trim().min(1, 'El token es requerido').max(200, 'Token inválido');
// ─── Endpoints protegidos (ADMIN / LIDER) ──────────────────────────────────────
// POST /api/invitaciones/qr
export async function crearCodigoQr(req, res) {
    try {
        const result = await crearCodigoQrService(buildDeps(req.user.organization), toRequester(req), {
            duracion: req.body?.duracion,
            maxUsos: req.body?.maxUsos,
            etiqueta: req.body?.etiqueta,
        });
        respond(res, result);
    }
    catch (error) {
        console.error('[crearCodigoQr]', error);
        res.status(500).json({ error: 'Error al crear el código QR' });
    }
}
// GET /api/invitaciones/qr
export async function listarCodigosQr(req, res) {
    try {
        const result = await listarCodigosQrService(buildDeps(req.user.organization), toRequester(req));
        respond(res, result);
    }
    catch (error) {
        console.error('[listarCodigosQr]', error);
        res.status(500).json({ error: 'Error al obtener los códigos QR' });
    }
}
// GET /api/invitaciones/qr/:id
export async function verCodigoQr(req, res) {
    try {
        const id = req.params['id'];
        const result = await verCodigoQrService(buildDeps(req.user.organization), toRequester(req), id);
        respond(res, result);
    }
    catch (error) {
        console.error('[verCodigoQr]', error);
        res.status(500).json({ error: 'Error al obtener el código QR' });
    }
}
// POST /api/invitaciones/qr/:id/revocar
export async function revocarCodigoQr(req, res) {
    try {
        const id = req.params['id'];
        const result = await revocarCodigoQrService(buildDeps(req.user.organization), toRequester(req), id);
        respond(res, result);
    }
    catch (error) {
        console.error('[revocarCodigoQr]', error);
        res.status(500).json({ error: 'Error al revocar el código QR' });
    }
}
// ─── Endpoints públicos (montados bajo /api/qr) ────────────────────────────────
// El token siempre viaja en el body, nunca en la URL, para que no quede en
// los logs de acceso — mismo motivo que las invitaciones individuales.
// POST /api/qr/consultar
export async function consultarCodigoQr(req, res) {
    const parsed = tokenField.safeParse(req.body?.token);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Token inválido' });
        return;
    }
    try {
        // Público: el token identifica el código (y su club) por sí solo, sin
        // sesión ni contexto de club previo — corre en contexto de plataforma.
        const result = await runAsPlatform(() => consultarCodigoQrService(buildPublicDeps(), parsed.data));
        respond(res, result);
    }
    catch (error) {
        console.error('[consultarCodigoQr]', error);
        res.status(500).json({ error: 'Error al consultar el código QR' });
    }
}
// POST /api/qr/solicitar
export async function solicitarInvitacionQr(req, res) {
    const parsedToken = tokenField.safeParse(req.body?.token);
    if (!parsedToken.success) {
        res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
        return;
    }
    try {
        // Público: el club del código se resuelve recién adentro del servicio
        // (que abre su propio contexto de tenant para el minteo) — arranca en
        // contexto de plataforma, igual que consultarCodigoQr.
        const result = await runAsPlatform(() => solicitarInvitacionQrService(buildPublicDeps(), parsedToken.data, { email: req.body?.email }));
        respond(res, result);
    }
    catch (error) {
        console.error('[solicitarInvitacionQr]', error);
        res.status(500).json({ error: 'Error al solicitar la invitación' });
    }
}

import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  crearCodigoQr as crearCodigoQrService,
  listarCodigosQr as listarCodigosQrService,
  verCodigoQr as verCodigoQrService,
  revocarCodigoQr as revocarCodigoQrService,
  estadoCodigoQr as estadoCodigoQrService,
  consultarCodigoQr as consultarCodigoQrService,
  solicitarInvitacionQr as solicitarInvitacionQrService,
  registrarConQrDirecto as registrarConQrDirectoService,
  type CodigosQrDeps,
} from '../services/codigos-qr.service.js';
import type { Requester, ServiceResult, AuthProof } from '../services/invitaciones.service.js';
import { verifiedEmailFromAuthHeader } from '../lib/verified-email.js';
import { codigosQrRepoPrisma } from '../services/codigos-qr.repo.prisma.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildInvitationEmail, brandingFor } from '../lib/email-templates.js';
import { subjectInvitacion } from '../lib/email/subjects.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { FRONTEND_URL } from '../lib/config.js';
import { requireJwtSecret } from '../lib/jwt.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { prisma } from '../lib/prisma.js';
import { isOrganizationSuspended } from '../lib/organization-status.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';
import type { OrganizationSummary } from '../types/index.js';

// Cableado real: repositorio Prisma y reloj real. El envío de correo se arma
// por request porque el club de quien invita (por QR, cualquiera puede
// resolverlo recién al leer el token) nunca es fijo a nivel de módulo — mismo
// motivo que buildDeps en invitaciones.controller.ts.
function buildDeps(organization: OrganizationSummary): CodigosQrDeps {
  return {
    repo: codigosQrRepoPrisma,
    sendInvitationEmail: async (_organizationId, params) => {
      const branding = brandingFor(organization);
      await sendClubEmail(organization, {
        to: params.to,
        subject: subjectInvitacion(branding),
        html: buildInvitationEmail(params, branding, { viaQr: true, existingAccount: params.existingAccount }),
        kind: 'notificacion',
      });
    },
    getOrganizationPublic: async () => ({
      brand: toPublicOrganizationBrand(organization),
      suspended: false,
    }),
    withOrganization: async (organizationId, fn) => runWithOrganization(organizationId, fn),
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Comparación de tiempo constante contra un hash ya guardado — la usa la
    // rama de "cuenta existente" de registrarConQrDirecto (buildPublicDeps
    // más abajo). Se cablea acá también por uniformidad: CodigosQrDeps es
    // una sola interfaz para ambos conjuntos de deps.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
    jwtSecret: requireJwtSecret(),
    logError: (error) => console.error('[codigos-qr] Error al enviar el correo de invitación:', error),
  };
}

// Deps para los flujos públicos (sin req.user): el club se resuelve recién
// al leer el token, así que sendInvitationEmail/getOrganizationPublic cargan
// la Organization por id en vez de recibirla ya armada.
function buildPublicDeps(): CodigosQrDeps {
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
        html: buildInvitationEmail(params, branding, { viaQr: true, existingAccount: params.existingAccount }),
        kind: 'notificacion',
      });
    },
    getOrganizationPublic: async (organizationId) => {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true },
      });
      if (!org) return null;
      return { brand: toPublicOrganizationBrand(org), suspended: isOrganizationSuspended(org.status) };
    },
    withOrganization: async (organizationId, fn) => runWithOrganization(organizationId, fn),
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Prueba de titularidad de una cuenta existente (registrarConQrDirecto)
    // — ver verificarPruebaDeCuentaExistente en invitaciones.service.ts.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
    jwtSecret: requireJwtSecret(),
    logError: (error) => console.error('[codigos-qr] Error al enviar el correo de invitación:', error),
  };
}

async function loadOrganizationSummary(organizationId: string): Promise<OrganizationSummary | null> {
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

function toRequester(req: Request): Requester {
  const { id, organizationId, name, rol } = req.user!;
  return { id, organizationId, name, rol };
}

function respond<T>(res: Response, result: ServiceResult<T>): void {
  if (result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json({ error: result.error });
}

const tokenField = z.string().trim().min(1, 'El token es requerido').max(200, 'Token inválido');

// ─── Endpoints protegidos (ADMIN / LIDER) ──────────────────────────────────────

// POST /api/invitaciones/qr
export async function crearCodigoQr(req: Request, res: Response): Promise<void> {
  try {
    const result = await crearCodigoQrService(buildDeps(req.user!.organization), toRequester(req), {
      modo: req.body?.modo,
      duracion: req.body?.duracion,
      maxUsos: req.body?.maxUsos,
      etiqueta: req.body?.etiqueta,
    });
    respond(res, result);
  } catch (error) {
    console.error('[crearCodigoQr]', error);
    res.status(500).json({ error: 'Error al crear el código QR' });
  }
}

// GET /api/invitaciones/qr
export async function listarCodigosQr(req: Request, res: Response): Promise<void> {
  try {
    const result = await listarCodigosQrService(buildDeps(req.user!.organization), toRequester(req));
    respond(res, result);
  } catch (error) {
    console.error('[listarCodigosQr]', error);
    res.status(500).json({ error: 'Error al obtener los códigos QR' });
  }
}

// GET /api/invitaciones/qr/:id
export async function verCodigoQr(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await verCodigoQrService(buildDeps(req.user!.organization), toRequester(req), id);
    respond(res, result);
  } catch (error) {
    console.error('[verCodigoQr]', error);
    res.status(500).json({ error: 'Error al obtener el código QR' });
  }
}

// POST /api/invitaciones/qr/:id/revocar
export async function revocarCodigoQr(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await revocarCodigoQrService(buildDeps(req.user!.organization), toRequester(req), id);
    respond(res, result);
  } catch (error) {
    console.error('[revocarCodigoQr]', error);
    res.status(500).json({ error: 'Error al revocar el código QR' });
  }
}

// GET /api/invitaciones/qr/:id/estado — lo que polea la pantalla de quien
// generó un QR directo, esperando a que alguien lo escanee.
export async function estadoCodigoQr(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await estadoCodigoQrService(buildDeps(req.user!.organization), toRequester(req), id);
    respond(res, result);
  } catch (error) {
    console.error('[estadoCodigoQr]', error);
    res.status(500).json({ error: 'Error al consultar el estado del código QR' });
  }
}

// ─── Endpoints públicos (montados bajo /api/qr) ────────────────────────────────
// El token siempre viaja en el body, nunca en la URL, para que no quede en
// los logs de acceso — mismo motivo que las invitaciones individuales.

// POST /api/qr/consultar
export async function consultarCodigoQr(req: Request, res: Response): Promise<void> {
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
  } catch (error) {
    console.error('[consultarCodigoQr]', error);
    res.status(500).json({ error: 'Error al consultar el código QR' });
  }
}

// POST /api/qr/solicitar
export async function solicitarInvitacionQr(req: Request, res: Response): Promise<void> {
  const parsedToken = tokenField.safeParse(req.body?.token);
  if (!parsedToken.success) {
    res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el club del código se resuelve recién adentro del servicio
    // (que abre su propio contexto de tenant para el minteo) — arranca en
    // contexto de plataforma, igual que consultarCodigoQr.
    const result = await runAsPlatform(() =>
      solicitarInvitacionQrService(buildPublicDeps(), parsedToken.data, { email: req.body?.email }),
    );
    respond(res, result);
  } catch (error) {
    console.error('[solicitarInvitacionQr]', error);
    res.status(500).json({ error: 'Error al solicitar la invitación' });
  }
}

// POST /api/qr/registrar — contraparte DIRECTO de solicitarInvitacionQr: da
// de alta la cuenta en el acto (o une una cuenta existente), sin correo de
// por medio.
export async function registrarConQrDirecto(req: Request, res: Response): Promise<void> {
  const parsedToken = tokenField.safeParse(req.body?.token);
  if (!parsedToken.success) {
    res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el usuario nuevo (o la Membresia nueva) hereda el
    // organizationId del QR, no de ningún contexto previo — corre en
    // contexto de plataforma, igual que aceptar una invitación individual.
    const auth: AuthProof = { verifiedEmail: verifiedEmailFromAuthHeader(req) };
    const result = await runAsPlatform(() =>
      registrarConQrDirectoService(
        buildPublicDeps(),
        parsedToken.data,
        { name: req.body?.name, email: req.body?.email, password: req.body?.password },
        auth,
      ),
    );
    respond(res, result);
  } catch (error) {
    console.error('[registrarConQrDirecto]', error);
    res.status(500).json({ error: 'Error al registrar la cuenta' });
  }
}

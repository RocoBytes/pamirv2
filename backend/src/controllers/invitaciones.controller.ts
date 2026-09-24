import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  crearInvitacion as crearInvitacionService,
  listarInvitaciones as listarInvitacionesService,
  revocarInvitacion as revocarInvitacionService,
  reenviarInvitacion as reenviarInvitacionService,
  consultarInvitacion as consultarInvitacionService,
  aceptarInvitacion as aceptarInvitacionService,
  type InvitacionesDeps,
  type Requester,
  type ServiceResult,
  type AuthProof,
} from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import { verifiedEmailFromAuthHeader } from '../lib/verified-email.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildInvitationEmail, brandingFor } from '../lib/email-templates.js';
import { subjectInvitacion } from '../lib/email/subjects.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { FRONTEND_URL } from '../lib/config.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import { prisma } from '../lib/prisma.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';
import type { OrganizationSummary } from '../types/index.js';

// Cableado real: repositorio Prisma, bcrypt y reloj real. El envío de correo
// se arma por request (ver buildDeps) porque necesita el club de quien invita
// — nunca un club fijo a nivel de módulo.
function buildDeps(organization: OrganizationSummary): InvitacionesDeps {
  return {
    repo: invitacionesRepoPrisma,
    sendEmail: async (params) => {
      const branding = brandingFor(organization);
      await sendClubEmail(organization, {
        to: params.to,
        subject: subjectInvitacion(branding),
        html: buildInvitationEmail(params, branding, { existingAccount: params.existingAccount }),
        kind: 'notificacion',
      });
    },
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Comparación de tiempo constante contra un hash ya guardado — la usa la
    // rama de "cuenta existente" de aceptarInvitacion (buildPublicDeps más
    // abajo). Se cablea acá también por uniformidad: InvitacionesDeps es una
    // sola interfaz para ambos conjuntos de deps.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
  };
}

// Deps para los flujos públicos (sin req.user) que nunca invocan sendEmail:
// un stub ruidoso evita que un cambio futuro en el servicio termine enviando
// un correo sin saber a nombre de qué club.
function buildPublicDeps(): InvitacionesDeps {
  return {
    repo: invitacionesRepoPrisma,
    sendEmail: async () => {
      throw new Error('[invitaciones] sendEmail no debe invocarse en un flujo público sin club conocido');
    },
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Prueba de titularidad de una cuenta existente (aceptarInvitacion) —
    // ver verificarPruebaDeCuentaExistente en invitaciones.service.ts.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: FRONTEND_URL,
    // Se llama dentro del runAsPlatform que ya envuelve a consultarInvitacion
    // (ver consultarInvitacion abajo), así que puede resolver el club de
    // CUALQUIERA de los dos clubes, no solo el de una sesión activa.
    getOrganizationBrand: async (organizationId) => {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, name: true, shortName: true, logoObjectKey: true },
      });
      return org ? toPublicOrganizationBrand(org) : null;
    },
  };
}

function toRequester(req: Request): Requester {
  const { id, organizationId, name, rol } = req.user!;
  return { id, organizationId, name, rol };
}

// Los controladores solo mapean el resultado discriminado del servicio a la
// respuesta HTTP; toda la lógica vive en invitaciones.service.ts.
function respond<T>(res: Response, result: ServiceResult<T>): void {
  if (result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json({ error: result.error });
}

const tokenField = z.string().trim().min(1, 'El token es requerido').max(200, 'Token inválido');

// ─── Endpoints protegidos (ADMIN / LIDER) ──────────────────────────────────────

// POST /api/invitaciones
export async function crearInvitacion(req: Request, res: Response): Promise<void> {
  try {
    const result = await crearInvitacionService(buildDeps(req.user!.organization), toRequester(req), {
      email: req.body?.email,
      rol: req.body?.rol,
    });
    respond(res, result);
  } catch (error) {
    console.error('[crearInvitacion]', error);
    res.status(500).json({ error: 'Error al crear la invitación' });
  }
}

// GET /api/invitaciones
export async function listarInvitaciones(req: Request, res: Response): Promise<void> {
  try {
    const result = await listarInvitacionesService(buildDeps(req.user!.organization), toRequester(req));
    respond(res, result);
  } catch (error) {
    console.error('[listarInvitaciones]', error);
    res.status(500).json({ error: 'Error al obtener las invitaciones' });
  }
}

// POST /api/invitaciones/:id/revocar
export async function revocarInvitacion(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await revocarInvitacionService(buildDeps(req.user!.organization), toRequester(req), id);
    respond(res, result);
  } catch (error) {
    console.error('[revocarInvitacion]', error);
    res.status(500).json({ error: 'Error al revocar la invitación' });
  }
}

// POST /api/invitaciones/:id/reenviar
export async function reenviarInvitacion(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await reenviarInvitacionService(buildDeps(req.user!.organization), toRequester(req), id);
    respond(res, result);
  } catch (error) {
    console.error('[reenviarInvitacion]', error);
    res.status(500).json({ error: 'Error al reenviar la invitación' });
  }
}

// ─── Endpoints públicos (montados bajo /api/auth) ─────────────────────────────
// El token siempre viaja en el body, nunca en la URL, para que no quede en
// los logs de acceso.

// POST /api/auth/invitaciones/consultar
export async function consultarInvitacion(req: Request, res: Response): Promise<void> {
  const parsed = tokenField.safeParse(req.body?.token);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el token identifica la invitación (y su club) por sí solo, sin
    // sesión ni contexto de club previo — corre en contexto de plataforma.
    const result = await runAsPlatform(() => consultarInvitacionService(buildPublicDeps(), parsed.data));
    respond(res, result);
  } catch (error) {
    console.error('[consultarInvitacion]', error);
    res.status(500).json({ error: 'Error al consultar la invitación' });
  }
}

// POST /api/auth/invitaciones/aceptar
export async function aceptarInvitacion(req: Request, res: Response): Promise<void> {
  const parsedToken = tokenField.safeParse(req.body?.token);
  if (!parsedToken.success) {
    res.status(400).json({ error: parsedToken.error.issues[0]?.message ?? 'Token inválido' });
    return;
  }
  try {
    // Público: el usuario nuevo (o la Membresia nueva, si la cuenta ya
    // existe) hereda el organizationId de la invitación, no de ningún
    // contexto previo — corre en contexto de plataforma. Un Bearer válido
    // (ver lib/verified-email.ts) es la prueba de titularidad para PR 4's
    // pantalla; el servicio nunca decodifica el token él mismo, solo recibe
    // el email YA verificado.
    const auth: AuthProof = { verifiedEmail: verifiedEmailFromAuthHeader(req) };
    const result = await runAsPlatform(() =>
      aceptarInvitacionService(
        buildPublicDeps(),
        parsedToken.data,
        { name: req.body?.name, password: req.body?.password },
        auth,
      ),
    );
    respond(res, result);
  } catch (error) {
    console.error('[aceptarInvitacion]', error);
    res.status(500).json({ error: 'Error al aceptar la invitación' });
  }
}

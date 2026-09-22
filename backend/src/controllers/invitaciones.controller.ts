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
} from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import { sendEmail as enviarCorreoGmail } from '../lib/google-gmail.js';
import { buildInvitationEmail } from '../lib/email-templates.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { runAsPlatform } from '../lib/tenant-context.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Cableado real: repositorio Prisma, envío de correo (HTML construido acá,
// fuera del servicio), bcrypt y reloj real.
const deps: InvitacionesDeps = {
  repo: invitacionesRepoPrisma,
  sendEmail: async (params) => {
    await enviarCorreoGmail(params.to, 'Te invitaron a Pamir', buildInvitationEmail(params));
  },
  hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
  now: () => new Date(),
  frontendUrl: FRONTEND_URL,
};

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
    const result = await crearInvitacionService(deps, toRequester(req), {
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
    const result = await listarInvitacionesService(deps, toRequester(req));
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
    const result = await revocarInvitacionService(deps, toRequester(req), id);
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
    const result = await reenviarInvitacionService(deps, toRequester(req), id);
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
    const result = await runAsPlatform(() => consultarInvitacionService(deps, parsed.data));
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
    // Público: el usuario nuevo hereda el organizationId de la invitación, no
    // de ningún contexto previo — corre en contexto de plataforma.
    const result = await runAsPlatform(() =>
      aceptarInvitacionService(deps, parsedToken.data, {
        name: req.body?.name,
        password: req.body?.password,
      }),
    );
    respond(res, result);
  } catch (error) {
    console.error('[aceptarInvitacion]', error);
    res.status(500).json({ error: 'Error al aceptar la invitación' });
  }
}

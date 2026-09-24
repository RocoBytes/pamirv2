import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { isAdmin, canInvite } from '../lib/authz.js';
import { categoriasGestionadas } from '../lib/gestores-eventos.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { isOrganizationSuspended, CLUB_SUSPENDIDO_MENSAJE } from '../lib/organization-status.js';
import { xClubHeader } from '../lib/x-club.js';

// Campos de Organization que arma req.user.organization (OrganizationSummary,
// ver types/index.ts), más "status", que solo se usa acá para el chequeo de
// suspensión y nunca se copia al objeto final.
const ORGANIZATION_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  status: true,
  membresiaPropia: true,
  alertEmail: true,
  contactName: true,
  contactEmail: true,
  logoObjectKey: true,
} as const;

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { userId } = verifyToken(token);
    // La cuenta (User) es global desde este PR — ver scope-args.ts — así que
    // se busca por id en contexto de plataforma, junto con TODAS sus
    // membresías. El club activo se resuelve aparte, abajo: X-Club decide
    // CUÁL de las membresías de la cuenta usar, nunca otorga pertenencia por
    // sí solo (la pertenencia ya la prueba que exista la Membresia).
    const user = await runAsPlatform(() =>
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          membresias: {
            orderBy: { creadoAt: 'asc' },
            include: { organization: { select: ORGANIZATION_SELECT } },
          },
        },
      }),
    );

    if (!user) {
      req.user = null;
      next();
      return;
    }

    const membresias = user.membresias;
    const xClub = xClubHeader(req);

    let activa: (typeof membresias)[number] | undefined;

    if (xClub !== undefined) {
      activa = membresias.find((m) => m.organization.slug === xClub);
      if (!activa) {
        // Se distingue "el club no existe" de "existe pero no soy socio" sin
        // filtrar más que eso — ver la tabla de errores del diseño multi-club.
        const orgExiste = await runAsPlatform(() =>
          prisma.organization.findUnique({ where: { slug: xClub }, select: { id: true } }),
        );
        res.status(orgExiste ? 403 : 404).json({
          error: orgExiste ? 'No perteneces a este club' : 'Club no encontrado',
        });
        return;
      }
    } else if (membresias.length === 1) {
      // Regla de transición: sin X-Club y con una sola membresía, se usa
      // esa — así un frontend que todavía no envía el header (el único que
      // existe en este PR) sigue funcionando exactamente igual que antes.
      activa = membresias[0];
    } else {
      // Cero o varias membresías sin X-Club: nada que asumir con seguridad.
      // (Una cuenta con cero membresías no puede existir hoy — ver el
      // diseño — así que en la práctica esto es siempre "varias".)
      res.status(400).json({ error: 'Selecciona un club' });
      return;
    }

    if (isOrganizationSuspended(activa.organization.status)) {
      res.status(403).json({ error: CLUB_SUSPENDIDO_MENSAJE });
      return;
    }

    req.user = {
      id: user.id,
      organizationId: activa.organization.id,
      email: user.email,
      name: user.name,
      rol: activa.rol,
      // Resumen cargado una sola vez acá: los controladores lo leen de
      // req.user.organization en vez de volver a consultar Organization.
      organization: {
        id: activa.organization.id,
        slug: activa.organization.slug,
        name: activa.organization.name,
        shortName: activa.organization.shortName,
        membresiaPropia: activa.organization.membresiaPropia,
        alertEmail: activa.organization.alertEmail,
        contactName: activa.organization.contactName,
        contactEmail: activa.organization.contactEmail,
        logoObjectKey: activa.organization.logoObjectKey,
      },
    };
    // Todo lo que siga en la cadena de middlewares/handler corre dentro del
    // contexto del club ACTIVO (no necesariamente el "primario" de User): es
    // lo que hace que prisma.ts filtre automáticamente cada consulta de este
    // request por su organizationId.
    runWithOrganization(activa.organization.id, () => next());
  } catch {
    req.user = null;
    next();
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Autenticación requerida' });
    return;
  }
  next();
}

// Autorización por columna rol: promover o degradar a un administrador es un
// UPDATE en la base de datos (o `npm run db:create-user -- ... --rol ADMIN
// --force`), sin redeploy.
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: 'Acceso restringido al administrador' });
    return;
  }
  next();
}

// Sistema cerrado: solo ADMIN y LIDER pueden invitar cuentas nuevas (un LIDER
// solo puede invitar SOCIOS — ver lib/invitaciones.ts).
export function requireCanInvite(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!canInvite(req.user)) {
    res.status(403).json({ error: 'No tienes permiso para invitar' });
    return;
  }
  next();
}

// Gestión de eventos por categoría: el ADMIN pasa siempre (gestorCategoriaIds
// null = sin restricción); un LIDER gestiona todas las categorías del club;
// cualquier otro gestor pasa con sus categorías asignadas en
// req.gestorCategoriaIds. Asignar un gestor no-LIDER es un INSERT en
// gestores_categoria (ver lib/gestores-eventos.ts).
export async function requireGestorEventos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(403).json({ error: 'Acceso restringido a gestores de eventos' });
    return;
  }
  if (isAdmin(req.user)) {
    req.gestorCategoriaIds = null;
    return next();
  }

  try {
    const categorias = await categoriasGestionadas(req.user);
    if (categorias.length === 0) {
      res.status(403).json({ error: 'Acceso restringido a gestores de eventos' });
      return;
    }
    req.gestorCategoriaIds = categorias.map((c) => c.categoriaId);
    next();
  } catch (error) {
    console.error('[requireGestorEventos]', error);
    res.status(500).json({ error: 'Error de autorización' });
  }
}

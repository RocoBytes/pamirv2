import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { isAdmin, canInvite } from '../lib/authz.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { isOrganizationSuspended, CLUB_SUSPENDIDO_MENSAJE } from '../lib/organization-status.js';

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
    // La cuenta se busca por id en todo el sistema (no se sabe todavía a qué
    // club pertenece), así que este findUnique corre en contexto de plataforma.
    const user = await runAsPlatform(() =>
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          organization: {
            select: {
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
            },
          },
        },
      }),
    );

    if (!user) {
      req.user = null;
      next();
      return;
    }

    if (isOrganizationSuspended(user.organization.status)) {
      res.status(403).json({ error: CLUB_SUSPENDIDO_MENSAJE });
      return;
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      rol: user.rol,
      // Resumen cargado una sola vez acá: los controladores lo leen de
      // req.user.organization en vez de volver a consultar Organization.
      organization: {
        id: user.organization.id,
        slug: user.organization.slug,
        name: user.organization.name,
        shortName: user.organization.shortName,
        membresiaPropia: user.organization.membresiaPropia,
        alertEmail: user.organization.alertEmail,
        contactName: user.organization.contactName,
        contactEmail: user.organization.contactEmail,
        logoObjectKey: user.organization.logoObjectKey,
      },
    };
    // Todo lo que siga en la cadena de middlewares/handler corre dentro del
    // contexto del club del usuario: es lo que hace que prisma.ts filtre
    // automáticamente cada consulta de este request por su organizationId.
    runWithOrganization(user.organizationId, () => next());
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
// null = sin restricción); un gestor pasa con sus categorías asignadas en
// req.gestorCategoriaIds. Asignar un gestor es un INSERT en gestores_categoria.
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
    const filas = await prisma.gestorCategoria.findMany({
      where: { usuarioId: req.user.id },
      select: { categoriaId: true },
    });
    if (filas.length === 0) {
      res.status(403).json({ error: 'Acceso restringido a gestores de eventos' });
      return;
    }
    req.gestorCategoriaIds = filas.map((f) => f.categoriaId);
    next();
  } catch (error) {
    console.error('[requireGestorEventos]', error);
    res.status(500).json({ error: 'Error de autorización' });
  }
}

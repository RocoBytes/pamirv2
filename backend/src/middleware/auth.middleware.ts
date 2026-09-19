import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { ADMIN_EMAIL } from '../lib/constants.js';

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const { userId } = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: userId } });

    req.user = user ? { id: user.id, email: user.email, name: user.name, rol: user.rol } : null;
  } catch {
    req.user = null;
  }

  next();
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

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: 'Acceso restringido al administrador' });
    return;
  }
  next();
}

// Autorización por columna rol (módulo de eventos): promover a un nuevo
// administrador es un UPDATE en la base de datos, sin redeploy.
export function requireRolAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.rol !== 'ADMIN') {
    res.status(403).json({ error: 'Acceso restringido al administrador' });
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
  if (req.user.rol === 'ADMIN') {
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

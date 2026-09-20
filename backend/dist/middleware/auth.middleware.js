import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { isAdmin, canInvite } from '../lib/authz.js';
export async function authMiddleware(req, _res, next) {
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
    }
    catch {
        req.user = null;
    }
    next();
}
export function requireAuth(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Autenticación requerida' });
        return;
    }
    next();
}
// Autorización por columna rol: promover o degradar a un administrador es un
// UPDATE en la base de datos (o `npm run db:create-user -- ... --rol ADMIN
// --force`), sin redeploy.
export function requireAdmin(req, res, next) {
    if (!isAdmin(req.user)) {
        res.status(403).json({ error: 'Acceso restringido al administrador' });
        return;
    }
    next();
}
// Sistema cerrado: solo ADMIN y LIDER pueden invitar cuentas nuevas (un LIDER
// solo puede invitar SOCIOS — ver lib/invitaciones.ts).
export function requireCanInvite(req, res, next) {
    if (!canInvite(req.user)) {
        res.status(403).json({ error: 'No tienes permiso para invitar' });
        return;
    }
    next();
}
// Gestión de eventos por categoría: el ADMIN pasa siempre (gestorCategoriaIds
// null = sin restricción); un gestor pasa con sus categorías asignadas en
// req.gestorCategoriaIds. Asignar un gestor es un INSERT en gestores_categoria.
export async function requireGestorEventos(req, res, next) {
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
    }
    catch (error) {
        console.error('[requireGestorEventos]', error);
        res.status(500).json({ error: 'Error de autorización' });
    }
}

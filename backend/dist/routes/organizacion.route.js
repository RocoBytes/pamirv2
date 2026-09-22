import { Router } from 'express';
import { authMiddleware, requireAuth, requireAdmin } from '../middleware/auth.middleware.js';
import { uploadOrganizacionLogo, deleteOrganizacionLogo } from '../controllers/organizacion.controller.js';
const router = Router();
// Todo el módulo exige sesión de administrador — solo el club dueño de la
// sesión puede tocar su propio logo (ver scope-args.ts: la extensión de
// Prisma fija cualquier Organization.update al club del contexto vigente).
router.use(authMiddleware, requireAuth);
router.post('/logo', requireAdmin, uploadOrganizacionLogo);
router.delete('/logo', requireAdmin, deleteOrganizacionLogo);
export default router;

import { Router } from 'express';
import { authMiddleware, requireAuth, requireCanInvite } from '../middleware/auth.middleware.js';
import { crearInvitacion, listarInvitaciones, revocarInvitacion, reenviarInvitacion, } from '../controllers/invitaciones.controller.js';
const router = Router();
// Sistema cerrado: solo ADMIN y LIDER pueden invitar (un LIDER solo a SOCIOS).
router.use(authMiddleware, requireAuth, requireCanInvite);
router.post('/', crearInvitacion);
router.get('/', listarInvitaciones);
router.post('/:id/revocar', revocarInvitacion);
router.post('/:id/reenviar', reenviarInvitacion);
export default router;

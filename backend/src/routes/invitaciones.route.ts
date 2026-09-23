import { Router } from 'express';
import { authMiddleware, requireAuth, requireCanInvite } from '../middleware/auth.middleware.js';
import {
  crearInvitacion,
  listarInvitaciones,
  revocarInvitacion,
  reenviarInvitacion,
} from '../controllers/invitaciones.controller.js';
import {
  crearCodigoQr,
  listarCodigosQr,
  verCodigoQr,
  revocarCodigoQr,
  estadoCodigoQr,
} from '../controllers/codigos-qr.controller.js';

const router = Router();

// Sistema cerrado: solo ADMIN y LIDER pueden invitar (un LIDER solo a SOCIOS).
router.use(authMiddleware, requireAuth, requireCanInvite);

// Rutas del QR reusable del club, declaradas ANTES de "/:id/..." para que
// nunca puedan quedar bajo su sombra si esas rutas cambian de forma.
router.post('/qr', crearCodigoQr);
router.get('/qr', listarCodigosQr);
router.get('/qr/:id', verCodigoQr);
router.post('/qr/:id/revocar', revocarCodigoQr);
// Poleado por el panel de "QR directo" mientras espera un escaneo — exento
// del limitador general de /api/invitaciones (ver app.ts) para no ahogar el
// polling de un evento con mucha gente registrándose a la vez.
router.get('/qr/:id/estado', estadoCodigoQr);

router.post('/', crearInvitacion);
router.get('/', listarInvitaciones);
router.post('/:id/revocar', revocarInvitacion);
router.post('/:id/reenviar', reenviarInvitacion);

export default router;

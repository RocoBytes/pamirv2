import { Router } from 'express';
import {
  verifyEmail,
  login,
  forgotPassword,
  resetPassword,
} from '../controllers/auth.controller.js';
import { consultarInvitacion, aceptarInvitacion } from '../controllers/invitaciones.controller.js';

const router = Router();

router.get('/verify/:token', verifyEmail);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Públicos (sistema cerrado): el token de invitación viaja en el body, nunca
// en la URL, para que no quede en los logs de acceso.
router.post('/invitaciones/consultar', consultarInvitacion);
router.post('/invitaciones/aceptar', aceptarInvitacion);

export default router;

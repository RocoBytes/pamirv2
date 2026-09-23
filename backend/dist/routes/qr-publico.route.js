import { Router } from 'express';
import { consultarCodigoQr, solicitarInvitacionQr } from '../controllers/codigos-qr.controller.js';
const router = Router();
// Público (sin sesión): quien escanea un QR proyectado o impreso consulta la
// marca del club y pide su propia invitación. Fuera de /api/auth a propósito
// (no es un flujo de autenticación en sí, es el punto de entrada al sistema
// cerrado por invitación) — con su propio límite de tasa por token, ver
// lib/rate-limits.ts.
router.post('/consultar', consultarCodigoQr);
router.post('/solicitar', solicitarInvitacionQr);
export default router;

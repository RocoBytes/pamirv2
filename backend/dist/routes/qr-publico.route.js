import { Router } from 'express';
import { consultarCodigoQr, solicitarInvitacionQr, registrarConQrDirecto } from '../controllers/codigos-qr.controller.js';
const router = Router();
// Público (sin sesión): quien escanea un QR proyectado o impreso consulta la
// marca del club y pide su propia invitación. Fuera de /api/auth a propósito
// (no es un flujo de autenticación en sí, es el punto de entrada al sistema
// cerrado por invitación) — con su propio límite de tasa por token, ver
// lib/rate-limits.ts.
router.post('/consultar', consultarCodigoQr);
router.post('/solicitar', solicitarInvitacionQr);
// Contraparte de un QR en modo DIRECTO: da de alta la cuenta en el acto, sin
// paso de correo — mismo límite de tasa por token que /solicitar, más un
// tope propio (ver lib/rate-limits.ts y app.ts).
router.post('/registrar', registrarConQrDirecto);
export default router;

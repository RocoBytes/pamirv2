import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { createIntegrante, getIntegranteByRut, getMyIntegrante } from '../controllers/integrantes.controller.js';

const router = Router();

router.use(authMiddleware);

// Verificar si el usuario logueado tiene ficha de integrante (por email)
router.get('/me', requireAuth, getMyIntegrante);

// Buscar por RUT exacto (para el picker del wizard)
router.get('/by-rut/:rut', getIntegranteByRut);

// Crear integrante (formulario de registro) — requiere autenticación
router.post('/', requireAuth, createIntegrante);

export default router;

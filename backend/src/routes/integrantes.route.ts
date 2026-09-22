import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { createIntegrante, getIntegranteByRut, getMyIntegrante } from '../controllers/integrantes.controller.js';

const router = Router();

// Sistema cerrado: ninguna ruta de integrantes admite acceso anónimo.
router.use(authMiddleware, requireAuth);

// Verificar si el usuario logueado tiene ficha de integrante (por email)
router.get('/me', getMyIntegrante);

// Buscar por RUT exacto (para el picker del wizard)
router.get('/by-rut/:rut', getIntegranteByRut);

// Crear integrante (formulario de registro)
router.post('/', createIntegrante);

export default router;

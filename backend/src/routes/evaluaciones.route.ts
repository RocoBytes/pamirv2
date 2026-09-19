import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { getEvaluacion, submitEvaluacion, getResultados } from '../controllers/evaluaciones.controller.js';

const router = Router();

// Resultados: solo admin (el check de email está en el controller)
router.get('/resultados/:salidaId', authMiddleware, requireAuth, getResultados);

// Formulario anónimo: rutas públicas protegidas por el token de un solo uso
router.get('/:token', getEvaluacion);
router.post('/:token', submitEvaluacion);

export default router;

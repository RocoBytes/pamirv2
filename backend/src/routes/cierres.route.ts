import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { createCierre, getCierres } from '../controllers/cierres.controller.js';

const router = Router();

// Sistema cerrado: ninguna ruta de cierres admite acceso anónimo.
router.use(authMiddleware, requireAuth);

router.get('/', getCierres);
router.post('/', createCierre);

export default router;

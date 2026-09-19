import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { createCierre, getCierres } from '../controllers/cierres.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/', getCierres);
router.post('/', requireAuth, createCierre);

export default router;

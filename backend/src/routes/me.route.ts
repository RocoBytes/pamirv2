import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { getMe } from '../controllers/auth.controller.js';

const router = Router();

router.use(authMiddleware, requireAuth);

router.get('/', getMe);

export default router;

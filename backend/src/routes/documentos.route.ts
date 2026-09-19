import { Router } from 'express';
import { authMiddleware, requireAuth, requireAdmin } from '../middleware/auth.middleware.js';
import {
  getDocumentos,
  getDocumentosAdmin,
  createDocumento,
  deleteDocumento,
} from '../controllers/documentos.controller.js';

const router = Router();

router.get('/', authMiddleware, requireAuth, getDocumentos);
router.get('/admin', authMiddleware, requireAuth, requireAdmin, getDocumentosAdmin);
router.post('/', authMiddleware, requireAuth, requireAdmin, createDocumento);
router.delete('/:id', authMiddleware, requireAuth, requireAdmin, deleteDocumento);

export default router;

import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { uploadGpx, uploadPronostico } from '../controllers/upload.controller.js';

const router = Router();

// Sistema cerrado: ninguna ruta de subida admite acceso anónimo.
router.use(authMiddleware, requireAuth);

/**
 * POST /api/salidas/:id/gpx
 * Multipart/form-data con campo "file" conteniendo el archivo .gpx.
 * Máximo 15 MB. Subida mediante Resumable Upload a Google Drive.
 */
router.post('/:id/gpx', uploadGpx);
router.post('/:id/pronostico', uploadPronostico);

export default router;

import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import {
  createSalida,
  getSalidas,
  getSalidaById,
  updateSalida,
  updateSalidaIntegrantes,
  deleteSalida,
  getSalidaArchivoUrl,
} from '../controllers/salidas.controller.js';

const router = Router();

// Sistema cerrado: ninguna ruta de salidas admite acceso anónimo.
router.use(authMiddleware, requireAuth);

router.post('/', createSalida);
router.get('/', getSalidas);
router.get('/:id', getSalidaById);
router.put('/:id', updateSalida);
router.put('/:id/integrantes', updateSalidaIntegrantes);
router.get('/:id/archivos/:tipo/url', getSalidaArchivoUrl);
router.delete('/:id', deleteSalida);

export default router;

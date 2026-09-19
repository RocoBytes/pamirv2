import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  createSalida,
  getSalidas,
  getSalidaById,
  updateSalida,
  updateSalidaIntegrantes,
  deleteSalida,
  claimSalida,
} from '../controllers/salidas.controller.js';

const router = Router();

// authMiddleware verifica el Google ID Token y popula req.user.
// Las rutas de salidas permiten acceso a invitados (req.user = null).
router.use(authMiddleware);

router.post('/', createSalida);
router.get('/', getSalidas);
router.get('/:id', getSalidaById);
router.patch('/:id/claim', claimSalida);
router.put('/:id', updateSalida);
router.put('/:id/integrantes', updateSalidaIntegrantes);
router.delete('/:id', deleteSalida);

export default router;

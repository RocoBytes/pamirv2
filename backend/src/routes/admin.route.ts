import { Router } from 'express';
import { authMiddleware, requireAuth, requireAdmin } from '../middleware/auth.middleware.js';
import {
  getStats,
  getDashboard,
  getSaludSalida,
  enviarSaludSalida,
  getDashboardLayout,
  saveDashboardLayout,
  deleteDashboardLayout,
  getGoogleCredencial,
  saveGoogleCredencial,
} from '../controllers/admin.controller.js';

const router = Router();

// All admin endpoints require an authenticated admin user
router.use(authMiddleware, requireAuth, requireAdmin);

router.get('/stats', getStats);
router.get('/dashboard', getDashboard);
router.get('/dashboard-layout', getDashboardLayout);
router.put('/dashboard-layout', saveDashboardLayout);
router.delete('/dashboard-layout', deleteDashboardLayout);
router.get('/salidas/:id/salud', getSaludSalida);
router.post('/salidas/:id/enviar-salud', enviarSaludSalida);
router.get('/google-credencial', getGoogleCredencial);
router.put('/google-credencial', saveGoogleCredencial);

export default router;

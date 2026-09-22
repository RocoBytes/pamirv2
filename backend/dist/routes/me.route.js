import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth.middleware.js';
import { getMe } from '../controllers/auth.controller.js';
import { getNavPreferences, saveNavPreferences, deleteNavPreferences, } from '../controllers/nav-prefs.controller.js';
const router = Router();
router.use(authMiddleware, requireAuth);
router.get('/', getMe);
// Preferencias de navegación: cuelgan de /me y no de /admin porque son de cada
// socio, no del club. Cualquier sesión válida puede leer y escribir la suya, y
// nunca la de otro: el userId sale del token, jamás del cuerpo del pedido.
router.get('/nav-preferences', getNavPreferences);
router.put('/nav-preferences', saveNavPreferences);
router.delete('/nav-preferences', deleteNavPreferences);
export default router;

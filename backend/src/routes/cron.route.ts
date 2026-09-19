import { Router } from 'express';
import { checkAlertas } from '../controllers/cron.controller.js';

const router = Router();

// GET /api/cron/check-alertas?secret=<CRON_SECRET>
// No auth middleware — the endpoint is protected by the CRON_SECRET query param.
router.get('/check-alertas', checkAlertas);

export default router;

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/health
 * Endpoint anti-cold-start para Render.com free tier.
 * Recibe pings cada 14 minutos desde un cronjob externo.
 * CRÍTICO: no toca la base de datos — responde instantáneamente.
 */
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

export default router;

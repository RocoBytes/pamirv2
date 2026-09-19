import { Router } from 'express';
import healthRouter from './health.route.js';
import authRouter from './auth.route.js';
import meRouter from './me.route.js';
import salidasRouter from './salidas.route.js';
import uploadRouter from './upload.route.js';
import integrantesRouter from './integrantes.route.js';
import cierresRouter from './cierres.route.js';
import evaluacionesRouter from './evaluaciones.route.js';
import documentosRouter from './documentos.route.js';
import eventosRouter from './eventos.route.js';
import cronRouter from './cron.route.js';
import adminRouter from './admin.route.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/me', meRouter);
router.use('/salidas', salidasRouter);
router.use('/salidas', uploadRouter); // POST /api/salidas/:id/gpx
router.use('/integrantes', integrantesRouter);
router.use('/cierres', cierresRouter);
router.use('/evaluaciones', evaluacionesRouter);
router.use('/documentos', documentosRouter);
router.use('/eventos', eventosRouter);
router.use('/cron', cronRouter);
router.use('/admin', adminRouter);

export default router;

import { Router } from 'express';
import { authMiddleware, requireAuth, requireGestorEventos } from '../middleware/auth.middleware.js';
import {
  getCategorias,
  getEventos,
  getEventoById,
  inscribirse,
  retirarse,
} from '../controllers/eventos.controller.js';
import {
  createEvento,
  updateEvento,
  deleteEventoBorrador,
  uploadItinerarioAdjunto,
  deleteItinerarioAdjunto,
  publicarEvento,
  despublicarEvento,
  cancelarEvento,
  getPostulantes,
  finalizarEvento,
  reenviarNotificaciones,
} from '../controllers/eventos-admin.controller.js';

const router = Router();

// Todo el módulo exige sesión; no hay vistas públicas de eventos.
router.use(authMiddleware, requireAuth);

// Rutas literales antes de /:id
router.get('/categorias', getCategorias);
router.get('/', getEventos);
router.get('/:id', getEventoById);
router.post('/:id/inscripcion', inscribirse);
router.delete('/:id/inscripcion', retirarse);

router.post('/', requireGestorEventos, createEvento);
router.put('/:id', requireGestorEventos, updateEvento);
router.delete('/:id', requireGestorEventos, deleteEventoBorrador);
router.post('/:id/itinerario-adjunto', requireGestorEventos, uploadItinerarioAdjunto);
router.delete('/:id/itinerario-adjunto', requireGestorEventos, deleteItinerarioAdjunto);
router.post('/:id/publicar', requireGestorEventos, publicarEvento);
router.post('/:id/despublicar', requireGestorEventos, despublicarEvento);
router.post('/:id/cancelar', requireGestorEventos, cancelarEvento);
router.get('/:id/postulantes', requireGestorEventos, getPostulantes);
router.post('/:id/finalizar', requireGestorEventos, finalizarEvento);
router.post('/:id/notificaciones/reenviar', requireGestorEventos, reenviarNotificaciones);

export default router;

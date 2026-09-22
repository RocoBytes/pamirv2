import { Router } from 'express';
import { getClubMarca, getClubLogo } from '../controllers/clubes.controller.js';

const router = Router();

// Sin authMiddleware a propósito: son las pantallas SIN sesión (login previo
// a autenticar) las que necesitan pintar la marca del club — ver el
// comentario de cada handler en clubes.controller.ts.
router.get('/:slug/marca', getClubMarca);
router.get('/:slug/logo', getClubLogo);

export default router;

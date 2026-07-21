import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();

// Todas las mutaciones reales de rutas ocurren vía POST /sincronizacion/push
// (WatermelonDB sync) — este módulo REST nunca se implementó, así que responde
// 501 en vez de simular un 200/201/204 de éxito que ningún caller debería confiar en.
const noImplementado = (_req: import('express').Request, res: import('express').Response) => {
  res.status(501).json({ message: 'Este endpoint REST no está implementado. Las rutas se gestionan vía /sincronizacion/push.' });
};

router.get('/', authMiddleware, noImplementado);
router.get('/:id', authMiddleware, noImplementado);
router.post('/', authMiddleware, noImplementado);
router.put('/:id', authMiddleware, noImplementado);
router.delete('/:id', authMiddleware, noImplementado);

export default router;

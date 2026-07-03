import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();

// Rutas de ruta
router.get('/', authMiddleware, (_req, res) => {
  res.status(200).json({ message: 'Listado de rutas pendiente de implementación.' });
});

router.get('/:id', authMiddleware, (_req, res) => {
  res.status(200).json({ message: 'Detalle de ruta pendiente de implementación.' });
});

router.post('/', authMiddleware, (_req, res) => {
  res.status(201).json({ message: 'Creación de ruta pendiente de implementación.' });
});

router.put('/:id', authMiddleware, (_req, res) => {
  res.status(200).json({ message: 'Actualización de ruta pendiente de implementación.' });
});

router.delete('/:id', authMiddleware, (_req, res) => {
  res.status(204).send();
});

export default router;

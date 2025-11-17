import {Router} from 'express';
import {seedOrders, deleteSeededOrders} from '@orders//controllers/seed.controller';

const router = Router();

router.post('/orders', seedOrders);
router.delete('/orders', deleteSeededOrders);

export default router;

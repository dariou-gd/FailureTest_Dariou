import express from 'express';
import {
    createOrder,
    getAllOrders,
    getOrderById,
    updateOrder,
} from '../controllers/orderController.js';

const router = express.Router();

router.post('/', createOrder);
router.get('/', getAllOrders);
router.get('/:id', getOrderById);
router.put('/:id', updateOrder);

export default router;

/**
 * Webhook routes.
 * POST /webhook/order-created — called by WooCommerce on every new order.
 */
import { Router } from 'express';
import { handleOrderCreated } from '../controllers/webhookController';
import { verifyWooWebhook } from '../middlewares/verifyWooWebhook';

export const webhookRouter = Router();

webhookRouter.post('/order-created', verifyWooWebhook, handleOrderCreated);

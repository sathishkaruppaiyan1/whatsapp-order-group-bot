/**
 * Webhook controller for WooCommerce order events.
 * Acknowledges immediately (WooCommerce disables slow webhooks) and runs the
 * processing pipeline asynchronously in the background.
 */
import { Request, Response } from 'express';
import { orderProcessor } from '../services/orderProcessor';
import { moduleLogger } from '../utils/logger';
import { WooWebhookPayload } from '../types';

const log = moduleLogger('Webhook');

export function handleOrderCreated(req: Request, res: Response): void {
  const payload = req.body as WooWebhookPayload;

  // WooCommerce sends a "ping" ({ webhook_id }) when the webhook is saved.
  if (payload?.webhook_id && !payload?.id) {
    log.info(`Webhook ping received (webhook_id=${payload.webhook_id})`);
    res.status(200).json({ received: true, ping: true });
    return;
  }

  const orderId = Number(payload?.id);
  if (!orderId || Number.isNaN(orderId)) {
    log.warn('Webhook received without a valid order id — ignoring');
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  log.info(`Webhook received: order.created for order #${orderId}`);

  // Acknowledge immediately; process in the background.
  res.status(200).json({ received: true, orderId });
  setImmediate(() => {
    orderProcessor.processNewOrder(orderId).catch((error: Error) => {
      log.error(`Background processing failed for order #${orderId}: ${error.message}`);
    });
  });
}

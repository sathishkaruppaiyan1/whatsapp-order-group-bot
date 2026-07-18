/**
 * Webhook controller for WooCommerce order events.
 * Accepts both "order.created" and "order.updated" deliveries on the same
 * endpoint, notifies only for confirmed statuses (default: "processing"),
 * deduplicates so each order is announced once, acknowledges immediately
 * (WooCommerce disables slow webhooks) and processes in the background.
 */
import { Request, Response } from 'express';
import { config } from '../config';
import { orderProcessor } from '../services/orderProcessor';
import { isOrderProcessed, markOrderProcessed } from '../utils/orderDedup';
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

  const topic = req.header('x-wc-webhook-topic') || 'order.event';
  const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : undefined;

  // Real WooCommerce payloads always carry a status; notify only for
  // confirmed ones. (Manual test payloads without a status pass through.)
  if (status && !config.notifyStatuses.includes(status)) {
    log.info(`Ignoring ${topic} for order #${orderId}: status "${status}" is not in [${config.notifyStatuses.join(', ')}]`);
    res.status(200).json({ received: true, ignored: true, status });
    return;
  }

  if (isOrderProcessed(orderId)) {
    log.info(`Ignoring ${topic} for order #${orderId}: already announced`);
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  markOrderProcessed(orderId);

  log.info(`Webhook received: ${topic} for order #${orderId} (status: ${status ?? 'unknown'})`);

  // Acknowledge immediately; process in the background.
  res.status(200).json({ received: true, orderId });
  setImmediate(() => {
    orderProcessor.processNewOrder(orderId).catch((error: Error) => {
      log.error(`Background processing failed for order #${orderId}: ${error.message}`);
    });
  });
}

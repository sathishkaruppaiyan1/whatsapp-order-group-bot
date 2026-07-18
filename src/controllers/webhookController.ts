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
import { moduleLogger } from '../utils/logger';
import { WooWebhookPayload } from '../types';

const log = moduleLogger('Webhook');

/**
 * Orders already sent to the group (orderId -> first-seen timestamp).
 * "order.updated" fires on every order change, so without this an order
 * would be re-announced on each edit. In-memory: a restart forgets it,
 * which at worst re-announces an order edited right after a redeploy.
 */
const processedOrders = new Map<number, number>();
const DEDUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function wasAlreadyProcessed(orderId: number): boolean {
  const now = Date.now();
  for (const [id, seenAt] of processedOrders) {
    if (now - seenAt > DEDUP_RETENTION_MS) processedOrders.delete(id);
  }
  return processedOrders.has(orderId);
}

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

  if (wasAlreadyProcessed(orderId)) {
    log.info(`Ignoring ${topic} for order #${orderId}: already announced`);
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  processedOrders.set(orderId, Date.now());

  log.info(`Webhook received: ${topic} for order #${orderId} (status: ${status ?? 'unknown'})`);

  // Acknowledge immediately; process in the background.
  res.status(200).json({ received: true, orderId });
  setImmediate(() => {
    orderProcessor.processNewOrder(orderId).catch((error: Error) => {
      log.error(`Background processing failed for order #${orderId}: ${error.message}`);
    });
  });
}

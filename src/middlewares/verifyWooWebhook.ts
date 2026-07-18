/**
 * WooCommerce webhook signature verification.
 * WooCommerce signs the raw request body with HMAC-SHA256 (base64) using the
 * webhook secret and sends it in the `x-wc-webhook-signature` header.
 * If WOO_WEBHOOK_SECRET is not configured, verification is skipped (with a warning).
 */
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';

const log = moduleLogger('Webhook');

/** Request augmented with the raw body captured by express.json({ verify }). */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function verifyWooWebhook(req: RawBodyRequest, res: Response, next: NextFunction): void {
  // WooCommerce sends a test ping (no signature over real payload logic needed)
  // when the webhook is first saved — let those through so activation succeeds.
  const signature = req.header('x-wc-webhook-signature');

  if (!config.woo.webhookSecret) {
    log.warn('WOO_WEBHOOK_SECRET not set — skipping webhook signature verification');
    next();
    return;
  }

  if (!signature || !req.rawBody) {
    log.warn('Webhook rejected: missing signature or raw body');
    res.status(401).json({ error: 'Missing webhook signature' });
    return;
  }

  const expected = crypto
    .createHmac('sha256', config.woo.webhookSecret)
    .update(req.rawBody)
    .digest('base64');

  const valid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!valid) {
    log.warn('Webhook rejected: invalid signature');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
}

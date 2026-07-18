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
  const signature = req.header('x-wc-webhook-signature');
  const rawText = req.rawBody ? req.rawBody.toString('utf-8') : '';

  // When a webhook is saved, WooCommerce sends an UNSIGNED activation ping with
  // a form-encoded body of "webhook_id=<n>". Acknowledge it with 200 so the
  // webhook activates — it never reaches order processing.
  if (rawText.startsWith('webhook_id=')) {
    log.info('WooCommerce webhook activation ping acknowledged');
    res.status(200).json({ ping: 'ok' });
    return;
  }

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

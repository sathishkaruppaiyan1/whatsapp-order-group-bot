/**
 * Express application setup.
 * Captures the raw request body (needed for WooCommerce webhook signature
 * verification) and wires up routes and error handling.
 */
import express, { Application } from 'express';
import { webhookRouter } from './routes/webhookRoutes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { RawBodyRequest } from './middlewares/verifyWooWebhook';
import { whatsAppService } from './services/whatsapp/whatsappService';

export function createApp(): Application {
  const app = express();

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        // Keep the raw body so the webhook signature can be verified.
        (req as RawBodyRequest).rawBody = buf;
      },
    })
  );

  // Health check (useful for Railway monitoring).
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      whatsappReady: whatsAppService.isReady(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use('/webhook', webhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

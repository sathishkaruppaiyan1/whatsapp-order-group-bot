/**
 * Express application setup.
 * Captures the raw request body (needed for WooCommerce webhook signature
 * verification) and wires up routes and error handling.
 */
import express, { Application } from 'express';
import QRCode from 'qrcode';
import { config } from './config';
import { webhookRouter } from './routes/webhookRoutes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { RawBodyRequest } from './middlewares/verifyWooWebhook';
import { whatsAppService } from './services/whatsapp/whatsappService';

export function createApp(): Application {
  const app = express();

  const captureRawBody = (req: express.Request, _res: express.Response, buf: Buffer): void => {
    // Keep the raw body so the webhook signature can be verified.
    (req as RawBodyRequest).rawBody = buf;
  };

  app.use(express.json({ limit: '2mb', verify: captureRawBody }));
  // WooCommerce's webhook activation ping is form-encoded ("webhook_id=<n>").
  app.use(express.urlencoded({ extended: false, limit: '1mb', verify: captureRawBody }));

  // Health check (useful for Railway monitoring).
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      whatsappReady: whatsAppService.isReady(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // WhatsApp login page: shows the current QR as a scannable image.
  // Protected with ?key=<WOO_WEBHOOK_SECRET> so strangers cannot hijack the session.
  app.get('/qr', async (req, res) => {
    if (config.woo.webhookSecret && req.query.key !== config.woo.webhookSecret) {
      res.status(403).send('Forbidden: add ?key=YOUR_WOO_WEBHOOK_SECRET to the URL');
      return;
    }

    const page = (body: string): string =>
      `<!doctype html><html><head><title>WhatsApp Login</title>
       <meta http-equiv="refresh" content="15">
       <style>body{font-family:sans-serif;text-align:center;padding-top:40px}</style>
       </head><body>${body}<p style="color:#888">Page refreshes every 15 seconds.</p></body></html>`;

    if (whatsAppService.isReady()) {
      res.send(page('<h2>✅ WhatsApp is connected</h2><p>No scan needed.</p>'));
      return;
    }
    const qr = whatsAppService.getLatestQr();
    if (!qr) {
      res.send(page('<h2>⏳ Waiting for QR code...</h2><p>The WhatsApp client is starting.</p>'));
      return;
    }
    const dataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
    res.send(
      page(
        '<h2>Scan with WhatsApp</h2>' +
          '<p>Phone → WhatsApp → Settings → Linked devices → Link a device</p>' +
          `<img src="${dataUrl}" alt="WhatsApp QR">`
      )
    );
  });

  app.use('/webhook', webhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

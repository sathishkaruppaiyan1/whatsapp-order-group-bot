/**
 * Server entry point.
 * Boots the Express server, WhatsApp client and Google Sheets header check.
 * Installs process-level guards so the service never crashes.
 */
import { createApp } from './app';
import { config, getMissingEnvVars } from './config';
import { ensureRuntimeDirectories } from './utils/fileUtils';
import { logger } from './utils/logger';
import { whatsAppService } from './services/whatsapp/whatsappService';
import { googleSheetsService } from './services/googleSheets/googleSheetsService';

async function bootstrap(): Promise<void> {
  ensureRuntimeDirectories();

  const missing = getMissingEnvVars();
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Fill in .env (see .env.example) and restart. Exiting.');
    process.exit(1);
  }

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port} (${config.nodeEnv})`);
    logger.info(`Webhook endpoint: ${config.baseUrl}/webhook/order-created`);
  });

  // WhatsApp boots in the background; orders wait for readiness before sending.
  whatsAppService.initialize().catch((error: Error) => {
    logger.error(`WhatsApp bootstrap error: ${error.message}`);
  });

  // Make sure the Google Sheet has its header row (non-fatal if it fails now).
  googleSheetsService.ensureHeaderRow().catch((error: Error) => {
    logger.error(`Google Sheets header check failed: ${error.message}`);
  });
}

/* --------- Never-crash guards (per spec) --------- */
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.stack || error.message}`);
});

/* --------- Graceful shutdown --------- */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);
  await whatsAppService.destroy().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void bootstrap();

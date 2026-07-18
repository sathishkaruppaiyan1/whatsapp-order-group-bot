/**
 * Central application configuration.
 * Loads environment variables once and exposes a typed, frozen config object.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const rootDir = path.resolve(__dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',

  woo: {
    url: (process.env.WOO_URL || '').replace(/\/+$/, ''),
    consumerKey: process.env.WOO_CONSUMER_KEY || '',
    consumerSecret: process.env.WOO_CONSUMER_SECRET || '',
    /** Optional: secret configured on the WooCommerce webhook for signature validation. */
    webhookSecret: process.env.WOO_WEBHOOK_SECRET || '',
  },

  google: {
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    /** Raw JSON string, base64-encoded JSON, or absolute path to the key file. */
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    sheetTabName: process.env.GOOGLE_SHEET_TAB || 'Orders',
  },

  /**
   * Order statuses that trigger the notification pipeline.
   * "processing" = confirmed orders (COD placed, or online payment completed).
   * Pending-payment orders are ignored until they reach a listed status.
   */
  notifyStatuses: (process.env.NOTIFY_ORDER_STATUSES || 'processing')
    .split(',')
    .map((status) => status.trim().toLowerCase())
    .filter(Boolean),

  whatsapp: {
    groupId: process.env.WHATSAPP_GROUP_ID || '',
    /** Where whatsapp-web.js stores the persistent session. */
    sessionDir: path.join(rootDir, '.wwebjs_auth'),
  },

  paths: {
    root: rootDir,
    logs: path.join(rootDir, 'logs'),
    downloads: path.join(rootDir, 'downloads'),
    generated: path.join(rootDir, 'generated'),
  },
} as const;

/**
 * Returns the list of required environment variables that are missing.
 * The server refuses to start when any of these are absent.
 */
export function getMissingEnvVars(): string[] {
  const required: Record<string, string> = {
    WOO_URL: config.woo.url,
    WOO_CONSUMER_KEY: config.woo.consumerKey,
    WOO_CONSUMER_SECRET: config.woo.consumerSecret,
    GOOGLE_SHEET_ID: config.google.sheetId,
    GOOGLE_SERVICE_ACCOUNT_JSON: config.google.serviceAccountJson,
    WHATSAPP_GROUP_ID: config.whatsapp.groupId,
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

/**
 * Reusable WhatsApp service built on whatsapp-web.js.
 * - LocalAuth persistent session (QR only needed on first login)
 * - Automatic reconnection with backoff when disconnected
 * - Helpers to send images and text messages to the configured group
 */
import fs from 'fs';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { config } from '../../config';
import { moduleLogger } from '../../utils/logger';

const log = moduleLogger('WhatsApp');

/**
 * Resolves the browser executable for puppeteer.
 * Priority: PUPPETEER_EXECUTABLE_PATH (set in Docker/Railway) -> locally
 * installed Chrome/Edge (Windows dev) -> undefined (puppeteer's own Chrome).
 */
function resolveBrowserPath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;
const READY_TIMEOUT_MS = 120000;

class WhatsAppService {
  private client: Client | null = null;
  private ready = false;
  private reconnectAttempts = 0;
  private shuttingDown = false;

  /** True once the client is authenticated and ready to send messages. */
  isReady(): boolean {
    return this.ready;
  }

  /** Boots the WhatsApp client. Safe to call once at server startup. */
  async initialize(): Promise<void> {
    if (this.client) return;
    this.client = this.createClient();
    log.info('Initializing WhatsApp client...');
    try {
      await this.client.initialize();
    } catch (error) {
      log.error(`WhatsApp initialization failed: ${(error as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private createClient(): Client {
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionDir }),
      puppeteer: {
        headless: true,
        // Required for containerized environments such as Railway.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        executablePath: resolveBrowserPath(),
      },
    });

    client.on('qr', (qr) => {
      log.info('QR code received. Scan it with WhatsApp (first login only):');
      qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => log.info('WhatsApp authenticated (session saved)'));

    client.on('ready', () => {
      this.ready = true;
      this.reconnectAttempts = 0;
      log.info('WhatsApp client is ready');
    });

    client.on('auth_failure', (message) => {
      this.ready = false;
      log.error(`WhatsApp authentication failure: ${message}`);
    });

    client.on('disconnected', (reason) => {
      this.ready = false;
      log.warn(`WhatsApp disconnected: ${reason}`);
      this.scheduleReconnect();
    });

    return client;
  }

  /** Destroys the current client and re-initializes it with exponential backoff. */
  private scheduleReconnect(): void {
    if (this.shuttingDown) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );
    log.info(`Reconnecting WhatsApp in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        if (this.client) {
          await this.client.destroy().catch(() => undefined);
        }
        this.client = this.createClient();
        await this.client.initialize();
      } catch (error) {
        log.error(`WhatsApp reconnect failed: ${(error as Error).message}`);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /** Resolves when the client becomes ready, or rejects after the timeout. */
  async waitUntilReady(timeoutMs: number = READY_TIMEOUT_MS): Promise<void> {
    const start = Date.now();
    while (!this.ready) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('WhatsApp client is not ready (timeout)');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /** Sends an image file (with optional caption) to the configured group. */
  async sendImage(filePath: string, caption?: string): Promise<void> {
    await this.waitUntilReady();
    const media = MessageMedia.fromFilePath(filePath);
    await this.client!.sendMessage(config.whatsapp.groupId, media, { caption });
    log.info(`Image sent to group: ${filePath}`);
  }

  /** Sends a plain text message to the configured group. */
  async sendText(message: string): Promise<void> {
    await this.waitUntilReady();
    await this.client!.sendMessage(config.whatsapp.groupId, message);
    log.info('Text message sent to group');
  }

  /** Graceful shutdown. */
  async destroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.client) {
      await this.client.destroy().catch(() => undefined);
      this.client = null;
    }
    this.ready = false;
  }
}

export const whatsAppService = new WhatsAppService();

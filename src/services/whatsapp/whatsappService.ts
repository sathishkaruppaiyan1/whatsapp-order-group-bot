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
export function resolveBrowserPath(): string | undefined {
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
const WATCHDOG_INTERVAL_MS = 4 * 60 * 1000;
const WATCHDOG_PROBE_TIMEOUT_MS = 30000;

class WhatsAppService {
  private client: Client | null = null;
  private ready = false;
  private reconnectAttempts = 0;
  private shuttingDown = false;
  private latestQr: string | null = null;
  private restarting = false;
  private watchdogTimer: NodeJS.Timeout | null = null;

  /** True once the client is authenticated and ready to send messages. */
  isReady(): boolean {
    return this.ready;
  }

  /** Latest login QR payload (null once authenticated). Served by GET /qr. */
  getLatestQr(): string | null {
    return this.latestQr;
  }

  /** Boots the WhatsApp client. Safe to call once at server startup. */
  async initialize(): Promise<void> {
    if (this.client) return;
    this.client = this.createClient();
    log.info('Initializing WhatsApp client...');
    this.startWatchdog();
    try {
      await this.client.initialize();
    } catch (error) {
      log.error(`WhatsApp initialization failed: ${(error as Error).message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * The Chromium page running WhatsApp Web can freeze after sitting idle in a
   * small container (every call then fails with "Runtime.callFunctionOn timed
   * out"). The watchdog probes the page every few minutes and hard-restarts
   * the client as soon as it stops responding; LocalAuth restores the session
   * without a new QR scan.
   */
  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      void this.checkPageAlive();
    }, WATCHDOG_INTERVAL_MS);
  }

  private async checkPageAlive(): Promise<void> {
    if (!this.client || !this.ready || this.restarting || this.shuttingDown) return;
    try {
      await Promise.race([
        this.client.getState(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('getState probe timed out')), WATCHDOG_PROBE_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      log.warn(`Watchdog: WhatsApp page unresponsive (${(error as Error).message}) — restarting client`);
      await this.restartClient();
    }
  }

  /** Destroys the frozen client and starts a fresh one (session is preserved). */
  private async restartClient(): Promise<void> {
    if (this.restarting || this.shuttingDown) return;
    this.restarting = true;
    this.ready = false;
    try {
      if (this.client) {
        await this.client.destroy().catch(() => undefined);
      }
      this.client = this.createClient();
      await this.client.initialize();
      log.info('WhatsApp client restarted after page freeze');
    } catch (error) {
      log.error(`WhatsApp restart failed: ${(error as Error).message}`);
      this.scheduleReconnect();
    } finally {
      this.restarting = false;
    }
  }

  /**
   * Runs a send action; if it hits a frozen page (protocol timeout), restarts
   * the client and retries the send once on the fresh instance.
   */
  private async sendWithRecovery(action: () => Promise<unknown>, label: string): Promise<void> {
    await this.waitUntilReady();
    try {
      await action();
    } catch (error) {
      const message = (error as Error).message || '';
      if (!/timed? ?out/i.test(message)) throw error;
      log.warn(`${label} hit a frozen WhatsApp page (${message}) — restarting client and retrying`);
      await this.restartClient();
      await this.waitUntilReady();
      await action();
    }
  }

  private createClient(): Client {
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionDir }),
      puppeteer: {
        headless: true,
        // Fail frozen-page calls in 60s instead of puppeteer's 180s default,
        // so the recovery logic kicks in quickly.
        protocolTimeout: 60000,
        // Required for containerized environments such as Railway, plus flags
        // that stop Chromium from throttling/freezing the idle WhatsApp tab.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--no-first-run',
          '--mute-audio',
        ],
        executablePath: resolveBrowserPath(),
      },
    });

    client.on('qr', (qr) => {
      this.latestQr = qr;
      log.info('QR code received. Open /qr in a browser to scan it (first login only):');
      qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
      this.latestQr = null;
      log.info('WhatsApp authenticated (session saved)');
    });

    client.on('ready', () => {
      this.ready = true;
      this.latestQr = null;
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
    const media = MessageMedia.fromFilePath(filePath);
    await this.sendWithRecovery(
      () => this.client!.sendMessage(config.whatsapp.groupId, media, { caption }),
      'Image send'
    );
    log.info(`Image sent to group: ${filePath}`);
  }

  /** Sends a plain text message to the configured group. */
  async sendText(message: string): Promise<void> {
    await this.sendWithRecovery(
      () => this.client!.sendMessage(config.whatsapp.groupId, message),
      'Text send'
    );
    log.info('Text message sent to group');
  }

  /** Graceful shutdown. */
  async destroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.client) {
      await this.client.destroy().catch(() => undefined);
      this.client = null;
    }
    this.ready = false;
  }
}

export const whatsAppService = new WhatsAppService();

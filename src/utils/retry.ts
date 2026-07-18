/**
 * Generic async retry helper with exponential backoff.
 * Used for WhatsApp sends and Google Sheets appends (3 attempts each, per spec).
 */
import { logger } from './logger';

export interface RetryOptions {
  /** Total number of attempts (including the first). Default 3. */
  attempts?: number;
  /** Delay before the first retry, doubled each subsequent retry. Default 2000ms. */
  delayMs?: number;
  /** Label used in log messages. */
  label?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying on failure with exponential backoff.
 * Throws the last error if every attempt fails.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelay = options.delayMs ?? 2000;
  const label = options.label ?? 'operation';

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Retry: ${label} failed (attempt ${attempt}/${attempts}): ${message}`);
      if (attempt < attempts) {
        await sleep(baseDelay * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}

/**
 * Registry of announced orders, persisted to disk.
 * Prevents re-announcing the same order when "order.updated" fires on every
 * edit â€” including after a restart/redeploy (the file lives in the
 * .wwebjs_auth volume, which survives container rebuilds). An order whose
 * WhatsApp delivery FAILED is released again, so the next webhook (e.g. the
 * merchant re-saving the order) retries it.
 */
import fs from 'fs';
import path from 'path';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STORE_FILE = path.join(process.cwd(), '.wwebjs_auth', 'processed-orders.json');

/** Marker for orders delivered successfully — never expires, never released. */
const SENT_MARK = -1;
const processedOrders = new Map<number, number>(); // orderId -> first-seen ms

function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Record<string, number>;
    for (const [id, seenAt] of Object.entries(raw)) processedOrders.set(Number(id), seenAt);
  } catch {
    // No file yet (or unreadable) â€” start empty.
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(Object.fromEntries(processedOrders)));
  } catch {
    // Persistence is best-effort; the in-memory registry still works.
  }
}

load();

function prune(): void {
  const now = Date.now();
  for (const [id, seenAt] of processedOrders) {
    // SENT_MARK entries (successfully delivered) are kept forever.
    if (seenAt !== SENT_MARK && now - seenAt > RETENTION_MS) processedOrders.delete(id);
  }
}

/** True if this order was already announced (or is being processed right now). */
export function isOrderProcessed(orderId: number): boolean {
  prune();
  return processedOrders.has(orderId);
}

/** Claims the order before processing starts (guards against parallel webhooks). */
export function markOrderProcessed(orderId: number): void {
  prune();
  processedOrders.set(orderId, Date.now());
  save();
}

/** Records a successful delivery permanently: this order is never sent again. */
export function markOrderSent(orderId: number): void {
  processedOrders.set(orderId, SENT_MARK);
  save();
}

/** Releases a failed order so a later webhook delivery can retry it. */
export function unmarkOrderProcessed(orderId: number): void {
  if (processedOrders.get(orderId) === SENT_MARK) return; // already delivered — never re-send
  processedOrders.delete(orderId);
  save();
}

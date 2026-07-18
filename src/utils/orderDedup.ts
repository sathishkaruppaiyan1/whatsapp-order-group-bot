/**
 * Shared in-memory registry of announced orders.
 * Prevents re-announcing the same order when "order.updated" fires on every
 * edit — but an order whose WhatsApp delivery FAILED is released again, so
 * the next webhook (e.g. the merchant re-saving the order) retries it.
 */
const processedOrders = new Map<number, number>(); // orderId -> first-seen ms
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function prune(): void {
  const now = Date.now();
  for (const [id, seenAt] of processedOrders) {
    if (now - seenAt > RETENTION_MS) processedOrders.delete(id);
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
}

/** Releases a failed order so a later webhook delivery can retry it. */
export function unmarkOrderProcessed(orderId: number): void {
  processedOrders.delete(orderId);
}

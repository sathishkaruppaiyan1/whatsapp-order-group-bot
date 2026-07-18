/**
 * Formats a processed order into the WhatsApp group message,
 * following the exact layout defined in the project spec.
 */
import { ProcessedOrder } from '../types';

const DIVIDER = '--------------------------------';

/** Formats a money value with the order's currency symbol. */
function money(symbol: string, value: string | number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${symbol}${amount.toFixed(2)}` : `${symbol}${value}`;
}

/** Builds the formatted WhatsApp order message. */
export function formatOrderMessage(order: ProcessedOrder): string {
  const symbol = order.currencySymbol;

  const lines: string[] = [
    '🛒 *NEW ORDER*',
    '',
    `*Order Number:* #${order.orderNumber}`,
    `*Customer Name:* ${order.customerName}`,
    `*Phone Number:* ${order.phone || 'N/A'}`,
    `*Payment Method:* ${order.paymentMethod}`,
    `*Shipping Method:* ${order.shippingMethod}`,
    '',
    DIVIDER,
    '*PRODUCTS*',
    DIVIDER,
  ];

  for (const item of order.items) {
    lines.push(
      '',
      `*${item.productName}*`,
      `Color: ${item.color}`,
      `Size: ${item.size}`,
      `Qty: ${item.quantity}`,
      `Price: ${money(symbol, item.unitPrice)}`,
      `Subtotal: ${money(symbol, item.subtotal)}`
    );
  }

  lines.push(
    '',
    DIVIDER,
    '*Delivery Address*',
    DIVIDER,
    order.address.street || 'N/A',
    order.address.city,
    order.address.state,
    order.address.pincode,
    '',
    DIVIDER,
    `*Order Total:* ${money(symbol, order.orderTotal)}`,
    DIVIDER
  );

  if (order.orderNotes) {
    lines.push('', `*Note:* ${order.orderNotes}`);
  }

  lines.push(
    '',
    `_Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}_`
  );

  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

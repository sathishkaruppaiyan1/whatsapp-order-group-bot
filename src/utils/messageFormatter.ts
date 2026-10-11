/**
 * Formats a processed order into the WhatsApp group message
 * (shipping-label style, exact layout requested by the store owner).
 */
import { ProcessedOrder } from '../types';

/** Store name shown under "From". Override with STORE_NAME env var. */
const STORE_NAME = process.env.STORE_NAME || 'Queenstall';

/** Shows local numbers without the +91 prefix, e.g. +919787887487 -> 9787887487. */
function displayPhone(phone: string): string {
  return phone.replace(/^\+91/, '').trim();
}

/** Builds the formatted WhatsApp order message. */
export function formatOrderMessage(order: ProcessedOrder): string {
  const lines: string[] = [`order id - ${order.orderNumber}`];

  // One size/color line per ordered product.
  for (const item of order.items) {
    lines.push(`size - ${item.size} , color - ${item.color}`);
  }

  // Shipping label: From / To.
  lines.push('From', STORE_NAME, 'To', order.customerName);
  for (const addressLine of [
    order.address.street1,
    order.address.street2,
    order.address.city.trim(),
    order.address.state.trim(),
    order.address.pincode.trim(),
    order.address.country.trim(),
  ]) {
    if (addressLine) lines.push(addressLine);
  }

  // Contact line; the customer note usually carries alternate/WhatsApp numbers.
  const phone = displayPhone(order.phone) || 'N/A';
  lines.push(order.orderNotes ? `Ph.no: ${phone} , Note: ${order.orderNotes}` : `Ph.no: ${phone}`);

  return lines.join('\n');
}

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

/** Strips the variation suffix (" - Wine, M") — Size/Colour get their own lines. */
function baseProductName(name: string, color: string, size: string): string {
  const suffix = ` - ${color}, ${size}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() : name;
}

/** Builds the formatted WhatsApp order message. */
export function formatOrderMessage(order: ProcessedOrder): string {
  const lines: string[] = [`Order ID - #${order.orderNumber}`, ''];

  // One block per ordered product.
  order.items.forEach((item, index) => {
    if (index > 0) lines.push('');
    lines.push(
      `Products Name: ${baseProductName(item.productName, item.color, item.size)}`,
      `Size - ${item.size}`,
      `Colour - ${item.color}`,
      `Qty - ${item.quantity}`
    );
  });

  // Shipping label: From / To.
  lines.push('', 'From', STORE_NAME, 'To', order.customerName);
  for (const addressLine of [
    order.address.street1,
    order.address.street2,
    order.address.city.trim(),
    order.address.state.trim(),
    order.address.pincode.trim(),
  ]) {
    if (addressLine) lines.push(addressLine);
  }

  // Contact line; the customer note usually carries alternate/WhatsApp numbers.
  const phone = displayPhone(order.phone) || 'N/A';
  lines.push(
    '',
    order.orderNotes ? `Ph.no: ${phone} , Note: ${order.orderNotes}` : `Ph.no: ${phone}`
  );

  lines.push(
    '',
    `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );

  return lines.join('\n');
}

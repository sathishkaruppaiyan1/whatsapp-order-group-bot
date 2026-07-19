/**
 * Prints the WhatsApp message the bot would send for a given order id.
 * Run: npx tsx scripts/preview-message.ts <orderId>
 */
import { wooCommerceService } from '../src/services/wooCommerce/wooCommerceService';
import { formatOrderMessage } from '../src/utils/messageFormatter';

async function main(): Promise<void> {
  const orderId = Number(process.argv[2] || 0);
  if (!orderId) {
    console.error('Usage: npx tsx scripts/preview-message.ts <orderId>');
    process.exit(1);
  }
  const order = await wooCommerceService.buildProcessedOrder(orderId);
  console.log('----- MESSAGE PREVIEW -----');
  console.log(formatOrderMessage(order));
  console.log('---------------------------');
}

main().catch((error) => {
  console.error(`FAILED: ${(error as Error).message}`);
  process.exit(1);
});

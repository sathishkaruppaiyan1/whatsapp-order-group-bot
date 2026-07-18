/**
 * Order processing pipeline — the heart of the bot.
 *
 * For every new order:
 *  1. Fetch full order + product + variation details from WooCommerce
 *  2. Download each variation image (parent product image as fallback)
 *  3. Generate badged images (SIZE + COLOR)
 *  4. Send images to the WhatsApp group, then the formatted order message
 *  5. Append one row per product to Google Sheets
 *  6. Delete temp files
 *
 * Failure policy (per spec):
 *  - Image generation failure  -> skip that image, still send text
 *  - WhatsApp failure          -> retry 3x, then continue (status FAILED)
 *  - Google Sheets failure     -> retry 3x
 *  - Nothing here may crash the application
 */
import { wooCommerceService } from './wooCommerce/wooCommerceService';
import { imageGeneratorService } from './imageGenerator/imageGeneratorService';
import { whatsAppService } from './whatsapp/whatsappService';
import { googleSheetsService } from './googleSheets/googleSheetsService';
import { formatOrderMessage } from '../utils/messageFormatter';
import { withRetry } from '../utils/retry';
import { deleteFiles } from '../utils/fileUtils';
import { unmarkOrderProcessed } from '../utils/orderDedup';
import { moduleLogger } from '../utils/logger';
import { DeliveryStatus, ProcessedOrder } from '../types';

const log = moduleLogger('OrderProcessor');

class OrderProcessor {
  /**
   * Entry point called by the webhook controller (which claims the order in
   * the dedup registry first). On failure the order is released again so the
   * next webhook delivery — e.g. the merchant re-saving the order — retries.
   * Never throws — all failures are logged and contained.
   */
  async processNewOrder(orderId: number): Promise<void> {
    log.info(`===== Processing order #${orderId} =====`);
    let order: ProcessedOrder;

    // --- 1. Fetch everything from WooCommerce ---
    try {
      order = await wooCommerceService.buildProcessedOrder(orderId);
    } catch (error) {
      log.error(`WooCommerce fetch failed for order #${orderId}: ${(error as Error).message}`);
      unmarkOrderProcessed(orderId); // Nothing announced — allow a retry.
      return;
    }

    try {
      // --- 2 & 3. Download images and generate badged versions ---
      await this.prepareImages(order);

      // --- 4. WhatsApp delivery ---
      const delivery = await this.sendToWhatsApp(order);

      if (delivery.whatsappStatus !== 'SENT') {
        // Delivery failed (e.g. WhatsApp disconnected). Release the order so
        // the next status-change webhook can announce it properly.
        unmarkOrderProcessed(orderId);
        log.warn(
          `Order #${order.orderNumber} released for retry — re-save the order in WooCommerce to resend`
        );
      }

      // --- 5. Google Sheets append (3 attempts) ---
      try {
        await withRetry(() => googleSheetsService.appendOrderRows(order, delivery), {
          attempts: 3,
          label: `Google Sheets append (order #${order.orderNumber})`,
        });
      } catch (error) {
        log.error(`Google Sheets append permanently failed: ${(error as Error).message}`);
      }
    } catch (error) {
      // Safety net — the pipeline must never take the app down.
      log.error(`Unexpected error processing order #${orderId}: ${(error as Error).message}`);
      unmarkOrderProcessed(orderId);
    } finally {
      // --- 6. Always clean up temp files ---
      deleteFiles(order.items.flatMap((item) => [item.downloadedImagePath, item.generatedImagePath]));
      log.info(`===== Finished order #${orderId} =====`);
    }
  }

  /** Downloads source images and generates badged images. Failures skip the image only. */
  private async prepareImages(order: ProcessedOrder): Promise<void> {
    for (const item of order.items) {
      if (!item.imageUrl) {
        log.warn(`No image available for "${item.productName}" — skipping image generation`);
        continue;
      }
      try {
        item.downloadedImagePath = await wooCommerceService.downloadImage(
          item.imageUrl,
          `order${order.orderId}-item${item.variationId || item.productId}`
        );
        item.generatedImagePath = await imageGeneratorService.generateOrderImage(
          item.downloadedImagePath,
          item.size,
          item.color,
          `order${order.orderId}-product${item.variationId || item.productId}`
        );
        item.imageGenerated = true;
      } catch (error) {
        // Per spec: if image generation fails, skip the image and continue.
        log.error(
          `Image generation failed for "${item.productName}": ${(error as Error).message} — skipping image`
        );
        item.generatedImagePath = null;
        item.imageGenerated = false;
      }
    }
  }

  /** Sends all generated images, then the formatted order text. Retries 3x. */
  private async sendToWhatsApp(order: ProcessedOrder): Promise<DeliveryStatus> {
    const message = formatOrderMessage(order);

    try {
      await withRetry(
        async () => {
          // Images first (each with a small product caption)...
          for (const item of order.items) {
            if (item.generatedImagePath && item.imageGenerated) {
              await whatsAppService.sendImage(
                item.generatedImagePath,
                `${item.productName} | ${item.size} | ${item.color} | Qty: ${item.quantity}`
              );
            }
          }
          // ...then the full formatted order message.
          await whatsAppService.sendText(message);
        },
        { attempts: 3, label: `WhatsApp send (order #${order.orderNumber})` }
      );

      const sentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      log.info(`WhatsApp delivery complete for order #${order.orderNumber}`);
      return { whatsappStatus: 'SENT', whatsappSentTime: sentTime };
    } catch (error) {
      log.error(
        `WhatsApp delivery permanently failed for order #${order.orderNumber}: ${(error as Error).message}`
      );
      return { whatsappStatus: 'FAILED', whatsappSentTime: '' };
    }
  }
}

export const orderProcessor = new OrderProcessor();

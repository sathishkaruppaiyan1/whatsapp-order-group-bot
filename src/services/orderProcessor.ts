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
import path from 'path';
import { wooCommerceService } from './wooCommerce/wooCommerceService';
import { imageGeneratorService } from './imageGenerator/imageGeneratorService';
import { whatsAppService } from './whatsapp/whatsappService';
import { googleSheetsService } from './googleSheets/googleSheetsService';
import { formatOrderMessage } from '../utils/messageFormatter';
import { withRetry } from '../utils/retry';
import { deleteFiles } from '../utils/fileUtils';
import { markOrderSent, unmarkOrderProcessed } from '../utils/orderDedup';
import { moduleLogger } from '../utils/logger';
import { DeliveryStatus, ProcessedOrder } from '../types';

const log = moduleLogger('OrderProcessor');

/** Posted after each order's details so consecutive orders are easy to tell apart. */
const ORDER_SEPARATOR_IMAGE = path.join(process.cwd(), 'assets', 'order-separator.png');

class OrderProcessor {
  /** Orders are posted one at a time so their images and text never interleave. */
  private whatsAppQueue: Promise<unknown> = Promise.resolve();

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

    // Safety net: the Google Sheet records every order ever delivered. If it
    // already says SENT, never post this order again (covers a lost/empty
    // dedup file). If the sheet can't be read, fall back to the local record.
    try {
      if (await googleSheetsService.wasOrderSent(order.orderNumber)) {
        markOrderSent(orderId);
        log.warn(`Order #${order.orderNumber} is already marked SENT in the sheet — not sending again`);
        return;
      }
    } catch (error) {
      log.warn(`Sent-check against the sheet failed (${(error as Error).message}) — relying on local record`);
    }

    try {
      // --- 2 & 3. Download images and generate badged versions ---
      await this.prepareImages(order);

      // --- 4. WhatsApp delivery ---
      const send = this.whatsAppQueue.then(() => this.sendToWhatsApp(order));
      this.whatsAppQueue = send.catch(() => undefined);
      const delivery = await send;

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
          `order${order.orderId}-product${item.variationId || item.productId}`,
          item.quantity
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
    // Images already delivered survive across retries, so a retry after a
    // failed text send doesn't post the same images to the group again.
    const sentImages = new Set<string>();

    try {
      await withRetry(
        async () => {
          // Images first (each with a small product caption)...
          for (const item of order.items) {
            if (item.generatedImagePath && item.imageGenerated && !sentImages.has(item.generatedImagePath)) {
              await whatsAppService.sendImage(
                item.generatedImagePath,
                `Size: ${item.size} | Color: ${item.color} | Qty: ${item.quantity}`
              );
              sentImages.add(item.generatedImagePath);
            }
          }
          // ...then the full formatted order message.
          await whatsAppService.sendText(message);
        },
        { attempts: 3, label: `WhatsApp send (order #${order.orderNumber})` }
      );

      // Record the delivery permanently right away — before the green tick or
      // any sheet work — so nothing that fails afterwards can allow a re-send.
      markOrderSent(order.orderId);

      // Green tick marks the end of this order in the group. Sent outside the
      // retry so a failure here never re-posts the order itself.
      try {
        await whatsAppService.sendImage(ORDER_SEPARATOR_IMAGE);
      } catch (error) {
        log.warn(`Order separator image not sent for #${order.orderNumber}: ${(error as Error).message}`);
      }

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

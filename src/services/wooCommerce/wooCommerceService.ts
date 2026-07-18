/**
 * WooCommerce REST API v3 service.
 * Handles order/product/variation fetching and image downloads.
 * Authentication uses consumer key/secret as query params (most compatible
 * across hosts; requires HTTPS store URLs in production).
 */
import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { moduleLogger } from '../../utils/logger';
import { tempFilePath } from '../../utils/fileUtils';
import {
  ProcessedOrder,
  ProcessedOrderItem,
  WooAttribute,
  WooLineItem,
  WooOrder,
  WooProduct,
  WooVariation,
} from '../../types';

const log = moduleLogger('WooCommerce');

class WooCommerceService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: `${config.woo.url}/wp-json/wc/v3`,
      timeout: 30000,
      params: {
        consumer_key: config.woo.consumerKey,
        consumer_secret: config.woo.consumerSecret,
      },
    });
  }

  /** Fetches a single order by id. */
  async getOrder(orderId: number): Promise<WooOrder> {
    log.info(`Fetching order #${orderId}`);
    const { data } = await this.api.get<WooOrder>(`/orders/${orderId}`);
    log.info(`Fetched order #${orderId} (number ${data.number}, ${data.line_items.length} items)`);
    return data;
  }

  /** Fetches a product by id. */
  async getProduct(productId: number): Promise<WooProduct> {
    log.info(`Fetching product #${productId}`);
    const { data } = await this.api.get<WooProduct>(`/products/${productId}`);
    return data;
  }

  /** Fetches a specific variation of a product. */
  async getVariation(productId: number, variationId: number): Promise<WooVariation> {
    log.info(`Fetching variation #${variationId} of product #${productId}`);
    const { data } = await this.api.get<WooVariation>(
      `/products/${productId}/variations/${variationId}`
    );
    return data;
  }

  /**
   * Downloads an image URL into downloads/ and returns the local file path.
   */
  async downloadImage(imageUrl: string, namePrefix: string): Promise<string> {
    const extension = (path.extname(new URL(imageUrl).pathname).slice(1) || 'jpg').toLowerCase();
    const destination = tempFilePath(config.paths.downloads, namePrefix, extension);

    log.info(`Downloading image: ${imageUrl}`);
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    fs.writeFileSync(destination, Buffer.from(response.data));
    log.info(`Image downloaded to ${path.basename(destination)}`);
    return destination;
  }

  /**
   * Fetches the full order plus every product/variation detail and
   * normalizes everything into a ProcessedOrder.
   */
  async buildProcessedOrder(orderId: number): Promise<ProcessedOrder> {
    const order = await this.getOrder(orderId);

    const items: ProcessedOrderItem[] = [];
    for (const lineItem of order.line_items) {
      items.push(await this.buildProcessedItem(lineItem));
    }

    const shipping = order.shipping?.address_1 ? order.shipping : order.billing;
    const street = [shipping.address_1, shipping.address_2].filter(Boolean).join(', ');
    const fullAddress = [street, shipping.city, shipping.state, shipping.postcode, shipping.country]
      .filter(Boolean)
      .join(', ');

    return {
      orderId: order.id,
      orderNumber: order.number,
      orderDate: order.date_created,
      customerName:
        `${order.billing.first_name} ${order.billing.last_name}`.trim() || 'Unknown Customer',
      phone: order.billing.phone || '',
      email: order.billing.email || '',
      address: {
        street,
        city: shipping.city || '',
        state: shipping.state || '',
        pincode: shipping.postcode || '',
        country: shipping.country || '',
        full: fullAddress,
      },
      paymentMethod: order.payment_method_title || order.payment_method,
      shippingMethod: order.shipping_lines?.[0]?.method_title || 'N/A',
      orderTotal: order.total,
      currency: order.currency,
      currencySymbol: order.currency_symbol || order.currency,
      orderNotes: order.customer_note || '',
      items,
    };
  }

  /** Resolves variation attributes (color/size) and image for one line item. */
  private async buildProcessedItem(lineItem: WooLineItem): Promise<ProcessedOrderItem> {
    let variation: WooVariation | null = null;
    let product: WooProduct | null = null;

    // Variation details (color, size, image) when the item is a variable product.
    if (lineItem.variation_id) {
      try {
        variation = await this.getVariation(lineItem.product_id, lineItem.variation_id);
      } catch (error) {
        log.error(`Failed to fetch variation #${lineItem.variation_id}: ${(error as Error).message}`);
      }
    }

    // Parent product is needed for the fallback image (and as attribute fallback).
    try {
      product = await this.getProduct(lineItem.product_id);
    } catch (error) {
      log.error(`Failed to fetch product #${lineItem.product_id}: ${(error as Error).message}`);
    }

    const color =
      this.findAttribute(variation?.attributes, /colou?r/i) ||
      this.findLineItemMeta(lineItem, /colou?r/i) ||
      'N/A';
    const size =
      this.findAttribute(variation?.attributes, /size/i) ||
      this.findLineItemMeta(lineItem, /size/i) ||
      'N/A';

    // Variation image first; fall back to the parent product's primary image.
    const imageUrl = variation?.image?.src || product?.images?.[0]?.src || null;
    if (!variation?.image?.src && imageUrl) {
      log.info(`Variation image missing for item "${lineItem.name}", using parent product image`);
    }

    const variationName = variation
      ? (variation.attributes || [])
          .map((attr) => attr.option)
          .filter(Boolean)
          .join(' / ')
      : '';

    return {
      productId: lineItem.product_id,
      productName: lineItem.name,
      variationId: lineItem.variation_id,
      variationName,
      sku: variation?.sku || lineItem.sku || product?.sku || 'N/A',
      quantity: lineItem.quantity,
      unitPrice: String(lineItem.price ?? variation?.price ?? ''),
      subtotal: lineItem.subtotal,
      color,
      size,
      imageUrl,
      downloadedImagePath: null,
      generatedImagePath: null,
      imageGenerated: false,
    };
  }

  /** Finds an attribute whose name matches the pattern (e.g. Color / Colour / pa_color). */
  private findAttribute(attributes: WooAttribute[] | undefined, pattern: RegExp): string {
    if (!attributes) return '';
    const match = attributes.find((attr) => pattern.test(attr.name));
    return match?.option || '';
  }

  /** Fallback: reads color/size from the order line item's meta data. */
  private findLineItemMeta(lineItem: WooLineItem, pattern: RegExp): string {
    const meta = lineItem.meta_data?.find(
      (entry) => pattern.test(entry.display_key || '') || pattern.test(entry.key || '')
    );
    const value = meta?.display_value ?? meta?.value;
    return typeof value === 'string' ? value : '';
  }
}

export const wooCommerceService = new WooCommerceService();

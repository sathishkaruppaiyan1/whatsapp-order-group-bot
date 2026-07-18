/**
 * Type definitions for the WooCommerce Order Automation Bot.
 * Raw Woo* interfaces mirror (a subset of) the WooCommerce REST API v3 payloads.
 * Processed* interfaces are the normalized shapes used internally by the bot.
 */

/* ---------------------------------- WooCommerce raw types ---------------------------------- */

export interface WooAddress {
  first_name: string;
  last_name: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

export interface WooMetaData {
  id: number;
  key: string;
  value: unknown;
  display_key?: string;
  display_value?: string;
}

export interface WooLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;
  quantity: number;
  sku: string;
  price: number | string;
  subtotal: string;
  total: string;
  meta_data: WooMetaData[];
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  currency_symbol?: string;
  date_created: string;
  total: string;
  customer_note: string;
  payment_method: string;
  payment_method_title: string;
  billing: WooAddress;
  shipping: WooAddress;
  line_items: WooLineItem[];
  shipping_lines: Array<{ method_title: string; total: string }>;
}

export interface WooImage {
  id: number;
  src: string;
  name: string;
  alt: string;
}

export interface WooAttribute {
  id: number;
  name: string;
  option?: string;
  options?: string[];
}

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  images: WooImage[];
  attributes: WooAttribute[];
}

export interface WooVariation {
  id: number;
  sku: string;
  price: string;
  image: WooImage | null;
  attributes: WooAttribute[];
  name?: string;
}

/** Minimal shape of the webhook payload we care about. */
export interface WooWebhookPayload {
  id?: number;
  webhook_id?: string;
  [key: string]: unknown;
}

/* ---------------------------------- Processed (internal) types ---------------------------------- */

export interface ProcessedOrderItem {
  productId: number;
  productName: string;
  variationId: number;
  variationName: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  color: string;
  size: string;
  imageUrl: string | null;
  /** Path of the downloaded source image (temp). */
  downloadedImagePath: string | null;
  /** Path of the generated badged image (temp). */
  generatedImagePath: string | null;
  imageGenerated: boolean;
}

export interface ProcessedOrder {
  orderId: number;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  phone: string;
  email: string;
  address: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
    full: string;
  };
  paymentMethod: string;
  shippingMethod: string;
  orderTotal: string;
  currency: string;
  currencySymbol: string;
  orderNotes: string;
  items: ProcessedOrderItem[];
}

/** Result of the WhatsApp delivery step, recorded into Google Sheets. */
export interface DeliveryStatus {
  whatsappStatus: 'SENT' | 'FAILED' | 'SKIPPED';
  whatsappSentTime: string;
}

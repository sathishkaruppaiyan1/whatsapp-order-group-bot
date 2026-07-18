/**
 * Google Sheets service.
 * Appends one row per ordered product using a service-account credential.
 * The credential can be supplied as raw JSON, base64 JSON, or a file path.
 */
import fs from 'fs';
import { google, sheets_v4 } from 'googleapis';
import { config } from '../../config';
import { moduleLogger } from '../../utils/logger';
import { DeliveryStatus, ProcessedOrder } from '../../types';

const log = moduleLogger('GoogleSheets');

const HEADER_ROW = [
  'Created Date',
  'Order Number',
  'Customer Name',
  'Phone',
  'Product',
  'SKU',
  'Color',
  'Size',
  'Quantity',
  'Unit Price',
  'Subtotal',
  'Payment Method',
  'Shipping Method',
  'Address',
  'WhatsApp Status',
  'WhatsApp Sent Time',
  'Image Generated',
];

class GoogleSheetsService {
  private sheets: sheets_v4.Sheets | null = null;

  /** Lazily builds the authenticated Sheets client. */
  private getClient(): sheets_v4.Sheets {
    if (this.sheets) return this.sheets;

    const credentials = this.parseCredentials(config.google.serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
    return this.sheets;
  }

  /** Accepts raw JSON, base64-encoded JSON, or a path to the key file. */
  private parseCredentials(value: string): Record<string, unknown> {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }
    if (fs.existsSync(trimmed)) {
      return JSON.parse(fs.readFileSync(trimmed, 'utf-8'));
    }
    // Assume base64-encoded JSON.
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  }

  /** Creates the configured tab if the spreadsheet does not have it yet. */
  private async ensureTabExists(): Promise<void> {
    const sheets = this.getClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.google.sheetId });
    const tabExists = (meta.data.sheets ?? []).some(
      (sheet) => sheet.properties?.title === config.google.sheetTabName
    );
    if (!tabExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.google.sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: config.google.sheetTabName } } }],
        },
      });
      log.info(`Created missing sheet tab "${config.google.sheetTabName}"`);
    }
  }

  /** Writes the header row if the sheet is currently empty. Called at startup. */
  async ensureHeaderRow(): Promise<void> {
    const sheets = this.getClient();
    const range = `${config.google.sheetTabName}!A1:Q1`;
    try {
      await this.ensureTabExists();
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.sheetId,
        range,
      });
      if (!existing.data.values || existing.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.google.sheetId,
          range,
          valueInputOption: 'RAW',
          requestBody: { values: [HEADER_ROW] },
        });
        log.info('Header row written to Google Sheet');
      }
    } catch (error) {
      log.error(`Could not verify/write header row: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Appends one row per ordered product for the given order.
   * Throws on failure so callers can apply the retry policy.
   */
  async appendOrderRows(order: ProcessedOrder, delivery: DeliveryStatus): Promise<void> {
    const sheets = this.getClient();
    const createdDate = new Date(order.orderDate).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
    });

    const rows = order.items.map((item) => [
      createdDate,
      order.orderNumber,
      order.customerName,
      order.phone,
      item.productName,
      item.sku,
      item.color,
      item.size,
      item.quantity,
      item.unitPrice,
      item.subtotal,
      order.paymentMethod,
      order.shippingMethod,
      order.address.full,
      delivery.whatsappStatus,
      delivery.whatsappSentTime,
      item.imageGenerated ? 'YES' : 'NO',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: `${config.google.sheetTabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });

    log.info(`Google Sheets updated: ${rows.length} row(s) appended for order #${order.orderNumber}`);
  }
}

export const googleSheetsService = new GoogleSheetsService();

/**
 * Reads the last rows of the Orders tab — shows what the bot logged
 * (including WhatsApp delivery status) for recent orders.
 * Run: npx tsx scripts/check-sheet.ts
 */
import fs from 'fs';
import { google } from 'googleapis';
import { config } from '../src/config';

async function main(): Promise<void> {
  const value = config.google.serviceAccountJson;
  const credentials = value.trim().startsWith('{')
    ? JSON.parse(value)
    : fs.existsSync(value)
      ? JSON.parse(fs.readFileSync(value, 'utf-8'))
      : JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: `${config.google.sheetTabName}!A1:Q100`,
  });
  const rows = res.data.values ?? [];
  console.log(`Total rows (incl header): ${rows.length}`);
  for (const row of rows.slice(-6)) {
    console.log(
      JSON.stringify({
        date: row[0],
        order: row[1],
        product: row[4],
        whatsappStatus: row[14],
        sentTime: row[15],
        imageGenerated: row[16],
      })
    );
  }
}

main().catch((error) => {
  console.error(`Sheet read failed: ${(error as Error).message}`);
  process.exit(1);
});

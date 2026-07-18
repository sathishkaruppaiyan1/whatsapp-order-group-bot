/**
 * Verifies the Google service-account setup:
 *  1. Credential loads and authenticates against Google's OAuth server
 *  2. If GOOGLE_SHEET_ID is set: the bot can actually read/write the sheet
 *     (runs the header-row check used at startup)
 *
 * Run: npm run check:google
 */
import fs from 'fs';
import { google } from 'googleapis';
import { config } from '../src/config';
import { googleSheetsService } from '../src/services/googleSheets/googleSheetsService';

async function main(): Promise<void> {
  const value = config.google.serviceAccountJson;
  if (!value) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env');
    process.exit(1);
  }

  // 1. Credential + token check.
  const credentials = value.trim().startsWith('{')
    ? JSON.parse(value)
    : fs.existsSync(value)
      ? JSON.parse(fs.readFileSync(value, 'utf-8'))
      : JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('No access token returned');
  console.log(`✅ Service account authenticated: ${credentials.client_email}`);

  // 2. Sheet access check.
  if (!config.google.sheetId) {
    console.log('ℹ️  GOOGLE_SHEET_ID not set yet — skipped the sheet access test.');
    console.log(`   Share the sheet with: ${credentials.client_email} (Editor), then re-run.`);
    return;
  }
  await googleSheetsService.ensureHeaderRow();
  console.log(`✅ Sheet access OK — header row verified in tab "${config.google.sheetTabName}".`);
}

main().catch((error) => {
  console.error(`❌ Google check failed: ${(error as Error).message}`);
  process.exit(1);
});

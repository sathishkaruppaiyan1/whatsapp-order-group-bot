# WooCommerce Order Automation Bot

Background automation service. When a customer places a WooCommerce order, the bot:

1. Receives + validates the WooCommerce webhook
2. Fetches full order, customer, product and variation details via the REST API
3. Downloads each variation image (parent product image as fallback)
4. Generates a badged product image (white rounded badge: **SIZE** on top, **COLOR** below)
5. Sends the images and a formatted order message to a WhatsApp group
6. Appends one row per product to Google Sheets
7. Cleans up temp files and writes rotated logs

No dashboard, no database, no commands — it runs entirely in the background.

## Tech stack

Node.js · TypeScript · Express · whatsapp-web.js (Puppeteer) · Sharp · node-canvas · WooCommerce REST API + Webhooks · Google Sheets API · Winston · Railway

## Project structure

```
src/
  config/          # env loading + validation
  routes/          # /webhook/order-created
  controllers/     # webhook controller (ack fast, process async)
  services/
    wooCommerce/   # REST API client, order/product/variation fetch, image download
    googleSheets/  # service-account auth + row append
    whatsapp/      # LocalAuth client, auto-reconnect, send helpers
    imageGenerator/# sharp + canvas badge compositing
    orderProcessor.ts # the pipeline orchestrator
  middlewares/     # webhook signature verification, error handling
  utils/           # logger, retry, file utils, message formatter
  types/           # WooCommerce + internal interfaces
  app.ts           # express app
  server.ts        # entry point, never-crash guards
logs/ generated/ downloads/   # runtime dirs (auto-created, git-ignored)
```

## Setup

### 1. Install & configure

```bash
npm install
cp .env.example .env   # then fill in every value
```

| Variable | Description |
|---|---|
| `PORT` | HTTP port (Railway injects this automatically) |
| `BASE_URL` | Public URL of this service |
| `WOO_URL` | Your store URL, e.g. `https://shop.example.com` |
| `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET` | WooCommerce → Settings → Advanced → REST API (Read permission is enough) |
| `WOO_WEBHOOK_SECRET` | The secret you set on the webhook (enables signature verification) |
| `GOOGLE_SHEET_ID` | The id from the sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account key: raw JSON, base64 JSON, or a file path |
| `WHATSAPP_GROUP_ID` | Target group id, e.g. `1203630xxxxxxxxxx@g.us` |

### 2. Google Sheets

1. Create a Google Cloud service account, enable the **Google Sheets API**, download the JSON key.
2. Share the target spreadsheet with the service account's email (Editor).
3. The bot writes to a tab named `Orders` (override with `GOOGLE_SHEET_TAB`) and creates the header row automatically.

### 3. WooCommerce webhook

WooCommerce Admin → Settings → Advanced → Webhooks → Add webhook:

- **Topic:** Order created
- **Delivery URL:** `<BASE_URL>/webhook/order-created`
- **Secret:** same value as `WOO_WEBHOOK_SECRET`
- **API Version:** v3

### 4. WhatsApp login

```bash
npm run dev
```

Scan the QR code printed in the terminal with the WhatsApp account that is a member of the target group. The session is stored in `.wwebjs_auth/` — you will not need the QR again unless you log out.

To find your group id: after login the client is connected; the group id has the form `<digits>@g.us`. (Temporarily log `client.getChats()` or check a group invite tool if needed.)

### 5. Run

```bash
npm run dev     # development (auto-restart)
npm run build && npm start   # production
```

## Railway deployment

The repo ships a `Dockerfile` (installs Chromium, canvas build deps and fonts) and `railway.json`.

1. Push the repo to GitHub and create a Railway project from it — Railway picks up the Dockerfile automatically.
2. Set all environment variables in the Railway dashboard (paste the service-account JSON as a single line, or base64-encode it).
3. Attach a **volume** mounted at `/app/.wwebjs_auth` so the WhatsApp session survives restarts/redeploys.
4. First deploy: watch the deploy logs for the QR code and scan it once.
5. Point the WooCommerce webhook at `https://<your-app>.up.railway.app/webhook/order-created`.

## Behavior & error handling

- Webhook is acknowledged immediately; processing happens in the background.
- Duplicate webhook deliveries for the same order are ignored (10-minute window).
- Image generation failure → image skipped, text still sent.
- WhatsApp send failure → 3 attempts (exponential backoff), then recorded as `FAILED` in the sheet.
- Google Sheets failure → 3 attempts.
- WhatsApp disconnect → automatic reconnect with backoff; process-level guards ensure the app never crashes.
- Logs rotate daily in `logs/` (`app-*.log`, `error-*.log`), gzipped, auto-pruned.

## Health check

`GET /health` → `{ "status": "ok", "whatsappReady": true, "uptimeSeconds": 123 }`

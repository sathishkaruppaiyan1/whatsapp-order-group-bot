# Deployment Guide — Railway + WhatsApp Authentication

This is the full walkthrough for taking the bot from local dev to a live Railway
deployment with a persistent WhatsApp session.

---

## Part 1 — WhatsApp authentication (do this locally first)

### How it works

whatsapp-web.js drives WhatsApp Web through a headless browser. Scanning the QR
code links the bot as a **Linked Device** on a WhatsApp account (same as using
WhatsApp Web in a browser). The session is saved to `.wwebjs_auth/`, so the QR
is only needed once — after that the bot logs in silently, even after restarts.

> ⚠️ **Use a dedicated WhatsApp number if possible.** Unofficial automation is
> against WhatsApp's ToS and carries a (small but real) risk of the number
> being banned. Don't risk your personal number for a business bot.

### Step-by-step

1. Fill in `.env` (copy from `.env.example`). `WHATSAPP_GROUP_ID` can stay
   empty for now.
2. Run the group-listing helper:

   ```bash
   npm run whatsapp:groups
   ```

3. A QR code prints in the terminal. On the phone that owns the bot's WhatsApp
   account: **Settings → Linked devices → Link a device** → scan the QR.
4. After login the script prints every group with its id:

   ```
   My Orders Group
     120363041234567890@g.us
   ```

5. Copy the id of the target group into `.env` as `WHATSAPP_GROUP_ID`.
   The bot's WhatsApp account must be a **member of that group**.
6. Start the bot (`npm run dev`) — it logs in from the saved session, no QR.

### Session lifecycle

| Event | What happens |
|---|---|
| Bot restarts | Auto-login from `.wwebjs_auth/` — no QR |
| Connection drops | Auto-reconnect with backoff |
| You tap "Log out" on the phone's Linked Devices | Session is invalidated — bot prints a new QR, scan again |
| `.wwebjs_auth/` deleted | Same — new QR required |

---

## Part 2 — Railway deployment

### Prerequisites

- The repo pushed to GitHub (`sathishkaruppaiyan1/whatsapp-order-group-bot`)
- A Railway account (https://railway.app) — the **Hobby plan ($5/mo)** is
  required for an always-on service; the free trial sleeps/expires.

### Step 1 — Create the service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Authorize Railway's GitHub app if asked, pick
   `whatsapp-order-group-bot`.
3. Railway reads `railway.json` and builds with the **Dockerfile**
   (Chromium + canvas libs + fonts are installed in the image).
   The first build takes several minutes — canvas compiles from source.

### Step 2 — Environment variables

Service → **Variables** tab → add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `WOO_URL` | `https://yourstore.com` (no trailing slash) |
| `WOO_CONSUMER_KEY` | from WooCommerce → Settings → Advanced → REST API |
| `WOO_CONSUMER_SECRET` | same place |
| `WOO_WEBHOOK_SECRET` | any strong random string — you'll reuse it in the webhook |
| `GOOGLE_SHEET_ID` | the long id in the sheet URL between `/d/` and `/edit` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **base64 of the key file** (see below) |
| `WHATSAPP_GROUP_ID` | the `...@g.us` id from Part 1 |
| `BASE_URL` | fill in after Step 3 (the Railway domain) |

Do **not** set `PORT` — Railway injects it automatically and the app reads it.

Base64-encode the Google key on Windows PowerShell (avoids all
newline/quoting problems in the Railway variable editor):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\service-account.json")) | Set-Clipboard
```

Then paste the clipboard as the value. (The bot accepts raw JSON, base64, or a
file path — base64 is the most reliable in env-var UIs.)

Remember: the Google Sheet must be **shared with the service account's email**
(Editor role), and the **Google Sheets API** enabled in the Cloud project.

### Step 3 — Public domain

1. Service → **Settings → Networking → Generate Domain**.
2. You get something like `whatsapp-order-group-bot-production.up.railway.app`.
3. Set `BASE_URL=https://<that-domain>` in Variables.

### Step 4 — Persistent volume (critical!)

Without this, every redeploy wipes the WhatsApp session and you'd re-scan the QR.

1. Right-click the service (or **⌘K / Ctrl+K** → "volume") → **Attach Volume**.
2. Mount path: `/app/.wwebjs_auth`
3. 1 GB is plenty.

Keep the service at **1 replica** — a WhatsApp session cannot be shared
between instances.

### Step 5 — First deploy + QR scan from logs

1. Trigger a deploy (happens automatically after the changes above).
2. Open **Deployments → View Logs** and wait for:

   ```
   QR code received. Scan it with WhatsApp (first login only):
   ```

3. The QR renders as ASCII in the logs. So it scans reliably:
   - zoom the browser out (Ctrl + minus) so the QR isn't line-wrapped,
   - scan with **Settings → Linked devices → Link a device**.
4. On success the logs show `WhatsApp authenticated` then
   `WhatsApp client is ready`. The session is now on the volume — you will
   not need the QR again, even across redeploys.

If the QR expires before you scan, a fresh one prints automatically; if the
service restarts, just scan the newest QR in the logs.

### Step 6 — Point WooCommerce at the bot

WooCommerce Admin → **Settings → Advanced → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Name | New Order → WhatsApp Bot |
| Status | Active |
| Topic | **Order created** |
| Delivery URL | `https://<railway-domain>/webhook/order-created` |
| Secret | the same value as `WOO_WEBHOOK_SECRET` |
| API Version | WP REST API Integration v3 |

Save. WooCommerce sends a ping — the bot logs `Webhook ping received`.

### Step 7 — Verify end-to-end

1. `https://<railway-domain>/health` should return
   `{"status":"ok","whatsappReady":true,...}`.
2. Place a **test order** in the store.
3. Watch the Railway logs walk the pipeline: webhook → order fetch →
   image download → image generated → WhatsApp sent → sheet updated.
4. Check the WhatsApp group (badged images + order message) and the Google
   Sheet (one row per product).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `whatsappReady: false` for a long time | Check logs — usually an unscanned QR, or the session was logged out on the phone |
| Webhook shows "Disabled" in WooCommerce | WooCommerce auto-disables after repeated delivery failures — verify the URL/health, then re-activate |
| `401 Invalid webhook signature` | `WOO_WEBHOOK_SECRET` doesn't match the webhook's Secret field exactly |
| Sheets error `The caller does not have permission` | Share the spreadsheet with the service-account email (Editor) |
| Images sent without badge text | Fonts missing — the provided Dockerfile installs DejaVu fonts, make sure Railway is building via the Dockerfile |
| QR re-appears after redeploy | The volume isn't mounted at `/app/.wwebjs_auth` |
| Order arrives but nothing happens | Logs will show which step failed; WooCommerce API and image steps are logged individually |

## Log access

Runtime logs stream in Railway's **View Logs**. Rotated files also exist in the
container (`logs/app-*.log`, `logs/error-*.log`) but note the container
filesystem (except the volume) resets on redeploy.

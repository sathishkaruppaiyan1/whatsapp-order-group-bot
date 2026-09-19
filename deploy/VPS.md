# VPS Deployment (Ubuntu + Nginx + Docker)

Moves the bot from Railway to your own VPS **without touching the WordPress /
React sites** already running there. The bot runs in one Docker container,
listens only on `127.0.0.1:3010`, and nginx forwards a subdomain to it.



---

## 0. Before you start (on your PC)

1. Push the latest code to GitHub (`git push`).
2. Keep the Railway service running until step 8 — no downtime for orders.
3. Have your Railway variables handy (Service → Variables) — you will copy them
   into `.env` on the VPS.

## 1. DNS

At your DNS provider add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `bot` | `<VPS public IP>` |

Check it resolves before continuing: `nslookup bot.queenstall.com`.

## 2. Install Docker (once)

SSH in, then:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker            # or log out / back in
docker --version && docker compose version
```

This adds nothing to nginx/PHP/Node on the host.

## 3. Get the code onto the VPS

```bash
sudo mkdir -p /opt/whatsapp-order-bot
sudo chown $USER:$USER /opt/whatsapp-order-bot
git clone https://github.com/sathishkaruppaiyan1/whatsapp-order-group-bot.git /opt/whatsapp-order-bot
cd /opt/whatsapp-order-bot
```

## 4. Environment file

```bash
cp .env.example .env
nano .env
```

Fill in the same values you had on Railway:

```
NODE_ENV=production
BASE_URL=https://bot.queenstall.com
WOO_URL=https://yourstore.com
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...
WOO_WEBHOOK_SECRET=<same strong secret as the WooCommerce webhook>
GOOGLE_SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON=<base64 of the key file — same as Railway>
WHATSAPP_GROUP_ID=1203...@g.us
NOTIFY_ORDER_STATUSES=processing
```

Leave `PORT` out (compose sets it). Lock the file down: `chmod 600 .env`.

## 5. Build and start the container

```bash
docker compose build          # first build takes several minutes (canvas compiles)
docker compose up -d
docker compose logs -f        # Ctrl+C to stop following
```

Verify it's up locally (nginx is not involved yet):

```bash
curl http://127.0.0.1:3010/health
# {"status":"ok","whatsappReady":false,"uptimeSeconds":...}
```

## 6. Nginx site + HTTPS

```bash
sudo cp deploy/nginx-bot.conf /etc/nginx/sites-available/bot.conf
sudo ln -s /etc/nginx/sites-available/bot.conf /etc/nginx/sites-enabled/bot.conf
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must say *syntax is ok* before reloading — if it errors, nothing
changes and your sites keep running.

Get a certificate (certbot is almost certainly already installed for your
sites; if not: `sudo apt-get install -y certbot python3-certbot-nginx`):

```bash
sudo certbot --nginx -d bot.queenstall.com
```

Certbot edits only `bot.conf` and adds the HTTPS block + redirect.

Check from outside: `https://bot.queenstall.com/health`.

## 7. Link WhatsApp (QR scan)

Open in a browser:

```
https://bot.queenstall.com/qr?key=<WOO_WEBHOOK_SECRET>
```

Phone → WhatsApp → **Settings → Linked devices → Link a device** → scan.
The page refreshes itself and shows "✅ WhatsApp is connected". The session is
stored in the `wwebjs_auth` Docker volume and survives restarts and rebuilds.

> If the bot number is still linked from Railway, the new scan simply adds
> another linked device. Once the VPS is confirmed working, remove the old
> Railway device from *Linked devices* on the phone (or just delete the
> Railway service).

## 8. Switch WooCommerce to the VPS

WooCommerce Admin → **Settings → Advanced → Webhooks** → edit the existing
webhook → Delivery URL:

```
https://bot.queenstall.com/webhook/order-created
```

Save. The bot logs `Webhook ping received`. Place a test order and watch:

```bash
docker compose logs -f --tail=100
```

When you see the group message arrive, delete the Railway service.

---

## Day-to-day

| Task | Command (run in `/opt/whatsapp-order-bot`) |
|---|---|
| Logs | `docker compose logs -f --tail=200` |
| Status / health | `docker compose ps` · `curl 127.0.0.1:3010/health` |
| Restart | `docker compose restart` |
| Deploy new code | `git pull && docker compose up -d --build` |
| Stop | `docker compose down` (session volume is kept) |
| Reset WhatsApp session | `docker compose down -v` then `up -d` and re-scan the QR |
| Resource usage | `docker stats whatsapp-order-bot` |

The container auto-restarts on crash and on VPS reboot (`restart: unless-stopped`).

## Why this can't hurt the sites

- **Port**: bound to `127.0.0.1:3010` only. Nginx keeps ports 80/443 and simply
  gains one extra `server_name`; your existing site configs are untouched.
- **Resources**: capped at 1 CPU / 1.5 GB RAM in `docker-compose.yml`. Headless
  Chromium idles around 300–500 MB; adjust the cap if your VPS is small
  (needs ~1 GB free for the bot on top of what WP/React already use — check
  with `free -m`).
- **Dependencies**: Node 20, Chromium, cairo/pango etc. live inside the image.
  Nothing is installed on the host except Docker itself.
- **Disk**: logs are rotated (`logs/` on host via winston, Docker json logs
  capped at 50 MB). Rebuilds leave dangling images — run
  `docker image prune -f` occasionally.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `502 Bad Gateway` on the subdomain | Container not up: `docker compose ps`, `docker compose logs --tail=100` |
| `whatsappReady:false` for long | Open `/qr?key=...` — session probably needs a scan |
| Chromium crashes / "Target closed" | Raise `memory` limit or `shm_size` in `docker-compose.yml` |
| Build fails compiling `canvas` | VPS ran out of RAM during build — add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| Certbot fails | DNS not propagated yet, or port 80 blocked by firewall (`sudo ufw status`) |

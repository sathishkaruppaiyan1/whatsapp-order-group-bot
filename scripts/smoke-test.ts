/**
 * HTTP-layer smoke test.
 * Boots the Express app (no WhatsApp / Sheets connections) and verifies:
 *  - /health responds
 *  - webhook ping (webhook_id) is acknowledged
 *  - payload without an order id is safely ignored
 *  - unknown routes 404
 *
 * Run: npx tsx scripts/smoke-test.ts
 */
import { createApp } from '../src/app';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(PORT);

  const results: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    results.push(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
    if (!ok) process.exitCode = 1;
  };

  const health = await fetch(`${BASE}/health`);
  const healthBody = (await health.json()) as { status: string };
  check('GET /health', health.status === 200 && healthBody.status === 'ok', JSON.stringify(healthBody));

  const ping = await fetch(`${BASE}/webhook/order-created`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ webhook_id: '42' }),
  });
  const pingBody = (await ping.json()) as { ping?: boolean };
  check('Webhook ping', ping.status === 200 && pingBody.ping === true, JSON.stringify(pingBody));

  const noId = await fetch(`${BASE}/webhook/order-created`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  const noIdBody = (await noId.json()) as { ignored?: boolean };
  check('Webhook without order id', noId.status === 200 && noIdBody.ignored === true, JSON.stringify(noIdBody));

  const missing = await fetch(`${BASE}/nope`);
  check('Unknown route', missing.status === 404, `status ${missing.status}`);

  console.log(`\n${results.join('\n')}\n`);
  server.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}

main().catch((error) => {
  console.error('❌ Smoke test failed:', error);
  process.exit(1);
});

/**
 * Helper: prints the name + id of every WhatsApp group the logged-in
 * account belongs to, so you can copy the right WHATSAPP_GROUP_ID.
 * Reuses the same LocalAuth session as the bot (scan QR if first time).
 *
 * If listing chats fails (WhatsApp Web internals change often), it falls
 * back to watch mode: send any message in the target group and its id
 * will be printed here.
 *
 * Run: npm run whatsapp:groups
 */
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { config } from '../src/config';
import { resolveBrowserPath } from '../src/services/whatsapp/whatsappService';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionDir }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath: resolveBrowserPath(),
  },
});

/** Watch mode: report the id of any group that receives a message. */
function watchForGroupMessages(): void {
  console.log('Watch mode: send ANY message in your orders group now (from any phone).');
  console.log('Its group id will appear below. Press Ctrl+C when done.\n');
  const seen = new Set<string>();
  const report = async (msg: { from: string; to: string }): Promise<void> => {
    const groupId = [msg.from, msg.to].find((id) => id?.endsWith('@g.us'));
    if (!groupId || seen.has(groupId)) return;
    seen.add(groupId);
    let name = '';
    try {
      const chat = await client.getChatById(groupId);
      name = chat.name;
    } catch {
      /* name lookup is best-effort */
    }
    console.log(`  ${name || '(group)'}\n    WHATSAPP_GROUP_ID=${groupId}\n`);
  };
  client.on('message', report);
  client.on('message_create', report);
}

client.on('qr', (qr) => {
  console.log('\nScan this QR with WhatsApp (Settings -> Linked devices -> Link a device):\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('\nConnected. Fetching chats...\n');
  try {
    const chats = await client.getChats();
    const groups = chats.filter((chat) => chat.isGroup);

    if (groups.length === 0) {
      console.log('No groups found via chat list.\n');
      watchForGroupMessages();
      return;
    }
    console.log('Your groups (use the id as WHATSAPP_GROUP_ID):\n');
    for (const group of groups) {
      console.log(`  ${group.name}\n    ${group.id._serialized}\n`);
    }
    await client.destroy();
    process.exit(0);
  } catch (error) {
    console.log(`Chat list unavailable (${(error as Error).message}). Switching to watch mode.\n`);
    watchForGroupMessages();
  }
});

client.initialize().catch((error) => {
  console.error('Failed to start WhatsApp client:', error);
  process.exit(1);
});

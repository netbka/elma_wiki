import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { vkSettings, normalizeVkLogin } from './vk-teams.mjs';

export function createVkLoginBot({ env = process.env, directory, issueLink, fetchImpl = fetch }) {
  if (env.VK_LOGIN_BOT_POLL !== '1') return null;
  const settings = vkSettings(env);
  if (!settings.configured || !issueLink) throw Error('Dedicated VK login bot is not configured');
  const controller = new AbortController(), signal = controller.signal;
  const file = path.join(directory, 'vk-login-cursor.json');
  const status = { enabled: true, polling: false, lastSuccess: null, lastReply: null, error: null };
  async function call(method, params) {
    const url = new URL(settings.apiBase + method);
    for (const [key, value] of Object.entries({ token: settings.token, ...params })) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    const data = await response.json();
    if (!response.ok || !data || data.ok === false || (method === '/messages/sendText' && data.ok !== true)) throw Error('vk_transport_failed');
    return data;
  }
  async function handle(event) {
    const p = event.payload;
    if (event.type !== 'newMessage' || p?.chat?.type !== 'private' || typeof p?.from?.userId !== 'string' || typeof p?.chat?.chatId !== 'string') return;
    let email;
    try {
      // Use the authenticated event sender, never text or a caller supplied login.
      if (!p.from.userId.toLowerCase().endsWith('@' + settings.domain)) return;
      email = normalizeVkLogin(p.from.userId, settings.domain);
      if (p.chat.chatId.toLowerCase() !== email) return;
    } catch { return; }
    const link = issueLink(email);
    await call('/messages/sendText', { chatId: p.chat.chatId, text: `Вход в E365 Wiki\n${link}\nСсылка действует 7 дней. Не пересылайте её другим людям.`, inlineKeyboardMarkup: JSON.stringify([[{ text: 'Открыть E365 Wiki', url: link, style: 'primary' }]]) });
    status.lastReply = Date.now();
  }
  async function run() {
    let cursor = 0;
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      try { cursor = JSON.parse(await fs.readFile(file, 'utf8')).lastEventId; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error('invalid_cursor');
      status.polling = true;
      while (!signal.aborted) {
        try {
          const data = await call('/events/get', { lastEventId: cursor, pollTime: 5 });
          if (!Array.isArray(data.events)) throw Error('invalid_events');
          for (const event of data.events) {
            if (!Number.isSafeInteger(event.eventId) || event.eventId <= cursor) continue;
            await handle(event);
            await fs.writeFile(file + '.tmp', JSON.stringify({ lastEventId: event.eventId }), { mode: 0o600 });
            await fs.rename(file + '.tmp', file);
            cursor = event.eventId;
          }
          status.lastSuccess = Date.now(); status.error = null;
          await delay(100, undefined, { signal });
        } catch {
          if (signal.aborted) break;
          status.error = 'poll_or_delivery_failed';
          await delay(2000, undefined, { signal }).catch(() => {});
        }
      }
    } catch { if (!signal.aborted) status.error = 'cursor_unavailable'; }
    finally { status.polling = false; }
  }
  return { status, run, stop: () => controller.abort(), handle };
}

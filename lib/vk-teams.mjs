// Same sendText contract as SudSvoiBot/packages/vk-teams-client; no event polling.
export function vkSettings(env = process.env) {
  const token = env.VK_BOT_AUTH_TOKEN || '', apiBase = env.VK_API_BASE || '';
  const domain = (env.PORTAL_EMAIL_DOMAIN || '').replace(/^@/, '').toLowerCase();
  if (!token && !apiBase && !domain) return { configured: false };
  let api;
  try { api = new URL(apiBase); } catch { throw Error('Укажите VK_API_BASE для бота входа'); }
  if (!token || /[\r\n]/.test(token) || api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(domain)) throw Error('Некорректные настройки бота VK Teams');
  const profile = (env.VK_BOT_AUTH_NAME || env.VK_BOT_AUTH_ID || '').replace(/^@/, '').trim();
  return { configured: true, token, apiBase: api.href.replace(/\/$/, ''), domain, botUrl: profile ? `https://teams.vk.com/profile/${encodeURIComponent(profile)}` : null };
}
export function createVkSender(env = process.env, fetchImpl = fetch) {
  const settings = vkSettings(env);
  if (!settings.configured) return undefined;
  const sender = async ({ email: chatId, key, baseUrl }) => {
    const url = new URL(settings.apiBase + '/messages/sendText');
    url.searchParams.set('token', settings.token);
    url.searchParams.set('chatId', chatId);
    url.searchParams.set('text', `E365 Wiki (${new URL(baseUrl).origin})\nКод входа: ${key}\nДействует 10 минут, используется один раз. Не передавайте код другим людям. Если вы не запрашивали вход, проигнорируйте сообщение.`);
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result?.ok !== true) throw Error('Не удалось доставить код в VK Teams');
  };
  sender.domain = settings.domain;
  sender.botUrl = settings.botUrl;
  sender.linkSecret = settings.token;
  return sender;
}
export function normalizeVkLogin(value, domain) {
  if (typeof value !== 'string') throw Error('Укажите логин VK Teams');
  const login = value.trim().toLowerCase();
  const user = login.endsWith('@' + domain) ? login.slice(0, -(domain.length + 1)) : login;
  if (!/^[a-z0-9._-]{1,64}$/.test(user)) throw Error('Укажите корпоративный логин VK Teams');
  return user + '@' + domain;
}

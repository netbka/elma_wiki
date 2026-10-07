import crypto from 'node:crypto';

import { normalizeVkLogin } from './vk-teams.mjs';
export const AUTH_TTL = 72 * 3600000;
export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value.trim())) throw Error('Укажите корректный адрес электронной почты');
  return value.trim().toLowerCase();
}
const hash = value => crypto.createHash('sha256').update(value).digest();
export function createAuth({ baseUrl, allowLocal = false, sendEmail, sendVk, now = Date.now }) {
  const sessions = new Map(), keys = new Map(), limits = new Map();
  const secure = new URL(baseUrl).protocol === 'https:';
  const cookie = (value, seconds) => `elma_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const sessionKey = req => (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith('elma_session='))?.slice(13);
  function cleanup() {
    for (const map of [sessions, keys, limits]) for (const [key, record] of map) if (record.expires <= now()) map.delete(key);
  }
  function limit(id, maximum, cooldown = 0) {
    let record = limits.get(id);
    if (!record) {
      if (limits.size >= 5000) throw Object.assign(Error('Слишком много запросов. Попробуйте позже'), { statusCode: 429 });
      record = { count: 0, last: -Infinity, expires: now() + 3600000 }; limits.set(id, record);
    }
    if (record.count >= maximum || now() - record.last < cooldown) throw Object.assign(Error('Слишком много запросов. Попробуйте позже'), { statusCode: 429 });
    record.count++; record.last = now();
  }
  function login(req, res, user) {
    sessions.delete(sessionKey(req));
    const key = crypto.randomBytes(32).toString('base64url');
    sessions.set(key, { user, expires: now() + AUTH_TTL });
    res.setHeader('Set-Cookie', cookie(key, AUTH_TTL / 1000));
  }
  async function read(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Error('Ожидается JSON');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 2048) throw Error('Размер запроса превышает лимит'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  return {
    emailConfigured: !!sendEmail, vkConfigured: !!sendVk, vkBotUrl: sendVk?.botUrl || null, allowLocal,
    session(req) { cleanup(); return sessions.get(sessionKey(req)); },
    async route(req, res, url) {
      cleanup();
      if (url.pathname === '/auth/github' || url.pathname === '/auth/github/callback') { json(res, 403, { error: 'Вход через GitHub отключён. Используйте настроенный способ входа' }); return true; }
      if (['/auth/email/request', '/auth/email/verify', '/auth/vk/request', '/auth/vk/verify'].includes(url.pathname)) {
        const vk = url.pathname.startsWith('/auth/vk/'), sender = vk ? sendVk : sendEmail;
        if (req.method !== 'POST') { json(res, 405, { error: 'Ожидается POST' }); return true; }
        if (!sender) { json(res, 503, { error: vk ? 'Бот входа VK Teams ещё не настроен' : 'Отправка писем ещё не настроена. Обратитесь к администратору' }); return true; }
        const request = await read(req), email = vk ? normalizeVkLogin(request?.login, sender.domain) : normalizeEmail(request?.email);
        const identity = (vk ? 'vk:' : 'email:') + email;
        const ip = req.socket.remoteAddress; // Forwarded headers are not trusted.
        if (url.pathname.endsWith('/request')) {
          limit('send-ip:' + ip, 20); limit('send-user:' + identity, 5, 60000);
          if (keys.size >= 5000 && !keys.has(identity)) { json(res, 429, { error: 'Слишком много запросов. Попробуйте позже' }); return true; }
          const key = crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
          const record = { digest: hash(key.replaceAll('-', '')), expires: now() + (vk ? 600000 : AUTH_TTL), attempts: 0 };
          try { await sender({ email, key, expires: record.expires, baseUrl }); }
          catch { json(res, 503, { error: vk ? 'Не удалось отправить код. Откройте бота входа в VK Teams, отправьте ему сообщение и повторите попытку' : 'Не удалось отправить письмо. Попробуйте позже' }); return true; }
          keys.set(identity, record);
          json(res, 200, { ok: true, message: vk ? 'Код отправлен в VK Teams. Он действует 10 минут и используется один раз' : 'Ключ отправлен на почту. Он действует 72 часа и используется один раз' }); return true;
        }
        limit('verify-ip:' + ip, 60);
        const record = keys.get(identity), key = typeof request.key === 'string' ? request.key.trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '') : '';
        if (!record || ++record.attempts > 5 || !/^[A-F0-9]{16}$/.test(key) || !crypto.timingSafeEqual(record.digest, hash(key))) {
          if (record?.attempts >= 5) keys.delete(identity);
          json(res, 400, { error: vk ? 'Неверный или просроченный код. Запросите новый код в VK Teams' : 'Неверный или просроченный ключ. Проверьте письмо или запросите новый ключ' }); return true;
        }
        keys.delete(identity);
        login(req, res, { id: (vk ? 'vk:' : 'email:') + hash(email).toString('hex'), login: email, provider: vk ? 'vk-teams' : 'email' });
        json(res, 200, { ok: true }); return true;
      }
      if (url.pathname === '/auth/local') {
        if (req.method !== 'POST' || !allowLocal) throw Error('Локальный вход отключён');
        login(req, res, { id: 'local', login: 'Локальный пользователь', provider: 'local' });
        json(res, 200, { ok: true }); return true;
      }
      if (url.pathname === '/auth/logout') {
        if (req.method !== 'POST') throw Error('Ожидается POST');
        sessions.delete(sessionKey(req)); res.setHeader('Set-Cookie', cookie('', 0));
        json(res, 200, { ok: true }); return true;
      }
      return false;
    }
  };
}

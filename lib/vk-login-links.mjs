import crypto from 'node:crypto';
import { normalizeVkLogin } from './vk-teams.mjs';

export const VK_LINK_TTL = 7 * 24 * 3600000;
export function vkLoginLinks({ secret, baseUrl, domain, now = Date.now }) {
  const origin = new URL(baseUrl).origin;
  const sign = payload => crypto.createHmac('sha256', secret).update(`wiki-login:v1:${origin}:${payload}`).digest('base64url');
  return {
    issue(email) {
      const payload = Buffer.from(JSON.stringify({ email: normalizeVkLogin(email, domain), expires: now() + VK_LINK_TTL })).toString('base64url');
      const url = new URL('/auth/vk/link', origin);
      url.searchParams.set('token', `${payload}.${sign(payload)}`);
      return url.href;
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 1024) return null;
      const parts = token.split('.');
      if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
      const [payload, mac] = parts, expected = Buffer.from(sign(payload)), actual = Buffer.from(mac);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(data.expires) || data.expires <= now() || data.expires > now() + VK_LINK_TTL) return null;
        return normalizeVkLogin(data.email, domain);
      } catch { return null; }
    }
  };
}

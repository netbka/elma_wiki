import crypto from 'node:crypto';

export function createAuth({ baseUrl, clientId, clientSecret, allowLocal = false, fetchImpl = fetch }) {
  const sessions = new Map(), states = new Map(), base = new URL(baseUrl), secure = base.protocol === 'https:';
  const random = () => crypto.randomBytes(32).toString('base64url');
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')));
  const cleanup = () => { for (const [k, v] of sessions) if (v.expires < Date.now()) sessions.delete(k); for (const [k, v] of states) if (v.expires < Date.now()) states.delete(k); };
  function session(req) { cleanup(); return sessions.get(cookies(req).elma_session); }
  function login(res, user, token) {
    const key = random(); sessions.set(key, { user, token, expires: Date.now() + 8 * 3600000 });
    const previous = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(previous ? [previous].flat() : []), cookie('elma_session', key, 8 * 3600)]);
  }
  return {
    configured: !!(clientId && clientSecret), allowLocal, session,
    async route(req, res, url) {
      const redirect = target => { res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' }); res.end(); };
      if (url.pathname === '/auth/github') {
        if (req.method !== 'GET') throw Error('Ожидается GET');
        if (!clientId || !clientSecret) { redirect('/login?setup=1'); return true; }
        cleanup();
        const state = random(), verifier = random();
        states.set(state, { verifier, expires: Date.now() + 10 * 60000 });
        res.setHeader('Set-Cookie', cookie('elma_oauth_state', state, 600));
        const target = new URL('https://github.com/login/oauth/authorize');
        target.search = new URLSearchParams({ client_id: clientId, redirect_uri: base.origin + '/auth/github/callback', scope: 'read:user repo', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        redirect(target.href); return true;
      }
      if (url.pathname === '/auth/github/callback') {
        const state = url.searchParams.get('state'), record = states.get(state);
        if (req.method !== 'GET' || !state || state !== cookies(req).elma_oauth_state || !record || record.expires < Date.now()) throw Error('Неверное или просроченное состояние OAuth. Повторите вход.');
        states.delete(state);
        res.setHeader('Set-Cookie', cookie('elma_oauth_state', '', 0));
        if (!url.searchParams.get('code')) throw Error('GitHub не подтвердил вход');
        const response = await fetchImpl('https://github.com/login/oauth/access_token', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code'), code_verifier: record.verifier, redirect_uri: base.origin + '/auth/github/callback' })
        });
        if (!response.ok) throw Error('GitHub не выполнил обмен OAuth');
        const tokenData = await response.json();
        if (typeof tokenData.access_token !== 'string') throw Error('GitHub не выдал OAuth-токен');
        const profile = await fetchImpl('https://api.github.com/user', { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'elma-wiki' } });
        if (!profile.ok) throw Error('Не удалось проверить пользователя GitHub');
        const user = await profile.json();
        if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw Error('Некорректный ответ GitHub');
        login(res, { id: `github:${user.id}`, login: user.login, provider: 'github' }, tokenData.access_token);
        redirect('/dashboard'); return true;
      }
      if (url.pathname === '/auth/local') {
        if (req.method !== 'POST' || !allowLocal) throw Error('Локальный вход отключён');
        login(res, { id: 'local', login: 'Локальный пользователь', provider: 'local' });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return true;
      }
      if (url.pathname === '/auth/logout') {
        if (req.method !== 'POST') throw Error('Ожидается POST');
        sessions.delete(cookies(req).elma_session);
        res.setHeader('Set-Cookie', cookie('elma_session', '', 0));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return true;
      }
      return false;
    }
  };
}

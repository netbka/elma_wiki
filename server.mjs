import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData, importConfig, saveImport } from './lib/store.mjs';
import { limits, serverKey } from './lib/e365.mjs';
import { createAuth } from './lib/auth.mjs';
import { portalStore } from './lib/portals.mjs';
import { githubClient } from './lib/github.mjs';
import { demoData } from './lib/demo.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req, max) {
  if (Number(req.headers['content-length']) > max) throw Error('Размер запроса превышает лимит');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw Error('Размер запроса превышает лимит'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function serve(req, res, directory, pathname) {
  const file = path.resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Страница не найдена' });
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
export function createServer({ directory = path.join(project, '.local'), baseUrl = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 43171}`,
  clientId = process.env.GITHUB_CLIENT_ID, clientSecret = process.env.GITHUB_CLIENT_SECRET,
  allowLocal = process.env.DISABLE_LOCAL_LOGIN !== '1' && ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) && (!process.env.HOST || process.env.HOST === '127.0.0.1'), fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl), auth = createAuth({ baseUrl, clientId, clientSecret, allowLocal, fetchImpl }), portals = portalStore(directory), demo = demoData();
  let importing = false;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const localHost = `${req.socket.localAddress}:${req.socket.localPort}`, allowed = new Set([base.host]);
      if (base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)) { allowed.add(localHost); allowed.add(`localhost:${req.socket.localPort}`); }
      if (!allowed.has(req.headers.host)) return send(res, 403, { error: 'Недопустимый Host' });
      const url = new URL(req.url, base), pathname = decodeURIComponent(url.pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        const expected = base.protocol === 'https:' ? base.origin : `http://${req.headers.host}`;
        if (origin && origin !== expected) return send(res, 403, { error: 'Запрос разрешён только из этого сервиса' });
        if (req.headers['x-elma-wiki-request'] !== '1' && req.headers['x-elma-wiki-import'] !== '1') return send(res, 403, { error: 'Отсутствует заголовок запроса сервиса' });
      }
      if (await auth.route(req, res, url)) return;
      const session = auth.session(req);
      if (pathname === '/api/session' && req.method === 'GET') return send(res, 200, { user: session?.user || null, githubConfigured: auth.configured, localEnabled: allowLocal });
      if (pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
      if (pathname === '/api/portals') {
        if (!session) return send(res, 401, { error: 'Войдите в сервис' });
        if (req.method === 'GET') {
          const rows = await portals.list(session.user.id);
          if (session.user.provider === 'local') rows.unshift({ id: 'local', name: 'Локальный импорт CLI', createdAt: null });
          return send(res, 200, rows);
        }
        if (req.method === 'POST') { const value = JSON.parse((await body(req, 4096)).toString()); return send(res, 201, await portals.create(session.user.id, value.name)); }
        return send(res, 405, { error: 'Метод не поддерживается' });
      }
      if (pathname === '/api/github/inspect' && req.method === 'POST') {
        if (!session) return send(res, 401, { error: 'Войдите через GitHub' });
        const value = JSON.parse((await body(req, 4096)).toString());
        return send(res, 200, await githubClient(session.token, fetchImpl).list(value.repo));
      }
      const githubMatch = /^\/api\/portals\/([0-9a-f-]{36})\/github$/.exec(pathname);
      if (githubMatch && req.method === 'POST') {
        if (!session || !await portals.get(githubMatch[1], session.user.id)) return send(res, 404, { error: 'Портал не найден' });
        if (importing) return send(res, 409, { error: 'Дождитесь текущего разбора' });
        const value = JSON.parse((await body(req, 4096)).toString()), environment = serverKey(value.server || 'local');
        importing = true;
        try { return send(res, 200, await saveImport(() => githubClient(session.token, fetchImpl).import(value.repo, value.path, environment), environment, portals.dataFile(githubMatch[1]))); }
        finally { importing = false; }
      }
      const portalMatch = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
      if (portalMatch) {
        const [, id, requested = '/'] = portalMatch;
        if (!portalMatch[2]) { res.writeHead(302, { Location: `/p/${encodeURIComponent(id)}/` }); return res.end(); }
        const showcase = id === 'showcase', local = id === 'local' && session?.user.provider === 'local';
        if (!showcase && !local && (!session || !await portals.get(id, session.user.id))) return send(res, 404, { error: 'Портал не найден или недоступен' });
        const dataFile = local ? path.join(directory, 'data.json') : showcase ? null : portals.dataFile(id);
        if (requested === '/api/import') {
          if (showcase) return send(res, 403, { error: 'Демонстрация доступна только для чтения' });
          if (req.method !== 'POST') return send(res, 405, { error: 'Используйте POST' });
          if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') return send(res, 415, { error: 'Ожидается бинарный .e365' });
          if (importing) return send(res, 409, { error: 'Дождитесь текущего разбора' });
          const environment = serverKey(url.searchParams.get('server') || 'local');
          importing = true;
          try { return send(res, 200, await importConfig(await body(req, limits.upload), environment, dataFile)); }
          finally { importing = false; }
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Только чтение' });
        if (requested === '/data.json') {
          if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
          return send(res, 200, showcase ? demo : await readData(dataFile));
        }
        return serve(req, res, path.join(project, 'dist'), requested);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается' });
      if (pathname === '/dashboard' && !session) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      if (['/', '/login', '/dashboard', '/guide'].includes(pathname)) return serve(req, res, path.join(project, 'web'), pathname === '/' ? '/index.html' : pathname + '.html');
      return serve(req, res, path.join(project, 'web'), pathname);
    } catch (error) {
      if (!res.headersSent) send(res, 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error instanceof URIError ? 'Некорректный URL' : error.code ? 'Операция хранилища недоступна' : /fetch|ENOTFOUND|ECONN/.test(error.message) ? 'Внешний сервис недоступен' : error.message });
      else res.destroy();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Node's built-in env loader keeps deployment independent of dotenv packages.
  if (fs.existsSync(path.join(project, '.env'))) process.loadEnvFile(path.join(project, '.env'));
  const port = Number(process.env.PORT || 43171), host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT: целое число от 1 до 65535');
  if (host !== '127.0.0.1' && (!process.env.PUBLIC_BASE_URL?.startsWith('https://') || process.env.DISABLE_LOCAL_LOGIN !== '1')) throw Error('Внешний сервер требует PUBLIC_BASE_URL=https://… и DISABLE_LOCAL_LOGIN=1');
  const server = createServer();
  server.requestTimeout = 120000;
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Укажите PORT.` : 'Не удалось запустить сервер'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`ELMA Wiki: ${process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`}`));
}

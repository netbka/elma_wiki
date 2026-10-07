import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from './lib/store.mjs';
import { limits } from './lib/e365.mjs';
import { createAuth } from './lib/auth.mjs';
import { createEmailSender } from './lib/email.mjs';
import { portalStore } from './lib/portals.mjs';
import { projectStore } from './lib/projects.mjs';
import { workspaceStore } from './lib/workspaces.mjs';
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
  sendEmail = createEmailSender(), now = Date.now,
  allowLocal = process.env.DISABLE_LOCAL_LOGIN === '0' && ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) && (!process.env.HOST || process.env.HOST === '127.0.0.1') } = {}) {
  const base = new URL(baseUrl), auth = createAuth({ baseUrl, allowLocal, sendEmail, now }), portals = portalStore(directory), projects = projectStore(directory), oldDemo = demoData(), sample = oldDemo.servers.showcase, demo = {entities:sample.entities,solution:sample.solutions[0],coverage:'structural',parserVersion:'2.0.0',inventory:[],provenance:{},synthetic:true};
  const workspaces = workspaceStore(projects);
  let uploading = false;
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
      const workspaceMatch = /^\/api\/projects\/([^/]+)\/workspace\/([^/]+)(?:\/(save|check|checkpoint|restore))?$/.exec(pathname);
      if (workspaceMatch) {
        const [,id,object,action] = workspaceMatch;
        if (!session || !await projects.get(id,session.user.id)) return send(res,404,{error:'Проект не найден'});
        if (req.method === 'GET' && !action) return send(res,200,await workspaces.read(id,session.user.id,object));
        if (req.method !== 'POST' || !action) return send(res,405,{error:'Метод не поддерживается'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Требуется JSON'});
        const payload = JSON.parse((await body(req,600*1024)).toString('utf8'));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res,400,{error:'Некорректный запрос'});
        return send(res,200,await workspaces[action](id,session.user.id,object,payload));
      }
      if (pathname === '/api/session' && req.method === 'GET') return send(res, 200, { user: session?.user || null, githubConfigured: false, emailConfigured: auth.emailConfigured, localEnabled: allowLocal });
      if (pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
      if (pathname === '/api/projects') {
        if (!session) return send(res,401,{error:'Войдите в сервис'});
        if (req.method === 'GET') {
          const legacy = (await portals.list(session.user.id)).map(p => ({...p,legacy:true,filename:p.name,coverage:'legacy',entities:null}));
          if (session.user.provider === 'local' && fs.existsSync(path.join(directory,'data.json'))) legacy.push({id:'local',filename:'Прежний локальный портал',legacy:true,coverage:'legacy'});
          return send(res,200,[...await projects.list(session.user.id),...legacy]);
        }
        if (req.method === 'POST') {
          if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') return send(res,415,{error:'Загрузите файл .e365'});
          if (uploading) return send(res,409,{error:'Дождитесь завершения текущей загрузки'});
          uploading = true;
          try { return send(res,201,await projects.create(session.user.id,await body(req,limits.upload),url.searchParams.get('filename') || 'configuration.e365')); }
          finally { uploading = false; }
        }
        return send(res,405,{error:'Метод не поддерживается'});
      }
      const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(data|report|original|preview|reparse|diagnostic-summary))?$/.exec(pathname);
      if (projectMatch) {
        const [,id,action] = projectMatch;
        if (!session || !await projects.get(id,session.user.id)) return send(res,404,{error:'Проект не найден'});
        const owner = session.user.id;
        if (req.method === 'DELETE' && !action) { await projects.delete(id,owner); return send(res,200,{ok:true}); }
        if (req.method === 'POST' && action === 'reparse') return send(res,200,await projects.reparse(id,owner));
        if (req.method !== 'GET') return send(res,405,{error:'Метод не поддерживается'});
        if (action === 'data' || action === 'report') return send(res,200,await projects.read(id,owner,action));
        if (action === 'preview') return send(res,200,await projects.preview(id,owner,url.searchParams.get('path')));
        if (action === 'diagnostic-summary') { const report = await projects.read(id,owner,'report'); return send(res,200,{parserVersion:report.parserVersion,status:report.status,counts:report.counts,files:report.files,indexedEntities:report.indexedEntities}); }
        if (action === 'original') { const bytes = await projects.original(id,owner); res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="original.e365"','Cache-Control':'no-store'}); return res.end(bytes); }
        return send(res,404,{error:'Страница не найдена'});
      }
      if (pathname.startsWith('/api/')) return send(res,404,{error:'API не найден'});
      const editorMatch = /^\/workspace\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (editorMatch) {
        if (!session || !await projects.get(editorMatch[1],session.user.id)) return send(res,404,{error:'Проект не найден'});
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Только чтение'});
        return serve(req,res,path.join(project,'web'),'/workspace.html');
      }
      const portalMatch = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
      if (portalMatch) {
        const [, id, requested = '/'] = portalMatch;
        if (!portalMatch[2]) { res.writeHead(302, { Location: `/p/${encodeURIComponent(id)}/` }); return res.end(); }
        const showcase = id === 'showcase', local = id === 'local' && session?.user.provider === 'local';
        const current = session && await projects.get(id,session.user.id), legacy = session && await portals.get(id,session.user.id);
        if (!showcase && !current && !legacy && !local) return send(res,404,{error:'Проект не найден'});
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Только чтение'});
        if (requested === '/data.json') {
          if (showcase) return send(res,200,demo);
          if (current) return send(res,200,await projects.read(id,session.user.id));
          const old = await readData(local ? path.join(directory,'data.json') : portals.dataFile(id));
          return send(res,200,{legacy:true,coverage:'legacy',entities:Object.values(old.servers || {}).flatMap(s => s.entities),solution:{},inventory:[],provenance:{}});
        }
        return serve(req, res, path.join(project, 'dist'), requested);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается' });
      if (pathname === '/dashboard' && !session) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      if (['/', '/login', '/dashboard', '/guide', '/flows'].includes(pathname)) return serve(req, res, path.join(project, 'web'), pathname === '/' ? '/index.html' : pathname + '.html');
      return serve(req, res, path.join(project, 'web'), pathname);
    } catch (error) {
      if (!res.headersSent) send(res, error.statusCode || error.status || 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error instanceof URIError ? 'Некорректный URL' : error.code ? 'Операция хранилища недоступна' : /fetch|ENOTFOUND|ECONN/.test(error.message) ? 'Внешний сервис недоступен' : error.message });
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

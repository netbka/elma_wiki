import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from './lib/store.mjs';
import { limits } from './lib/e365.mjs';
import { createAuth } from './lib/auth.mjs';
import { createEmailSender } from './lib/email.mjs';
import { createVkSender } from './lib/vk-teams.mjs';
import { portalStore } from './lib/portals.mjs';
import { projectStore } from './lib/projects.mjs';
import { workspaceStore } from './lib/workspaces.mjs';
import { releaseStore } from './lib/releases.mjs';
import { deliveryStore, syntheticAdapter } from './lib/delivery.mjs';
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
  sendEmail = createEmailSender(), sendVk = createVkSender(), now = Date.now,
  allowLocal = process.env.DISABLE_LOCAL_LOGIN === '0' && ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) && (!process.env.HOST || process.env.HOST === '127.0.0.1'),
  // The synthetic Target adapter is for tests/Storybook; a hosted service must opt in explicitly.
  syntheticDelivery = process.env.DELIVERY_SYNTHETIC_ADAPTER === '1',
  protectedTargetHosts = (process.env.PROTECTED_TARGET_HOSTS || '').split(',') } = {}) {
  const base = new URL(baseUrl), auth = createAuth({ baseUrl, allowLocal, sendEmail, sendVk, now }), portals = portalStore(directory), projects = projectStore(directory), oldDemo = demoData(), sample = oldDemo.servers.showcase, demo = {entities:sample.entities,solution:sample.solutions[0],coverage:'structural',parserVersion:'2.0.0',inventory:[],provenance:{},synthetic:true};
  const workspaces = workspaceStore(projects);
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  delivery = deliveryStore(directory, releases, { adapters: syntheticDelivery ? { synthetic: syntheticAdapter } : {}, protectedHosts: protectedTargetHosts });
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
      if (pathname === '/api/delivery/capabilities') {
        if (!session) return send(res,401,{error:'Войдите в сервис'});
        if (req.method !== 'GET') return send(res,405,{error:'Метод не поддерживается'});
        return send(res,200,{ mode: syntheticDelivery ? 'synthetic' : 'unavailable', liveDelivery: false });
      }
      if (pathname === '/api/releases') {
        if (!session) return send(res,401,{error:'Войдите в сервис'});
        if (req.method === 'GET') return send(res,200,await releases.list(session.user.id));
        if (req.method !== 'POST') return send(res,405,{error:'Метод не поддерживается'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Требуется JSON'});
        const input = JSON.parse((await body(req,64*1024)).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'Некорректный запрос'});
        return send(res,201,await releases.create(session.user.id,input));
      }
      if (pathname === '/api/connections/adapters') { if (!session) return send(res,401,{error:'Войдите в сервис'}); return send(res,200,{ adapters: delivery.adapterNames }); }
      const connectionMatch = /^\/api\/connections(?:\/([^/]+)(?:\/(probe))?)?$/.exec(pathname);
      if (connectionMatch) {
        const [,id,action] = connectionMatch;
        if (!session) return send(res,id ? 404 : 401,{error:id ? 'Подключение не найдено' : 'Войдите в сервис'});
        const owner = session.user.id;
        if (id) await delivery.connections.get(id,owner);
        if (req.method === 'GET' && !id) return send(res,200,await delivery.connections.list(owner));
        if (req.method === 'GET' && id && !action) return send(res,200,await delivery.connections.get(id,owner));
        if (req.method === 'DELETE' && id && !action) return send(res,200,await delivery.connections.remove(id,owner));
        if (req.method === 'POST' && id && action === 'probe') return send(res,200,await delivery.connections.probe(id,owner));
        if (req.method !== 'POST' || id) return send(res,405,{error:'Метод не поддерживается'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Требуется JSON'});
        const input = JSON.parse((await body(req,16*1024)).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'Некорректный запрос'});
        return send(res,201,await delivery.connections.create(owner,input));
      }
      const releaseMatch = /^\/api\/releases\/([^/]+)(?:\/(change|preview|bundle|delivery))?$/.exec(pathname);
      if (releaseMatch) {
        const [,id,action] = releaseMatch;
        if (!session) return send(res,404,{error:'Релиз не найден'});
        const owner = session.user.id;
        // Authorization precedes method/body validation on every release surface.
        await releases.authorize(id,owner);
        if (req.method === 'GET' && !action) return send(res,200,await releases.get(id,owner));
        if (req.method === 'GET' && action === 'preview') return send(res,200,await releases.preview(id,owner,url.searchParams.get('path'),url.searchParams.get('side')));
        if (req.method === 'GET' && action === 'delivery') return send(res,200,await delivery.list(id,owner));
        if (req.method !== 'POST' || !['change','bundle','delivery'].includes(action)) return send(res,405,{error:'Метод не поддерживается'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Требуется JSON'});
        const input = JSON.parse((await body(req,64*1024)).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'Некорректный запрос'});
        if (action === 'change') return send(res,200,await releases.change(id,owner,input));
        if (action === 'delivery') {
          if (input.action === 'prepare') return send(res,201,await delivery.prepare(id,owner,input));
          if (input.action === 'confirm') return send(res,200,await delivery.confirm(id,input.attemptId,owner,input));
          if (input.action === 'verify') return send(res,200,await delivery.verify(id,input.attemptId,owner));
          if (input.action === 'cancel') return send(res,200,await delivery.cancel(id,input.attemptId,owner));
          return send(res,400,{error:'Неизвестное действие доставки'});
        }
        const bundle = await releases.bundle(id,owner,input.revision);
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="release-handoff.zip"','Cache-Control':'no-store'});
        return res.end(bundle);
      }
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
      if (pathname === '/api/session' && req.method === 'GET') return send(res, 200, { user: session?.user || null, githubConfigured: false, emailConfigured: auth.emailConfigured, vkConfigured: auth.vkConfigured, vkBotUrl: auth.vkBotUrl, localEnabled: allowLocal });
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
      const snapshotMatch = /^\/api\/projects\/([^/]+)\/snapshots(?:\/([^/]+)\/(data|report|inventory|original|select))?$/.exec(pathname);
      if (snapshotMatch) {
        const [,id,snapshotId,action] = snapshotMatch;
        if (!session || !await projects.get(id,session.user.id)) return send(res,404,{error:'Проект не найден'});
        const owner = session.user.id;
        if (req.method === 'GET' && !snapshotId) return send(res,200,await projects.listSnapshots(id,owner));
        if (req.method === 'GET' && ['data','report','inventory'].includes(action)) return send(res,200,await projects.readSnapshot(id,owner,snapshotId,action));
        if (req.method === 'GET' && action === 'original') {
          const bytes = await projects.snapshotOriginal(id,owner,snapshotId);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="snapshot.e365"','Cache-Control':'no-store'});
          return res.end(bytes);
        }
        if (req.method !== 'POST' || action !== 'select') return send(res,405,{error:'Метод не поддерживается'});
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Требуется JSON'});
        const input = JSON.parse((await body(req,4096)).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'Некорректный запрос'});
        return send(res,200,await projects.selectSnapshot(id,owner,snapshotId,input.expectedSnapshotId));
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
      if (['/dashboard','/releases'].includes(pathname) && !session) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      if (['/', '/login', '/dashboard', '/guide', '/flows','/releases'].includes(pathname)) return serve(req, res, path.join(project, 'web'), pathname === '/' ? '/index.html' : pathname + '.html');
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

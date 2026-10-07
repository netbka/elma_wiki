import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { ciPolicy, refreshCi } from './ci.mjs';
import { Coordinator, Fault } from './core.mjs';
import { readPortal, commandPortal } from './portal.mjs';
import { VkClient, GitHubClient, secretEqual, normalizeVkEvent, verifyWebhook, githubCommentEvent, dispatchOne, reconcileIssues } from './adapters.mjs';

export function validateConfig(c, env) {
  if (!c || typeof c !== 'object' || !c.projects || !Object.keys(c.projects).length || !Array.isArray(c.bindings) || !Array.isArray(c.workers)) throw Error('Invalid request-bot configuration');
  for (const [key, p] of Object.entries(c.projects)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(key) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(p.repository) || !['wiki_code', 'elma_config'].includes(p.taskKind)) throw Error('Invalid project registry');
    if (p.ci) { ciPolicy(p.ci); if (p.taskKind !== 'wiki_code') throw Error('CI repair supports Wiki code only'); }
    if (['prod', 'production'].includes(String(p.environment).toLowerCase())) throw Error('PROD is not supported');
  }
  for (const b of c.bindings) {
    if (typeof b.actor !== 'string' || !b.actor || typeof b.chat !== 'string' || !b.chat || b.chat === 'portal' || !Array.isArray(b.projects) || !b.projects.length || b.projects.some(p => !c.projects[p])) throw Error('Invalid identity binding');
    if (b.githubUserId !== undefined && (!Number.isSafeInteger(b.githubUserId) || b.githubUserId < 1)) throw Error('Invalid GitHub identity');
  }
  const names = new Set(), values = new Set();
  const checkSecret = name => {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(name) || typeof env[name] !== 'string' || env[name].length < 32) throw Error('A configured secret is missing or too short');
    if (values.has(env[name])) throw Error('Roles must not share credentials');
    values.add(env[name]);
  };
  for (const w of c.workers) {
    if (typeof w.id !== 'string' || !w.id || names.has(w.id) || !Array.isArray(w.kinds) || !w.kinds.length || w.kinds.some(k => !['triage', 'implement', 'publish'].includes(k)) || !Array.isArray(w.projects) || !w.projects.length || w.projects.some(p => !c.projects[p])) throw Error('Invalid worker registry');
    if (w.kinds.includes('publish') && w.kinds.length !== 1) throw Error('Publisher must be isolated from coding workers');
    names.add(w.id); checkSecret(w.tokenEnv);
  }
  if (c.operatorTokenEnv) checkSecret(c.operatorTokenEnv);
  if (c.ingressTokenEnv) checkSecret(c.ingressTokenEnv);
  if (c.portal) {
    checkSecret(c.portal.tokenEnv);
    if (!Array.isArray(c.portal.bindings) || !c.portal.bindings.length || c.portal.bindings.some(b =>
      typeof b.owner !== 'string' || !b.owner || b.owner.length > 200 || !Array.isArray(b.projects) || !b.projects.length || b.projects.some(p => !c.projects[p]))) throw Error('Invalid portal identity binding');
  }
  if (c.vk) {
    if (!c.vk.botId || !c.vk.apiBase || !c.vk.tokenEnv || !env[c.vk.tokenEnv] || !['dispatcher', 'dedicated-polling'].includes(c.vk.mode)) throw Error('Invalid VK transport configuration');
    if (c.vk.mode === 'dispatcher' && !c.ingressTokenEnv) throw Error('Dispatcher ingress credential is required');
    if (c.vk.mode === 'dedicated-polling' && c.vk.dedicatedBotConfirmed !== true) throw Error('Do not start a competing poller for an existing bot');
  }
  if (!c.vk && !c.portal) throw Error('A portal or VK ingress is required');
  if (!c.github?.botLogin || !c.github.tokenEnv || !env[c.github.tokenEnv] || !c.github.webhookSecretEnv) throw Error('GitHub transport configuration is required');
  checkSecret(c.github.webhookSecretEnv);
  if (c.leaseMs !== undefined && (!Number.isInteger(c.leaseMs) || c.leaseMs < 1000 || c.leaseMs > 600000)) throw Error('Invalid lease duration');
  if (c.maxActive !== undefined && (!Number.isInteger(c.maxActive) || c.maxActive < 1 || c.maxActive > 100)) throw Error('Invalid active request limit');
  if (c.maxJobs !== undefined && (!Number.isInteger(c.maxJobs) || c.maxJobs < 1 || c.maxJobs > 100)) throw Error('Invalid job limit');
  if (c.maxRunMs !== undefined && (!Number.isInteger(c.maxRunMs) || c.maxRunMs < 1000 || c.maxRunMs > 3600000)) throw Error('Invalid run duration');
  return c;
}
async function body(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Fault('json_required', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) throw new Fault('body_too_large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parse(raw) { try { const data = JSON.parse(raw.toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; } catch { throw new Fault('invalid_json', 400); } }
function bearer(req) { return req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''; }

export function createApp(core, adapters, env, { signal } = {}) {
  const c = core.config;
  const server = createServer(async (req, res) => {
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (signal?.aborted) throw new Fault('service_stopping', 503);
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/healthz' && req.method === 'GET') return reply(200, { status: 'ok', liveDelivery: false });
      if (path.startsWith('/portal/')) {
        if (!c.portal || !secretEqual(bearer(req), env[c.portal.tokenEnv])) throw new Fault('unauthorized', 401);
        if (req.method !== 'POST') throw new Fault('not_found', 404);
        const data = parse(await body(req));
        if (Object.keys(data).some(k => !['owner', 'id', 'input'].includes(k))) throw new Fault('invalid_command', 400);
        if (path === '/portal/read' && data.input === undefined) return reply(200, readPortal(core, data.owner, data.id));
        if (path === '/portal/command' && data.id === undefined) return reply(200, commandPortal(core, data.owner, data.input));
        throw new Fault('not_found', 404);
      }
      if (path.startsWith('/ops/')) {
        if (!secretEqual(bearer(req), env[c.operatorTokenEnv])) throw new Fault('unauthorized', 401);
        if (path === '/ops/status' && req.method === 'GET') return reply(200, {
          jobs: core.s.all('SELECT id,request_id,kind,status,attempts,expires FROM jobs ORDER BY id DESC LIMIT 100'),
          outbox: core.s.all('SELECT id,request_id,kind,status,error_code FROM outbox ORDER BY id DESC LIMIT 100') });
        if (path === '/ops/reconcile' && req.method === 'POST') { const r = core.reconcile(); await reconcileIssues(core, adapters.github); await refreshCi(core, adapters.github, signal); return reply(200, r); }
        throw new Fault('not_found', 404);
      }
      if (path === '/integrations/vk/events' && req.method === 'POST') {
        if (c.vk?.mode !== 'dispatcher' || !secretEqual(bearer(req), env[c.ingressTokenEnv])) throw new Fault('unauthorized', 401);
        const data = parse(await body(req));
        if (!Array.isArray(data.events) || data.events.length > 100) throw new Fault('invalid_batch', 400);
        const events = data.events.map(e => normalizeVkEvent(e, c.vk.botId));
        return reply(200, { outcomes: core.ingest(`vk:${c.vk.botId}`, events) });
      }
      if (path === '/integrations/github/webhook' && req.method === 'POST') {
        const raw = await body(req);
        if (!verifyWebhook(raw, req.headers['x-hub-signature-256'], env[c.github.webhookSecretEnv])) throw new Fault('invalid_signature', 401);
        const payload = parse(raw);
        const e = req.headers['x-github-event'] === 'issue_comment' ? githubCommentEvent(core, payload) : null;
        return reply(202, { outcomes: e ? core.ingest('github', [e]) : [] });
      }
      if (path.startsWith('/worker/') && req.method === 'POST') {
        const worker = c.workers.find(w => secretEqual(bearer(req), env[w.tokenEnv]));
        if (!worker) throw new Fault('unauthorized', 401);
        const data = parse(await body(req));
        if (path === '/worker/claim') return reply(200, { job: core.claim(worker) });
        const m = path.match(/^\/worker\/jobs\/(\d+)\/(heartbeat|complete|fail)$/);
        if (!m || typeof data.leaseToken !== 'string') throw new Fault('not_found', 404);
        const id = Number(m[1]);
        if (m[2] === 'heartbeat') return reply(200, core.heartbeat(worker, id, data.leaseToken));
        if (m[2] === 'fail') return reply(200, core.fail(worker, id, data.leaseToken, data.code));
        const prior = core.s.get('SELECT status FROM jobs WHERE id=?', id);
        if (prior?.status === 'done') return reply(200, core.complete(worker, id, data.leaseToken, data.result));
        const { j, r } = core.leased(worker, id, data.leaseToken);
        const receipt = j.kind === 'publish' ? await adapters.github.verifyPr(r, core.project(r.project), data.result) : null;
        return reply(200, core.complete(worker, id, data.leaseToken, data.result, receipt));
      }
      throw new Fault('not_found', 404);
    } catch (error) { if (!res.headersSent) reply(error instanceof Fault ? error.status : 500, { error: error instanceof Fault ? error.code : 'internal_error' }); else res.destroy(); }
  });
  server.requestTimeout = 45000; server.headersTimeout = 10000; server.maxHeadersCount = 30;
  return server;
}
export function startLoops(core, adapters, { signal, onError = () => {} } = {}) {
  const stopped = new AbortController();
  const ciSignal = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
  let busy = false, reconciling = false, checking = false;
  const checkCi = async () => {
    if (checking || ciSignal.aborted) return;
    checking = true;
    try { await refreshCi(core, adapters.github, ciSignal); } catch { onError('ci_observation_failed'); }
    finally { checking = false; }
  };
  const flush = async () => {
    if (busy || signal?.aborted) return;
    busy = true;
    try { for (let i = 0; i < 20 && !signal?.aborted && await dispatchOne(core, adapters); i++); }
    catch { onError('dispatch_failed'); } finally { busy = false; }
  };
  const recover = async () => {
    if (reconciling || signal?.aborted) return;
    reconciling = true;
    try { core.reconcile(); await reconcileIssues(core, adapters.github); await checkCi(); }
    catch { onError('reconcile_failed'); } finally { reconciling = false; }
  };
  const delivery = setInterval(flush, 1000), reconciliation = setInterval(recover, 15 * 60 * 1000), ciTimer = setInterval(checkCi, 60000);
  delivery.unref(); reconciliation.unref(); ciTimer.unref();
  const stop = () => { stopped.abort(); clearInterval(delivery); clearInterval(reconciliation); clearInterval(ciTimer); };
  signal?.addEventListener('abort', stop, { once: true });
  void recover();
  return { stop, flush, recover, checkCi };
}
export async function pollOnce(core, vk) {
  const stream = `vk:${core.config.vk.botId}`, cursor = core.s.get('SELECT position FROM cursors WHERE stream=?', stream)?.position || 0;
  const raw = await vk.events(cursor);
  if (!raw.length) return [];
  const events = raw.map(e => normalizeVkEvent(e, core.config.vk.botId));
  // Persist every event outcome before advancing the durable cursor, in one transaction.
  return core.ingest(stream, events, Math.max(...raw.map(e => e.eventId)));
}
export async function main(env = process.env) {
  if (env.REQUEST_BOT_ENABLED !== '1') throw Error('Request bot disabled; set REQUEST_BOT_ENABLED=1 after configuring dedicated credentials');
  if (!env.REQUEST_BOT_CONFIG || !env.REQUEST_BOT_DATABASE) throw Error('Set REQUEST_BOT_CONFIG and REQUEST_BOT_DATABASE');
  const config = validateConfig(JSON.parse(readFileSync(env.REQUEST_BOT_CONFIG, 'utf8')), env);
  process.umask(0o077);
  const store = new Store(env.REQUEST_BOT_DATABASE), core = new Coordinator(store, config);
  const adapters = { ...(config.vk ? { vk: new VkClient({ ...config.vk, token: () => env[config.vk.tokenEnv] }) } : {}), github: new GitHubClient({ ...config.github, token: () => env[config.github.tokenEnv] }) };
  const abort = new AbortController(), app = createApp(core, adapters, env, { signal: abort.signal });
  const port = Number(env.REQUEST_BOT_PORT || 43174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(port, '127.0.0.1', resolve); });
  const loops = startLoops(core, adapters, { signal: abort.signal, onError: code => console.error(code) });
  console.log(`Request coordinator listening on loopback:${port}; live delivery is disabled`);
  if (config.vk?.mode === 'dedicated-polling') void (async () => {
    let failures = 0;
    while (!abort.signal.aborted) {
      try { await pollOnce(core, adapters.vk); failures = 0; }
      catch { failures++; console.error('vk_poll_failed'); await new Promise(r => setTimeout(r, Math.min(60000, 1000 * 2 ** Math.min(failures, 6)))); }
    }
  })();
  const shutdown = () => { abort.abort(); loops.stop(); app.close(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  return { app, core, store, shutdown };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Request bot startup failed. Check local configuration; no secrets are logged.'); process.exitCode = 1; });

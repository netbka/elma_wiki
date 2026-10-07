import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../services/request-bot/store.mjs';
import { Coordinator } from '../services/request-bot/core.mjs';
import { readPortal, commandPortal } from '../services/request-bot/portal.mjs';
import { createApp, validateConfig } from '../services/request-bot/server.mjs';
import { createServer } from '../server.mjs';
import { requestCoordinator } from '../lib/request-coordinator.mjs';

const secrets = { AGENT_KEY: 'a'.repeat(40), PUBLISHER_KEY: 'p'.repeat(40),
  PORTAL_KEY: 'w'.repeat(40), GITHUB_KEY: 'g'.repeat(40), WEBHOOK_KEY: 'h'.repeat(40) };
const config = () => ({ projects: { wiki: { repository: 'fixture/wiki', taskKind: 'wiki_code' } },
  bindings: [], portal: { tokenEnv: 'PORTAL_KEY', bindings: [{ owner: 'local', projects: ['wiki'] }, { owner: 'other', projects: ['wiki'] }] },
  workers: [{ id: 'agent', tokenEnv: 'AGENT_KEY', kinds: ['triage', 'implement'], projects: ['wiki'] },
    { id: 'publisher', tokenEnv: 'PUBLISHER_KEY', kinds: ['publish'], projects: ['wiki'] }],
  github: { tokenEnv: 'GITHUB_KEY', botLogin: 'fixture-bot', webhookSecretEnv: 'WEBHOOK_KEY' } });
const command = (operationId, extra = {}) => ({ operationId, action: 'create', project: 'wiki', text: 'Synthetic portal task', ...extra });
function setup(t) {
  const store = new Store(':memory:'), cfg = validateConfig(config(), secrets), core = new Coordinator(store, cfg);
  t.after(() => store.close());
  return { core, store, cfg };
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('portal-only configuration needs no VK account and isolates ingress/worker credentials', t => {
  const { core } = setup(t);
  assert.equal(core.config.vk, undefined);
  const bad = config(); bad.portal.tokenEnv = 'AGENT_KEY';
  assert.throws(() => validateConfig(bad, secrets), /share/);
  const forged = config(); forged.bindings = [{ actor: 'local', chat: 'portal', projects: ['wiki'] }];
  assert.throws(() => validateConfig(forged, secrets), /binding/);
  const missing = config(); delete missing.portal;
  assert.throws(() => validateConfig(missing, secrets), /ingress/);
});

test('portal owner isolation, no VK messages, immutable retries and stale approval', t => {
  const { core, store, cfg } = setup(t), input = command('synthetic-operation-01');
  const created = commandPortal(core, 'local', input);
  assert.equal(commandPortal(core, 'local', input).id, created.id);
  assert.equal(store.all('SELECT * FROM requests').length, 1);
  assert.equal(store.all('SELECT * FROM jobs').length, 1);
  assert.equal(store.all("SELECT * FROM outbox WHERE kind='vk'").length, 0);
  assert.throws(() => commandPortal(core, 'local', { ...input, text: 'Different' }), /operation_id_reused/);
  assert.throws(() => readPortal(core, 'other', created.id), /not_found/);
  assert.throws(() => readPortal(core, 'not-bound'), /not_authorized/);
  assert.deepEqual(readPortal(core, 'other').requests, []);
  assert.throws(() => commandPortal(core, 'local', command('synthetic-denied-01', { project: 'not-bound' })), /not_authorized/);
  const job = core.claim(cfg.workers[0]);
  core.complete(cfg.workers[0], job.id, job.leaseToken, { type: 'specification', summary: 'Synthetic change', criteria: ['Visible result'], scope: ['Wiki only'] });
  assert.throws(() => commandPortal(core, 'local', { operationId: 'synthetic-stale-01', action: 'approve', requestId: created.id, revision: 0 }), /stale_revision/);
  const approve = { operationId: 'synthetic-approve-01', action: 'approve', requestId: created.id, revision: 1 };
  assert.equal(commandPortal(core, 'local', approve).state, 'QUEUED');
  assert.equal(commandPortal(core, 'local', approve).state, 'QUEUED');
  assert.equal(store.all("SELECT * FROM jobs WHERE kind='implement'").length, 1);
  assert.equal(core.claim(cfg.workers[0]).kind, 'implement');
  assert.equal(readPortal(core, 'local', created.id).deployed, false);
  assert.equal(JSON.stringify(readPortal(core, 'local', created.id)).includes('leaseToken'), false);
});

test('portal clarification advances revision and cancellation stops queued work', t => {
  const { core, cfg } = setup(t), r = commandPortal(core, 'local', command('synthetic-operation-02'));
  const j = core.claim(cfg.workers[0]);
  core.complete(cfg.workers[0], j.id, j.leaseToken, { type: 'needs_input', questions: ['Which field?'] });
  assert.deepEqual(readPortal(core, 'local', r.id).questions, ['Which field?']);
  const revised = commandPortal(core, 'local', { operationId: 'synthetic-reply-01', action: 'reply', requestId: r.id, revision: 1, text: 'Field A' });
  assert.equal(revised.revision, 2);
  assert.equal(revised.state, 'TRIAGING');
  assert.deepEqual(revised.questions, []);
  commandPortal(core, 'local', { operationId: 'synthetic-cancel-01', action: 'cancel', requestId: r.id, revision: 2 });
  assert.equal(core.claim(cfg.workers[0]), null);
  assert.equal(readPortal(core, 'local', r.id).state, 'CANCELLED');
});

test('portal retry receipt survives coordinator restart and changed allowlist cannot regain access', t => {
  const directory = mkdtempSync(join(tmpdir(), 'wiki-request-restart-'));
  let store = new Store(join(directory, 'queue.sqlite'));
  t.after(() => { store.close(); assert.equal(join(directory, '..'), join(tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  const cfg = config(), input = command('synthetic-operation-03');
  const r = commandPortal(new Coordinator(store, cfg), 'local', input);
  store.close(); store = new Store(join(directory, 'queue.sqlite'));
  const core = new Coordinator(store, cfg);
  assert.equal(commandPortal(core, 'local', input).id, r.id);
  cfg.portal.bindings = cfg.portal.bindings.filter(b => b.owner !== 'local');
  assert.throws(() => commandPortal(core, 'local', input), /not_authorized/);
});

test('real Wiki session forwards only its owner to the real coordinator and its existing worker protocol', async t => {
  const store = new Store(':memory:'), cfg = config(), core = new Coordinator(store, cfg);
  const coordinator = createApp(core, { github: {} }, secrets), coordinatorUrl = await listen(coordinator);
  const directory = mkdtempSync(join(tmpdir(), 'wiki-request-http-'));
  const wiki = createServer({ directory, allowLocal: true, sendEmail: undefined,
    requests: requestCoordinator({ url: coordinatorUrl, token: secrets.PORTAL_KEY }) });
  const base = await listen(wiki), headers = { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' };
  t.after(async () => { await close(wiki); await close(coordinator); store.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await fetch(base + '/api/requests')).status, 401);
  const login = await fetch(base + '/auth/local', { method: 'POST', headers });
  headers.cookie = login.headers.getSetCookie()[0].split(';')[0];
  const send = (route, input) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal((await send('/api/requests', { operationId: 'synthetic-http-01', project: 'wiki', text: 'Change', owner: 'other' })).status, 400);
  const r = await (await send('/api/requests', { operationId: 'synthetic-http-01', project: 'wiki', text: 'Change' })).json();
  assert.equal(store.request(r.id).owner, 'local');
  assert.equal((await fetch(base + '/api/requests', { headers })).status, 200);
  const worker = (route, input) => fetch(coordinatorUrl + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secrets.AGENT_KEY }, body: JSON.stringify(input) });
  assert.equal((await worker('/portal/read', { owner: 'local' })).status, 401);
  const { job } = await (await worker('/worker/claim', {})).json();
  assert.equal(job.request.id, r.id);
  assert.equal((await worker('/worker/jobs/' + job.id + '/complete', { leaseToken: job.leaseToken,
    result: { type: 'specification', summary: 'Change', criteria: ['Visible'], scope: ['Wiki'] } })).status, 200);
  assert.equal((await send('/api/requests/' + r.id + '/approve', { operationId: 'synthetic-http-approve', revision: 1 })).status, 200);
  assert.equal((await (await worker('/worker/claim', {})).json()).job.kind, 'implement');
  assert.equal((await send('/api/requests/' + r.id + '/cancel', { operationId: 'synthetic-http-cancel', revision: 1 })).status, 200);
  const session = await (await fetch(base + '/api/session', { headers })).json();
  assert.equal(JSON.stringify(session).includes(secrets.PORTAL_KEY), false);
  assert.equal((await fetch(base + '/api/requests', { method: 'POST', headers: { ...headers, origin: 'https://elsewhere.invalid' },
    body: JSON.stringify({ operationId: 'synthetic-http-02', project: 'wiki', text: 'Change' }) })).status, 403);
  assert.equal((await fetch(base + '/api/requests', { method: 'POST', headers: { cookie: headers.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('transport refuses unsafe destinations and secrets are absent from failed responses', async () => {
  for (const url of ['http://localhost:43174', 'http://example.test', 'https://user:pass@example.test', 'https://example.test/path']) {
    assert.throws(() => requestCoordinator({ url, token: secrets.PORTAL_KEY }));
  }
  const client = requestCoordinator({ url: 'https://queue.example.test', token: secrets.PORTAL_KEY,
    fetchImpl: async () => new Response(secrets.PORTAL_KEY, { status: 500 }) });
  await assert.rejects(client.read('local'), error => error.status === 503 && !error.message.includes(secrets.PORTAL_KEY));
  const offline = requestCoordinator({ url: 'https://queue.example.test', token: secrets.PORTAL_KEY, fetchImpl: async () => { throw Error(secrets.PORTAL_KEY); } });
  await assert.rejects(offline.command('local', command('synthetic-offline-01')), error => error.status === 503 && !error.message.includes(secrets.PORTAL_KEY));
});

test('Wiki explicitly reports a missing coordinator and never invents a local accepted job', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'wiki-request-offline-'));
  const wiki = createServer({ directory, allowLocal: true, sendEmail: undefined, requests: null }), base = await listen(wiki);
  t.after(async () => { await close(wiki); rmSync(directory, { recursive: true, force: true }); });
  const login = await fetch(base + '/auth/local', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1' } });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const response = await fetch(base + '/api/requests', { headers: { cookie } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).configured, false);
});

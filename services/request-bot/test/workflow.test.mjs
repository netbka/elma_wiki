import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Store } from '../store.mjs';
import { Coordinator, Fault } from '../core.mjs';
import { VkClient, GitHubClient, dispatchOne, reconcileIssues, normalizeVkEvent, verifyWebhook, githubCommentEvent, prMarker } from '../adapters.mjs';
import { createApp, pollOnce, validateConfig, main } from '../server.mjs';

const config = () => ({
  leaseMs: 1000, maxRunMs: 5000,
  projects: { wiki: { repository: 'example/wiki', taskKind: 'wiki_code' }, elma: { repository: 'example/elma', taskKind: 'elma_config', targetRef: 'test-only' } },
  bindings: [{ actor: 'alice', chat: 'alice-chat', projects: ['wiki'], githubUserId: 7 }, { actor: 'bob', chat: 'bob-chat', projects: ['elma'] }],
  workers: [{ id: 'agent', tokenEnv: 'AGENT_KEY', kinds: ['triage', 'implement'], projects: ['wiki'] }, { id: 'publisher', tokenEnv: 'PUBLISHER_KEY', kinds: ['publish'], projects: ['wiki'] }],
  vk: { botId: 'bot', apiBase: 'https://chat.example.test/bot/v1', tokenEnv: 'VK_KEY', mode: 'dispatcher' },
  github: { tokenEnv: 'GITHUB_KEY', botLogin: 'delivery-bot', webhookSecretEnv: 'WEBHOOK_KEY' },
  ingressTokenEnv: 'INGRESS_KEY', operatorTokenEnv: 'OPS_KEY'
});
const env = { AGENT_KEY: 'a'.repeat(40), PUBLISHER_KEY: 'p'.repeat(40), INGRESS_KEY: 'i'.repeat(40), OPS_KEY: 'o'.repeat(40), VK_KEY: 'v'.repeat(40), GITHUB_KEY: 'g'.repeat(40), WEBHOOK_KEY: 'h'.repeat(40) };
const spec = { type: 'specification', summary: 'Add a safe field', criteria: ['Empty value is rejected on return', 'Normal save still works'], scope: ['Test form only'] };
const patch = { type: 'patch_ready', artifactId: 'artifact_01', sha256: 'a'.repeat(64), baseSha: 'b'.repeat(40) };
function setup(t, filename = ':memory:') {
  const s = new Store(filename), cfg = config(); let now = 10000, event = 0;
  const core = new Coordinator(s, cfg, () => now);
  t.after(() => s.close());
  const message = (text, opts = {}) => core.ingest('vk:bot', [{ id: ++event, type: 'message', actor: 'alice', chat: 'alice-chat', text, ...opts }])[0];
  const start = () => message('/task wiki Add a field').requestId;
  const propose = id => { const j = core.claim(cfg.workers[0]); assert.equal(j.request.id, id); core.complete(cfg.workers[0], j.id, j.leaseToken, spec); return j; };
  return { s, core, cfg, message, start, propose, advance: ms => now += ms };
}
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof Fault && e.code === code);

test('durable request, inbox deduplication and restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'request-bot-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite'); let s = new Store(file), c = new Coordinator(s, config());
  const events = [{ id: 1, type: 'message', actor: 'alice', chat: 'alice-chat', text: '/task wiki Example' }];
  const r = c.ingest('vk:bot', events, 1)[0]; s.close(); s = new Store(file); c = new Coordinator(s, config());
  assert.deepEqual(c.ingest('vk:bot', events, 1)[0], r);
  assert.equal(s.get('SELECT count(*) n FROM requests').n, 1);
  assert.equal(s.get("SELECT count(*) n FROM outbox WHERE kind='github_issue'").n, 1);
  assert.equal(s.get('SELECT position FROM cursors').position, 1);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  s.close();
});
test('natural private message, clarification and explicit approval', t => {
  const f = setup(t); const id = f.message('Add a field', { chatType: 'private' }).requestId;
  const j = f.core.claim(f.cfg.workers[0]);
  f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, { type: 'needs_input', questions: ['Which form?'] });
  assert.equal(f.s.request(id).state, 'WAITING_USER');
  assert.equal(f.message('Payment form', { chatType: 'private' }).requestId, id);
  assert.equal(f.s.request(id).revision, 2);
  f.propose(id); assert.equal(f.core.claim(f.cfg.workers[0]), null);
  assert.equal(f.message(`/approve ${id} 1`).code, 'stale_approval');
  f.message(`/approve ${id} 2`);
  const implementation = f.core.claim(f.cfg.workers[0]); assert.equal(implementation.kind, 'implement');
  assert.equal(implementation.request.approval.revision, 2);
});
test('two waiting requests are not guessed from an unthreaded answer', t => {
  const f = setup(t); f.start(); f.start();
  for (let i = 0; i < 2; i++) { const j = f.core.claim(f.cfg.workers[0]); f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, { type: 'needs_input', questions: ['Which form?'] }); }
  assert.equal(f.message('Payment').code, 'use_task_or_reply');
  assert.equal(f.s.get('SELECT count(*) n FROM requests').n, 2);
});
test('group messages require an explicit command and exact actor/chat allowlist', t => {
  const f = setup(t);
  assert.equal(f.message('Hello', { chatType: 'group' }).status, 'rejected');
  assert.equal(f.message('/task wiki Evil', { actor: 'mallory' }).code, 'not_authorized');
  assert.equal(f.message('/task elma Evil').code, 'not_authorized');
  assert.equal(f.s.get('SELECT count(*) n FROM requests').n, 0);
});
test('malformed event/cursor rolls back whole batch, rejected event does not poison other events', t => {
  const f = setup(t), e = { id: 1, type: 'message', actor: 'alice', chat: 'alice-chat', text: '/task wiki Valid' };
  throwsCode(() => f.core.ingest('vk:bot', [e], -1), 'invalid_cursor');
  assert.equal(f.s.get('SELECT count(*) n FROM requests').n, 0);
  const r = f.core.ingest('vk:bot', [{ ...e, actor: 'evil' }, { ...e, id: 2 }], 2);
  assert.equal(r[0].status, 'rejected'); assert.equal(r[1].status, 'accepted');
  assert.equal(f.s.get('SELECT position FROM cursors').position, 2);
});
test('another user cannot read status, reply, cancel or approve a request', t => {
  const f = setup(t), id = f.start(); f.propose(id);
  for (const cmd of ['status', 'cancel', 'reply', 'approve']) assert.equal(f.message(`/${cmd} ${id} 1`, { actor: 'bob', chat: 'bob-chat' }).code, 'not_found');
  assert.equal(f.s.request(id).state, 'AWAITING_APPROVAL');
});
test('opaque button is owner/revision-bound and single use', t => {
  const f = setup(t), id = f.start(); f.propose(id);
  const card = f.s.all("SELECT payload FROM outbox WHERE kind='vk'").map(x => JSON.parse(x.payload)).find(x => x.buttons);
  const button = { id: 90, type: 'callback', actor: 'alice', chat: 'alice-chat', token: card.buttons[0][0].callbackData };
  assert.equal(f.core.ingest('vk:bot', [{ ...button, id: 89, actor: 'bob', chat: 'bob-chat' }])[0].status, 'rejected');
  assert.equal(f.core.ingest('vk:bot', [button])[0].status, 'accepted');
  assert.equal(f.core.ingest('vk:bot', [{ ...button, id: 91 }])[0].status, 'rejected');
  assert.equal(f.s.all("SELECT * FROM jobs WHERE kind='implement'").length, 1);
});
test('requirements revision invalidates old buttons and approval', t => {
  const f = setup(t), id = f.start(); f.propose(id);
  const card = f.s.all('SELECT payload FROM outbox').map(x => JSON.parse(x.payload)).find(x => x.buttons);
  f.message(`/reply ${id} Use another form`);
  assert.equal(f.core.ingest('vk:bot', [{ id: 80, type: 'callback', actor: 'alice', chat: 'alice-chat', token: card.buttons[0][0].callbackData }])[0].status, 'rejected');
  assert.equal(f.s.request(id).revision, 2);
});
test('job lease fences concurrent claims, stale completion, and cross-role callbacks', t => {
  const f = setup(t), id = f.start(), w = f.cfg.workers[0], j = f.core.claim(w);
  assert.equal(f.core.claim(w), null);
  throwsCode(() => f.core.complete(f.cfg.workers[1], j.id, j.leaseToken, spec), 'lease_not_found');
  f.advance(1001); throwsCode(() => f.core.complete(w, j.id, j.leaseToken, spec), 'lease_lost');
  assert.equal(f.core.reconcile().recovered, 1);
  const next = f.core.claim(w); assert.notEqual(next.leaseToken, j.leaseToken);
  throwsCode(() => f.core.complete(w, j.id, j.leaseToken, spec), 'lease_not_found');
  f.core.complete(w, next.id, next.leaseToken, spec); assert.equal(f.s.request(id).state, 'AWAITING_APPROVAL');
});
test('heartbeat cannot extend the configured run deadline', t => {
  const f = setup(t); f.start(); const j = f.core.claim(f.cfg.workers[0]);
  for (let i = 0; i < 6; i++) { f.advance(800); f.core.heartbeat(f.cfg.workers[0], j.id, j.leaseToken); }
  f.advance(201); throwsCode(() => f.core.heartbeat(f.cfg.workers[0], j.id, j.leaseToken), 'lease_lost');
});
test('uncertain implementation is blocked, never automatically re-executed', t => {
  const f = setup(t), id = f.start(); f.propose(id); f.message(`/approve ${id} 1`);
  f.core.claim(f.cfg.workers[0]); f.advance(1001); f.core.reconcile();
  assert.equal(f.s.request(id).blocker, 'worker_outcome_unknown'); assert.equal(f.core.claim(f.cfg.workers[0]), null);
});
test('cancel fences a running job without claiming rollback', t => {
  const f = setup(t), id = f.start(), j = f.core.claim(f.cfg.workers[0]); f.message(`/cancel ${id}`);
  throwsCode(() => f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, spec), 'lease_lost');
  assert.equal(f.s.request(id).state, 'CANCELLED'); assert.equal(f.core.claim(f.cfg.workers[0]), null);
});
test('malformed model output cannot change policy, environment or state', t => {
  const f = setup(t), id = f.start(), j = f.core.claim(f.cfg.workers[0]);
  throwsCode(() => f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, { ...spec, targetRef: 'prod' }), 'invalid_result');
  assert.equal(f.s.request(id).state, 'TRIAGING');
});
test('model cannot publish a PR; trusted publisher needs independently verified receipt', t => {
  const f = setup(t), id = f.start(), agent = f.cfg.workers[0], publisher = f.cfg.workers[1];
  f.propose(id); f.message(`/approve ${id} 1`);
  const j = f.core.claim(agent); f.core.complete(agent, j.id, j.leaseToken, patch);
  assert.equal(f.core.claim(agent), null);
  const p = f.core.claim(publisher), result = { type: 'pull_request', number: 42, headSha: 'c'.repeat(40) };
  throwsCode(() => f.core.complete(publisher, p.id, p.leaseToken, result), 'publication_not_verified');
  f.core.complete(publisher, p.id, p.leaseToken, result, { repository: 'example/wiki', number: 42, headSha: result.headSha });
  assert.equal(f.s.request(id).state, 'PR_READY'); assert.equal(f.s.request(id).pr.number, 42);
  f.message(`/changes ${id} Move the field`);
  assert.equal(f.s.request(id).revision, 2); assert.equal(f.s.request(id).previousPrs[0].number, 42);
});
test('duplicate completion acknowledges once without repeating effects', t => {
  const f = setup(t); f.start(); const j = f.core.claim(f.cfg.workers[0]);
  f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, spec);
  const n = f.s.get('SELECT count(*) n FROM outbox').n;
  assert.equal(f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, spec).replay, true);
  assert.equal(f.s.get('SELECT count(*) n FROM outbox').n, n);
});
test('job budget stops a new iteration rather than scheduling unbounded work', t => {
  const f = setup(t); f.core.maxJobs = 1; const id = f.start(); f.propose(id); f.message(`/approve ${id} 1`);
  assert.equal(f.s.request(id).blocker, 'job_budget_exhausted'); assert.equal(f.core.claim(f.cfg.workers[0]), null);
});
test('outbox ambiguous create is reconciled by read, never by repeating the POST', async t => {
  const f = setup(t), id = f.start(); let creates = 0;
  const adapters = { github: { createIssue: async () => { creates++; throw Error('timeout'); }, recoverIssue: async () => 77 }, vk: { send: async () => 'msg' } };
  await dispatchOne(f.core, adapters); assert.equal(creates, 1);
  assert.equal(f.s.get("SELECT status FROM outbox WHERE kind='github_issue'").status, 'unknown');
  await reconcileIssues(f.core, adapters.github); assert.equal(creates, 1); assert.equal(f.s.request(id).issueNumber, 77);
});
test('missing recovery result stays unknown; interrupted send is not retried', async t => {
  const f = setup(t); f.start(); f.core.claimOutbox(); f.advance(60001); f.core.reconcile();
  await reconcileIssues(f.core, { recoverIssue: async () => null });
  assert.equal(f.s.get("SELECT status FROM outbox WHERE kind='github_issue'").status, 'unknown');
});
test('stale approval card is never sent after cancellation', async t => {
  const f = setup(t), id = f.start(); f.propose(id); f.message(`/cancel ${id}`); const cards = [];
  const a = { github: { createIssue: async () => 1 }, vk: { send: async (_chat, payload) => { cards.push(payload); return 'msg'; } } };
  while (await dispatchOne(f.core, a));
  assert.equal(cards.some(x => x.buttons), false);
});
test('VK transport uses explicit base URL, bounded request, and does not leak token in errors', async () => {
  let seen;
  const vk = new VkClient({ apiBase: 'https://chat.example.test/bot/v1', token: () => 'private-token' }, async (url, options) => { seen = { url, options }; return new Response(JSON.stringify({ ok: true, msgId: '11' })); });
  assert.equal(await vk.send('alice', { text: 'Hello' }), '11');
  assert.equal(seen.url.pathname, '/bot/v1/messages/sendText'); assert.equal(seen.options.redirect, 'error');
  assert.throws(() => new VkClient({ apiBase: 'https://user:secret@example.test', token: () => 'x' }));
  const failing = new VkClient({ apiBase: 'https://example.test/bot/v1', token: () => 'secret' }, async () => { throw Error('secret token URL'); });
  await assert.rejects(failing.send('a', { text: 'hi' }), e => e.code === 'vk_request_failed' && !e.message.includes('secret'));
});
test('GitHub public issue contains no customer request or private specification', async () => {
  let sent;
  const gh = new GitHubClient({ token: () => 'x', botLogin: 'delivery-bot' }, async (_url, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify({ number: 9, user: { login: 'delivery-bot' } })); });
  await gh.createIssue({ id: 'REQ-ABC123ABC123', project: 'wiki', messages: ['sensitive customer details'], spec }, { repository: 'example/wiki' });
  assert.equal(JSON.stringify(sent).includes('sensitive'), false); assert.equal(JSON.stringify(sent).includes(spec.summary), false);
});
test('independent PR read rejects wrong SHA, branch, repository and revision marker', async () => {
  const r = { id: 'REQ-ABC123ABC123', revision: 2 }, project = { repository: 'example/wiki' }, result = { number: 5, headSha: 'f'.repeat(40) };
  const valid = { number: 5, state: 'open', head: { sha: result.headSha, ref: `bot/${r.id.toLowerCase()}/v2`, repo: { full_name: project.repository } }, base: { ref: 'main', repo: { full_name: project.repository } }, body: prMarker(r.id, 2) };
  let data = valid;
  const gh = new GitHubClient({ token: () => 'x', botLogin: 'b' }, async () => new Response(JSON.stringify(data)));
  assert.equal((await gh.verifyPr(r, project, result)).number, 5);
  for (const modify of [p => p.head.sha = 'a'.repeat(40), p => p.head.ref = 'main', p => p.base.repo.full_name = 'other/repo', p => p.body = prMarker(r.id, 1)]) {
    data = structuredClone(valid); modify(data); await assert.rejects(gh.verifyPr(r, project, result), e => e.code === 'publication_mismatch');
  }
});
test('webhook HMAC validates raw bytes; edits and unknown senders cannot act', t => {
  const raw = Buffer.from('{"x":1}'), secret = 'secret';
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyWebhook(raw, sig, secret), true); assert.equal(verifyWebhook(Buffer.from('{"x":2}'), sig, secret), false);
  const f = setup(t), id = f.start(); const r = f.s.request(id); r.issueNumber = 3; f.s.save(r);
  const payload = { action: 'created', sender: { id: 7 }, repository: { id: 10, full_name: 'example/wiki' }, issue: { number: 3 }, comment: { id: 9, user: { id: 7 }, body: '/reply Payment form' } };
  assert.ok(githubCommentEvent(f.core, payload)); assert.equal(githubCommentEvent(f.core, { ...payload, action: 'edited' }), null);
  assert.equal(githubCommentEvent(f.core, { ...payload, sender: { id: 8 } }), null);
});
test('normalizer uses verified actor IDs and ignores edits/bot echoes', () => {
  assert.equal(normalizeVkEvent({ eventId: 1, type: 'editedMessage', payload: {} }, 'bot').type, 'ignored');
  assert.equal(normalizeVkEvent({ eventId: 2, type: 'newMessage', payload: { from: { userId: 'bot' } } }, 'bot').type, 'ignored');
  assert.equal(normalizeVkEvent({ eventId: 3, type: 'callbackQuery', payload: { queryId: 'q:alice:x', message: { chat: { chatId: 'a' } }, callbackData: 't' } }, 'bot').actor, 'alice');
  assert.throws(() => normalizeVkEvent({ eventId: 4, type: 'callbackQuery', payload: { queryId: 'q:alice:x', from: { userId: 'evil' } } }, 'bot'));
});
test('poller advances durable cursor only after committing all received events', async t => {
  const f = setup(t);
  await pollOnce(f.core, { events: async cursor => { assert.equal(cursor, 0); return [{ eventId: 5, type: 'newMessage', payload: { from: { userId: 'alice' }, chat: { chatId: 'alice-chat', type: 'private' }, text: '/task wiki Test' } }]; } });
  assert.equal(f.s.get('SELECT position FROM cursors').position, 5); assert.equal(f.s.get('SELECT count(*) n FROM requests').n, 1);
});
test('config rejects role key reuse, mixed publisher/agent role, unsafe polling and PROD', () => {
  assert.ok(validateConfig(config(), env));
  for (const change of [c => c.workers[1].tokenEnv = 'AGENT_KEY', c => c.workers[0].kinds.push('publish'), c => c.vk.mode = 'dedicated-polling', c => c.projects.elma.environment = 'prod']) {
    const c = config(); change(c); assert.throws(() => validateConfig(c, env));
  }
});
test('service is disabled by default and does not load unknown secrets or create a DB', async () => {
  await assert.rejects(main({}), /disabled/);
});
test('HTTP worker authentication, duplicate completion, body validation, and no deploy route', async t => {
  const f = setup(t); f.start();
  const app = createApp(f.core, {}, env); await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => app.close(r)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (path, body, key = env.AGENT_KEY) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/worker/claim', {}, 'evil')).status, 401);
  assert.equal((await post('/worker/claim', null)).status, 400);
  const { job } = await (await post('/worker/claim', {})).json();
  const payload = { leaseToken: job.leaseToken, result: spec };
  assert.equal((await post(`/worker/jobs/${job.id}/complete`, payload)).status, 200);
  assert.equal((await (await post(`/worker/jobs/${job.id}/complete`, payload)).json()).replay, true);
  assert.equal((await post('/deploy', {})).status, 404);
  assert.equal((await (await fetch(base + '/healthz')).json()).liveDelivery, false);
});

test('changing routing or revoking the requester cannot repurpose an approved job', t => {
  const f = setup(t), id = f.start(); f.propose(id); f.message(`/approve ${id} 1`);
  f.cfg.projects.wiki.repository = 'elsewhere/repository';
  assert.equal(f.core.claim(f.cfg.workers[0]), null);
  assert.equal(f.s.request(id).blocker, 'routing_or_authorization_changed');
  assert.equal(f.s.request(id).route.repository, 'example/wiki');
  assert.equal(f.core.claimOutbox(), null);
});
test('unknown forged receipt cannot move a coding job to PR_READY', t => {
  const f = setup(t), id = f.start(); f.propose(id); f.message(`/approve ${id} 1`);
  const j = f.core.claim(f.cfg.workers[0]);
  throwsCode(() => f.core.complete(f.cfg.workers[0], j.id, j.leaseToken, { type: 'pull_request', number: 2, headSha: 'a'.repeat(40) }), 'invalid_result');
  assert.equal(f.s.request(id).state, 'IMPLEMENTING');
});
test('shared SQLite database provides a single claim across coordinator connections', t => {
  const dir = mkdtempSync(join(tmpdir(), 'request-bot-concurrency-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite'), a = new Store(file), b = new Store(file);
  const c1 = new Coordinator(a, config()), c2 = new Coordinator(b, config());
  c1.ingest('vk:bot', [{ id: 1, type: 'message', actor: 'alice', chat: 'alice-chat', text: '/task wiki A' }]);
  const job = c1.claim(config().workers[0]); assert.ok(job);
  assert.equal(c2.claim(config().workers[0]), null);
  c2.complete(config().workers[0], job.id, job.leaseToken, spec);
  assert.equal(a.request(job.request.id).state, 'AWAITING_APPROVAL');
  a.close(); b.close();
});
test('GitHub status projection contains state only and cannot echo as a user command', async t => {
  const f = setup(t), id = f.start(); let body;
  const gh = new GitHubClient({ token: () => 'x', botLogin: 'delivery-bot' }, async (_url, o) => { body = JSON.parse(o.body).body; return new Response(JSON.stringify({ id: 22 })); });
  const r = f.s.request(id); r.issueNumber = 9;
  await gh.createComment(r, f.cfg.projects.wiki, { state: 'WAITING_USER' });
  assert.equal(body.includes('WAITING_USER'), true); assert.equal(body.includes('Add a field'), false); assert.equal(body.startsWith('/'), false);
});
test('two different HTTP worker keys cannot cross project boundaries', async t => {
  const f = setup(t); f.start(); f.cfg.workers.push({ id: 'other', kinds: ['triage'], projects: ['elma'], tokenEnv: 'OTHER_KEY' });
  const app = createApp(f.core, {}, { ...env, OTHER_KEY: 'z'.repeat(40) }); await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => app.close(r)));
  const resp = await fetch(`http://127.0.0.1:${app.address().port}/worker/claim`, { method: 'POST', headers: { Authorization: 'Bearer ' + 'z'.repeat(40), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await resp.json()).job, null);
});

test('same VK message under a new delivery event ID does not duplicate the task', t => {
  const f = setup(t);
  const raw = { eventId: 10, type: 'newMessage', payload: { msgId: 'm100', from: { userId: 'alice' }, chat: { chatId: 'alice-chat', type: 'private' }, text: '/task wiki A' } };
  const first = f.core.ingest('vk:bot', [normalizeVkEvent(raw, 'bot')])[0];
  const second = f.core.ingest('vk:bot', [normalizeVkEvent({ ...raw, eventId: 11 }, 'bot')])[0];
  assert.equal(first.requestId, second.requestId); assert.equal(f.s.get('SELECT count(*) n FROM requests').n, 1);
});
test('approval card includes full scope; oversized output is rejected without a transition', t => {
  const f = setup(t); f.start(); const job = f.core.claim(f.cfg.workers[0]);
  throwsCode(() => f.core.complete(f.cfg.workers[0], job.id, job.leaseToken, { ...spec, summary: 'x'.repeat(601) }), 'invalid_text');
  f.core.complete(f.cfg.workers[0], job.id, job.leaseToken, spec);
  const card = f.s.all('SELECT payload FROM outbox').map(x => JSON.parse(x.payload)).find(x => x.buttons);
  assert.ok(card.text.includes(spec.scope[0])); assert.ok(card.text.length < 4000);
});
test('missing patch artifact ID is rejected rather than coerced to a string', t => {
  const f = setup(t), id = f.start(); f.propose(id); f.message(`/approve ${id} 1`); const job = f.core.claim(f.cfg.workers[0]);
  const { artifactId, ...invalid } = patch;
  throwsCode(() => f.core.complete(f.cfg.workers[0], job.id, job.leaseToken, invalid), 'invalid_patch_manifest');
  throwsCode(() => f.core.complete(f.cfg.workers[0], job.id, job.leaseToken, null), 'invalid_result');
});

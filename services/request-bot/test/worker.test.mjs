import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../store.mjs';
import { Coordinator, digest } from '../core.mjs';
import { GitHubClient } from '../adapters.mjs';
import { createApp } from '../server.mjs';
import { WorkStore, runOnce, validatePolicy, safePath,
  gitBlobSha, coordinatorClient, main } from '../worker.mjs';

const BASE = 'a'.repeat(40), TREE = 'b'.repeat(40), NEWTREE = 'c'.repeat(40), HEAD = 'd'.repeat(40);
const signal = () => new AbortController().signal;
const policy = () => ({ repository: 'fixture/wiki', baseRef: 'main', taskKind: 'wiki_code',
  contextFiles: ['AGENTS.md', '.agent/capabilities.yaml'], editableFiles: ['src/message.mjs', 'test/message.test.mjs'],
  publishEnabled: true, allowPublicCode: true });
const model = (type, rest = {}) => ({ type, questions: [], summary: '', criteria: [], scope: [], reason: '', files: [], ...rest });
const specification = () => model('specification', { summary: 'Change greeting', criteria: ['Greeting is hello'], scope: ['Greeting module'] });
const changes = () => model('changes', { files: [{ path: 'src/message.mjs', content: 'export const greeting = "hello";\n' }] });
const approvedJob = () => {
  const spec = { summary: 'Change greeting', criteria: ['Greeting is hello'], scope: ['Greeting module'] };
  return { id: 1, kind: 'implement', revision: 1, leaseToken: 'lease-a', repository: 'fixture/wiki', taskKind: 'wiki_code', targetRef: null,
    request: { id: 'REQ-ABCDEF123456', revision: 1, project: 'wiki', owner: 'user-a', chat: 'chat-a',
      messages: [{ text: 'private requirement, not a PR title' }], spec,
      route: { repository: 'fixture/wiki', baseRef: 'main', taskKind: 'wiki_code', targetRef: null },
      approval: { actor: 'user-a', revision: 1, specHash: digest(JSON.stringify(spec)) } } };
};
function temp(t) {
  const root = mkdtempSync(join(tmpdir(), 'request-worker-'));
  const s = new WorkStore(join(root, 'artifacts'));
  t.after(() => { s.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, s };
}
/** Network-only test doubles. Coordinator, GitHub adapter, worker and SQLite are real. */
function githubFixture() {
  const g = { calls: [], base: BASE, private: false, branches: [], prs: [], files: {
    'AGENTS.md': '# Fixture contract\nUse focused tests.\n', '.agent/capabilities.yaml': 'version: 1\n',
    'src/message.mjs': 'export const greeting = "old";\n', 'test/message.test.mjs': '// synthetic test source\n' } };
  g.fetch = async (url, options) => {
    options.signal?.throwIfAborted();
    const u = new URL(url), path = decodeURIComponent(u.pathname), method = options.method || 'GET';
    assert.equal(u.origin, 'https://api.github.com');
    const body = options.body ? JSON.parse(options.body) : null;
    g.calls.push({ path, method, body });
    if (g.onCall) await g.onCall(path, method);
    const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    const root = '/repos/fixture/wiki';
    if (path === root) return json({ full_name: 'fixture/wiki', private: g.private });
    if (path === root + '/git/ref/heads/main') return json({ object: { type: 'commit', sha: g.base } });
    if (path === root + '/git/commits/' + BASE) return json({ sha: BASE, tree: { sha: TREE } });
    if (path === root + '/git/trees/' + TREE) {
      const entries = Object.entries(g.files).map(([path, content]) => ({ path, type: 'blob', mode: g.mode?.[path] || '100644', sha: gitBlobSha(content), size: Buffer.byteLength(content) }));
      entries.push(...['.agent', 'src', 'test'].map(path => ({ path, type: g.parentType?.[path] || 'tree', mode: g.parentMode?.[path] || '040000', sha: TREE })));
      return json({ sha: TREE, truncated: g.truncated || false, tree: entries });
    }
    if (path.startsWith(root + '/git/blobs/')) {
      const sha = path.split('/').at(-1), content = Object.values(g.files).find(x => gitBlobSha(x) === sha);
      assert.notEqual(content, undefined);
      return json({ sha, encoding: 'base64', content: Buffer.from(g.corrupt ? 'corrupt' : content).toString('base64') });
    }
    if (path.startsWith(root + '/git/matching-refs/heads/')) return json(g.branches.filter(x => x.ref.startsWith('refs/heads/' + path.split('/heads/')[1])));
    if (method === 'POST' && path === root + '/git/trees') { assert.equal(body.base_tree, TREE); g.treeWrite = body; return json({ sha: NEWTREE }); }
    if (method === 'POST' && path === root + '/git/commits') { g.commit = body; if (g.driftAfterCommit) g.base = 'e'.repeat(40); return json({ sha: HEAD }); }
    if (path === root + '/git/commits/' + HEAD) return json({ sha: HEAD, tree: { sha: g.badCommit ? TREE : NEWTREE }, parents: [{ sha: BASE }] });
    if (method === 'POST' && path === root + '/git/refs') {
      g.branches.push({ ref: body.ref, object: { sha: body.sha } });
      if (g.refTimeout) throw Error('lost ref response');
      return json(g.branches.at(-1));
    }
    if (path === root + '/pulls') {
      if (method === 'GET') return json(g.prs);
      assert.equal(method, 'POST'); assert.equal(body.draft, true);
      const pr = { number: 31, state: 'open', draft: true, body: body.body,
        head: { ref: body.head, sha: HEAD, repo: { full_name: 'fixture/wiki' } },
        base: { ref: body.base, repo: { full_name: 'fixture/wiki' } } };
      g.prs.push(pr);
      if (g.prTimeout) throw Error('lost PR response');
      return json(pr);
    }
    if (path === root + '/pulls/31') return json({ ...g.prs[0], ...(g.badPr ? { head: { sha: BASE } } : {}) });
    throw Error(`Unexpected fixture endpoint ${method} ${path}`);
  };
  g.client = new GitHubClient({ token: () => 'synthetic-github-token', botLogin: 'test-bot' }, g.fetch);
  g.writes = () => g.calls.filter(x => x.method !== 'GET');
  return g;
}
async function harness(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'request-worker-http-'));
  const store = new Store(join(root, 'coordinator.sqlite')), work = new WorkStore(join(root, 'artifacts'));
  const p = policy(), g = githubFixture();
  const env = { AGENT_KEY: 'a'.repeat(48), PUBLISHER_KEY: 'p'.repeat(48), INGRESS_KEY: 'i'.repeat(48) };
  const config = { projects: { wiki: p }, bindings: [{ actor: 'user-a', chat: 'chat-a', projects: ['wiki'] }],
    workers: [{ id: 'agent', kinds: ['triage', 'implement'], projects: ['wiki'], tokenEnv: 'AGENT_KEY' },
      { id: 'publisher', kinds: ['publish'], projects: ['wiki'], tokenEnv: 'PUBLISHER_KEY' }],
    leaseMs: options.leaseMs || 3000, maxRunMs: 30000, vk: { mode: 'dispatcher', botId: 'bot' }, ingressTokenEnv: 'INGRESS_KEY' };
  const core = new Coordinator(store, config), app = createApp(core, { github: g.client }, env);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { app.closeAllConnections(); await new Promise(r => app.close(r)); work.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  let counter = 0, modelCalls = 0;
  const h = { root, store, work, g, core, p, base, modelRequests: [], workerConfig: {
    installation: 'test', role: 'agent', projects: { wiki: p }, maxJobMs: 20000,
    provider: { model: 'fixture-model', token: 'synthetic-model-token', maxOutputTokens: 1024, maxCallsPerDay: 20 } } };
  h.send = async text => {
    const r = await fetch(base + '/integrations/vk/events', { method: 'POST', headers: { Authorization: `Bearer ${env.INGRESS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ eventId: ++counter, type: 'newMessage', payload: { msgId: String(counter), text,
        from: { userId: 'user-a' }, chat: { chatId: 'chat-a', type: 'private' } } }] }) });
    assert.equal(r.status, 200); return (await r.json()).outcomes[0];
  };
  h.run = async (role, output, tweaks = {}) => {
    const config = { ...h.workerConfig, role };
    const actualCall = coordinatorClient(base, role === 'agent' ? env.AGENT_KEY : env.PUBLISHER_KEY);
    const deps = { call: tweaks.call ? (...args) => tweaks.call(actualCall, ...args) : actualCall,
      makeGithub: sig => new GitHubClient({ token: () => 'synthetic-github-token' }, (url, opts) => g.fetch(url, { ...opts, signal: AbortSignal.any([sig, opts.signal]) })),
      fetchImpl: async (url, opts) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(opts.headers.Authorization, 'Bearer synthetic-model-token');
        const request = JSON.parse(opts.body); h.modelRequests.push(request); modelCalls++;
        assert.deepEqual(request.tools, []); assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
        assert.ok(!opts.body.includes(env.AGENT_KEY)); assert.ok(!opts.body.includes('synthetic-model-token'));
        if (tweaks.model) return tweaks.model(url, opts);
        return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }));
      } };
    return runOnce(config, work, deps, tweaks.signal || signal());
  };
  h.modelCalls = () => modelCalls;
  h.approved = async () => {
    const { requestId: id } = await h.send('/task wiki Change greeting; private detail stays out of GitHub');
    assert.equal((await h.run('agent', specification())).accepted, true);
    assert.equal((await h.send(`/approve ${id} 1`)).status, 'accepted');
    return id;
  };
  return h;
}

test('HTTP: question -> reply -> specification -> approval -> model artifact -> independent draft PR receipt', async t => {
  const h = await harness(t);
  const { requestId: id } = await h.send('/task wiki Change the greeting');
  assert.equal((await h.run('agent', model('needs_input', { questions: ['Which greeting?'] }))).accepted, true);
  assert.equal(h.store.request(id).state, 'WAITING_USER');
  await h.send(`/reply ${id} Public greeting only`);
  assert.equal((await h.run('agent', specification())).accepted, true);
  assert.equal(h.store.request(id).revision, 2);
  assert.deepEqual(await h.run('agent', changes()), { idle: true }); // Not approved, no implementation job.
  await h.send(`/approve ${id} 2`);
  assert.equal((await h.run('agent', changes())).accepted, true);
  assert.equal(h.store.request(id).state, 'PUBLISHING');
  assert.equal(h.g.writes().length, 0); // Model worker has never published code.
  assert.equal(h.work.get(h.store.request(id).patch).files[0].content, changes().files[0].content);
  assert.equal((await h.run('publisher')).accepted, true);
  const r = h.store.request(id);
  assert.equal(r.state, 'PR_READY'); assert.equal(r.pr.headSha, HEAD);
  assert.equal(h.g.prs[0].draft, true); assert.equal(h.g.writes().length, 4);
  assert.ok(h.g.calls.filter(x => x.path.endsWith('/pulls/31')).length >= 2); // Publisher AND coordinator verify.
  assert.ok(!JSON.stringify(h.g.writes()).includes('Public greeting only'));
  assert.equal(h.g.treeWrite.tree.length, 1); assert.equal(h.g.treeWrite.base_tree, TREE);
  assert.equal(h.modelCalls(), 3);
  assert.equal(existsSync(join(h.root, 'src/message.mjs')), false); // Generated code was never executed or written into host workspace.
});

test('lost completion acknowledgement retries the receipt without another model call', async t => {
  const h = await harness(t); await h.send('/task wiki Change greeting'); let lost = false;
  const result = await h.run('agent', specification(), { call: async (call, path, ...args) => {
    const r = await call(path, ...args);
    if (path.endsWith('/complete') && !lost) { lost = true; throw Error('lost response'); }
    return r;
  } });
  assert.equal(result.accepted, true); assert.equal(h.modelCalls(), 1);
});

test('cancel while provider is running aborts HTTP and prevents an artifact or publication', async t => {
  const h = await harness(t, { leaseMs: 300 }); const id = await h.approved();
  const outcome = await h.run('agent', changes(), { model: async (_url, opts) => {
    await h.send(`/cancel ${id}`);
    await new Promise((_, reject) => { opts.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }); });
  } });
  assert.equal(outcome.blocked, true); assert.equal(outcome.code, 'lease_or_deadline_lost');
  assert.equal(h.store.request(id).state, 'CANCELLED'); assert.equal(h.g.writes().length, 0);
  assert.equal(h.work.db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 0);
});

for (const [name, options] of [
  ['incomplete generation', { model: async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })) }],
  ['refusal', { model: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })) }],
  ['malformed provider JSON', { model: async () => new Response('not json') }],
  ['oversized provider response', { model: async () => new Response('x'.repeat(1024 * 1024 + 1)) }],
]) test(name + ' blocks instead of inventing changes', async t => {
  const h = await harness(t); const id = await h.approved();
  assert.equal((await h.run('agent', changes(), options)).blocked, true);
  assert.equal(h.store.request(id).state, 'BLOCKED'); assert.equal(h.g.writes().length, 0);
});

for (const [name, change] of [
  ['path traversal', { path: '../outside.mjs', content: 'bad' }],
  ['workflow write', { path: '.github/workflows/main.yml', content: 'bad' }],
  ['worker self-modification', { path: 'services/request-bot/core.mjs', content: 'bad' }],
  ['non-allowlisted file', { path: 'src/other.mjs', content: 'bad' }],
  ['binary', { path: 'src/message.mjs', content: 'bad\0' }],
  ['unpaired surrogate', { path: 'src/message.mjs', content: '\ud800' }],
  ['secret-shaped output', { path: 'src/message.mjs', content: 'github_pat_' + 'a'.repeat(30) }],
  ['size limit', { path: 'src/message.mjs', content: 'a'.repeat(65537) }],
  ['unchanged file', { path: 'src/message.mjs', content: 'export const greeting = \"old\";\n' }],
  ['command injection field', { path: 'src/message.mjs', content: 'fine', command: 'execute me' }],
]) test(name + ' is rejected before artifact publication', async t => {
  const h = await harness(t); const id = await h.approved();
  const result = await h.run('agent', model('changes', { files: [change] }));
  assert.equal(result.blocked, true); assert.equal(h.g.writes().length, 0);
  assert.equal(h.store.request(id).state, 'BLOCKED');
});

for (const kind of ['refTimeout', 'prTimeout']) test(kind + ': lost GitHub acknowledgement is recovered by GET, never a second POST', async t => {
  const h = await harness(t); await h.approved(); await h.run('agent', changes()); h.g[kind] = true;
  assert.equal((await h.run('publisher')).accepted, true);
  assert.equal(h.g.writes().filter(x => x.path.endsWith('/git/refs')).length, 1);
  assert.equal(h.g.writes().filter(x => x.path.endsWith('/pulls')).length, 1);
});

for (const [name, mutate] of [
  ['base drift before publication', h => { h.g.base = HEAD; }],
  ['disabled publisher', h => { h.p.publishEnabled = false; }],
  ['public code not approved', h => { h.p.allowPublicCode = false; }],
  ['existing branch', h => { const r = h.store.all('SELECT record FROM requests')[0]; const id = JSON.parse(r.record).id; h.g.branches.push({ ref: `refs/heads/bot/${id.toLowerCase()}/v1`, object: { sha: HEAD } }); }],
  ['artifact tampering', h => { h.work.db.exec("UPDATE artifacts SET body='{}'"); }],
  ['artifact mode mismatch', h => { const r = JSON.parse(h.store.all('SELECT record FROM requests')[0].record); const a = h.work.get(r.patch); a.files[0].mode = '120000'; r.patch = h.work.put(a); h.store.save(r); }],
  ['artifact before-hash mismatch', h => { const r = JSON.parse(h.store.all('SELECT record FROM requests')[0].record); const a = h.work.get(r.patch); a.files[0].beforeSha = HEAD; r.patch = h.work.put(a); h.store.save(r); }],
  ['artifact revision mismatch', h => { const r = JSON.parse(h.store.all('SELECT record FROM requests')[0].record); const a = h.work.get(r.patch); a.revision++; r.patch = h.work.put(a); h.store.save(r); }],
  ['artifact owner mismatch', h => { const r = JSON.parse(h.store.all('SELECT record FROM requests')[0].record); const a = h.work.get(r.patch); a.owner = 'other'; r.patch = h.work.put(a); h.store.save(r); }],
]) test(name + ' produces no GitHub writes', async t => {
  const h = await harness(t); await h.approved(); await h.run('agent', changes()); mutate(h);
  assert.equal((await h.run('publisher')).blocked, true); assert.equal(h.g.writes().length, 0);
});

test('base drift after object creation prevents branch/PR creation', async t => {
  const h = await harness(t); await h.approved(); await h.run('agent', changes()); h.g.driftAfterCommit = true;
  assert.equal((await h.run('publisher')).blocked, true);
  assert.equal(h.g.branches.length, 0); assert.equal(h.g.prs.length, 0);
});
test('wrong PR receipt never reaches PR_READY', async t => {
  const h = await harness(t); const id = await h.approved(); await h.run('agent', changes()); h.g.badPr = true;
  assert.equal((await h.run('publisher')).blocked, true); assert.equal(h.store.request(id).state, 'BLOCKED');
});
test('wrong commit receipt stops before a ref', async t => {
  const h = await harness(t); await h.approved(); await h.run('agent', changes()); h.g.badCommit = true;
  assert.equal((await h.run('publisher')).blocked, true); assert.equal(h.g.branches.length, 0);
});

for (const [name, mutate] of [
  ['truncated tree', g => { g.truncated = true; }],
  ['symlink context', g => { g.mode = { 'src/message.mjs': '120000' }; }],
  ['submodule parent', g => { g.parentType = { src: 'commit' }; g.parentMode = { src: '160000' }; }],
  ['hash mismatch', g => { g.corrupt = true; }],
  ['case collision', g => { g.files['src/Message.mjs'] = 'case'; }],
  ['missing instructions', g => { delete g.files['AGENTS.md']; }],
]) test(name + ' stops before sending repository context to the model', async t => {
  const h = await harness(t); await h.send('/task wiki Change greeting'); mutate(h.g);
  assert.equal((await h.run('agent', specification())).blocked, true); assert.equal(h.modelCalls(), 0);
});

test('SQLite artifact/journal survives restart; uncertain run cannot repeat a billable call', t => {
  const { root, s } = temp(t), path = join(root, 'artifacts');
  const a = { baseSha: BASE, content: 'private' }, m = s.put(a);
  s.start('unknown'); s.start('done'); s.done('done', { accepted: true });
  const other = new WorkStore(path);
  try {
    assert.deepEqual(other.get(m), a); assert.throws(() => other.start('unknown'), /worker_outcome_unknown/);
    assert.deepEqual(other.start('done'), { accepted: true });
    s.reserveCall('call-1', 1); assert.throws(() => other.reserveCall('call-2', 1), /budget_exhausted/);
    assert.throws(() => other.reserveCall('call-1', 2), /model_call_already_attempted/);
  } finally { other.close(); }
});
test('budget exhaustion is reported to the coordinator without a model request', async t => {
  const h = await harness(t); await h.send('/task wiki Change greeting');
  h.workerConfig.provider.maxCallsPerDay = 1; h.work.reserveCall('prior', 1);
  assert.equal((await h.run('agent', specification())).code, 'budget_exhausted'); assert.equal(h.modelCalls(), 0);
});
test('work store refuses a repository directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'worker-storage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git')); assert.throws(() => new WorkStore(join(root, 'artifacts')), /outside_repository/);
});
test('policy refuses unbounded edits, target execution and missing instruction context', () => {
  assert.throws(() => validatePolicy({ ...policy(), taskKind: 'elma_config' }), /unsupported/);
  assert.throws(() => validatePolicy({ ...policy(), targetRef: 'dev2' }), /unsupported/);
  assert.throws(() => validatePolicy({ ...policy(), contextFiles: ['src/message.mjs'] }), /context_policy/);
  assert.throws(() => validatePolicy({ ...policy(), editableFiles: ['.env'] }), /protected/);
  assert.throws(() => validatePolicy({ ...policy(), contextFiles: [...policy().contextFiles, '.local/secret.json'] }), /private_context/);
  assert.throws(() => safePath('src\\escape.js'), /unsafe_path/);
});
test('worker client rejects insecure remote URLs and arbitrary coordinator routes', async () => {
  assert.throws(() => coordinatorClient('http://example.com', 'x'.repeat(48)), /unsafe/);
  assert.throws(() => coordinatorClient('https://user:pass@example.com', 'x'.repeat(48)), /unsafe/);
  const call = coordinatorClient('http://127.0.0.1:12345', 'x'.repeat(48));
  await assert.rejects(call('/ops/reconcile', {}, signal()), /invalid_worker_route/);
});
test('worker remains disabled without explicit operator enablement', async () => {
  await assert.rejects(main({}), /worker_disabled/);
});

test('new allowed text file is created without deleting other files or changing its bytes', async t => {
  const h = await harness(t); h.p.editableFiles.push('src/new.mjs'); await h.approved();
  const value = '  // trailing whitespace is intentional\n\n';
  assert.equal((await h.run('agent', model('changes', { files: [{ path: 'src/new.mjs', content: value }] }))).accepted, true);
  assert.equal((await h.run('publisher')).accepted, true);
  assert.deepEqual(h.g.treeWrite.tree, [{ path: 'src/new.mjs', mode: '100644', type: 'blob', content: value }]);
});
test('duplicate changes are rejected', async t => {
  const h = await harness(t); await h.approved();
  const f = changes().files[0]; assert.equal((await h.run('agent', model('changes', { files: [f, f] }))).blocked, true);
  assert.equal(h.g.writes().length, 0);
});
test('triage cannot smuggle a patch into specification output', async t => {
  const h = await harness(t); await h.send('/task wiki Change greeting');
  assert.equal((await h.run('agent', { ...specification(), files: changes().files })).blocked, true);
});
test('unknown publisher outcome cannot trigger a second create after restart', t => {
  const { root, s } = temp(t), job = { ...approvedJob(), kind: 'publish' };
  const key = s.key('instance', job); assert.equal(s.start(key), null);
  const restarted = new WorkStore(join(root, 'artifacts'));
  try { assert.throws(() => restarted.start(key), /worker_outcome_unknown/); }
  finally { restarted.close(); }
});
test('deadline aborts a pending provider call and creates no artifact', async t => {
  const h = await harness(t); await h.approved(); h.workerConfig.maxJobMs = 100;
  const result = await h.run('agent', changes(), { model: async (_url, opts) =>
    new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true })) });
  assert.equal(result.code, 'lease_or_deadline_lost'); assert.equal(h.work.db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 0);
});
test('lease is checked immediately before every GitHub mutation', async t => {
  const h = await harness(t); const id = await h.approved(); await h.run('agent', changes());
  h.g.onCall = async (path, method) => { if (method === 'POST' && path.endsWith('/git/trees')) await h.send(`/cancel ${id}`); };
  assert.equal((await h.run('publisher')).blocked, true);
  assert.equal(h.g.writes().length, 1); assert.equal(h.g.branches.length, 0); assert.equal(h.g.prs.length, 0);
});
test('non-file database substitution is refused', t => {
  const root = mkdtempSync(join(tmpdir(), 'worker-invalid-db-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'worker.sqlite'));
  assert.throws(() => new WorkStore(root), /unsafe_database/);
});

test('a stalled heartbeat cannot keep the provider running beyond the last granted lease', async t => {
  const h = await harness(t, { leaseMs: 300 }); await h.approved(); let beats = 0;
  const result = await h.run('agent', changes(), {
    call: async (call, path, data, sig) => {
      if (path.endsWith('/heartbeat') && ++beats > 1) {
        await new Promise((_, reject) => sig.addEventListener('abort', () => reject(Error('timeout')), { once: true }));
      }
      return call(path, data, sig);
    },
    model: async (_url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }))
  });
  assert.equal(result.code, 'lease_or_deadline_lost');
  assert.equal(h.work.db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 0);
});

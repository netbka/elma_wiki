import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, inventoryOf } from '../lib/delivery.mjs';
import { bridgeStore } from '../lib/bridge.mjs';
import { createServer } from '../server.mjs';
import { zip } from './fixture.mjs';

const fixture = (required = false) => zip([
  ['package.json', { code: 'bridge_release', title: 'Учебный пакет', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
]);
const details = { title: 'Релиз в TEST', intent: 'Проверить обязательность заголовка', targetIntent: 'TEST' };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-bridge-test-'));
  t.after(async () => { assert.ok(path.basename(directory).startsWith('e365-bridge-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), bridges = bridgeStore(directory, { onlineMs: 5000, healthTimeoutMs: 500 });
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  delivery = deliveryStore(directory, releases, { adapters: { bridge: (opts, connection) => bridges.adapter(opts, connection) }, protectedHosts: ['prod.example.invalid'], timeoutMs: 2000, ...options });
  return { directory, projects, releases, delivery, bridges };
}
async function approvedRelease(projects, releases, owner = 'alice') {
  const baseline = await projects.create(owner, await fixture(false)), source = await projects.create(owner, await fixture(true));
  let release = await releases.create(owner, { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
  for (const row of release.changes) release = await releases.change(release.id, owner, { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Назначение изменения проверено' });
  release = await releases.change(release.id, owner, { revision: release.revision, action: 'freeze' });
  return releases.change(release.id, owner, { revision: release.revision, action: 'approve', reason: 'Принимаю неизменённый архив' });
}
const confirmation = attempt => `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`;

async function waitForWorker(bridges, bridgeId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await bridges.get(bridgeId, 'alice')).online) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('worker did not report online within 5 seconds');
}

// An in-process stand-in for the operator worker: it owns the "Target" state the way the real worker owns
// the ELMA host, and it only ever talks to the store through the worker-side API (authenticate/poll/
// artifact/complete), so the test exercises the same seams as the HTTP routes.
function fakeWorker(bridges, token, { host = 'test.example.invalid', inventory = [], delayMs = 0, importApplies = true, deployError = null } = {}) {
  let state = { inventory: structuredClone(inventory), version: 1, log: [] };
  let running = true;
  const loop = (async () => {
    while (running) {
      let bridge, job;
      try { bridge = await bridges.authenticate(`Bearer ${token}`); job = await bridges.poll(bridge, { identity: { host, version: '2025.10.97' }, worker: 'fake', waitMs: 100 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      if (!job) continue;
      state.log.push(job.kind);
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        if (job.kind === 'health') await bridges.complete(bridge, job.id, { ok: true, result: { ok: true, identity: { host, version: '2025.10.97' } } });
        else if (job.kind === 'inspect' || job.kind === 'readBack') await bridges.complete(bridge, job.id, { ok: true, result: { inventory: structuredClone(state.inventory), version: state.version } });
        else if (job.kind === 'deploy') {
          const bytes = await bridges.artifact(bridge, job.id);
          if (sha(bytes) !== job.payload.sha256) throw Error('checksum mismatch');
          if (deployError) throw Error(deployError);
          if (importApplies) state = { ...state, inventory: await inventoryOf(bytes), version: state.version + 1 };
          await bridges.complete(bridge, job.id, { ok: true, result: { ok: true, nativeResult: 'import: exit 0' } });
        }
      } catch (error) { await bridges.complete(bridge, job.id, { ok: false, error: error.message }).catch(() => {}); }
    }
  })();
  return { state: () => state, stop: async () => { running = false; await loop; } };
}

test('bridge: token issued once and stored hashed; delivery runs end to end through a polling worker', async t => {
  const { projects, releases, delivery, bridges, directory } = await setup(t);
  const { bridge, token } = await bridges.create('alice', { name: 'Рабочее место оператора' });
  assert.match(token, /^wb_/); assert.equal(bridge.tokenHash, undefined); assert.equal(bridge.online, false);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'delivery', 'bridges', bridge.id + '.json'), 'utf8'));
  assert.equal(stored.tokenHash, sha(token)); assert.ok(!JSON.stringify(stored).includes(token));
  assert.deepEqual((await bridges.list('alice')).map(b => b.id), [bridge.id]); assert.deepEqual(await bridges.list('bob'), []);
  const connection = await delivery.connections.create('alice', { name: 'TEST через мост', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: bridge.id } });
  // No worker yet: the probe is honest about it and prepare refuses.
  let probed = await delivery.connections.probe(connection.id, 'alice');
  assert.equal(probed.probe.ok, false); assert.equal(probed.probe.identity, null);
  const release = await approvedRelease(projects, releases);
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), /Target недоступен/);
  const worker = fakeWorker(bridges, token, { inventory: await inventoryOf(await fixture(false)) });
  t.after(() => worker.stop());
  await waitForWorker(bridges, bridge.id);
  assert.equal((await bridges.get(bridge.id, 'alice')).online, true);
  probed = await delivery.connections.probe(connection.id, 'alice');
  assert.equal(probed.probe.ok, true); assert.equal(probed.probe.identity.host, 'test.example.invalid');
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  assert.equal(attempt.state, 'prepared'); assert.equal(attempt.evidence.preDeploy.files, 3);
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k1', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'deployed-unverified', JSON.stringify(attempt.evidence.operation)); assert.equal(attempt.evidence.operation.nativeResult, 'import: exit 0');
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verified'); assert.equal(attempt.evidence.comparison.different.length, 0);
  // probe ×2, prepare (health + inspect), confirm (health + inspect + deploy), verify (health, read-back, health again).
  assert.deepEqual(worker.state().log, ['health', 'health', 'inspect', 'health', 'inspect', 'deploy', 'health', 'readBack', 'health']);
  // Artifact and job files do not linger after completion.
  const jobs = await fs.readdir(path.join(directory, 'delivery', 'bridges', bridge.id, 'jobs'));
  assert.ok(jobs.every(name => name.endsWith('.json')), 'artifact removed once the job finished');
  assert.equal((await releases.get(release.id, 'alice')).checks.find(c => c.id === 'target').result, 'pass');
});

async function waitForAttempt(delivery, releaseId, attemptId, expectedState) {
  const deadline = Date.now() + 5000;
  let attempt;
  do {
    attempt = await delivery.get(releaseId, attemptId, 'alice');
    if (attempt.state === expectedState) return attempt;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.equal(attempt.state, expectedState, 'background operation did not reach its terminal state');
}

test('bridge: slow import returns deploying and finishes in the background; unapplied import never verifies; worker errors fail the attempt', async t => {
  const { projects, releases, delivery, bridges } = await setup(t, { confirmGraceMs: 100 });
  const { bridge, token } = await bridges.create('alice', { name: 'Медленный мост' });
  const connection = await delivery.connections.create('alice', { name: 'TEST через мост', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: bridge.id } });
  let worker = fakeWorker(bridges, token, { inventory: await inventoryOf(await fixture(false)), delayMs: 300, importApplies: false });
  await waitForWorker(bridges, bridge.id);
  const release = await approvedRelease(projects, releases);
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'slow', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'deploying');
  await assert.rejects(delivery.verify(release.id, attempt.id, 'alice'), /невозможен в состоянии «deploying»/);
  attempt = await waitForAttempt(delivery, release.id, attempt.id, 'deployed-unverified');
  assert.equal(attempt.state, 'deployed-unverified');
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verification-failed'); assert.match(attempt.history.at(-1).note, /импорт не применён/);
  await worker.stop();
  // A worker that reports an error: the attempt fails, nothing is marked verified.
  worker = fakeWorker(bridges, token, { inventory: await inventoryOf(await fixture(false)), deployError: 'import: unresolved dependency' });
  t.after(() => worker.stop());
  const second = await approvedRelease(projects, releases);
  let failing = await delivery.prepare(second.id, 'alice', { revision: second.revision, connectionId: connection.id });
  failing = await delivery.confirm(second.id, failing.id, 'alice', { idempotencyKey: 'f', confirmation: confirmation(failing) });
  failing = await waitForAttempt(delivery, second.id, failing.id, 'failed');
  assert.equal(failing.state, 'failed'); assert.match(failing.evidence.operation.error, /unresolved dependency/);
  await assert.rejects(delivery.verify(second.id, failing.id, 'alice'), /невозможен/);
  // Removing the bridge rejects anything still queued and invalidates the token.
  await bridges.remove(bridge.id, 'alice');
  assert.deepEqual(await bridges.list('alice'), []);
  await assert.rejects(bridges.authenticate(`Bearer ${token}`), error => error.statusCode === 401);
});

test('bridge: owner isolation, PROD identity refusal and timeouts without a worker', async t => {
  const { projects, releases, delivery, bridges } = await setup(t, { timeoutMs: 300 });
  const { bridge, token } = await bridges.create('alice', { name: 'Мост Алисы' });
  // Bob cannot use Alice's bridge even if he knows its id.
  const bobs = await delivery.connections.create('bob', { name: 'Чужой мост', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: bridge.id } });
  const probed = await delivery.connections.probe(bobs.id, 'bob');
  assert.equal(probed.probe.ok, false); assert.equal(probed.probe.identity, null);
  await assert.rejects(bridges.get(bridge.id, 'bob'), error => error.statusCode === 404);
  await assert.rejects(bridges.remove(bridge.id, 'bob'), error => error.statusCode === 404);
  // A worker that is actually pointed at a protected host is refused by identity, whatever the connection says.
  const worker = fakeWorker(bridges, token, { host: 'prod.example.invalid', inventory: await inventoryOf(await fixture(false)) });
  t.after(() => worker.stop());
  await waitForWorker(bridges, bridge.id);
  const connection = await delivery.connections.probe((await delivery.connections.create('alice', { name: 'Якобы TEST', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: bridge.id } })).id, 'alice');
  assert.equal(connection.probe.protectedHost, true);
  const release = await approvedRelease(projects, releases);
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), error => error.statusCode === 403 && /защищённый узел/.test(error.message));
  await worker.stop();
  // Worker gone after the bridge was last seen online: inspect times out instead of hanging.
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), error => /защищённый узел|не ответил|недоступен/.test(error.message));
  assert.rejects(bridges.authenticate('Bearer wb_' + 'x'.repeat(40)), error => error.statusCode === 401);
  await assert.rejects(bridges.authenticate(undefined), error => error.statusCode === 401);
});

test('bridge API: worker routes need the bearer token, owner routes need a session; the token never comes back', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-bridge-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const server = createServer({ directory, allowLocal: true, deliveryTimeoutMs: 1000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, options = {}, cookie) => {
    const response = await fetch(base + route, { ...options, headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const { cookie } = await request('/auth/local', { method: 'POST', body: '{}' });
  assert.equal((await request('/api/bridges')).status, 401);
  assert.equal((await request('/api/bridge/poll', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request('/api/bridge/poll', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer wb_' + 'a'.repeat(43) } })).status, 401);
  const created = await request('/api/bridges', { method: 'POST', body: JSON.stringify({ name: 'Оператор' }) }, cookie);
  assert.equal(created.status, 201); assert.match(created.body.token, /^wb_/); assert.equal(created.body.bridge.tokenHash, undefined);
  const listed = await request('/api/bridges', {}, cookie);
  assert.equal(listed.status, 200); assert.ok(!JSON.stringify(listed.body).includes(created.body.token));
  const auth = { Authorization: `Bearer ${created.body.token}` };
  // The browser session cannot call worker routes and the worker token cannot call owner routes.
  assert.equal((await request('/api/bridge/poll', { method: 'POST', body: '{}' }, cookie)).status, 401);
  assert.equal((await request('/api/bridges', { headers: auth })).status, 401);
  // Empty poll, then a queued job appears for a long-poller when the adapter asks for health.
  const empty = await request('/api/bridge/poll', { method: 'POST', body: JSON.stringify({ identity: { host: 'test.example.invalid' }, waitMs: 0 }), headers: auth });
  assert.equal(empty.status, 200); assert.equal(empty.body.job, null);
  assert.equal((await request('/api/bridges', {}, cookie)).body[0].online, true);
  const connection = await request('/api/connections', { method: 'POST', body: JSON.stringify({ name: 'TEST', role: 'target', environment: 'test', adapter: 'bridge', adapterOptions: { bridgeId: created.body.bridge.id } }) }, cookie);
  assert.equal(connection.status, 201);
  const probe = request(`/api/connections/${connection.body.id}/probe`, { method: 'POST', body: '{}' }, cookie);
  const polled = await request('/api/bridge/poll', { method: 'POST', body: JSON.stringify({ identity: { host: 'test.example.invalid' }, waitMs: 2000 }), headers: auth });
  assert.equal(polled.body.job.kind, 'health'); assert.equal(polled.body.job.hasArtifact, false);
  assert.equal((await request(`/api/bridge/jobs/${polled.body.job.id}/artifact`, { headers: auth })).status, 404);
  assert.equal((await request(`/api/bridge/jobs/${polled.body.job.id}/result`, { method: 'POST', body: JSON.stringify({ ok: true, result: { ok: true, identity: { host: 'test.example.invalid', version: '1' } } }), headers: auth })).status, 200);
  assert.equal((await request(`/api/bridge/jobs/${polled.body.job.id}/result`, { method: 'POST', body: JSON.stringify({ ok: true }), headers: auth })).status, 409);
  assert.equal((await probe).body.probe.ok, true);
  assert.equal((await request(`/api/bridges/${created.body.bridge.id}`, { method: 'DELETE' }, cookie)).status, 200);
  assert.equal((await request('/api/bridge/poll', { method: 'POST', body: '{}', headers: auth })).status, 401, 'a removed bridge\'s token stops working');
});

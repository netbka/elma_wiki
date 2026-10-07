import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, syntheticAdapter } from '../lib/delivery.mjs';
import { READ_BACK_POLICY } from '../lib/delivery-verification.mjs';
import { deliveryPanelView } from '../web/releases/delivery-model.js';
import { createServer } from '../server.mjs';
import { zip } from './fixture.mjs';

const details = { title: 'Integration release', intent: 'Check the exact result', targetIntent: 'Synthetic TEST' };
const confirmation = attempt => `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`;
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-delivery-integration-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('e365-delivery-integration-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const projects = projectStore(directory), calls = [];
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  delivery = deliveryStore(directory, releases, { adapters: { synthetic: () => syntheticAdapter({ calls }) } });
  const fixture = required => zip([
    ['package.json', { code: 'synthetic_release', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
    ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
  ]);
  const baseline = await projects.create('alice', await fixture(false));
  const source = await projects.create('alice', await fixture(true));
  let release = await releases.create('alice', { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
  for (const row of release.changes) release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic review' });
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'freeze' });
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'approve', reason: 'Synthetic acceptance' });
  const connection = await delivery.connections.create('alice', { name: 'Training TEST', role: 'target', environment: 'test', adapter: 'synthetic' });
  const attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  return { directory, releases, delivery, release, connection, attempt, calls };
}

test('strict verification remains revision-bound in mutation responses and delivery controls', async t => {
  const { releases, delivery, connection, attempt } = await setup(t);
  await delivery.confirm(attempt.releaseId, attempt.id, 'alice', { idempotencyKey: 'strict', confirmation: confirmation(attempt) });
  const verified = await delivery.verify(attempt.releaseId, attempt.id, 'alice');
  assert.equal(verified.evidence.comparison.policy, READ_BACK_POLICY);
  assert.deepEqual(verified.evidence.comparison.volatile, []);
  assert.equal(verified.evidence.comparison.compared, 3);
  let release = await releases.get(attempt.releaseId, 'alice');
  assert.equal(release.checks.find(check => check.id === 'target').result, 'pass');
  release = await releases.change(release.id, 'alice', { ...details, action: 'details', revision: release.revision, notes: 'New conditions', limitations: '' });
  assert.equal(release.checks.find(check => check.id === 'target').result, 'stale');
  assert.equal(release.delivery.latest.state, 'verified');
  release = await releases.change(release.id, 'alice', { action: 'freeze', revision: release.revision });
  release = await releases.change(release.id, 'alice', { action: 'approve', revision: release.revision, reason: 'New candidate accepted' });
  assert.notEqual(release.candidate.id, attempt.candidateId);
  assert.equal(release.checks.find(check => check.id === 'target').result, 'stale');
  const view = deliveryPanelView(release, { capabilities: { mode: 'synthetic', liveDelivery: false }, connections: [connection], attempts: [verified] });
  assert.equal(view.current, false);
  assert.equal(view.canConfirm, false);
  assert.equal(view.canVerify, false);
});

test('stale preparation can be cancelled without weakening dispatch or ownership guards', async t => {
  const { releases, delivery, connection, attempt, calls } = await setup(t);
  let release = await releases.get(attempt.releaseId, 'alice');
  release = await releases.change(release.id, 'alice', { ...details, action: 'details', revision: release.revision, notes: 'Changed', limitations: '' });
  await assert.rejects(delivery.cancel(release.id, attempt.id, 'bob'), error => error.statusCode === 404);
  assert.equal((await delivery.cancel(release.id, attempt.id, 'alice')).state, 'cancelled');
  assert.equal(calls.length, 0);
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'cancelled', confirmation: confirmation(attempt) }), error => error.statusCode === 409);
  release = await releases.change(release.id, 'alice', { action: 'freeze', revision: release.revision });
  release = await releases.change(release.id, 'alice', { action: 'approve', revision: release.revision, reason: 'Accept current candidate' });
  const next = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  await delivery.confirm(release.id, next.id, 'alice', { idempotencyKey: 'new', confirmation: confirmation(next) });
  await assert.rejects(delivery.cancel(release.id, next.id, 'alice'), error => error.statusCode === 409);
  assert.equal((await delivery.verify(release.id, next.id, 'alice')).state, 'verified');
  assert.equal(calls.length, 1);
});

test('legacy policy invalidation reaches the release summary and retry controls without redispatch', async t => {
  const { directory, releases, delivery, connection, attempt, calls } = await setup(t);
  await delivery.confirm(attempt.releaseId, attempt.id, 'alice', { idempotencyKey: 'legacy', confirmation: confirmation(attempt) });
  await delivery.verify(attempt.releaseId, attempt.id, 'alice');
  const file = path.join(directory, 'delivery', 'attempts', attempt.releaseId, attempt.id + '.json');
  const old = JSON.parse(await fs.readFile(file, 'utf8'));
  delete old.evidence.comparison.policy;
  await fs.writeFile(file, JSON.stringify(old));
  const release = await releases.get(attempt.releaseId, 'alice');
  assert.equal(release.checks.find(check => check.id === 'target').result, 'fail');
  const attempts = await delivery.list(release.id, 'alice');
  assert.equal(attempts.at(-1).state, 'verification-failed');
  const view = deliveryPanelView(release, { capabilities: { mode: 'synthetic', liveDelivery: false }, connections: [connection], attempts });
  assert.equal(view.canVerify, true);
  assert.equal(view.canConfirm, false);
  assert.equal((await delivery.verify(release.id, attempt.id, 'alice')).state, 'verified');
  assert.equal(calls.length, 1);
});

test('delivery capability API remains authenticated and distinguishes unavailable from training', async t => {
  const { directory } = await setup(t);
  for (const syntheticDelivery of [false, true]) {
    const server = createServer({ directory, allowLocal: true, syntheticDelivery });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' };
      assert.equal((await fetch(base + '/api/delivery/capabilities')).status, 401);
      const login = await fetch(base + '/auth/local', { method: 'POST', headers, body: '{}' });
      assert.equal(login.status, 200);
      headers.Cookie = login.headers.get('set-cookie').split(';')[0];
      const response = await fetch(base + '/api/delivery/capabilities', { headers });
      // The operator bridge is always registered; `liveDelivery` only turns true with verified live evidence.
      assert.deepEqual(await response.json(), { mode: syntheticDelivery ? 'synthetic' : 'bridge', liveDelivery: false, bridge: true, adapters: syntheticDelivery ? ['synthetic', 'bridge'] : ['bridge'] });
      assert.equal((await fetch(base + '/api/delivery/capabilities', { method: 'POST', headers, body: '{}' })).status, 405);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

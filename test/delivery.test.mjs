import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, syntheticAdapter, inventoryOf, compareReadBack, bootId } from '../lib/delivery.mjs';
import { createServer } from '../server.mjs';
import { zip } from './fixture.mjs';

const fixture = (required = false) => zip([
  ['package.json', { code: 'synthetic_release', title: 'Учебный пакет', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
]);
const details = { title: 'Релиз в TEST', intent: 'Проверить обязательность заголовка', targetIntent: 'TEST' };
async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-delivery-test-'));
  t.after(async () => { assert.ok(path.basename(directory).startsWith('e365-delivery-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), calls = [];
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  // Every synthetic Target starts from the baseline package, i.e. the state before this release.
  const baselineInventory = await inventoryOf(await fixture(false));
  delivery = deliveryStore(directory, releases, { adapters: { synthetic: opts => syntheticAdapter({ inventory: baselineInventory, calls, ...opts }) }, protectedHosts: ['prod.example.invalid'], timeoutMs: 50, ...options });
  return { directory, projects, releases, delivery, calls };
}
async function approvedRelease(projects, releases, owner = 'alice') {
  const baseline = await projects.create(owner, await fixture(false)), source = await projects.create(owner, await fixture(true));
  let release = await releases.create(owner, { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
  for (const row of release.changes) release = await releases.change(release.id, owner, { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Назначение изменения проверено' });
  release = await releases.change(release.id, owner, { revision: release.revision, action: 'freeze' });
  return releases.change(release.id, owner, { revision: release.revision, action: 'approve', reason: 'Принимаю неизменённый архив' });
}
const target = (scenario = 'apply', extra = {}) => ({ name: 'TEST (dev2)', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { scenario }, ...extra });
const confirmation = attempt => `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`;

test('one complete delivery: prepare, confirm, deployed-unverified, read-back, verified with linked evidence', async t => {
  const { projects, releases, delivery, calls } = await setup(t);
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.probe((await delivery.connections.create('alice', target())).id, 'alice');
  assert.equal(connection.probe.identity.host, 'test.example.invalid'); assert.equal(connection.probe.protectedHost, false);
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  assert.equal(attempt.state, 'prepared'); assert.equal(attempt.sha256, release.candidate.sha256); assert.ok(attempt.evidence.preDeploy.inventoryHash);
  assert.notEqual(attempt.evidence.preDeploy.inventoryHash, attempt.evidence.candidateInventoryHash, 'target differs from candidate before delivery');
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k1', confirmation: 'DEPLOY wrong' }), /Подтверждение/);
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k1', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'deployed-unverified'); assert.equal(attempt.evidence.operation.result, 'returned'); assert.equal(attempt.evidence.readBack, null);
  assert.equal((await releases.get(release.id, 'alice')).checks.find(c => c.id === 'target').result, 'not-run', 'a returned operation is not verification');
  assert.deepEqual(attempt.evidence.rollbackReference.inventoryHash, attempt.evidence.preDeploy.inventoryHash);
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verified'); assert.equal(attempt.evidence.comparison.match, true); assert.deepEqual(attempt.evidence.comparison.volatile, []);
  assert.equal(attempt.evidence.comparison.policy, 'exact-solution-inventory-v1');
  assert.deepEqual(attempt.evidence.readBack.targetIdentity, attempt.targetIdentity);
  assert.equal(attempt.evidence.readBack.inventoryHash, attempt.evidence.candidateInventoryHash);
  assert.equal(calls.length, 1);
  const view = await releases.get(release.id, 'alice');
  assert.equal(view.checks.find(c => c.id === 'target').result, 'pass'); assert.equal(view.delivery.latest.state, 'verified');
  assert.deepEqual(attempt.history.map(h => h.state), ['prepared', 'deploying', 'deployed-unverified', 'verified']);
  assert.equal(JSON.stringify(attempt).includes('"owner"'), false);
});

test('import that returns success but applies nothing never becomes Verified', async t => {
  const { projects, releases, delivery } = await setup(t);
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.create('alice', target('unapplied'));
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'deployed-unverified'); assert.match(attempt.evidence.operation.nativeResult, /exit 0/);
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verification-failed'); assert.equal(attempt.evidence.comparison.match, false); assert.equal(attempt.evidence.comparison.different.length, 1);
  assert.match(attempt.history.at(-1).note, /не применён/);
  assert.equal((await releases.get(release.id, 'alice')).checks.find(c => c.id === 'target').result, 'fail');
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k2', confirmation: confirmation(attempt) }), error => error.statusCode === 409);
  // A failed verification is terminal for that attempt; the owner may prepare a new, separately evidenced attempt.
  const retry = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  assert.equal(retry.state, 'prepared'); assert.equal((await delivery.list(release.id, 'alice')).length, 2);
  assert.equal((await releases.get(release.id, 'alice')).checks.find(c => c.id === 'target').result, 'not-run');
});

test('PROD is rejected server-side by environment and by actual identity regardless of the connection name', async t => {
  const { projects, releases, delivery } = await setup(t);
  const release = await approvedRelease(projects, releases);
  const prod = await delivery.connections.create('alice', target('apply', { name: 'Тестовый стенд', environment: 'prod' }));
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: prod.id }), error => error.statusCode === 403 && /PROD/.test(error.message));
  const misleading = await delivery.connections.create('alice', target('apply', { name: 'TEST', adapterOptions: { scenario: 'apply', identity: { host: 'prod.example.invalid', version: '2025.10' } } }));
  assert.equal((await delivery.connections.probe(misleading.id, 'alice')).probe.protectedHost, true);
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: misleading.id }), error => error.statusCode === 403 && /защищённый/.test(error.message));
  const source = await delivery.connections.create('alice', target('apply', { role: 'source' }));
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: source.id }), error => error.statusCode === 403);
  assert.equal((await delivery.list(release.id, 'alice')).length, 0);
});

test('stale approval and target drift block confirmation; duplicate confirmations run the operation once', async t => {
  const { projects, releases, delivery, calls } = await setup(t);
  let release = await approvedRelease(projects, releases);
  const drift = await delivery.connections.create('alice', target('drift'));
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: drift.id });
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'd', confirmation: confirmation(attempt) }), /изменилось после подготовки/);
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).state, 'blocked');
  const ok = await delivery.connections.create('alice', target('apply'));
  attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: ok.id });
  release = await releases.change(release.id, 'alice', { ...details, revision: release.revision, action: 'details', notes: 'после подготовки', limitations: '' });
  assert.equal(release.approval, null);
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'e', confirmation: confirmation(attempt) }), error => error.statusCode === 409 && /изменились после подготовки/.test(error.message));
  assert.equal(calls.length, 0);
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'freeze' });
  release = await releases.change(release.id, 'alice', { revision: release.revision, action: 'approve', reason: 'Повторно принимаю' });
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: ok.id }), /незавершённая/, 'the stale prepared attempt still holds the lock');
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'e', confirmation: confirmation(attempt) }), error => error.statusCode === 409);
  // A fresh release cycle on the same target with two concurrent clicks.
  const second = await approvedRelease(projects, releases);
  let fresh = await delivery.prepare(second.id, 'alice', { revision: second.revision, connectionId: ok.id });
  const [a, b] = await Promise.all([delivery.confirm(second.id, fresh.id, 'alice', { idempotencyKey: 'same', confirmation: confirmation(fresh) }), delivery.confirm(second.id, fresh.id, 'alice', { idempotencyKey: 'same', confirmation: confirmation(fresh) })]);
  assert.equal(a.state, 'deployed-unverified'); assert.ok(['deploying', 'deployed-unverified'].includes(b.state), 'the duplicate sees the same attempt, possibly still in progress'); assert.equal(calls.length, 1);
  assert.equal((await delivery.get(second.id, fresh.id, 'alice')).state, 'deployed-unverified');
  await assert.rejects(delivery.confirm(second.id, fresh.id, 'alice', { idempotencyKey: 'other', confirmation: confirmation(fresh) }), /повторный запуск запрещён/);
});

test('timeout and process restart leave an unknown outcome that only read-back resolves', async t => {
  const { directory, projects, releases, delivery } = await setup(t);
  const release = await approvedRelease(projects, releases);
  const slow = await delivery.connections.create('alice', target('timeout'));
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: slow.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 't', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'unknown-outcome'); assert.equal(attempt.evidence.operation.result, 'timeout');
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verification-failed', 'nothing was applied, so the read-back must not match');
  // Simulate a crash mid-operation: a record persisted as deploying by another process boot.
  const file = path.join(directory, 'delivery', 'attempts', release.id, attempt.id + '.json');
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...record, state: 'deploying', bootId: 'previous-boot' }));
  const restarted = deliveryStore(directory, releases, { adapters: { synthetic: syntheticAdapter } });
  const reconciled = await restarted.get(release.id, attempt.id, 'alice');
  assert.equal(reconciled.state, 'unknown-outcome'); assert.match(reconciled.history.at(-1).note, /перезапущен/);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).state, 'unknown-outcome');
  assert.equal(record.bootId, bootId);
  await assert.rejects(restarted.verify(release.id, attempt.id, 'bob'), error => error.statusCode === 404);
});

test('connections store references only, deny credentials and stay owner-scoped', async t => {
  const { directory, delivery } = await setup(t);
  for (const bad of [{ token: 'x' }, { adapterOptions: { password: 'x' } }, { adapterOptions: { url: 'https://user:pw@host/' } }]) await assert.rejects(delivery.connections.create('alice', target('apply', bad)), /учётные данные|URL с учётными/);
  await assert.rejects(delivery.connections.create('alice', target('apply', { adapter: 'elma365pm' })), error => error.statusCode === 503);
  await assert.rejects(delivery.connections.create('alice', target('apply', { environment: 'staging' })), /Среда/);
  const created = await delivery.connections.create('alice', target());
  const stored = await fs.readFile(path.join(directory, 'delivery', 'connections', created.id + '.json'), 'utf8');
  assert.equal(/token|password|secret/i.test(stored), false);
  assert.equal((await delivery.connections.list('bob')).length, 0);
  await assert.rejects(delivery.connections.get(created.id, 'bob'), error => error.statusCode === 404);
  await assert.rejects(delivery.connections.remove(created.id, 'bob'), error => error.statusCode === 404);
  await delivery.connections.remove(created.id, 'alice');
  assert.equal((await delivery.connections.list('alice')).length, 0);
});

test('read-back compares package and manifest hashes, without filename exclusions', () => {
  const row = (path, value) => ({ path, sha256: value.repeat(64) });
  const expected = [row('package.json', 'a'), row('widgets/manifest.json', 'b'), row('widgets/form.json', 'c')];
  assert.equal(compareReadBack(expected, expected).match, true);
  assert.equal(compareReadBack(expected, [row('package.json', 'd'), row('widgets/manifest.json', 'e'), expected[2]]).match, false);
  assert.deepEqual(compareReadBack(expected, []).missing, ['package.json', 'widgets/form.json', 'widgets/manifest.json']);
  assert.equal(compareReadBack(expected, [...expected, row('permissionsSettings/stale.json', 'f')]).match, false);
});

test('API: synthetic adapter is disabled unless enabled, routes require session, service header and owner', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-delivery-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const run = async (server, requests) => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try { return await requests(async (route, options = {}, cookie) => {
      const response = await fetch(base + route, { ...options, headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
      return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }); } finally { await new Promise(resolve => server.close(resolve)); }
  };
  await run(createServer({ directory, allowLocal: true }), async request => {
    const { cookie } = await request('/auth/local', { method: 'POST', body: '{}' });
    assert.equal((await request('/api/connections')).status, 401);
    assert.equal((await request('/api/connections', {}, cookie)).status, 200);
    const denied = await request('/api/connections', { method: 'POST', body: JSON.stringify(target()) }, cookie);
    assert.equal(denied.status, 503); assert.match(denied.body.error, /недоступен/);
  });
  await run(createServer({ directory, allowLocal: true, syntheticDelivery: true }), async request => {
    const { cookie } = await request('/auth/local', { method: 'POST', body: '{}' });
    const created = await request('/api/connections', { method: 'POST', body: JSON.stringify(target()) }, cookie);
    assert.equal(created.status, 201); assert.equal(created.body.owner, undefined);
    assert.equal((await request(`/api/connections/${created.body.id}/probe`, { method: 'POST', body: '{}' }, cookie)).body.probe.ok, true);
    assert.equal((await request(`/api/connections/${created.body.id}`, { method: 'POST', body: '{}', headers: { 'X-Elma-Wiki-Request': '' } }, cookie)).status, 403);
    assert.equal((await request(`/api/connections/${crypto.randomUUID()}`, {}, cookie)).status, 404);
    assert.equal((await request(`/api/releases/${crypto.randomUUID()}/delivery`, {}, cookie)).status, 404);
    assert.equal((await request(`/api/connections/${created.body.id}`, { method: 'DELETE' }, cookie)).status, 200);
  });
});

test('whole-scope read-back rejects changed metadata, unexpected files and duplicate paths', async t => {
  for (const mode of ['metadata', 'unexpected', 'duplicate']) await t.test(mode, async t => {
    const { projects, releases, delivery } = await setup(t, { adapters: { synthetic: () => {
      const adapter = syntheticAdapter();
      return { ...adapter, async readBack(code) {
        const result = await adapter.readBack(code);
        if (mode === 'metadata') result.inventory.find(row => row.path === 'package.json').sha256 = 'f'.repeat(64);
        if (mode === 'unexpected') result.inventory.push({ path: 'permissionsSettings/stale.json', sha256: 'd'.repeat(64) });
        if (mode === 'duplicate') result.inventory.push({ ...result.inventory[0] });
        return result;
      } };
    } } });
    const release = await approvedRelease(projects, releases);
    const connection = await delivery.connections.create('alice', target());
    let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
    attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: mode, confirmation: confirmation(attempt) });
    if (mode === 'duplicate') {
      await assert.rejects(delivery.verify(release.id, attempt.id, 'alice'), { statusCode: 502 });
      attempt = await delivery.get(release.id, attempt.id, 'alice');
      assert.equal(attempt.evidence.readBack, null);
      assert.ok(attempt.evidence.verificationError);
    } else {
      attempt = await delivery.verify(release.id, attempt.id, 'alice');
      assert.equal(attempt.evidence.comparison.match, false);
      if (mode === 'metadata') assert.deepEqual(attempt.evidence.comparison.different, ['package.json']);
      else assert.deepEqual(attempt.evidence.comparison.unexpected, ['permissionsSettings/stale.json']);
    }
    assert.equal(attempt.state, 'verification-failed');
    assert.equal((await releases.get(release.id, 'alice')).checks.find(c => c.id === 'target').result, 'fail');
  });
});

test('a matching inventory from a changed Target cannot verify before or during read-back', async t => {
  for (const duringReadBack of [false, true]) await t.test(String(duringReadBack), async t => {
    let host = 'test.example.invalid', readCount = 0, changeOnRead = false;
    const { projects, releases, delivery } = await setup(t, { adapters: { synthetic: () => {
      const adapter = syntheticAdapter();
      return { ...adapter, async health() { return { ok: true, identity: { host, version: '2025.10.97', company: 'synthetic' } }; },
        async readBack(code) { readCount++; if (changeOnRead) host = 'another.example.invalid'; return adapter.readBack(code); } };
    } } });
    const release = await approvedRelease(projects, releases);
    const connection = await delivery.connections.create('alice', target());
    let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
    attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'identity', confirmation: confirmation(attempt) });
    if (duringReadBack) changeOnRead = true; else host = 'another.example.invalid';
    await assert.rejects(delivery.verify(release.id, attempt.id, 'alice'), { statusCode: 409 });
    assert.equal(readCount, duringReadBack ? 1 : 0);
    assert.equal((await delivery.get(release.id, attempt.id, 'alice')).state, 'verification-failed');
  });
});

test('unhealthy Target at confirmation blocks dispatch even when the identity is unchanged', async t => {
  let healthy = true;
  const operations = [];
  const { projects, releases, delivery } = await setup(t, { adapters: { synthetic: () => {
    const adapter = syntheticAdapter({ calls: operations });
    return { ...adapter, async health() { return { ...await adapter.health(), ok: healthy }; } };
  } } });
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.create('alice', target());
  const attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  healthy = false;
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'health', confirmation: confirmation(attempt) }), { statusCode: 503 });
  assert.equal(operations.length, 0);
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).state, 'blocked');
});

test('identity object key order does not cause a false change', async t => {
  let reorder = false;
  const { projects, releases, delivery } = await setup(t, { adapters: { synthetic: () => {
    const adapter = syntheticAdapter();
    return { ...adapter, async health() {
      const health = await adapter.health();
      if (reorder) health.identity = { company: health.identity.company, version: health.identity.version, host: health.identity.host };
      return health;
    } };
  } } });
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.create('alice', target());
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  reorder = true;
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'reorder', confirmation: confirmation(attempt) });
  assert.equal((await delivery.verify(release.id, attempt.id, 'alice')).state, 'verified');
});

test('release changes during read-back invalidate evidence before it can become verified', async t => {
  let onRead = async () => {};
  const { projects, releases, delivery } = await setup(t, { adapters: { synthetic: () => {
    const adapter = syntheticAdapter();
    return { ...adapter, async readBack(code) { const result = await adapter.readBack(code); await onRead(); return result; } };
  } } });
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.create('alice', target());
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'stale-read', confirmation: confirmation(attempt) });
  onRead = () => releases.change(release.id, 'alice', { ...details, revision: release.revision, action: 'details', notes: 'changed during read-back', limitations: '' });
  await assert.rejects(delivery.verify(release.id, attempt.id, 'alice'));
  const result = await delivery.get(release.id, attempt.id, 'alice');
  assert.equal(result.state, 'verification-failed');
  assert.equal(result.evidence.comparison, null);
});

test('legacy verified records lose their pass until checked against the current policy', async t => {
  const { directory, projects, releases, delivery } = await setup(t);
  const release = await approvedRelease(projects, releases);
  const connection = await delivery.connections.create('alice', target());
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'legacy', confirmation: confirmation(attempt) });
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verified');
  const file = path.join(directory, 'delivery', 'attempts', release.id, attempt.id + '.json');
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  delete record.evidence.comparison.policy;
  await fs.writeFile(file, JSON.stringify(record));
  const invalidated = await delivery.get(release.id, attempt.id, 'alice');
  assert.equal(invalidated.state, 'verification-failed');
  assert.equal(invalidated.evidence.operation.operationId, attempt.evidence.operation.operationId);
  assert.equal((await delivery.summary(release.id, 'alice')).latest.state, 'verification-failed');
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).history.length, invalidated.history.length);
  assert.equal((await delivery.verify(release.id, attempt.id, 'alice')).state, 'verified');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, syntheticAdapter, inventoryOf, canonicalJson } from '../lib/delivery.mjs';
import { createServer } from '../server.mjs';
import { zip } from './fixture.mjs';

// MR-08 promotion and recovery through the single delivery coordinator. Every Target here is a
// synthetic adapter on a fictional host; nothing reaches ELMA, a bridge or a production host.
const fixture = (required = false) => zip([
  ['package.json', { code: 'synthetic_release', title: 'Synthetic package', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
]);
const details = { title: 'Promotion release', intent: 'Promote the verified candidate', targetIntent: 'TEST then STAGE' };
const VERSION = '2025.10.97';
const host = name => `${name}.example.invalid`;
const target = (name, extra = {}, options = {}) => ({ name: name.toUpperCase(), role: 'target', environment: 'test', adapter: 'synthetic',
  adapterOptions: { identity: { host: host(name), version: VERSION }, ...options }, ...extra });
const confirmation = attempt => `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`;
const status = code => error => error.statusCode === code;

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-promotion-test-'));
  t.after(async () => { assert.ok(path.basename(directory).startsWith('e365-promotion-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), calls = [], targets = new Map();
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  const baselineInventory = await inventoryOf(await fixture(false));
  delivery = deliveryStore(directory, releases, { adapters: { synthetic: opts => {
    const adapter = syntheticAdapter({ inventory: baselineInventory, calls, ...opts });
    targets.set(opts.identity?.host, adapter);
    return adapter;
  } }, protectedHosts: [host('protected')], timeoutMs: 50, ...options });
  const release = await approvedRelease(projects, releases);
  const connect = (...args) => delivery.connections.create('alice', target(...args));
  // Instantiate the adapter of a connection so a test can change its Target externally.
  const external = async (connection, label) => { await delivery.connections.probe(connection.id, 'alice'); targets.get(connection.adapterOptions.identity.host).simulateExternalChange(label); };
  return { directory, projects, releases, delivery, calls, release, connect, external };
}
async function approvedRelease(projects, releases, owner = 'alice') {
  const baseline = await projects.create(owner, await fixture(false)), source = await projects.create(owner, await fixture(true));
  let release = await releases.create(owner, { ...details, sourceProjectId: source.id, baselineProjectId: baseline.id });
  for (const row of release.changes) release = await releases.change(release.id, owner, { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic review' });
  release = await releases.change(release.id, owner, { revision: release.revision, action: 'freeze' });
  return releases.change(release.id, owner, { revision: release.revision, action: 'approve', reason: 'Synthetic acceptance' });
}
async function delivered(delivery, release, connection, key = 'first') {
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: key, confirmation: confirmation(attempt) });
  return delivery.verify(release.id, attempt.id, 'alice');
}

test('promotion carries the exact verified candidate to a matching destination and binds a per-destination evidence packet', async t => {
  const { delivery, calls, release, connect } = await setup(t);
  const testTarget = await connect('test-a'), stage = await connect('stage-b');
  const source = await delivered(delivery, release, testTarget);
  assert.equal(source.state, 'verified');
  let promoted = await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'promote-1' });
  assert.equal(promoted.state, 'prepared');
  assert.equal(promoted.sha256, source.sha256); assert.equal(promoted.candidateId, source.candidateId);
  assert.equal(promoted.promotion.fromAttemptId, source.id);
  assert.equal(promoted.promotion.fromEvidence.preDeployInventoryHash, source.evidence.preDeploy.inventoryHash);
  assert.equal(promoted.evidence.preDeploy.inventoryHash, source.evidence.preDeploy.inventoryHash);
  // A lost promote response: the same key replays the stored attempt, never a second one.
  assert.equal((await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'promote-1' })).id, promoted.id);
  await assert.rejects(delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'promote-2' }), status(409));
  assert.equal(calls.length, 1, 'promotion preparation dispatches nothing');
  // Normal typed confirmation and read-back on the destination.
  await assert.rejects(delivery.confirm(release.id, promoted.id, 'alice', { idempotencyKey: 'p', confirmation: 'DEPLOY wrong' }), status(400));
  promoted = await delivery.confirm(release.id, promoted.id, 'alice', { idempotencyKey: 'p', confirmation: confirmation(promoted) });
  assert.equal(promoted.state, 'deployed-unverified');
  promoted = await delivery.verify(release.id, promoted.id, 'alice');
  assert.equal(promoted.state, 'verified'); assert.equal(promoted.evidence.reconciliation.outcome, 'applied');
  assert.equal(calls.length, 2);

  const sourcePacket = await delivery.packet(release.id, source.id, 'alice'), destinationPacket = await delivery.packet(release.id, promoted.id, 'alice');
  assert.equal(sourcePacket.schema, 'delivery-evidence-packet-v1');
  assert.equal(sourcePacket.inputsDigest, destinationPacket.inputsDigest, 'same exact inputs');
  assert.notEqual(sourcePacket.environmentDigest, destinationPacket.environmentDigest, 'separate destination profile');
  assert.equal(destinationPacket.environmentProfile.host, host('stage-b'));
  assert.equal(destinationPacket.environmentProfile.platformVersion, VERSION);
  assert.equal(destinationPacket.lineage.promotion.fromAttemptId, source.id);
  assert.equal(destinationPacket.lineage.promotion.fromEvidence.packetDigest, promoted.promotion.fromEvidence.packetDigest);
  assert.deepEqual(destinationPacket.outcome, { state: 'verified', candidateStatus: 'current', verificationCurrent: true });
  assert.equal(destinationPacket.evidenceBasis, 'synthetic');
  assert.deepEqual(destinationPacket.notEstablished, ['live-delivery', 'native-business-acceptance']);
  assert.equal(JSON.stringify(destinationPacket).includes('"owner"'), false);
  // The digest is reproducible and covers the whole packet.
  const { packetDigest, ...rest } = destinationPacket;
  assert.equal((await delivery.packet(release.id, promoted.id, 'alice')).packetDigest, packetDigest);
  assert.equal(packetDigest, (await import('node:crypto')).createHash('sha256').update(canonicalJson(rest)).digest('hex'));
});

test('promotion refuses unverified evidence, the same Target, another platform profile and a destination that drifted from the evidence', async t => {
  const { delivery, calls, release, connect, external } = await setup(t);
  const testTarget = await connect('test-a');
  // Not yet verified: a returned operation is not promotable evidence.
  let source = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: testTarget.id });
  source = await delivery.confirm(release.id, source.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(source) });
  const stage = await connect('stage-b');
  await assert.rejects(delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'early' }), error => error.statusCode === 409 && /verified/.test(error.message));
  source = await delivery.verify(release.id, source.id, 'alice');
  const promote = (connection, key) => delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: connection.id, idempotencyKey: key });
  await assert.rejects(promote(testTarget, 'same-connection'), status(409));
  await assert.rejects(promote(await connect('alias', {}, { identity: { host: host('test-a'), version: VERSION } }), 'alias'), error => error.statusCode === 409 && /совпадает/.test(error.message));
  await assert.rejects(promote(await connect('other-platform', {}, { identity: { host: host('other-platform'), version: '2026.1' } }), 'platform'), error => /платформы/.test(error.message));
  await assert.rejects(delivery.promote(release.id, source.id, 'alice', { revision: release.revision - 1, connectionId: stage.id, idempotencyKey: 'old-tab' }), status(409));
  // Destination state changed since the evidence was produced: blocked before any attempt exists.
  const drifted = await connect('drifted');
  await external(drifted, 'concurrent-draft');
  await assert.rejects(promote(drifted, 'drift'), error => error.statusCode === 409 && /drift/.test(error.message));
  assert.equal((await delivery.list(release.id, 'alice')).length, 1, 'refused promotions persist no attempt');
  assert.equal(calls.length, 1);
});

test('fresh pre-dispatch drift check: a destination change after promotion preparation blocks dispatch', async t => {
  const { delivery, calls, release, connect, external } = await setup(t);
  const source = await delivered(delivery, release, await connect('test-a'));
  const stage = await connect('stage-b');
  const promoted = await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'p' });
  await external(stage, 'operator-change');
  await assert.rejects(delivery.confirm(release.id, promoted.id, 'alice', { idempotencyKey: 'c', confirmation: confirmation(promoted) }), status(409));
  const blocked = await delivery.get(release.id, promoted.id, 'alice');
  assert.equal(blocked.state, 'blocked'); assert.match(blocked.history.at(-1).note, /drift/);
  assert.equal(calls.length, 1);
});

test('promotion chains from verified destination evidence; a destination already holding the candidate is not imported again', async t => {
  const { delivery, calls, release, connect } = await setup(t);
  const source = await delivered(delivery, release, await connect('test-a'));
  const stage = await connect('stage-b');
  const attempt = await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'a' });
  await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'a', confirmation: confirmation(attempt) });
  await delivery.verify(release.id, attempt.id, 'alice');
  await assert.rejects(delivery.promote(release.id, attempt.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'b' }), status(409));
  const second = await connect('stage-c');
  const chained = await delivery.promote(release.id, attempt.id, 'alice', { revision: release.revision, connectionId: second.id, idempotencyKey: 'c' });
  assert.equal(chained.promotion.fromAttemptId, attempt.id);
  await delivery.cancel(release.id, chained.id, 'alice');
  await assert.rejects(delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'again' }), error => error.statusCode === 409 && /уже содержит/.test(error.message));
  assert.equal(calls.length, 2);
});

test('a promotion dispatches only while its source evidence stays verified and current', async t => {
  const { directory, delivery, calls, release, connect } = await setup(t);
  const source = await delivered(delivery, release, await connect('test-a'));
  const promoted = await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: (await connect('stage-b')).id, idempotencyKey: 'p' });
  // The source verification is lazily invalidated (legacy policy record): it no longer supports promotion.
  const file = path.join(directory, 'delivery', 'attempts', release.id, source.id + '.json');
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  delete stored.evidence.comparison.policy;
  await fs.writeFile(file, JSON.stringify(stored));
  await assert.rejects(delivery.confirm(release.id, promoted.id, 'alice', { idempotencyKey: 'c', confirmation: confirmation(promoted) }), status(409));
  const blocked = await delivery.get(release.id, promoted.id, 'alice');
  assert.equal(blocked.state, 'blocked'); assert.match(blocked.history.at(-1).note, /исходной проверки/);
  assert.equal(calls.length, 1);
});

test('PROD stays refused by default; only a trusted owner grant for an exact promotion plus a separate typed confirmation reaches it', async t => {
  // Default store (as server.mjs builds it): no grants.
  const plain = await setup(t);
  const source = await delivered(plain.delivery, plain.release, await plain.connect('test-a'));
  const prod = await plain.connect('prod-p', { environment: 'prod' });
  await assert.rejects(plain.delivery.promote(plain.release.id, source.id, 'alice', { revision: plain.release.revision, connectionId: prod.id, idempotencyKey: 'p' }), error => error.statusCode === 403 && /PROD/.test(error.message));
  await assert.rejects(plain.delivery.prepare(plain.release.id, 'alice', { revision: plain.release.revision, connectionId: prod.id }), status(403));
  assert.equal((await plain.delivery.list(plain.release.id, 'alice')).length, 1);

  // Grants are read once at construction: a later change to the supplied list has no effect.
  const grants = [];
  const granted = await setup(t, { productionPromotions: grants });
  const sourceAttempt = await delivered(granted.delivery, granted.release, await granted.connect('test-a'));
  const destination = await granted.connect('prod-p', { environment: 'prod' });
  const connectionId = destination.id, sha256 = sourceAttempt.sha256, expiresAt = '2999-01-01T00:00:00.000Z';
  const grant = { authorizationRef: 'owner-record-synthetic', sha256, connectionId, host: host('prod-p'), expiresAt };
  grants.push(grant);
  const promoteWith = (store, key, id = connectionId) => store.promote(granted.release.id, sourceAttempt.id, 'alice', { revision: granted.release.revision, connectionId: id, idempotencyKey: key });
  await assert.rejects(promoteWith(granted.delivery, 'late-grant'), status(403));
  const baselineInventory = await inventoryOf(await fixture(false));
  const storeWith = (productionPromotions, calls = []) => deliveryStore(granted.directory, granted.releases, {
    adapters: { synthetic: opts => syntheticAdapter({ inventory: baselineInventory, calls, ...opts }) }, protectedHosts: [host('protected')], productionPromotions });
  for (const [label, change] of [['wrong candidate', { sha256: 'a'.repeat(64) }], ['wrong connection', { connectionId: 'other' }], ['wrong host', { host: host('elsewhere') }],
    ['expired', { expiresAt: '2000-01-01T00:00:00.000Z' }], ['no reference', { authorizationRef: ' ' }]])
    await assert.rejects(promoteWith(storeWith([{ ...grant, ...change }]), label), status(403), label);
  const calls = [], store = storeWith([grant], calls);
  // A grant never authorizes a direct preparation, only a promotion of verified evidence.
  await assert.rejects(store.prepare(granted.release.id, 'alice', { revision: granted.release.revision, connectionId }), status(403));
  let attempt = await promoteWith(store, 'granted');
  assert.equal(attempt.promotion.production.authorizationRef, 'owner-record-synthetic');
  await assert.rejects(store.confirm(granted.release.id, attempt.id, 'alice', { idempotencyKey: 'c', confirmation: confirmation(attempt) }), status(400));
  assert.equal(calls.length, 0, 'no dispatch without the separate PROD confirmation');
  attempt = await store.confirm(granted.release.id, attempt.id, 'alice', { idempotencyKey: 'c', confirmation: confirmation(attempt),
    productionConfirmation: `PROMOTE PROD ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)} ${host('prod-p')}` });
  assert.equal(attempt.state, 'deployed-unverified');
  // Without the grant the PROD attempt cannot even be read back: it stays unresolved and reserved.
  await assert.rejects(granted.delivery.verify(granted.release.id, attempt.id, 'alice'), status(403));
  assert.equal((await granted.delivery.get(granted.release.id, attempt.id, 'alice')).state, 'deployed-unverified');
  assert.equal((await store.verify(granted.release.id, attempt.id, 'alice')).state, 'verified');
  assert.equal(calls.length, 1);
  // A protected host stays refused even with a matching grant.
  const guarded = await granted.connect('protected', { environment: 'prod' });
  await assert.rejects(promoteWith(storeWith([{ ...grant, connectionId: guarded.id, host: host('protected') }]), 'protected', guarded.id), error => error.statusCode === 403 && /защищённый/.test(error.message));
});

test('lost response: an applied import with no answer stays unknown, blocks retry and is reconciled only by read-back', async t => {
  const { delivery, calls, release, connect } = await setup(t);
  const connection = await connect('test-a', {}, { scenario: 'lost-response' });
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'once', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'unknown-outcome');
  // A lost HTTP answer: replaying the same key returns the stored attempt and never redispatches.
  assert.equal((await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'once', confirmation: confirmation(attempt) })).state, 'unknown-outcome');
  await assert.rejects(delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'other', confirmation: confirmation(attempt) }), status(409));
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => error.statusCode === 409 && /read-back/.test(error.message));
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), status(409));
  await assert.rejects(delivery.promote(release.id, attempt.id, 'alice', { revision: release.revision, connectionId: (await connect('stage-b')).id, idempotencyKey: 'p' }), status(409));
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verified');
  assert.equal(attempt.evidence.reconciliation.fromState, 'unknown-outcome'); assert.equal(attempt.evidence.reconciliation.outcome, 'applied');
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => error.statusCode === 409 && /проверена/.test(error.message));
  assert.equal(calls.length, 1);
});

test('restart during dispatch: unknown outcome until read-back; a not-applied reconciliation allows one idempotent, separately confirmed retry', async t => {
  const { directory, releases, delivery, calls, release, connect } = await setup(t);
  const connection = await connect('test-a', {}, { sequence: ['timeout', 'apply'] });
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'unknown-outcome');
  // A previous process left `deploying`: restart reconciliation keeps the outcome unknown.
  const file = path.join(directory, 'delivery', 'attempts', release.id, attempt.id + '.json');
  await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), state: 'deploying', bootId: 'previous-process' }));
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).state, 'unknown-outcome');
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r1' }), status(409));
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verification-failed'); assert.equal(attempt.evidence.reconciliation.outcome, 'not-applied');
  let retry = await delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r1' });
  assert.equal(retry.state, 'prepared'); assert.deepEqual(retry.retryOf, { attemptId: attempt.id, reconciliation: 'not-applied', mode: 'retry' });
  // Idempotent: the same key returns the same retry; another key is refused.
  assert.equal((await delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r1' })).id, retry.id);
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r2' }), status(409));
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).retriedBy, retry.id);
  assert.equal(calls.length, 1, 'a retry is prepared, never dispatched automatically');
  retry = await delivery.confirm(release.id, retry.id, 'alice', { idempotencyKey: 'rk', confirmation: confirmation(retry) });
  assert.equal((await delivery.verify(release.id, retry.id, 'alice')).state, 'verified');
  assert.equal(calls.length, 2);
  assert.equal((await releases.get(release.id, 'alice')).checks.find(check => check.id === 'target').result, 'pass');
  assert.equal((await delivery.packet(release.id, retry.id, 'alice')).lineage.retryOf.attemptId, attempt.id);
});

test('a Target changed after reconciliation is not retried on stale evidence', async t => {
  const { delivery, calls, release, connect, external } = await setup(t);
  const connection = await connect('test-b', {}, { scenario: 'timeout' });
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.evidence.reconciliation.outcome, 'not-applied');
  await external(connection, 'after-reconciliation');
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => error.statusCode === 409 && /drift/.test(error.message));
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).retriedBy, undefined);
  assert.equal(calls.length, 1);
});

test('partial install: diverged read-back blocks plain retry; forward recovery needs a declared idempotent re-import and a fresh confirmation', async t => {
  for (const reimport of [null, 'idempotent']) await t.test(String(reimport), async t => {
    const { delivery, calls, release, connect } = await setup(t);
    const connection = await connect('test-a', {}, { sequence: ['diverge', 'apply'], ...(reimport ? { reimport } : {}) });
    let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
    attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
    assert.equal(attempt.state, 'failed');
    // An adapter error is not proof that nothing applied: read back before any retry.
    await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => /read-back/.test(error.message));
    attempt = await delivery.verify(release.id, attempt.id, 'alice');
    assert.equal(attempt.state, 'verification-failed');
    assert.equal(attempt.evidence.reconciliation.outcome, 'diverged'); assert.equal(attempt.evidence.reconciliation.fromState, 'failed');
    if (!reimport) {
      await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => error.statusCode === 409 && /идемпотентный/.test(error.message));
      assert.equal((await delivery.get(release.id, attempt.id, 'alice')).retriedBy, undefined);
      assert.equal(calls.length, 1);
      return;
    }
    let recovery = await delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' });
    assert.equal(recovery.retryOf.mode, 'forward-recovery');
    assert.equal(recovery.evidence.preDeploy.inventoryHash, attempt.evidence.reconciliation.readBackInventoryHash);
    recovery = await delivery.confirm(release.id, recovery.id, 'alice', { idempotencyKey: 'rk', confirmation: confirmation(recovery) });
    assert.equal((await delivery.verify(release.id, recovery.id, 'alice')).state, 'verified');
    assert.equal(calls.length, 2);
  });
});

test('retry refuses attempts that never dispatched or whose candidate changed; packets go stale with the candidate', async t => {
  const { delivery, releases, calls, release, connect } = await setup(t);
  const connection = await connect('test-a', {}, { scenario: 'unapplied' });
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), status(409));
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
  assert.equal((await delivery.verify(release.id, attempt.id, 'alice')).evidence.reconciliation.outcome, 'not-applied');
  await releases.change(release.id, 'alice', { ...details, action: 'details', revision: release.revision, notes: 'Changed', limitations: '' });
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), status(409));
  assert.equal((await delivery.packet(release.id, attempt.id, 'alice')).outcome.candidateStatus, 'stale');
  await assert.rejects(delivery.packet(release.id, attempt.id, 'bob'), error => [403, 404].includes(error.statusCode));
  assert.equal(calls.length, 1);
});

test('API: promote, retry and packet use the existing release route; PROD stays refused and no PROD grant is wired', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-promotion-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const server = createServer({ directory, allowLocal: true, syntheticDelivery: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' };
  const login = await fetch(base + '/auth/local', { method: 'POST', headers, body: '{}' });
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const request = async (route, body) => { const response = await fetch(base + route, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }); return { status: response.status, body: await response.json() }; };
  const owner = (await request('/api/session')).body.user.id;
  const projects = projectStore(directory), releases = releaseStore(directory, projects, { sharedAccess: true });
  const release = await approvedRelease(projects, releases, owner);
  const connection = async (name, extra = {}) => (await request('/api/connections', target(name, extra))).body;
  const testTarget = await connection('test-a'), stage = await connection('stage-b'), prod = await connection('prod-p', { environment: 'prod' });
  const route = `/api/releases/${release.id}/delivery`;
  let attempt = (await request(route, { action: 'prepare', revision: release.revision, connectionId: testTarget.id })).body;
  attempt = (await request(route, { action: 'confirm', attemptId: attempt.id, idempotencyKey: 'k', confirmation: confirmation(attempt) })).body;
  attempt = (await request(route, { action: 'verify', attemptId: attempt.id })).body;
  assert.equal(attempt.state, 'verified');
  assert.equal((await request(route, { action: 'promote', attemptId: attempt.id, connectionId: prod.id, revision: release.revision, idempotencyKey: 'p' })).status, 403);
  const promoted = await request(route, { action: 'promote', attemptId: attempt.id, connectionId: stage.id, revision: release.revision, idempotencyKey: 'p' });
  assert.equal(promoted.status, 201); assert.equal(promoted.body.promotion.fromAttemptId, attempt.id);
  assert.equal((await request(route, { action: 'retry', attemptId: attempt.id, idempotencyKey: 'r' })).status, 409);
  const packet = await request(`${route}?packet=${promoted.body.id}`);
  assert.equal(packet.status, 200); assert.equal(packet.body.schema, 'delivery-evidence-packet-v1'); assert.equal(packet.body.outcome.state, 'prepared');
  const source = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('productionPromotions'), false, 'the service never constructs PROD grants');
});

test('review regression: an unreconciled failed or diverged attempt reserves the Target, so a fresh prepare cannot bypass the recovery gate', async t => {
  const { projects, releases, delivery, calls, release, connect } = await setup(t);
  // Exact review repro: partial install, no idempotent re-import capability.
  const connection = await connect('test-a', {}, { sequence: ['diverge', 'apply'] });
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'k', confirmation: confirmation(attempt) });
  assert.equal(attempt.state, 'failed');
  const other = await approvedRelease(projects, releases);
  const alias = await connect('alias', {}, { identity: { host: host('test-a'), version: VERSION } });
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), status(409));
  await assert.rejects(delivery.prepare(other.id, 'alice', { revision: other.revision, connectionId: alias.id }), status(409));
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.evidence.reconciliation.outcome, 'diverged');
  // Diverged: still reserved; only the gated forward recovery (refused without idempotent re-import) may follow.
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), status(409));
  await assert.rejects(delivery.prepare(other.id, 'alice', { revision: other.revision, connectionId: alias.id }), status(409));
  await assert.rejects(delivery.retry(release.id, attempt.id, 'alice', { idempotencyKey: 'r' }), error => /идемпотентный/.test(error.message));
  assert.equal(calls.length, 1, 'no second import without read-back and the recovery gate');
  assert.equal((await delivery.get(release.id, attempt.id, 'alice')).state, 'verification-failed');
});

test('review regression: a read-back never verifies an earlier attempt with a later attempt\'s import', async t => {
  const { delivery, calls, release, connect } = await setup(t);
  const connection = await connect('test-a', {}, { sequence: ['fail', 'apply'] });
  let first = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  first = await delivery.confirm(release.id, first.id, 'alice', { idempotencyKey: 'k1', confirmation: confirmation(first) });
  assert.equal(first.state, 'failed');
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id }), status(409));
  first = await delivery.verify(release.id, first.id, 'alice');
  assert.equal(first.evidence.reconciliation.outcome, 'not-applied');
  // Reconciled as not applied: a new, separately confirmed attempt is allowed again.
  let second = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: connection.id });
  second = await delivery.confirm(release.id, second.id, 'alice', { idempotencyKey: 'k2', confirmation: confirmation(second) });
  assert.equal((await delivery.verify(release.id, second.id, 'alice')).state, 'verified');
  await assert.rejects(delivery.verify(release.id, first.id, 'alice'), error => error.statusCode === 409 && /позже/.test(error.message));
  const stored = await delivery.get(release.id, first.id, 'alice');
  assert.equal(stored.state, 'verification-failed'); assert.equal(stored.evidence.reconciliation.outcome, 'not-applied');
  // The superseded attempt is not promotable evidence either.
  await assert.rejects(delivery.promote(release.id, first.id, 'alice', { revision: release.revision, connectionId: (await connect('stage-b')).id, idempotencyKey: 'p' }), status(409));
  assert.equal(calls.length, 2);
});

test('review regression: a promotion key reused for another destination is a conflict', async t => {
  const { delivery, release, connect } = await setup(t);
  const source = await delivered(delivery, release, await connect('test-a'));
  const stage = await connect('stage-b'), other = await connect('stage-c');
  const promoted = await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'same' });
  await assert.rejects(delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: other.id, idempotencyKey: 'same' }), error => error.statusCode === 409 && /другого Target/.test(error.message));
  assert.equal((await delivery.promote(release.id, source.id, 'alice', { revision: release.revision, connectionId: stage.id, idempotencyKey: 'same' })).id, promoted.id);
  assert.equal((await delivery.list(release.id, 'alice')).length, 2);
});

test('review regression: every delivery route, including the legacy release route, allowlists request keys', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-promotion-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const server = createServer({ directory, allowLocal: true, syntheticDelivery: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' };
  const login = await fetch(base + '/auth/local', { method: 'POST', headers, body: '{}' });
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const request = async (route, body) => { const response = await fetch(base + route, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }); return { status: response.status, body: await response.json() }; };
  const owner = (await request('/api/session')).body.user.id;
  const projects = projectStore(directory), releases = releaseStore(directory, projects, { sharedAccess: true });
  const release = await approvedRelease(projects, releases, owner);
  const connection = (await request('/api/connections', target('test-a'))).body;
  const route = `/api/releases/${release.id}/delivery`;
  assert.equal((await request(route, { action: 'prepare', revision: release.revision, connectionId: connection.id, owner: 'someone' })).status, 400);
  assert.equal((await request(route, { action: 'unknown' })).status, 400);
  const attempt = (await request(route, { action: 'prepare', revision: release.revision, connectionId: connection.id })).body;
  const confirm = { action: 'confirm', attemptId: attempt.id, idempotencyKey: 'k', confirmation: confirmation(attempt) };
  const refused = await request(route, { ...confirm, productionConfirmation: `PROMOTE PROD ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)} ${host('test-a')}` });
  assert.equal(refused.status, 400);
  assert.equal((await request(`${route}?packet=${attempt.id}`)).body.outcome.state, 'prepared', 'a refused request dispatches nothing');
  assert.equal((await request(route, confirm)).body.state, 'deployed-unverified');
});

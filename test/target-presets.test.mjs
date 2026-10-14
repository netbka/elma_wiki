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
import { targetPresets, guardPresetDeploy, workerTarget } from '../lib/target-presets.mjs';
import { zip } from './fixture.mjs';

// Synthetic hosts only; no live ELMA endpoint is contacted.
const DEV = 'dev.example.invalid', DEV2 = 'dev2.example.invalid', PROD = 'prod.example.invalid';
const env = (extra = {}) => ({ WIKI_TARGET_DEV_URL: `https://${DEV}`, WIKI_TARGET_DEV2_URL: `https://${DEV2}/`, ...extra });
const byId = presets => Object.fromEntries(presets.map(preset => [preset.id, preset]));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('exactly DEV and DEV2 are predefined; missing variables leave a Target unavailable without a guessed host', () => {
  const empty = targetPresets({ WIKI_TARGET_PROD_URL: `https://${PROD}`, PROD_URL: `https://${PROD}` });
  assert.deepEqual(empty.map(preset => preset.id), ['preset-dev', 'preset-dev2']);
  for (const preset of empty) {
    assert.equal(preset.available, false);
    assert.equal(preset.host, null); assert.equal(preset.baseUrl, null);
    assert.deepEqual(preset.allowedOperations, []);
  }
  assert.match(empty[0].reason, /WIKI_TARGET_DEV_URL/);
  assert.match(empty[1].reason, /WIKI_TARGET_DEV2_URL/);
  assert.ok(!JSON.stringify(empty).includes(PROD), 'no PROD configuration is ever produced');

  const { 'preset-dev': dev, 'preset-dev2': dev2 } = byId(targetPresets(env({ WIKI_TARGET_DEV2_NAME: 'DEV2 (technical)' })));
  assert.deepEqual({ ...dev, reason: dev.reason }, { id: 'preset-dev', name: 'DEV', environmentRole: 'shared-business', bridgeTarget: 'main-dev', baseUrl: `https://${DEV}`, host: DEV,
    allowedOperations: ['health', 'inspect', 'export'], designatedCandidates: [], available: true, reason: null });
  assert.equal(dev2.name, 'DEV2 (technical)'); assert.equal(dev2.environmentRole, 'technical'); assert.equal(dev2.bridgeTarget, 'dev2');
  assert.equal(dev2.host, DEV2); assert.deepEqual(dev2.allowedOperations, ['health', 'inspect', 'export', 'readBack', 'deploy']);
  assert.deepEqual(dev2.designatedCandidates, [], 'no candidate is designated by default');
});

test('bridge mapping is explicit: DEV is main-dev, DEV2 is dev2, the legacy dev name is refused', () => {
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV2_BRIDGE_TARGET: 'dev' })))['preset-dev2'].available, false);
  assert.match(byId(targetPresets(env({ WIKI_TARGET_DEV2_BRIDGE_TARGET: 'dev' })))['preset-dev2'].reason, /неоднозначен/);
  assert.match(byId(targetPresets(env({ WIKI_TARGET_DEV_BRIDGE_TARGET: 'dev' })))['preset-dev'].reason, /неоднозначен/);
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV_BRIDGE_TARGET: 'dev2' })))['preset-dev'].available, false);
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV2_BRIDGE_TARGET: 'main-dev' })))['preset-dev2'].available, false);
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV2_BRIDGE_TARGET: 'DEV2' })))['preset-dev2'].available, true);
  assert.equal(workerTarget('elma-dev bridge @ operator-pc → dev2'), 'dev2');
  assert.equal(workerTarget('elma-dev bridge @ operator-pc → main-dev'), 'main-dev');
  assert.equal(workerTarget('fake'), null);
});

test('DEV is read-only in configuration and code; DEV2 deploys only an owner-designated candidate', () => {
  const widened = byId(targetPresets(env({ WIKI_TARGET_DEV_OPERATIONS: 'health,inspect,export,deploy' })))['preset-dev'];
  assert.equal(widened.available, false); assert.match(widened.reason, /deploy/);
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV_OPERATIONS: 'health,readBack' })))['preset-dev'].available, false);
  const designated = 'b'.repeat(64);
  const { 'preset-dev': dev, 'preset-dev2': dev2 } = byId(targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: ` ${designated.toUpperCase()} ` })));
  assert.throws(() => guardPresetDeploy(dev, designated), error => error.statusCode === 403 && /только чтение/.test(error.message));
  assert.throws(() => guardPresetDeploy(dev2, 'c'.repeat(64)), error => error.statusCode === 403 && /назначенного владельцем/.test(error.message));
  assert.doesNotThrow(() => guardPresetDeploy(dev2, designated));
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: 'contracts' })))['preset-dev2'].available, false);
  // Deploy without its read-back is unprovable and is not a valid configuration.
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV2_OPERATIONS: 'health,inspect,deploy' })))['preset-dev2'].available, false);
  const readOnly = byId(targetPresets(env({ WIKI_TARGET_DEV2_OPERATIONS: 'health,inspect,export,readBack', WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: designated })))['preset-dev2'];
  assert.throws(() => guardPresetDeploy(readOnly, designated), /только чтение/);
});

test('misconfigured DEV2 pointing at shared DEV or a PROD host is rejected; credentials in a URL are rejected', () => {
  const shared = byId(targetPresets(env({ WIKI_TARGET_DEV2_URL: `https://${DEV.toUpperCase()}.` })));
  assert.equal(shared['preset-dev'].available, true);
  assert.equal(shared['preset-dev2'].available, false); assert.match(shared['preset-dev2'].reason, /общего DEV/);
  const prod = byId(targetPresets(env({ WIKI_TARGET_DEV2_URL: `https://${PROD}` }), { protectedHosts: [PROD] }));
  assert.equal(prod['preset-dev2'].available, false); assert.match(prod['preset-dev2'].reason, /защищённый/);
  const prodDev = byId(targetPresets(env({ WIKI_TARGET_DEV_URL: `https://${PROD}` }), { protectedHosts: [` ${PROD.toUpperCase()} `] }));
  assert.equal(prodDev['preset-dev'].available, false);
  const credential = byId(targetPresets(env({ WIKI_TARGET_DEV2_URL: `https://user:placeholder@${DEV2}` })))['preset-dev2'];
  assert.equal(credential.available, false); assert.ok(!JSON.stringify(credential).includes('placeholder'));
  assert.equal(byId(targetPresets(env({ WIKI_TARGET_DEV_URL: 'not a url' })))['preset-dev'].available, false);
});

const fixture = (required = false) => zip([
  ['package.json', { code: 'preset_release', title: 'Учебный пакет', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
]);
async function setup(t, variables) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'e365-preset-test-'));
  t.after(async () => { assert.ok(path.basename(directory).startsWith('e365-preset-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const projects = projectStore(directory), bridges = bridgeStore(directory, { onlineMs: 5000, healthTimeoutMs: 1000 });
  let delivery;
  const releases = releaseStore(directory, projects, { deliverySummary: (id, owner) => delivery.summary(id, owner) });
  const presets = targetPresets(variables, { protectedHosts: [PROD] });
  delivery = deliveryStore(directory, releases, { adapters: { bridge: (opts, connection) => bridges.adapter(opts, connection) }, presets,
    presetAdapter: (preset, connection) => bridges.presetAdapter(preset, connection), protectedHosts: [PROD], timeoutMs: 3000 });
  return { directory, projects, releases, delivery, bridges };
}
async function approvedRelease(projects, releases, owner = 'alice') {
  const baseline = await projects.create(owner, await fixture(false)), source = await projects.create(owner, await fixture(true));
  let release = await releases.create(owner, { title: 'Релиз в DEV2', intent: 'Проверить обязательность заголовка', targetIntent: 'DEV2', sourceProjectId: source.id, baselineProjectId: baseline.id });
  for (const row of release.changes) release = await releases.change(release.id, owner, { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Назначение изменения проверено' });
  release = await releases.change(release.id, owner, { revision: release.revision, action: 'freeze' });
  return releases.change(release.id, owner, { revision: release.revision, action: 'approve', reason: 'Принимаю неизменённый архив' });
}
// In-process stand-in for `elma-dev bridge --target=<name>` pointed at `host`.
function fakeWorker(bridges, token, { target, host, inventory = [] }) {
  let state = { inventory: structuredClone(inventory), version: 1 }, running = true;
  const log = [], identity = { host, version: '2025.10.97' };
  const loop = (async () => {
    while (running) {
      let bridge, job;
      try { bridge = await bridges.authenticate(`Bearer ${token}`); job = await bridges.poll(bridge, { identity, worker: `elma-dev bridge @ operator-pc → ${target}`, waitMs: 100 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      if (!job) continue;
      log.push(job.kind);
      try {
        if (job.kind === 'health') await bridges.complete(bridge, job.id, { ok: true, result: { ok: true, identity } });
        else if (job.kind === 'deploy') { state = { inventory: await inventoryOf(await bridges.artifact(bridge, job.id)), version: state.version + 1 }; await bridges.complete(bridge, job.id, { ok: true, result: { ok: true, nativeResult: 'import: exit 0' } }); }
        else await bridges.complete(bridge, job.id, { ok: true, result: { inventory: structuredClone(state.inventory), version: state.version } });
      } catch (error) { await bridges.complete(bridge, job.id, { ok: false, error: error.message }).catch(() => {}); }
    }
  })();
  return { log, stop: async () => { running = false; await loop; } };
}
async function online(bridges, id, owner = 'alice') {
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 25)))
    if ((await bridges.get(id, owner)).online) return;
  assert.fail('worker did not report online');
}

test('predefined Targets exist for every actor without setup and execute only through that actor\'s matching bridge', async t => {
  const { projects, releases, delivery, bridges, directory } = await setup(t, env());
  const listed = await delivery.connections.list('alice');
  assert.deepEqual(listed.map(row => [row.id, row.name, row.role, row.adapter, row.preset.bridgeTarget]), [['preset-dev', 'DEV', 'target', 'bridge', 'main-dev'], ['preset-dev2', 'DEV2', 'target', 'bridge', 'dev2']]);
  assert.deepEqual((await delivery.connections.list('bob')).map(row => row.id), ['preset-dev', 'preset-dev2']);
  await assert.rejects(delivery.connections.remove('preset-dev', 'alice'), error => error.statusCode === 403);
  // Without a running worker the probe is honest and names the bridge command.
  const offline = await delivery.connections.probe('preset-dev2', 'alice');
  assert.equal(offline.probe.ok, false); assert.match(offline.probe.reason, /--target=dev2/);

  const { bridge: devBridge, token: devToken } = await bridges.create('alice', { name: 'DEV' });
  const { bridge: dev2Bridge, token: dev2Token } = await bridges.create('alice', { name: 'DEV2' });
  const devWorker = fakeWorker(bridges, devToken, { target: 'main-dev', host: DEV });
  const dev2Worker = fakeWorker(bridges, dev2Token, { target: 'dev2', host: DEV2, inventory: await inventoryOf(await fixture(false)) });
  t.after(() => Promise.all([devWorker.stop(), dev2Worker.stop()]));
  await online(bridges, devBridge.id); await online(bridges, dev2Bridge.id);
  const devProbe = await delivery.connections.probe('preset-dev', 'alice');
  assert.equal(devProbe.probe.ok, true); assert.equal(devProbe.probe.identity.host, DEV); assert.equal(devProbe.probe.hostMatches, true);
  assert.deepEqual(devProbe.probe.capabilities, { inspect: true, deploy: false, readBack: false, rollbackReference: 'previous-export-only' });
  assert.equal((await delivery.connections.probe('preset-dev2', 'alice')).probe.identity.host, DEV2);
  // Another actor's bridge is never used for this actor.
  assert.equal((await delivery.connections.probe('preset-dev2', 'bob')).probe.ok, false);
  assert.equal((await delivery.connections.list('bob')).find(row => row.id === 'preset-dev2').probe.ok, false);
  assert.equal((await delivery.connections.list('alice')).find(row => row.id === 'preset-dev2').probe.ok, true);

  // DEV: deploy refused in code before any bridge job is created.
  const release = await approvedRelease(projects, releases);
  const before = devWorker.log.length;
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev' }), error => error.statusCode === 403 && /только чтение/.test(error.message));
  assert.equal(devWorker.log.length, before);
  // DEV2 without a designation: refused.
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev2' }), error => error.statusCode === 403 && /назначенного владельцем/.test(error.message));
  assert.ok(!dev2Worker.log.includes('inspect'));
  assert.equal((await fs.readdir(path.join(directory, 'delivery', 'connections', 'presets'))).length, 3, 'only probe results are stored per actor');
});

test('DEV2 delivers a designated candidate through the dev2 bridge and refuses a bridge pointed at DEV or PROD', async t => {
  const first = await setup(t, env());
  const release = await approvedRelease(first.projects, first.releases);
  const designated = release.candidate.sha256;
  assert.equal(designated, sha(await first.releases.candidateArtifact(release.id, 'alice').then(row => row.bytes)));
  // Same private directory, new process with the owner's designation configured.
  const { projects, releases, bridges } = first;
  const presets = targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: designated }), { protectedHosts: [PROD] });
  let delivery;
  delivery = deliveryStore(first.directory, releases, { adapters: {}, presets, presetAdapter: (preset, connection) => bridges.presetAdapter(preset, connection), protectedHosts: [PROD], timeoutMs: 3000 });

  // A bridge running `--target=dev2` but whose host is shared DEV (or PROD) is never selected.
  const { bridge: wrong, token: wrongToken } = await bridges.create('alice', { name: 'misconfigured' });
  const misconfigured = fakeWorker(bridges, wrongToken, { target: 'dev2', host: DEV });
  await online(bridges, wrong.id);
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev2' }), error => error.statusCode === 503);
  await misconfigured.stop(); await bridges.remove(wrong.id, 'alice');
  const { bridge: prodBridge, token: prodToken } = await bridges.create('alice', { name: 'prod' });
  const prodWorker = fakeWorker(bridges, prodToken, { target: 'dev2', host: PROD });
  await online(bridges, prodBridge.id);
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev2' }), error => error.statusCode === 503);
  await prodWorker.stop(); await bridges.remove(prodBridge.id, 'alice');
  assert.ok(!misconfigured.log.includes('deploy') && !prodWorker.log.includes('deploy'));

  const { bridge, token } = await bridges.create('alice', { name: 'DEV2' });
  const worker = fakeWorker(bridges, token, { target: 'dev2', host: DEV2, inventory: await inventoryOf(await fixture(false)) });
  t.after(() => worker.stop());
  await online(bridges, bridge.id);
  let attempt = await delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev2' });
  assert.equal(attempt.state, 'prepared'); assert.deepEqual(attempt.connection, { id: 'preset-dev2', name: 'DEV2', environment: 'dev', adapter: 'bridge' });
  attempt = await delivery.confirm(release.id, attempt.id, 'alice', { idempotencyKey: 'dev2', confirmation: `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}` });
  assert.equal(attempt.state, 'deployed-unverified');
  attempt = await delivery.verify(release.id, attempt.id, 'alice');
  assert.equal(attempt.state, 'verified');
  assert.deepEqual(worker.log.filter(kind => kind !== 'health'), ['inspect', 'inspect', 'deploy', 'readBack']);

  // A changed configuration (designation withdrawn) refuses dispatch of a prepared attempt.
  const second = await approvedRelease(projects, releases);
  const withdrawn = deliveryStore(first.directory, releases, { adapters: {}, presets: targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: second.candidate.sha256 }), { protectedHosts: [PROD] }), presetAdapter: (preset, connection) => bridges.presetAdapter(preset, connection), protectedHosts: [PROD], timeoutMs: 3000 });
  const prepared = await withdrawn.prepare(second.id, 'alice', { revision: second.revision, connectionId: 'preset-dev2' });
  const restarted = deliveryStore(first.directory, releases, { adapters: {}, presets: targetPresets(env(), { protectedHosts: [PROD] }), presetAdapter: (preset, connection) => bridges.presetAdapter(preset, connection), protectedHosts: [PROD], timeoutMs: 3000 });
  const deploys = worker.log.filter(kind => kind === 'deploy').length;
  await assert.rejects(restarted.confirm(second.id, prepared.id, 'alice', { idempotencyKey: 'late', confirmation: `DEPLOY ${prepared.solutionCode} ${prepared.sha256.slice(0, 12)}` }), error => error.statusCode === 403);
  assert.equal(worker.log.filter(kind => kind === 'deploy').length, deploys);
});

test('a predefined Target whose observed identity differs from its configured host is refused at the delivery guard', async t => {
  const designated = 'd'.repeat(64);
  const { directory, projects, releases } = await setup(t, env());
  const release = await approvedRelease(projects, releases);
  const presets = targetPresets(env({ WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: release.candidate.sha256 + ',' + designated }), { protectedHosts: [PROD] });
  // An adapter that reports shared DEV even though DEV2 is configured: the guard refuses before inspection.
  const calls = [];
  const lying = () => ({ name: 'bridge', capabilities: async () => ({ inspect: true, deploy: true, readBack: true }), health: async () => ({ ok: true, identity: { host: DEV, version: '2025.10.97' } }),
    inspectSolution: async () => { calls.push('inspect'); return { inventory: [], version: 1 }; }, deployCandidate: async () => { calls.push('deploy'); }, readBack: async () => { calls.push('readBack'); } });
  const delivery = deliveryStore(directory, releases, { adapters: {}, presets, presetAdapter: lying, protectedHosts: [PROD] });
  await assert.rejects(delivery.prepare(release.id, 'alice', { revision: release.revision, connectionId: 'preset-dev2' }), error => error.statusCode === 409 && error.message.includes(DEV));
  const probed = await delivery.connections.probe('preset-dev2', 'alice');
  assert.equal(probed.probe.ok, false); assert.equal(probed.probe.hostMatches, false);
  assert.deepEqual(calls, []);
  // An unavailable preset is never handed to an adapter.
  const missing = deliveryStore(directory, releases, { adapters: {}, presets: targetPresets({}), presetAdapter: lying });
  await assert.rejects(missing.connections.probe('preset-dev2', 'alice'), error => error.statusCode === 503 && /WIKI_TARGET_DEV2_URL/.test(error.message));
});

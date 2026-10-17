import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bridgeStore } from '../lib/bridge.mjs';
import { observationRequirements, OBSERVATION_TARGETS } from '../lib/target-profile-refresh.mjs';
import { createServer } from '../server.mjs';
import { fixture } from './fixture.mjs';
import { call } from './bridge-worker-fixture.mjs';
import { WORKER, hex, observedReport } from './native-contract-fixtures.mjs';

// Explicit operator Target profile refresh (#94 MR-05, P8). Everything is synthetic and local: a
// temporary Wiki, a registered bridge and an in-process HTTP worker answering the read-only
// `targetProfile` job with a fictional report. No ELMA host, credential or native tool is involved.
const PROFILE = hex('a');

async function setup(t, { owner = 'local', configuredOwner = owner, target = 'dev2', configure = true, timeoutMs = 3000, directory: shared = null } = {}) {
  const directory = shared ?? await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-target-profile-refresh-'));
  const { bridge, token } = await bridgeStore(directory).create(owner, { name: 'Synthetic DEV2 bridge' });
  const materializationEnv = configure ? { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: configuredOwner,
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER.nativeRevision, WIKI_NATIVE_TARGET_PROFILE_TARGET: target, WIKI_NATIVE_TARGET_PROFILE_TIMEOUT_MS: String(timeoutMs) } : {};
  const server = createServer({ directory, allowLocal: true, materializationEnv });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.stop()));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!shared) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const login = await call(base, '/auth/local', { method: 'POST', json: {} });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  // Polling worker: answers each targetProfile job with `respond(payload)` (a bridge result body).
  const worker = ({ respond = payload => ({ ok: true, result: { report: observedReport({ targetId: payload.targetId, environment: payload.environment,
    runId: payload.runId, targetProfileDigest: PROFILE, observedAt: new Date().toISOString(), requirements: payload.requirements }) } }) } = {}) => {
    let running = true, ready;
    const seen = [], polled = new Promise(resolve => { ready = resolve; });
    const loop = (async () => {
      while (running) {
        let job;
        try { job = (await call(base, '/api/bridge/poll', { token, method: 'POST', json: { identity: { host: 'dev2.example.invalid', version: '2025.4' }, worker: 'synthetic-observer',
          waitMs: 50, capabilities: { jobKinds: ['health', 'targetProfile'] } } })).body?.job; }
        catch { if (!running) return; continue; }
        ready();
        if (!running || !job) continue;
        seen.push(job);
        const answer = await respond(job.payload);
        if (answer) await call(base, `/api/bridge/jobs/${job.id}/result`, { token, method: 'POST', json: answer });
      }
    })();
    const started = { seen, polled, stop: async () => { running = false; await loop.catch(() => {}); } };
    workers.push(started); return started;
  };
  const upload = await call(base, '/api/solutions/uploads?sharedConfirmed=true', { method: 'POST', bytes: await fixture(), headers });
  assert.equal(upload.status, 201);
  const created = await call(base, '/api/solutions', { method: 'POST', headers, json: { sharedConfirmed: true, name: 'Synthetic Solution', baselineOwner: 'Vendor',
    snapshot: { projectId: upload.body.id, snapshotId: upload.body.currentSnapshotId, scope: 'full', scopeConfirmed: true } } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const revision = async () => (await call(base, `/api/solutions/${id}`, { headers })).body.revision;
  const eligibility = async () => call(base, `/api/solutions/${id}/composed-eligibility`, { headers });
  const refresh = async (json, extra = {}) => call(base, `/api/solutions/${id}/target-profile`, { method: 'POST', headers, json: json ?? { expectedRevision: await revision() }, ...extra });
  const archive = async archived => assert.equal((await call(base, `/api/solutions/${id}/archive`, { method: 'POST', headers, json: { archived, expectedRevision: await revision() } })).status, 200);
  return { directory, server, base, headers, id, worker, revision, eligibility, refresh, archive };
}
const gate = (body, id) => body.gates.find(row => row.id === id);
const reasons = (body, id) => gate(body, id).reasons.map(row => row.reason);

test('only dev2 is a designated observation Target', () => {
  assert.deepEqual(OBSERVATION_TARGETS, ['dev2']);
});

test('requirements are derived from the accepted capture plan, one provider each', () => {
  const dependencies = { schemaVersion: 1, rows: [{ category: 'dependencies', service: 'widgets', targetNamespace: 'vendor', targetCode: 'ext',
    source: { service: 'widgets', namespace: 'synthetic.app', code: 'form' }, status: 'paid-source-unavailable', candidates: [{ code: 'vendor_module', version: '2.1.0', paid: true }] }] };
  const capture = { solution: 'synthetic_contracts', scope: 'full', checksum: hex('c'), ambiguities: [], unclassifiedFiles: [], dependencies,
    components: [{ key: JSON.stringify(['widgets', 'synthetic.app', 'form']), service: 'widgets', namespace: 'synthetic.app', code: 'form', kind: 'widget', digest: hex('d') }] };
  assert.deepEqual(observationRequirements(capture), [{ service: 'widgets', namespace: 'vendor', code: 'ext', provider: { code: 'vendor_module', version: '2.1.0' } }]);
  assert.deepEqual(observationRequirements({ ...capture, dependencies: { schemaVersion: 1, rows: [] } }), []);
});

test('unconfigured: the composer says why, and a refresh is refused without any job', async t => {
  const env = await setup(t, { configure: false });
  const read = await env.eligibility();
  assert.equal(read.status, 200);
  assert.deepEqual({ ...read.body.targetProfileRefresh, last: undefined }, { configured: false, reason: 'target-profile-observation-unconfigured', target: null,
    operator: false, inProgress: false, current: false, staleInputs: false, last: undefined });
  const refused = await env.refresh();
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body, { outcome: 'unavailable', reason: 'target-profile-observation-unconfigured' });
});

test('a bridge configured for a non-designated Target is not offered and never observes', async t => {
  const env = await setup(t, { target: 'synthetic-target' });
  const worker = env.worker(); await worker.polled;
  assert.equal((await env.eligibility()).body.targetProfileRefresh.reason, 'target-not-designated');
  const refused = await env.refresh();
  assert.deepEqual([refused.status, refused.body.reason], [409, 'target-not-designated']);
  assert.equal(worker.seen.length, 0);
});

test('another operational actor, malformed input and a stale revision are refused; GET has no side effect', async t => {
  const env = await setup(t, { configuredOwner: 'synthetic-operator' });
  const worker = env.worker(); await worker.polled;
  // The session user has shared content access but is not the configured bridge owner.
  const read = await env.eligibility();
  assert.equal(read.body.targetProfileRefresh.configured, true);
  assert.equal(read.body.targetProfileRefresh.operator, false);
  const refused = await env.refresh();
  assert.deepEqual([refused.status, refused.body.reason], [403, 'operator-only']);
  for (let i = 0; i < 3; i++) assert.equal((await env.eligibility()).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(worker.seen.length, 0, 'neither a read nor a refused refresh enqueues a job');

  const own = await setup(t, { owner: 'local' });
  const ownWorker = own.worker(); await ownWorker.polled;
  const route = `/api/solutions/${own.id}/target-profile`;
  assert.equal((await call(own.base, route, { method: 'POST', json: { expectedRevision: 0 } })).status, 404, 'no session reveals nothing');
  assert.equal((await call(own.base, route, { headers: own.headers })).status, 405);
  assert.equal((await call(own.base, route, { method: 'POST', headers: { ...own.headers, 'Content-Type': 'text/plain' }, bytes: Buffer.from('{}') })).status, 415);
  const expectedRevision = await own.revision();
  for (const json of [{}, { expectedRevision: '0' }, { expectedRevision, targetId: 'prod' }, { expectedRevision, environment: 'dev' }, { expectedRevision, bridgeId: hex('0', 32) },
    { expectedRevision, owner: 'local' }, { expectedRevision, report: {} }, { expectedRevision, requirements: [] }, []]) {
    const malformed = await own.refresh(json);
    assert.deepEqual([malformed.status, malformed.body.reason], [400, 'invalid-request'], JSON.stringify(json));
  }
  const stale = await own.refresh({ expectedRevision: expectedRevision + 1 });
  assert.deepEqual([stale.status, stale.body.reason], [409, 'stale-solution-revision']);
  assert.equal((await call(own.base, '/api/solutions/00000000-0000-4000-8000-000000000000/target-profile', { method: 'POST', headers: own.headers, json: { expectedRevision } })).status, 404);
  assert.equal(ownWorker.seen.length, 0);
});

test('an operator refresh observes dev2 once and feeds the admitted observation into eligibility', async t => {
  const env = await setup(t);
  const worker = env.worker(); await worker.polled;
  const before = await env.eligibility();
  assert.equal(before.body.evidence.targetProfile, 'unknown');
  assert.ok(reasons(before.body, 'target-profile').includes('unobserved-target-profile'));
  assert.equal(before.body.targetProfileRefresh.operator, true);

  const observed = await env.refresh();
  assert.equal(observed.status, 201, JSON.stringify(observed.body));
  assert.equal(observed.body.outcome, 'observed');
  assert.deepEqual({ ...observed.body.targetProfile, observedAt: undefined }, { targetId: 'dev2', digest: PROFILE, platformVersion: '2025.4', observedAt: undefined });
  assert.equal(worker.seen.length, 1);
  const [job] = worker.seen;
  assert.equal(job.kind, 'targetProfile');
  assert.deepEqual(Object.keys(job.payload).sort(), ['contract', 'environment', 'requirements', 'runId', 'targetId']);
  assert.deepEqual([job.payload.targetId, job.payload.environment], ['dev2', 'dev2']);

  const after = await env.eligibility();
  assert.equal(after.body.evidence.targetProfile, 'observed');
  assert.equal(after.body.targetProfile.digest, PROFILE);
  assert.ok(!reasons(after.body, 'target-profile').includes('unobserved-target-profile'));
  assert.equal(after.body.targetProfileRefresh.current, true);
  assert.equal(after.body.targetProfileRefresh.last.outcome, 'observed');
  // Native coverage is not acquired: the build stays ineligible with its named reasons.
  assert.equal(after.body.eligible, false);
  assert.notEqual(gate(after.body, 'coverage').status, 'verified');
  assert.ok(gate(after.body, 'coverage').reasons.length > 0);
  assert.equal(worker.seen.length, 1, 'reads never observe again');

  // A changed Solution state invalidates the observation: it is stale, never current.
  await env.archive(true); await env.archive(false);
  const moved = await env.eligibility();
  assert.equal(moved.body.evidence.targetProfile, 'unknown');
  assert.ok(reasons(moved.body, 'target-profile').includes('unobserved-target-profile'));
  assert.deepEqual([moved.body.targetProfileRefresh.current, moved.body.targetProfileRefresh.staleInputs], [false, true]);
});

test('a restarted service holds no observation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-target-profile-restart-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }));
  const first = await setup(t, { directory });
  const worker = first.worker(); await worker.polled;
  assert.equal((await first.refresh()).status, 201);
  assert.equal((await first.eligibility()).body.evidence.targetProfile, 'observed');
  await worker.stop();
  const restarted = createServer({ directory, allowLocal: true, materializationEnv: {} });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restarted.closeAllConnections(); await new Promise(resolve => restarted.close(resolve)); });
  const base = `http://127.0.0.1:${restarted.address().port}`;
  const login = await call(base, '/auth/local', { method: 'POST', json: {} });
  const read = await call(base, `/api/solutions/${first.id}/composed-eligibility`, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.equal(read.status, 200);
  assert.equal(read.body.evidence.targetProfile, 'unknown');
  assert.equal(read.body.targetProfileRefresh.last, null);
});

test('unavailable, invalid, unknown and moved observations never enable the gate', async t => {
  const env = await setup(t, { timeoutMs: 400 });
  let mode = 'unavailable';
  const report = payload => observedReport({ targetId: payload.targetId, environment: payload.environment, runId: payload.runId, targetProfileDigest: PROFILE, observedAt: new Date().toISOString() });
  const worker = env.worker({ respond: async payload => {
    if (mode === 'unavailable') return { ok: true, result: { report: { ...report(payload), status: 'unavailable', targetProfileDigest: null, platformVersion: null, changedAt: null,
      inventoryDigest: null, installedSolutions: [], receipts: [], observation: null, evidenceRef: null,
      unavailable: { reason: 'live-target-access-unavailable', missing: ['target-profile-digest'], requiredOperation: 'read-only target-profile-observation job' } } } };
    if (mode === 'replayed') return { ok: true, result: { report: { ...report(payload), observation: { ...report(payload).observation, runId: 'replayed-run' } } } };
    if (mode === 'foreign') return { ok: true, result: { report: report({ ...payload, targetId: 'prod', environment: 'prod' }) } };
    if (mode === 'lost') return null;
    if (mode === 'moved') { await env.archive(true); await env.archive(false); }
    return { ok: true, result: { report: report(payload) } };
  } });
  await worker.polled;
  const expectNoObservation = async () => {
    const read = await env.eligibility();
    assert.equal(read.body.evidence.targetProfile, 'unknown');
    assert.equal(read.body.targetProfileRefresh.current, false);
    return read.body.targetProfileRefresh;
  };
  let result = await env.refresh();
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.deepEqual([result.body.outcome, result.body.reason], ['unavailable', 'live-target-access-unavailable']);
  assert.equal(result.body.targetProfileRefresh.inProgress, false);
  assert.equal((await expectNoObservation()).last.outcome, 'unavailable');
  for (const [name, error] of [['replayed', 'unattested-observation'], ['foreign', 'target-mismatch']]) {
    mode = name; result = await env.refresh();
    assert.equal(result.status, 422, name);
    assert.equal(result.body.outcome, 'invalid');
    assert.ok(result.body.errors.includes(error), `${name}: ${result.body.errors}`);
    assert.deepEqual((await expectNoObservation()).last.errors, result.body.errors);
  }
  mode = 'lost'; result = await env.refresh();
  assert.deepEqual([result.status, result.body.outcome], [502, 'unknown']);
  assert.equal((await expectNoObservation()).last.outcome, 'unknown');
  mode = 'moved'; result = await env.refresh();
  assert.deepEqual([result.status, result.body.outcome, result.body.reason], [409, 'stale', 'stale-solution-binding']);
  assert.equal((await expectNoObservation()).last.outcome, 'stale');
  // A valid observation replaces nothing it should not: a later failure drops the earlier one.
  mode = 'valid'; assert.equal((await env.refresh()).status, 201);
  assert.equal((await env.eligibility()).body.evidence.targetProfile, 'observed');
  mode = 'unavailable'; assert.equal((await env.refresh()).status, 409);
  await expectNoObservation();
});

test('one refresh at a time per Solution', async t => {
  const env = await setup(t);
  let release;
  const gateOpen = new Promise(resolve => { release = resolve; });
  const worker = env.worker({ respond: async payload => { await gateOpen; return { ok: true, result: { report: observedReport({ targetId: payload.targetId,
    environment: payload.environment, runId: payload.runId, targetProfileDigest: PROFILE, observedAt: new Date().toISOString() }) } }; } });
  await worker.polled;
  const first = env.refresh();
  for (let i = 0; i < 100 && !worker.seen.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await env.eligibility()).body.targetProfileRefresh.inProgress, true);
  const second = await env.refresh();
  assert.deepEqual([second.status, second.body.outcome], [409, 'in-progress']);
  release();
  assert.equal((await first).status, 201);
  assert.equal(worker.seen.length, 1);
});

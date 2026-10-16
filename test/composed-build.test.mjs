import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { bridgeStore } from '../lib/bridge.mjs';
import { adaptNativeCoverage } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence } from '../lib/dependency-resolver.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { prepareMaterializationRequest } from '../lib/native-materialization.mjs';
import { observedTargetProfileReport } from '../lib/native-materialization-bridge.mjs';
import { changesFromRequest } from '../lib/elma365-native-contracts.mjs';
import { composedBuildCapability, buildBlockingGates, POST_BUILD_FACTS } from '../lib/composed-build.mjs';
import { createServer } from '../server.mjs';
import { archive, keyOf, assemble, receiptFor, COMPILER, WIDGET } from './manifest-policy-fixtures.mjs';
import { hex, nativeDeclaration, observe } from './native-contract-fixtures.mjs';
import { httpWorker, call, WORKER_REVISION } from './bridge-worker-fixture.mjs';

// Opt-in native build route (#94 MR-03, PLAN-01 C2). Everything is synthetic and local: a
// temporary Wiki, a registered bridge and an in-process HTTP worker that assembles the output
// and answers with an E1 receipt. No ELMA host, credential or native tool is involved.
const OWNER = 'synthetic-owner', PROFILE = hex('a'), SOLUTION = 'synthetic_contracts';
const NATIVE_RECEIPTS = { id: 'elma365-dependency-receipt', version: 1 };
const uploader = { id: 'synthetic-uploader', login: 'uploader@example.org', provider: 'local' };
const OUTSIDE = { service: 'widgets', code: 'outside', kind: 'widget' };
const reasons = rows => rows.map(row => row.reason);
const advertise = (revision = WORKER_REVISION) => ({ jobKinds: ['health', 'materialize'], materialize: { contract: { id: 'elma365-native-materialization', version: 1 }, nativeRevision: revision } });

// A full base and one resolved partial change of the widget `div`.
async function solution(directory) {
  const solutions = solutionStore(directory), managed = solutions.managed;
  const upload = async (rows, scope) => {
    const project = await solutions.uploads.create(SOLUTION_CATALOG, await archive(rows), 'synthetic.e365', uploader);
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await managed.create(SOLUTION_CATALOG, { name: 'Synthetic contracts', baselineOwner: 'Base', snapshot: await upload([{ ...WIDGET, value: 0 }, { ...OUTSIDE, value: 0 }], 'full') }, uploader);
  const change = await managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'change', snapshot: await upload([{ ...WIDGET, value: 1 }], 'partial'), expectedRevision: state.revision,
    team: 'C', taskRef: 'SYNTHETIC-C', sameSourceConfirmed: true, base: { artifactId: state.baselineId, revision: 0, confirmed: true },
    changeScope: { name: 'Synthetic scope', members: [keyOf(WIDGET)], confirmed: true, deletions: [] } }, uploader);
  const current = await managed.get(state.id, SOLUTION_CATALOG), merge = await managed.merge(state.id, SOLUTION_CATALOG, change.artifactId);
  await managed.resolveMerge(state.id, SOLUTION_CATALOG, change.artifactId, { expectedRevision: current.revision, planDigest: merge.plan.planDigest,
    expectedResolutionId: merge.head?.id ?? null, decisions: {}, reason: 'Synthetic reviewed choice' }, uploader);
  return { managed, id: state.id, artifactId: change.artifactId };
}

// The server's trusted evidence source in these tests: a native coverage declaration over the
// resolved revision bound to its own changes, receipts and profile from an admitted bridge observation.
const nativeEvidence = observation => async ({ state, artifact, resolution, originals }) => {
  const changes = changesFromRequest(await prepareMaterializationRequest({ state, artifact, resolution, originals }));
  const components = resolution.result.filter(row => row.digest).map(row => {
    const [service, namespace, code] = JSON.parse(row.key);
    return { key: row.key, service, namespace, code, kind: 'widget', digest: row.digest };
  });
  const capture = { solution: SOLUTION, scope: 'full', checksum: resolution.resultDigest, components, ambiguities: [], unclassifiedFiles: [], dependencies: dependencyReport([]) };
  const coverage = adaptNativeCoverage({ request: { kind: 'solution', solution: SOLUTION }, artifacts: [capture], targetProfile: { digest: PROFILE }, changes,
    declarations: [nativeDeclaration({ captures: [capture], changes, targetProfileDigest: PROFILE, targetReport: observedTargetProfileReport(observation) })] });
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, receiptContract: NATIVE_RECEIPTS, observation, now: new Date().toISOString() });
  return { coverage, dependencies, observation, compiler: COMPILER };
};

async function setup(t, { configure = true, evidence = true, env = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-composed-build-'));
  const { bridge, token } = await bridgeStore(directory).create(OWNER, { name: 'Synthetic materializer' });
  const built = await solution(directory);
  const observed = evidence ? await observe({ targetProfileDigest: PROFILE, observedAt: new Date().toISOString() }) : null;
  if (observed) assert.equal(observed.status, 'observed');
  const materializationEnv = configure ? { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: OWNER,
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER_REVISION, WIKI_NATIVE_MATERIALIZATION_TIMEOUT_MS: '6000', ...env } : {};
  const server = createServer({ directory, allowLocal: true, materializationEnv, buildEvidence: observed ? nativeEvidence(observed.observation) : null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.stop()));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const login = await fetch(base + '/auth/local', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const answers = [];
  // Default answer: assemble the exact request and return its validated E1 receipt with the bytes.
  const worker = (capabilities = advertise()) => {
    const started = httpWorker({ base, token, capabilities, handle: async ({ envelope, originals }) => {
      const answer = answers.shift() ?? (row => row);
      const bytes = await assemble(envelope.request, originals);
      return answer({ receipt: receiptFor(envelope.request, bytes), bytes }, envelope);
    } });
    workers.push(started); return started;
  };
  const capability = async () => (await call(base, '/api/delivery/capabilities', { headers })).body.composedBuild;
  const revision = async () => (await built.managed.get(built.id, SOLUTION_CATALOG)).revision;
  const build = async (input = {}) => call(base, `/api/solutions/${built.id}/composed-build`, { method: 'POST', headers,
    json: { artifactId: built.artifactId, expectedRevision: await revision(), ...input } });
  // Wait until the bridge reports the worker's latest poll.
  const settle = async expected => { for (let i = 0; i < 100 && (await capability()).detail !== expected; i++) await new Promise(resolve => setTimeout(resolve, 20)); return capability(); };
  return { ...built, server, base, headers, answers, worker, capability, settle, build, revision, directory };
}

test('unconfigured: building stays unavailable with the reason, and the route never calls a worker', async t => {
  const env = await setup(t, { configure: false });
  assert.equal(env.server.nativeMaterialization, null);
  const capability = await env.capability();
  assert.equal(capability.available, false);
  assert.equal(capability.reason, 'native-materialization-unavailable');
  assert.equal(capability.detail, 'native-materialization-unconfigured');
  assert.equal(await composedBuildCapability(null).then(row => row.detail), 'native-materialization-unconfigured');
  assert.equal(await composedBuildCapability({ health: async () => ({ healthy: true }) }).then(row => row.available), false, 'a hand-built adapter is not configured');
  const response = await env.build();
  assert.equal(response.status, 409);
  assert.equal(response.body.outcome, 'unavailable'); assert.equal(response.body.reason, 'native-materialization-unconfigured'); assert.equal(response.body.manifest, null);
  // The eligibility route reports the same reason in its materialization gate.
  const eligibility = await call(env.base, `/api/solutions/${env.id}/composed-eligibility`, { headers: env.headers });
  assert.deepEqual(eligibility.body.gates.find(row => row.id === 'materialization').reasons.map(row => [row.reason, row.detail]),
    [['native-materialization-unavailable', 'native-materialization-unconfigured']]);
});

test('configured: an offline, non-advertising or other-revision bridge stays unavailable; a healthy one enables building', async t => {
  const env = await setup(t);
  assert.equal((await env.capability()).detail, 'materialization-bridge-offline', 'the worker never polled');
  assert.equal((await env.build()).body.reason, 'materialization-bridge-offline');
  const first = env.worker({ jobKinds: ['health'] });
  assert.equal((await env.settle('materialize-not-advertised')).available, false);
  await first.stop();
  const second = env.worker(advertise(hex('b', 40)));
  assert.equal((await env.settle('native-worker-revision-mismatch')).available, false);
  await second.stop();
  env.worker();
  const capability = await env.settle(null);
  assert.equal(capability.available, true); assert.equal(capability.reason, null);
  assert.deepEqual(capability.contracts, ['elma365-native-materialization@1']);
  // A removed bridge disables it again.
  const other = await setup(t, { env: { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '00000000-0000-4000-8000-000000000000' } });
  assert.equal((await other.capability()).detail, 'materialization-bridge-missing');
});

test('validated: only a receipt bound to the exact request produces a build manifest; native output is never release-eligible', async t => {
  const env = await setup(t);
  env.worker();
  await env.settle(null);
  const response = await env.build();
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const { outcome, manifest, receipt } = response.body;
  assert.equal(outcome, 'validated');
  assert.equal(manifest.status, 'materialized'); assert.equal(manifest.evidenceBasis, 'native');
  assert.equal(manifest.adapter.id, 'operator-bridge-materialize'); assert.equal(manifest.adapter.nativeRevision, WORKER_REVISION);
  assert.equal(receipt.status, 'validated'); assert.equal(manifest.validation.matches, true);
  // The post-build facts the build itself cannot produce keep it out of release.
  assert.deepEqual(reasons(manifest.blockers), ['native-installation-evidence-incomplete']);
  assert.deepEqual(manifest.blockers[0].missing, [...POST_BUILD_FACTS].sort());
  assert.equal(manifest.releaseEligible, false); assert.equal(manifest.publicationReady, false); assert.equal(manifest.executionEnabled, false);
  // The validated build is held in process for freezing (B1); the route itself freezes nothing.
  const held = env.server.composedBuilds.get(env.id);
  assert.equal(held.artifactId, env.artifactId); assert.equal(held.result.manifest.manifestDigest, manifest.manifestDigest);
  assert.equal(held.result.artifacts[0].sha256, manifest.artifacts[0].sha256); assert.equal(held.targetProfile.digest, PROFILE);
  assert.deepEqual((await call(env.base, `/api/solutions/${env.id}/composed`, { headers: env.headers })).body, []);
});

test('failed, tool-fault and unbound receipts produce no build manifest', async t => {
  const env = await setup(t);
  env.worker();
  await env.settle(null);
  const failedChecks = answer => ({ ...answer, receipt: { ...answer.receipt, status: 'failed',
    checks: answer.receipt.checks.map(check => check.id === 'native-package-check' ? { ...check, status: 'failed' } : check) } });
  const cases = [
    [failedChecks, 'failed', 'native-validation-failed'],
    [() => ({ result: { ok: false, error: 'synthetic tool crash' } }), 'tool-fault', 'native-materialization-failed'],
    // A receipt for another request, or one naming other bytes, is not bound to this build.
    [answer => ({ ...answer, receipt: { ...answer.receipt, requestDigest: hex('0') } }), 'unbound-receipt', 'native-receipt-invalid'],
    [answer => ({ ...answer, receipt: { ...answer.receipt, inputsDigest: hex('0') } }), 'unbound-receipt', 'native-receipt-invalid'],
    [answer => ({ ...answer, bytes: Buffer.concat([answer.bytes, Buffer.from('tail')]) }), 'unbound-receipt', 'native-receipt-invalid'],
    [answer => ({ ...answer, receipt: { ...answer.receipt, worker: { ...answer.receipt.worker, nativeRevision: hex('b', 40) } } }), 'unbound-receipt', 'native-worker-revision-mismatch']
  ];
  for (const [answer, outcome, reason] of cases) {
    env.answers.push(answer);
    const response = await env.build();
    assert.equal(response.status, 422, outcome + ' ' + JSON.stringify(response.body));
    assert.equal(response.body.outcome, outcome);
    assert.ok(reasons(response.body.reasons).includes(reason), JSON.stringify(response.body.reasons));
    assert.equal(response.body.manifest, null);
  }
  assert.equal(env.server.composedBuilds.has(env.id), false);
  assert.deepEqual((await call(env.base, `/api/solutions/${env.id}/composed`, { headers: env.headers })).body, []);
});

test('stale inputs: a moved revision is refused before the worker, and a change during the build invalidates its result', async t => {
  const env = await setup(t);
  const worker = env.worker();
  await env.settle(null);
  const before = worker.seen.length;
  const moved = await env.build({ expectedRevision: (await env.revision()) - 1 });
  assert.equal(moved.status, 409);
  assert.equal(worker.seen.filter(job => job.kind === 'materialize').length, 0, 'no job for a stale request');
  assert.ok(worker.seen.length >= before);
  // New review evidence lands while the worker builds: the validated receipt is for superseded inputs.
  env.answers.push(async answer => {
    const review = await env.managed.review(env.id, SOLUTION_CATALOG, env.artifactId);
    await env.managed.comment(env.id, SOLUTION_CATALOG, env.artifactId, { expectedRevision: await env.revision(), expectedDiscussionRevision: review.discussion.version,
      type: 'comment', text: 'New synthetic review evidence' }, uploader);
    return answer;
  });
  const stale = await env.build();
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.outcome, 'stale'); assert.equal(stale.body.manifest, null);
  assert.equal(stale.body.receipt.status, 'validated'); assert.equal(env.server.composedBuilds.has(env.id), false);
  // Rebuilt from the current inputs, it validates again.
  assert.equal((await env.build()).body.outcome, 'validated');
});

test('missing evidence blocks before the worker with every eligibility gate named; requests are strict', async t => {
  const env = await setup(t, { evidence: false });
  const worker = env.worker();
  await env.settle(null);
  const blocked = await env.build();
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.outcome, 'blocked');
  assert.deepEqual(blocked.body.gates.map(row => row.id), ['scope', 'coverage', 'dependencies', 'target-profile']);
  assert.equal(worker.seen.filter(job => job.kind === 'materialize').length, 0);
  assert.equal((await env.build({ extra: true })).status, 400);
  assert.equal((await call(env.base, `/api/solutions/${env.id}/composed-build`, { headers: env.headers })).status, 405);
  assert.equal((await call(env.base, `/api/solutions/${env.id}/composed-build`, { method: 'POST', json: { artifactId: env.artifactId, expectedRevision: 0 } })).status, 404);
});

test('post-build installation facts are the only coverage reasons a build may proceed with', () => {
  const gate = (id, status, rows) => ({ id, status, reasons: rows });
  const eligibility = { gates: [gate('scope', 'verified', []), gate('coverage', 'blocked', POST_BUILD_FACTS.map(fact => ({ reason: 'missing-native-evidence', fact, unitId: 'u' }))),
    gate('materialization', 'verified', [])] };
  assert.deepEqual(buildBlockingGates(eligibility), []);
  eligibility.gates[1].reasons.push({ reason: 'missing-native-evidence', fact: 'global-domain-executable-handler' });
  assert.deepEqual(buildBlockingGates(eligibility).map(row => [row.id, reasons(row.reasons)]), [['coverage', ['missing-native-evidence']]]);
  eligibility.gates[1].reasons = [{ reason: 'missing-native-evidence' }];
  assert.equal(buildBlockingGates(eligibility).length, 1, 'an unnamed native evidence gap still blocks');
});

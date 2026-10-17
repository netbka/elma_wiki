import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { selectReadBackPolicy } from '../lib/delivery.mjs';
import { targetPresets, guardPresetDeploy } from '../lib/target-presets.mjs';
import { createServer } from '../server.mjs';
import { archive, keyOf, assemble, receiptFor, COMPILER, WIDGET } from './manifest-policy-fixtures.mjs';
import { hex, nativeDeclaration, observe, observedReport } from './native-contract-fixtures.mjs';
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

// A full base and one resolved, accepted partial change of the widget `div`: the accepted merged revision.
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
  await managed.accept(state.id, SOLUTION_CATALOG, change.artifactId, { expectedRevision: current.revision, reviewedDigest: change.artifactDigest,
    reviewedBoundaryKeys: change.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, uploader);
  // Prepares, resolves and optionally accepts a later change of `outside` against the same base.
  const later = async (value, { accept = false } = {}) => {
    const now = await managed.get(state.id, SOLUTION_CATALOG);
    const next = await managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'change', snapshot: await upload([{ ...OUTSIDE, value }], 'partial'),
      expectedRevision: now.revision, team: 'C', taskRef: 'SYNTHETIC-LATER', sameSourceConfirmed: true, base: { artifactId: state.baselineId, revision: 0, confirmed: true },
      changeScope: { name: 'Later scope', members: [keyOf(OUTSIDE)], confirmed: true, deletions: [] } }, uploader);
    const plan = await managed.merge(state.id, SOLUTION_CATALOG, next.artifactId);
    await managed.resolveMerge(state.id, SOLUTION_CATALOG, next.artifactId, { expectedRevision: now.revision, planDigest: plan.plan.planDigest,
      expectedResolutionId: plan.head?.id ?? null, decisions: {}, reason: 'Synthetic later choice' }, uploader);
    if (accept) await managed.accept(state.id, SOLUTION_CATALOG, next.artifactId, { expectedRevision: now.revision, reviewedDigest: next.artifactDigest,
      reviewedBoundaryKeys: next.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, uploader);
    return next.artifactId;
  };
  return { managed, composed: solutions.composed, id: state.id, artifactId: change.artifactId, later };
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

async function setup(t, { configure = true, evidence = true, env = {}, owner = OWNER } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-composed-build-'));
  const { bridge, token } = await bridgeStore(directory).create(owner, { name: 'Synthetic materializer' });
  const built = await solution(directory);
  const observed = evidence ? await observe({ targetProfileDigest: PROFILE, observedAt: new Date().toISOString() }) : null;
  if (observed) assert.equal(observed.status, 'observed');
  const materializationEnv = configure ? { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: owner,
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
  const worker = (capabilities = advertise(), profile = null) => {
    const started = httpWorker({ base, token, capabilities, profile, handle: async ({ envelope, originals }) => {
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
  // Freeze the held build; the body defaults to confirming exactly that build.
  const freeze = async (input = {}) => call(base, `/api/solutions/${built.id}/composed`, { method: 'POST', headers,
    json: { artifactId: built.artifactId, expectedRevision: await revision(), manifestDigest: server.composedBuilds.get(built.id)?.result.manifest.manifestDigest ?? hex('0'), ...input } });
  const candidates = async () => (await call(base, `/api/solutions/${built.id}/composed`, { headers })).body;
  return { ...built, server, base, headers, answers, worker, capability, settle, build, freeze, candidates, revision, directory };
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

test('the service build evidence carries the operator admitted Target profile observation, and nothing else', async t => {
  // The local session is the configured bridge owner; the bridge observes its designated dev2.
  const env = await setup(t, { evidence: false, owner: 'local', env: { WIKI_NATIVE_TARGET_PROFILE_TARGET: 'dev2' } });
  const profile = payload => observedReport({ targetId: payload.targetId, environment: payload.environment, runId: payload.runId,
    targetProfileDigest: PROFILE, observedAt: new Date().toISOString(), worker: { id: 'synthetic-native-worker', nativeRevision: WORKER_REVISION } });
  const worker = env.worker({ ...advertise(), jobKinds: ['health', 'materialize', 'targetProfile'] }, profile);
  await env.settle(null);
  const before = await env.build();
  assert.equal(before.body.outcome, 'blocked');
  assert.equal(before.body.eligibility.evidence.targetProfile, 'unknown');
  assert.equal(worker.seen.filter(job => job.kind === 'targetProfile').length, 0, 'a build never observes');
  const refreshed = await call(env.base, `/api/solutions/${env.id}/target-profile`, { method: 'POST', headers: env.headers, json: { expectedRevision: await env.revision() } });
  assert.equal(refreshed.status, 201, JSON.stringify(refreshed.body));
  const after = await env.build();
  assert.equal(after.status, 409);
  assert.equal(after.body.outcome, 'blocked');
  assert.equal(after.body.eligibility.evidence.targetProfile, 'observed');
  assert.equal(after.body.eligibility.targetProfile.digest, PROFILE);
  // Native coverage and dependency locks are not acquired: they stay named blockers, and no worker builds.
  assert.deepEqual(after.body.gates.find(row => row.id === 'coverage').reasons.map(row => row.reason), ['missing-native-coverage']);
  assert.deepEqual(after.body.gates.find(row => row.id === 'dependencies').reasons.map(row => row.reason), ['missing-dependency-resolution']);
  assert.equal(worker.seen.filter(job => job.kind === 'materialize').length, 0);
  assert.equal(worker.seen.filter(job => job.kind === 'targetProfile').length, 1);
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

// Freeze route (#94 MR-06, PLAN-01 B1): only the held validated build becomes a candidate.
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const OTHER_SOLUTION = '00000000-0000-4000-8000-000000000000';

test('freeze: the held validated build becomes a candidate bound to its manifest, units, locks, profile and artifact digest', async t => {
  const env = await setup(t);
  env.worker();
  await env.settle(null);
  assert.equal((await env.build()).body.outcome, 'validated');
  const held = env.server.composedBuilds.get(env.id), manifest = held.result.manifest;
  // The body only confirms which build; it can neither supply nor override a bound value.
  for (const extra of [{ sha256: hex('1') }, { units: [] }, { targetProfile: { digest: hex('b') } }, { manifest: {} }, { dependencies: {} }, { bytes: 'AA==' }])
    assert.equal((await env.freeze(extra)).status, 400, JSON.stringify(extra));
  assert.equal((await env.freeze({ manifestDigest: hex('c') })).body.reason, 'foreign-build');
  assert.equal((await env.freeze({ artifactId: env.id })).body.reason, 'foreign-build');
  const moved = await env.freeze({ expectedRevision: (await env.revision()) + 1 });
  assert.equal(moved.status, 409); assert.equal(moved.body.reason, 'stale-build'); assert.equal(moved.body.candidate, null);
  assert.deepEqual(await env.candidates(), []);

  const frozen = await env.freeze();
  assert.equal(frozen.status, 201, JSON.stringify(frozen.body));
  const { candidate } = frozen.body;
  assert.equal(frozen.body.outcome, 'frozen');
  assert.equal(candidate.candidate.sha256, manifest.artifacts[0].sha256);
  assert.equal(candidate.candidate.sha256, sha(Buffer.from(held.result.artifacts[0].bytes)));
  assert.equal(candidate.binding.manifestDigest, manifest.manifestDigest);
  assert.equal(candidate.binding.requestDigest, manifest.requestDigest); assert.equal(candidate.binding.inputsDigest, manifest.inputsDigest);
  assert.equal(candidate.binding.artifactId, env.artifactId); assert.equal(candidate.binding.revision, await env.revision());
  assert.equal(candidate.binding.dependencyPlanDigest, held.dependencies.planDigest);
  assert.equal(candidate.binding.targetProfileDigest, PROFILE); assert.equal(candidate.targetProfile.digest, PROFILE);
  assert.deepEqual(candidate.compiler, { contract: COMPILER.contract, profileDigest: COMPILER.profileDigest });
  assert.ok(candidate.units.length >= 1);
  assert.equal(candidate.evidenceBasis, 'native'); assert.deepEqual(candidate.adapter, manifest.adapter);
  assert.equal(candidate.validation.artifactSha256, candidate.candidate.sha256);
  // Truthful: the import has not happened, so the candidate is not release-eligible.
  assert.equal(candidate.releaseEligible, false); assert.deepEqual(candidate.pendingNativeEvidence, [...POST_BUILD_FACTS].sort());
  assert.ok(candidate.frozenBy?.id);
  assert.equal(candidate.inputsStatus, 'current'); assert.equal(candidate.deliverable, false);
  // The held build is consumed: it cannot be frozen twice.
  assert.equal(env.server.composedBuilds.has(env.id), false);
  assert.equal((await env.freeze({ manifestDigest: manifest.manifestDigest })).body.reason, 'no-validated-build');
  assert.deepEqual((await env.candidates()).map(row => row.id), [candidate.id]);

  // The delivery coordinator's trusted consumer and the DEV2 designation refer to these exact bytes.
  const approved = await call(env.base, `/api/solutions/${env.id}/composed/${candidate.id}`, { method: 'POST', headers: env.headers,
    json: { action: 'approve', revision: candidate.revision, reason: 'Synthetic exact-byte review' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const consumed = await env.composed.withCandidate(env.id, candidate.id, async row => ({ sha256: row.candidate.sha256, digest: sha(row.bytes),
    manifestDigest: row.sourceAssociation.manifestDigest, units: row.composed.units, profile: row.composed.targetProfile }));
  assert.deepEqual(consumed, { sha256: candidate.candidate.sha256, digest: candidate.candidate.sha256, manifestDigest: manifest.manifestDigest,
    units: candidate.units, profile: candidate.targetProfile });
  const [, dev2] = targetPresets({ WIKI_TARGET_DEV2_URL: 'https://dev2.example.invalid', WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: candidate.candidate.sha256 });
  assert.equal(dev2.available, true, dev2.reason);
  assert.doesNotThrow(() => guardPresetDeploy(dev2, candidate.candidate.sha256));
  assert.equal(selectReadBackPolicy({ preset: dev2 }, candidate.candidate.sha256).selectedBy, 'dev2-designated-candidate');
  assert.throws(() => guardPresetDeploy(dev2, hex('9')), error => error.statusCode === 403);
});

test('freeze: no build, a failed build, a hand-built or foreign held build is refused with a reason and creates nothing', async t => {
  const env = await setup(t);
  assert.equal((await env.freeze()).body.reason, 'no-validated-build', 'nothing was built');
  env.worker();
  await env.settle(null);
  env.answers.push(() => ({ result: { ok: false, error: 'synthetic tool crash' } }));
  assert.equal((await env.build()).body.outcome, 'tool-fault');
  const failed = await env.freeze();
  assert.equal(failed.status, 409); assert.equal(failed.body.reason, 'no-validated-build');
  assert.equal((await env.build()).body.outcome, 'validated');
  const held = env.server.composedBuilds.get(env.id), manifestDigest = held.result.manifest.manifestDigest;
  // A copied manifest has no in-process provenance mark; it is not a validated build.
  env.server.composedBuilds.set(env.id, { ...held, result: { ...held.result, manifest: structuredClone(held.result.manifest) } });
  assert.equal((await env.freeze({ manifestDigest })).body.reason, 'no-validated-build');
  for (const foreign of [{ ...held, solutionId: OTHER_SOLUTION }, { ...held, adapter: { ...held.adapter, nativeRevision: hex('b', 40) } }]) {
    env.server.composedBuilds.set(env.id, foreign);
    const refused = await env.freeze();
    assert.equal(refused.status, 409); assert.equal(refused.body.reason, 'foreign-build');
  }
  // A build held for another Solution is never reachable from this one.
  env.server.composedBuilds.delete(env.id);
  env.server.composedBuilds.set(OTHER_SOLUTION, held);
  assert.equal((await env.freeze({ manifestDigest })).body.reason, 'no-validated-build');
  assert.deepEqual(await env.candidates(), []);
  assert.equal((await call(env.base, `/api/solutions/${env.id}/composed`, { method: 'POST', json: { artifactId: env.artifactId, expectedRevision: 0, manifestDigest } })).status, 404);
});

test('freeze: a build whose inputs moved after validation is stale, and no freeze runs while a build is in progress', async t => {
  const env = await setup(t);
  env.worker();
  await env.settle(null);
  let during = null;
  env.answers.push(async answer => { during = await env.freeze(); return answer; });
  assert.equal((await env.build()).body.outcome, 'validated');
  assert.equal(during.status, 409); assert.equal(during.body.reason, 'build-in-progress');
  const held = env.server.composedBuilds.get(env.id);
  // New review evidence after the build: the store re-derives the request and refuses it.
  const review = await env.managed.review(env.id, SOLUTION_CATALOG, env.artifactId);
  await env.managed.comment(env.id, SOLUTION_CATALOG, env.artifactId, { expectedRevision: await env.revision(), expectedDiscussionRevision: review.discussion.version,
    type: 'comment', text: 'Later synthetic review evidence' }, uploader);
  const stale = await env.freeze({ expectedRevision: held.revision });
  assert.equal(stale.status, 409, JSON.stringify(stale.body)); assert.equal(stale.body.reason, 'stale-build');
  assert.deepEqual(await env.candidates(), []);
  // Rebuilt from the current inputs, it freezes.
  assert.equal((await env.build()).body.outcome, 'validated');
  assert.equal((await env.freeze()).status, 201);
});

test('only the latest accepted merged revision builds: a pending resolved change and a superseded acceptance are refused before the worker', async t => {
  const env = await setup(t);
  const worker = env.worker();
  await env.settle(null);
  const jobs = () => worker.seen.filter(job => job.kind === 'materialize').length;
  assert.equal((await env.build()).body.outcome, 'validated');
  assert.equal((await env.freeze()).status, 201);
  const built = jobs();
  // Resolved but not accepted: Build follows acceptance.
  const pending = await env.later(5);
  const early = await env.build({ artifactId: pending });
  assert.equal(early.status, 409); assert.match(early.body.error, /latest accepted merged revision/);
  assert.equal(jobs(), built, 'no job for a change that is not accepted');
  assert.equal((await env.candidates())[0].inputsStatus, 'current', 'a pending change leaves the accepted revision current');
  // A later acceptance supersedes the earlier merged revision and its candidate.
  const accepted = await env.later(6, { accept: true });
  const superseded = await env.build();
  assert.equal(superseded.status, 409); assert.match(superseded.body.error, /latest accepted merged revision/);
  assert.equal(jobs(), built);
  assert.equal((await env.candidates())[0].inputsStatus, 'stale');
  assert.equal((await env.build({ artifactId: accepted })).body.outcome, 'validated');
});

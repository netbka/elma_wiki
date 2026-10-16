import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, syntheticAdapter, inventoryOf } from '../lib/delivery.mjs';
import { readArchive } from '../lib/e365.mjs';
import { adaptNativeCoverage, SYNTHETIC_COVERAGE_CONTRACT } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence, SYNTHETIC_RECEIPT_CONTRACT } from '../lib/dependency-resolver.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { prepareMaterializationRequest, materializeNative, SYNTHETIC_MATERIALIZATION_CONTRACT } from '../lib/native-materialization.mjs';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from './fixture.mjs';

// Synthetic Contracts-shaped Solution in the shared root. Content provenance
// (uploader, resolver, reviewer) is deliberately separate from the execution
// actor that owns connections and delivery attempts.
const uploader = { id: 'synthetic-uploader', login: 'uploader@example.org', provider: 'local' };
const resolver = { id: 'synthetic-resolver', login: 'resolver@example.org', provider: 'local' };
const reviewer = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'local' };
const executor = 'synthetic-executor';
const NOW = '2026-10-13T12:00:00.000Z';
const PROFILE = { targetId: 'synthetic-target', environment: 'isolated', digest: 'synthetic-profile', platformVersion: '2025.4', changedAt: '2026-10-01T00:00:00.000Z' };
const COMPILER = { contract: 'synthetic-compiler', profileDigest: 'c'.repeat(64), platformVersion: '2025.4', evidenceRef: 'synthetic-compiler-evidence', services: ['widgets'] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entries = rows => [
  ['package.json', { code: 'synthetic_contracts', type: 'SOLUTION' }],
  ['widgets/manifest.json', { nativeUnknown: { keep: true }, entities: rows.map(([code]) => ({ code, namespace: 'contracts', kind: 'WIDGET', path: code + '.json', resources: [{ path: 'resources/' + code + '.po' }] })) }],
  ...rows.flatMap(([code, value]) => [
    ['widgets/' + code + '.json', { descriptor: { clientScripts: `const value = ${JSON.stringify(value)};` }, unknownNativeField: code }],
    ['widgets/resources/' + code + '.po', `msgid "${code}"\nmsgstr "${value}"\n`]])
];
const target = (version = PROFILE.platformVersion, host = 'composed.example.invalid', adapter = 'synthetic', extra = {}) =>
  ({ name: 'Synthetic Target', role: 'target', environment: 'test', adapter, adapterOptions: { identity: { host, version }, ...extra } });
const confirmation = attempt => ({ idempotencyKey: 'composed-once', confirmation: `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}` });

// Test-only native assembler: whole-component operations over the baseline bytes
// with regenerated entity records. Its output is synthetic evidence only.
const identity = row => JSON.stringify([row.namespace, row.code, row.kind]);
const assembler = { id: 'synthetic-assembler', contract: SYNTHETIC_MATERIALIZATION_CONTRACT, nativeRevision: 'e'.repeat(40),
  async materialize({ request, originals }) {
    const read = new Map(await Promise.all([...originals].map(async ([id, bytes]) => [id, await readArchive(bytes)])));
    const files = new Map(read.get(request.inputs.base.artifactId));
    for (const op of request.operations) for (const file of op.files) files.set(file.path, read.get(op.sourceArtifactId).get(file.path));
    const manifest = JSON.parse(files.get('widgets/manifest.json'));
    for (const op of request.operations) {
      const record = JSON.parse(read.get(op.sourceArtifactId).get('widgets/manifest.json')).entities.find(row => identity(row) === identity({ namespace: 'contracts', code: JSON.parse(op.key)[2], kind: 'WIDGET' }));
      manifest.entities[manifest.entities.findIndex(row => identity(row) === identity(record))] = record;
    }
    files.set('widgets/manifest.json', Buffer.from(JSON.stringify(manifest)));
    const bytes = await zip([...files].reverse());
    return { inputsDigest: request.inputsDigest, artifacts: [{ solution: request.inputs.solution, bytes }],
      validation: { status: 'passed', validator: 'synthetic-validator', evidenceRef: 'synthetic-validation', artifactSha256: sha(bytes), contract: SYNTHETIC_MATERIALIZATION_CONTRACT,
        targetProfileDigest: request.inputs.targetProfile.digest, compilerProfileDigest: request.inputs.compiler.profileDigest } };
  } };

// P4 units (one per changed component, explicit order) and P5 locks over that plan.
function evidence(resolution, { order = null } = {}) {
  const components = resolution.result.filter(row => row.digest).map(row => {
    const [service, namespace, code] = JSON.parse(row.key);
    return { key: row.key, service, namespace, code, digest: row.digest };
  });
  const capture = { solution: 'synthetic_contracts', scope: 'full', checksum: resolution.resultDigest, components, ambiguities: [], unclassifiedFiles: [], dependencies: dependencyReport([]) };
  const units = (order ?? components.map(row => row.code)).map(code => components.find(row => row.code === code)).map(row => ({ id: row.code, status: 'supported', evidenceRef: 'synthetic-unit',
    members: [{ solution: capture.solution, key: row.key, digest: row.digest }], targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target' } }));
  const coverage = adaptNativeCoverage({ request: { kind: 'solution', solution: 'synthetic_contracts' }, artifacts: [capture], targetProfile: PROFILE,
    declarations: [{ contract: SYNTHETIC_COVERAGE_CONTRACT, nativeRevision: 'f'.repeat(40), adapter: 'synthetic-native-adapter', evidenceRef: 'synthetic-declaration',
      targetProfileDigest: PROFILE.digest, captures: [{ solution: capture.solution, artifactChecksum: capture.checksum }], units }] });
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, targetProfile: PROFILE, receiptContract: SYNTHETIC_RECEIPT_CONTRACT, now: NOW });
  return { coverage, dependencies };
}

async function setup(t, { base = [['div', 0], ['outside', 0]], changed = [['div', 2], ['outside', 3]], adapters, ...options } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-composed-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const solutions = solutionStore(directory), managed = solutions.managed, projects = projectStore(directory), legacy = releaseStore(directory, projects);
  const upload = async (rows, scope) => {
    const project = await solutions.uploads.create(SOLUTION_CATALOG, await zip(entries(rows)), 'synthetic.e365', uploader);
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await managed.create(SOLUTION_CATALOG, { name: 'Synthetic contracts', baselineOwner: 'Base', snapshot: await upload(base, 'full') }, uploader);
  const key = code => state.current.find(row => row.code === code).key;
  const change = await managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'change', snapshot: await upload(changed, 'partial'), expectedRevision: state.revision,
    team: 'C', taskRef: 'SYNTHETIC-C', sameSourceConfirmed: true, base: { artifactId: state.baselineId, revision: 0, confirmed: true },
    changeScope: { name: 'Synthetic scope', members: changed.map(([code]) => key(code)), confirmed: true, deletions: [] } }, uploader);
  const resolve = async () => {
    const current = await managed.get(state.id, SOLUTION_CATALOG), merge = await managed.merge(state.id, SOLUTION_CATALOG, change.artifactId);
    const saved = await managed.resolveMerge(state.id, SOLUTION_CATALOG, change.artifactId, { expectedRevision: current.revision, planDigest: merge.plan.planDigest,
      expectedResolutionId: merge.head?.id ?? null, decisions: {}, reason: 'Synthetic reviewed choice' }, resolver);
    const { status, ...head } = saved.head; return head;
  };
  const build = async (resolution, extra = {}) => {
    const current = await managed.get(state.id, SOLUTION_CATALOG), artifact = await managed.artifact(state.id, SOLUTION_CATALOG, change.artifactId);
    const ids = [...new Set([current.baselineId, change.artifactId, ...current.artifacts.map(row => row.id)])];
    const originals = new Map(await Promise.all(ids.map(async id => [id, await managed.original(state.id, SOLUTION_CATALOG, id)])));
    const inputs = { ...evidence(resolution, extra), compiler: COMPILER, targetProfile: PROFILE, ...extra.inputs };
    const request = await prepareMaterializationRequest({ state: current, artifact, resolution, ...inputs, originals });
    assert.equal(request.status, 'ready', JSON.stringify(request.blockers));
    return { inputs, build: await materializeNative({ request, originals, adapter: extra.adapter === undefined ? assembler : extra.adapter, now: NOW }) };
  };
  const resolution = await resolve();
  const { inputs, build: built } = await build(resolution);
  let candidate = await solutions.composed.freeze(state.id, { artifactId: change.artifactId, build: built, ...inputs }, resolver);
  candidate = await solutions.composed.change(state.id, candidate.id, { action: 'approve', revision: candidate.revision, reason: 'Synthetic review of exact composed bytes' }, reviewer);
  const calls = [];
  const delivery = deliveryStore(directory, legacy, { solutionHandoffs: solutions.handoffs, composedCandidates: solutions.composed,
    adapters: adapters ?? { synthetic: opts => syntheticAdapter({ ...opts, calls }) }, ...options });
  const composed = delivery.forComposed(state.id);
  const mutate = async mode => {
    if (mode === 'resolution') return resolve();
    if (mode === 'revoke') { const current = await solutions.composed.get(state.id, candidate.id);
      return solutions.composed.change(state.id, candidate.id, { action: 'revoke', revision: current.revision, reason: 'Synthetic revocation' }, reviewer); }
    const discussion = (await managed.review(state.id, SOLUTION_CATALOG, change.artifactId)).discussion;
    return managed.comment(state.id, SOLUTION_CATALOG, change.artifactId, { expectedRevision: (await managed.get(state.id, SOLUTION_CATALOG)).revision,
      expectedDiscussionRevision: discussion.version, type: 'comment', text: 'New synthetic review evidence' }, reviewer);
  };
  const attemptFile = attemptId => path.join(directory, 'delivery', 'attempts', 'composed', candidate.id, attemptId + '.json');
  return { directory, solutions, projects, legacy, state, change, candidate, built, inputs, build, resolve, delivery, composed, calls, mutate, attemptFile };
}

test('composed candidate binds exact build, units, profile and review; provenance stays separate from the execution actor', async t => {
  const { directory, solutions, state, change, candidate, built, inputs, delivery, composed, calls, attemptFile } = await setup(t);
  const [output] = built.artifacts;
  assert.equal(candidate.candidate.sha256, output.sha256);
  assert.equal(candidate.binding.manifestDigest, built.manifest.manifestDigest);
  assert.equal(candidate.binding.inputsDigest, built.manifest.inputsDigest);
  assert.equal(candidate.binding.requestDigest, built.manifest.requestDigest);
  assert.equal(candidate.binding.dependencyPlanDigest, inputs.dependencies.planDigest);
  assert.equal(candidate.binding.targetProfileDigest, PROFILE.digest);
  assert.equal(candidate.binding.artifactId, change.artifactId);
  assert.deepEqual(candidate.units.map(unit => unit.id), ['div', 'outside']);
  assert.deepEqual(candidate.targetProfile, { digest: PROFILE.digest, platformVersion: PROFILE.platformVersion });
  // P6 synthetic output remains non-native until P8.
  assert.equal(candidate.evidenceBasis, 'synthetic');
  assert.equal(candidate.releaseEligible, false);
  assert.equal(candidate.inputsStatus, 'current');
  assert.deepEqual(candidate.frozenBy, resolver);
  assert.deepEqual(candidate.approval.actor, reviewer);
  assert.deepEqual(candidate.provenance.resolution.actor, { ...resolver });
  assert.ok(candidate.provenance.originals.every(row => row.uploadedBy?.id === uploader.id));
  assert.equal(sha(await fs.readFile(path.join(directory, 'shared-solutions', 'composed-candidates', candidate.id, 'candidate.e365'))), output.sha256);

  const connection = await delivery.connections.create(executor, target());
  let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
  assert.deepEqual(attempt.candidateSource, { namespace: 'composed', solutionId: state.id, id: candidate.id });
  assert.equal(attempt.executionActorId, executor);
  assert.equal(attempt.sha256, output.sha256);
  assert.deepEqual(attempt.sourceAssociation, candidate.binding);
  assert.deepEqual(attempt.evidence.units.map(unit => unit.status), ['pending', 'pending']);
  assert.equal(JSON.parse(await fs.readFile(attemptFile(attempt.id))).owner, executor);
  // Another actor never sees or drives this actor's attempt, despite shared content access.
  await assert.rejects(composed.get(candidate.id, attempt.id, 'synthetic-other'), error => error.statusCode === 404);
  attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
  assert.equal(attempt.state, 'deployed-unverified');
  assert.deepEqual(calls.map(call => call.units), [['div', 'outside']]);
  assert.deepEqual(attempt.evidence.units.map(unit => unit.status), ['applied', 'applied']);
  attempt = await composed.verify(candidate.id, attempt.id, executor);
  assert.equal(attempt.state, 'verified');
  assert.equal(attempt.evidence.comparison.compared, (await inventoryOf(output.bytes)).length);
  assert.equal((await composed.get(candidate.id, attempt.id, executor)).verificationCurrent, true);
  // A different Solution never resolves this candidate.
  const other = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Other', baselineOwner: 'Team', snapshot: state.artifacts[0].snapshot && {
    projectId: state.artifacts[0].snapshot.projectId, snapshotId: state.artifacts[0].snapshot.snapshotId, scope: 'full', scopeConfirmed: true } }, uploader);
  await assert.rejects(delivery.forComposed(other.id).list(candidate.id, executor), error => error.statusCode === 404);
  await assert.rejects(solutions.composed.get(other.id, candidate.id), error => error.statusCode === 404);
  assert.equal(calls.length, 1);
});

test('freeze refuses unavailable, unverified, stale or mismatched builds and never trusts caller evidence', async t => {
  const env = await setup(t);
  const { solutions, state, change, built, inputs, build } = env;
  const freeze = (value, extra = {}) => solutions.composed.freeze(state.id, { artifactId: change.artifactId, build: value, ...inputs, ...extra }, resolver);
  const { status, ...head } = (await solutions.managed.merge(state.id, SOLUTION_CATALOG, change.artifactId)).head;
  // No pinned native contract: the real path is unavailable and cannot be frozen.
  const unavailable = await build(head, { adapter: null });
  assert.equal(unavailable.build.manifest.status, 'unavailable');
  await assert.rejects(freeze(unavailable.build), error => error.statusCode === 409);
  // Tampered bytes, manifest or a relocked compiler profile.
  const tampered = { manifest: built.manifest, artifacts: [{ ...built.artifacts[0], bytes: Buffer.concat([built.artifacts[0].bytes, Buffer.from('x')]) }] };
  await assert.rejects(freeze(tampered), error => error.statusCode === 409);
  await assert.rejects(freeze({ manifest: { ...built.manifest, evidenceBasis: 'native' }, artifacts: built.artifacts }), error => error.statusCode === 409);
  await assert.rejects(freeze(built, { compiler: { ...COMPILER, profileDigest: 'd'.repeat(64) } }), error => error.statusCode === 409);
  await assert.rejects(freeze(built, { targetProfile: { ...PROFILE, digest: 'other-profile' } }), error => error.statusCode === 409);
  // A later resolution or review event makes the old build stale.
  await env.mutate('resolution');
  await assert.rejects(freeze(built), error => error.statusCode === 409);
  const listed = await solutions.composed.list(state.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].inputsStatus, 'stale');
  assert.equal(listed[0].deliverable, false);
  // Only an authenticated actor can freeze; HTTP never reaches this method.
  await assert.rejects(solutions.composed.freeze(state.id, { artifactId: change.artifactId, build: built, ...inputs }), error => error.statusCode === 401);
});

test('synthetic composed evidence, a mismatched Target profile and missing unit receipts never reach dispatch', async t => {
  const calls = [];
  // A synthetic training Target whose adapter reports no per-unit receipts.
  const synthetic = ({ noReceipts, ...opts }) => { const adapter = syntheticAdapter({ ...opts, calls }); const capabilities = adapter.capabilities.bind(adapter);
    if (noReceipts) adapter.capabilities = async () => ({ ...await capabilities(), unitReceipts: false }); return adapter; };
  const { delivery, composed, candidate } = await setup(t, { adapters: { synthetic, 'operator-like': opts => syntheticAdapter({ ...opts, calls }) } });
  const refused = async (input, status) => {
    const connection = await delivery.connections.create(executor, input);
    await assert.rejects(composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id }), error => error.statusCode === status);
  };
  await refused(target(PROFILE.platformVersion, 'native.example.invalid', 'operator-like'), 409);
  await refused(target('2025.5'), 409);
  await refused(target(PROFILE.platformVersion, 'composed.example.invalid', 'synthetic', { noReceipts: true }), 503);
  await refused({ ...target(), environment: 'prod' }, 403);
  assert.equal((await composed.list(candidate.id, executor)).length, 0);
  assert.equal(calls.length, 0);
});

test('async prepare, confirm and read-back cannot commit evidence after resolution, review or approval changes', async t => {
  for (const phase of ['prepare', 'confirm', 'verify']) for (const mode of ['resolution', 'comment', 'revoke']) await t.test(`${phase}/${mode}`, async sub => {
    const entered = deferred(), finish = deferred(); let pause = false, imports = 0;
    const adapter = syntheticAdapter({ identity: { host: 'composed.example.invalid', version: PROFILE.platformVersion } });
    const inspect = adapter.inspectSolution.bind(adapter), readBack = adapter.readBack.bind(adapter), deploy = adapter.deployCandidate.bind(adapter);
    adapter.inspectSolution = async (...args) => { if (pause && phase !== 'verify') { entered.resolve(); await finish.promise; } return inspect(...args); };
    adapter.readBack = async (...args) => { if (pause) { entered.resolve(); await finish.promise; } return readBack(...args); };
    adapter.deployCandidate = (...args) => { imports++; return deploy(...args); };
    const { delivery, composed, candidate, mutate } = await setup(sub, { adapters: { synthetic: () => adapter } });
    const connection = await delivery.connections.create(executor, target());
    let attempt;
    if (phase !== 'prepare') attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
    if (phase === 'verify') attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
    pause = true;
    const pending = phase === 'prepare' ? composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id })
      : phase === 'confirm' ? composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt)) : composed.verify(candidate.id, attempt.id, executor);
    const observed = assert.rejects(pending, error => error.statusCode === 409);
    await entered.promise; await mutate(mode); finish.resolve(); await observed;
    assert.equal(imports, phase === 'verify' ? 1 : 0);
    const history = await composed.list(candidate.id, executor);
    if (phase === 'prepare') assert.equal(history.length, 0);
    else if (phase === 'confirm') {
      assert.equal(history[0].state, 'prepared');
      assert.equal(history[0].candidateStatus, 'stale');
      // Cancellation stays available for a stale preparation, before dispatch only.
      assert.equal((await composed.cancel(candidate.id, attempt.id, executor)).state, 'cancelled');
    } else {
      assert.equal(history[0].state, 'verification-failed');
      assert.equal(history[0].verificationCurrent, false);
      assert.equal(history[0].evidence.comparison, null);
    }
  });
});

test('deploying is durable before dispatch, cancellation is pre-dispatch only, and lost responses never redispatch', async t => {
  let observed = null, imports = 0;
  const env = await setup(t, { adapters: { synthetic: opts => {
    const adapter = syntheticAdapter(opts), deploy = adapter.deployCandidate.bind(adapter);
    adapter.deployCandidate = async (candidate, options) => {
      imports++;
      observed = JSON.parse(await fs.readFile(env.attemptFile(observed.id)));
      return deploy(candidate, options);
    };
    return adapter;
  } } });
  const { delivery, composed, candidate } = env;
  const connection = await delivery.connections.create(executor, target());
  const cancelled = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
  assert.equal((await composed.cancel(candidate.id, cancelled.id, executor)).state, 'cancelled');
  await assert.rejects(composed.confirm(candidate.id, cancelled.id, executor, confirmation(cancelled)), error => error.statusCode === 409);
  let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
  observed = { id: attempt.id };
  await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), confirmation: 'DEPLOY wrong' }), error => error.statusCode === 400);
  attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
  assert.equal(observed.state, 'deploying');
  assert.equal(observed.idempotencyKey, 'composed-once');
  // Persisted in flight: the units were handed to the adapter, not "not started".
  assert.deepEqual(observed.evidence.units.map(unit => unit.status), ['dispatched', 'dispatched']);
  // Lost response: the same key returns the stored attempt, another key is refused.
  assert.equal((await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt))).id, attempt.id);
  await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), idempotencyKey: 'another' }), error => error.statusCode === 409);
  await assert.rejects(composed.cancel(candidate.id, attempt.id, executor), error => error.statusCode === 409);
  assert.equal(imports, 1);
});

test('crash, timeout and unknown outcome recover only by read-back without redispatch', async t => {
  const env = await setup(t, { timeoutMs: 20 });
  const { delivery, composed, candidate, calls } = env;
  // Timeout: unknown outcome, never retried.
  const slow = await delivery.connections.create(executor, target(PROFILE.platformVersion, 'slow.example.invalid', 'synthetic', { scenario: 'timeout' }));
  let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: slow.id });
  attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
  for (let i = 0; i < 100 && attempt.state === 'deploying'; i++) { await new Promise(resolve => setTimeout(resolve, 10)); attempt = await composed.get(candidate.id, attempt.id, executor); }
  assert.equal(attempt.state, 'unknown-outcome');
  // Dispatched units are not reported as never started after a timeout.
  assert.deepEqual(attempt.evidence.units.map(unit => unit.status), ['unreported', 'unreported']);
  assert.equal(attempt.evidence.operation.result, 'timeout');
  await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), idempotencyKey: 'retry' }), error => error.statusCode === 409);
  await assert.rejects(composed.cancel(candidate.id, attempt.id, executor), error => error.statusCode === 409);
  assert.equal(calls.length, 1);
  // The unresolved attempt keeps this candidate reserved.
  const again = await delivery.connections.create(executor, target(PROFILE.platformVersion, 'again.example.invalid'));
  await assert.rejects(composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: again.id }), error => error.statusCode === 409);
  // Crash after durable `deploying` in a fresh lifecycle: a restarted coordinator
  // marks it unknown, keeps the Target reserved and recovers only by read-back.
  const second = await setup(t);
  const fresh = await second.delivery.connections.create(executor, target(PROFILE.platformVersion, 'fresh.example.invalid'));
  const prepared = await second.composed.prepare(second.candidate.id, executor, { revision: second.candidate.revision, connectionId: fresh.id });
  const record = JSON.parse(await fs.readFile(second.attemptFile(prepared.id)));
  await fs.writeFile(second.attemptFile(prepared.id), JSON.stringify({ ...record, state: 'deploying', bootId: 'previous-process', idempotencyKey: 'already-dispatched' }));
  let redispatches = 0;
  const recovered = syntheticAdapter({ identity: { host: 'fresh.example.invalid', version: PROFILE.platformVersion }, inventory: await inventoryOf(second.built.artifacts[0].bytes) });
  recovered.deployCandidate = async () => { redispatches++; assert.fail('unknown outcome redispatched'); };
  const restarted = deliveryStore(second.directory, second.legacy, { solutionHandoffs: second.solutions.handoffs, composedCandidates: second.solutions.composed, adapters: { synthetic: () => recovered } });
  const contextual = restarted.forComposed(second.state.id);
  const other = await restarted.connections.create('synthetic-other', target(PROFILE.platformVersion, 'FRESH.example.invalid.'));
  await assert.rejects(contextual.prepare(second.candidate.id, 'synthetic-other', { revision: second.candidate.revision, connectionId: other.id }), error => error.statusCode === 409);
  const unknown = await contextual.get(second.candidate.id, prepared.id, executor);
  assert.equal(unknown.state, 'unknown-outcome');
  assert.deepEqual(unknown.evidence.units.map(unit => unit.status), ['unreported', 'unreported']);
  // A lost response replays the stored attempt; any other key is refused. Neither dispatches.
  assert.equal((await contextual.confirm(second.candidate.id, prepared.id, executor, { ...confirmation(prepared), idempotencyKey: 'already-dispatched' })).state, 'unknown-outcome');
  await assert.rejects(contextual.confirm(second.candidate.id, prepared.id, executor, confirmation(prepared)), error => error.statusCode === 409);
  assert.equal((await contextual.verify(second.candidate.id, prepared.id, executor)).state, 'verified');
  assert.equal(redispatches, 0);
});

test('multi-unit receipts stay truthful: partial, missing and errored units keep the reservation and require read-back', async t => {
  for (const mode of ['partial', 'missing', 'error']) await t.test(mode, async sub => {
    const calls = [];
    const adapter = opts => {
      const value = syntheticAdapter({ ...opts, calls, scenario: mode === 'partial' ? 'partial' : 'apply' }), deploy = value.deployCandidate.bind(value);
      value.deployCandidate = async (candidate, options) => {
        if (mode === 'error') { calls.push({ units: candidate.units }); throw Error('Synthetic native failure after an unknown unit'); }
        const result = await deploy(candidate, options);
        return mode === 'missing' ? { ...result, receipts: result.receipts.slice(0, 1) } : result;
      };
      return value;
    };
    const { delivery, composed, candidate, legacy, projects } = await setup(sub, { adapters: { synthetic: adapter } });
    const connection = await delivery.connections.create(executor, target());
    let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
    attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
    const expected = { partial: ['partial-outcome', ['applied', 'failed']], missing: ['partial-outcome', ['applied', 'unreported']], error: ['unknown-outcome', ['unreported', 'unreported']] }[mode];
    assert.equal(attempt.state, expected[0]);
    assert.deepEqual(attempt.evidence.units.map(unit => unit.status), expected[1]);
    // The Target stays reserved across namespaces and owners.
    const bytes = await zip(entries([['div', 9]]));
    const project = await projects.create('synthetic-legacy', bytes);
    let release = await legacy.create('synthetic-legacy', { sourceProjectId: project.id, title: 'Legacy', intent: 'Synthetic', targetIntent: 'Test' });
    release = await legacy.change(release.id, 'synthetic-legacy', { revision: release.revision, action: 'details', title: 'Legacy', intent: 'Synthetic', targetIntent: 'Test', limitations: 'No baseline', notes: '' });
    for (const row of release.changes) release = await legacy.change(release.id, 'synthetic-legacy', { revision: release.revision, action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic' });
    release = await legacy.change(release.id, 'synthetic-legacy', { revision: release.revision, action: 'freeze' });
    release = await legacy.change(release.id, 'synthetic-legacy', { revision: release.revision, action: 'approve', reason: 'Synthetic' });
    const legacyConnection = await delivery.connections.create('synthetic-legacy', target());
    await assert.rejects(delivery.prepare(release.id, 'synthetic-legacy', { revision: release.revision, connectionId: legacyConnection.id }), error => error.statusCode === 409);
    await assert.rejects(composed.cancel(candidate.id, attempt.id, executor), error => error.statusCode === 409);
    await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), idempotencyKey: 'retry' }), error => error.statusCode === 409);
    attempt = await composed.verify(candidate.id, attempt.id, executor);
    assert.equal(attempt.state, mode === 'missing' ? 'verified' : 'verification-failed');
    assert.equal(calls.length, 1);
  });
});

test('contextual composed API uses the trusted execution actor and rejects forged fields, foreign roots and freezing', async t => {
  const { directory, state, change, candidate } = await setup(t);
  const secret = 'SYNTHETIC_COMPOSED_DELIVERY_SECRET';
  const server = createServer({ directory, syntheticDelivery: true, sendEmail: undefined,
    sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, cookie, options = {}) => fetch(base + route, { ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  const json = async (response, expected = 200) => { const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value; };
  const post = (route, cookie, input, headers = {}) => request(route, cookie, { method: 'POST', body: JSON.stringify(input),
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers } });
  const login = async email => {
    const link = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(link.pathname + link.search, null, { redirect: 'manual' }); assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return { cookie, user: (await json(await request('/api/session', cookie))).user };
  };
  const alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const candidateRoute = `/api/solutions/${state.id}/composed/${candidate.id}`, route = candidateRoute + '/delivery';
  await json(await request(route, null), 404);
  await json(await request(`/api/solutions/${crypto.randomUUID()}/composed/${candidate.id}`, alice.cookie), 404);
  await json(await request(`/api/releases/${candidate.id}/delivery`, alice.cookie), 404);
  await json(await request(`/api/solutions/${state.id}/handoffs/${candidate.id}/delivery`, alice.cookie), 404);
  const listed = await json(await request(`/api/solutions/${state.id}/composed`, alice.cookie));
  assert.deepEqual(listed.map(row => [row.id, row.inputsStatus, row.deliverable, row.evidenceBasis]), [[candidate.id, 'current', true, 'synthetic']]);
  // HTTP never supplies build bytes: freezing (PLAN-01 B1) only confirms a server-held validated build,
  // and there is none here. Review decisions require the exact revision.
  await json(await post(`/api/solutions/${state.id}/composed`, alice.cookie, { action: 'freeze' }), 400);
  await json(await post(`/api/solutions/${state.id}/composed`, alice.cookie, { artifactId: change.artifactId, expectedRevision: 0, manifestDigest: candidate.binding.manifestDigest,
    bytes: 'forged' }), 400);
  const refused = await json(await post(`/api/solutions/${state.id}/composed`, alice.cookie, { artifactId: change.artifactId, expectedRevision: 0,
    manifestDigest: candidate.binding.manifestDigest }), 409);
  assert.equal(refused.reason, 'no-validated-build');
  assert.equal((await json(await request(`/api/solutions/${state.id}/composed`, alice.cookie))).length, 1);
  await json(await post(candidateRoute, alice.cookie, { action: 'approve', revision: candidate.revision, reason: 'Again', bytes: 'forged' }), 400);
  const connection = await json(await post('/api/connections', alice.cookie, target()), 201);
  const input = { action: 'prepare', revision: candidate.revision, connectionId: connection.id };
  await json(await post(route, bob.cookie, input), 404);
  await json(await post(route, alice.cookie, input, { Origin: 'https://foreign.example.invalid' }), 403);
  for (const extra of [{ owner: SOLUTION_CATALOG }, { actor: bob.user }, { namespace: 'legacy' }, { bytes: 'forged' }, { units: ['div'] }, { solutionId: state.id }])
    await json(await post(route, alice.cookie, { ...input, ...extra }), 400);
  let attempt = await json(await post(route, alice.cookie, input), 201);
  assert.equal(attempt.executionActorId, alice.user.id);
  assert.equal(attempt.owner, undefined);
  assert.deepEqual(await json(await request(route, bob.cookie)), []);
  await json(await post(route, bob.cookie, { action: 'confirm', attemptId: attempt.id, ...confirmation(attempt) }), 404);
  attempt = await json(await post(route, alice.cookie, { action: 'confirm', attemptId: attempt.id, ...confirmation(attempt) }));
  assert.equal(attempt.state, 'deployed-unverified');
  attempt = await json(await post(route, alice.cookie, { action: 'verify', attemptId: attempt.id }));
  assert.equal(attempt.state, 'verified');
  // Revoking review makes the historical verification non-current.
  const revoked = await json(await post(candidateRoute, alice.cookie, { action: 'revoke', revision: candidate.revision, reason: 'Synthetic revocation' }));
  assert.equal(revoked.deliverable, false);
  const [historical] = await json(await request(route, alice.cookie));
  assert.equal(historical.state, 'verified');
  assert.equal(historical.verificationCurrent, false);
});

test('timeout and receipt-less errors on a single-unit candidate never leave units pending', async t => {
  for (const mode of ['error', 'timeout', 'timeout-partial']) await t.test(mode, async sub => {
    const calls = [];
    const adapter = opts => {
      const value = syntheticAdapter({ ...opts, calls });
      value.deployCandidate = async candidate => {
        calls.push({ units: candidate.units });
        if (mode === 'error') throw Error('Synthetic native failure without receipts');
        throw Object.assign(Error('Synthetic timeout'), { code: 'TIMEOUT', ...(mode === 'timeout-partial' ? { receipts: [{ unitId: candidate.units[0], status: 'applied' }] } : {}) });
      };
      return value;
    };
    const changed = mode === 'timeout-partial' ? undefined : [['div', 2]];
    const { delivery, composed, candidate } = await setup(sub, { adapters: { synthetic: adapter }, ...(changed ? { base: [['div', 0]], changed } : {}) });
    const connection = await delivery.connections.create(executor, target());
    let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
    assert.deepEqual(attempt.evidence.units.map(unit => unit.status), changed ? ['pending'] : ['pending', 'pending']);
    attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
    const expected = { error: ['failed', ['failed']], timeout: ['unknown-outcome', ['unreported']], 'timeout-partial': ['partial-outcome', ['applied', 'unreported']] }[mode];
    assert.equal(attempt.state, expected[0]);
    assert.deepEqual(attempt.evidence.units.map(unit => unit.status), expected[1]);
    assert.deepEqual((await composed.get(candidate.id, attempt.id, executor)).evidence.units.map(unit => unit.status), expected[1]);
    await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), idempotencyKey: 'retry' }), error => error.statusCode === 409);
    assert.equal(calls.length, 1);
  });
});

test('an unobserved read-back failure keeps partial and unknown outcomes reserved; only an observed read-back resolves them', async t => {
  for (const [scenario, failure] of [['partial', 'read-back'], ['partial', 'health'], ['timeout', 'read-back'], ['timeout', 'health']]) await t.test(`${scenario}/${failure}`, async sub => {
    const calls = [];
    let broken = false;
    const adapter = opts => {
      const value = syntheticAdapter({ ...opts, calls, scenario: scenario === 'partial' ? 'partial' : 'apply' }), deploy = value.deployCandidate.bind(value);
      const health = value.health.bind(value), readBack = value.readBack.bind(value);
      if (scenario === 'timeout') value.deployCandidate = async (candidate, options) => { await deploy(candidate, options); throw Object.assign(Error('Synthetic lost response'), { code: 'TIMEOUT' }); };
      value.health = async () => broken && failure === 'health' ? { ok: false } : health();
      value.readBack = async code => { if (broken && failure === 'read-back') throw Error('Synthetic transient read-back failure'); return readBack(code); };
      return value;
    };
    const { delivery, composed, candidate, attemptFile } = await setup(sub, { adapters: { synthetic: adapter } });
    const connection = await delivery.connections.create(executor, target());
    let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
    attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
    const unresolved = scenario === 'partial' ? 'partial-outcome' : 'unknown-outcome', units = attempt.evidence.units.map(unit => unit.status);
    assert.equal(attempt.state, unresolved);
    broken = true;
    await assert.rejects(composed.verify(candidate.id, attempt.id, executor), failure === 'health' ? { statusCode: 503 } : /transient read-back/);
    // Nothing was observed: the state, units and Target reservation survive, durably.
    const stored = JSON.parse(await fs.readFile(attemptFile(attempt.id), 'utf8'));
    assert.equal(stored.state, unresolved);
    assert.deepEqual(stored.evidence.units.map(unit => unit.status), units);
    assert.ok(stored.evidence.verificationError);
    assert.equal(stored.evidence.comparison, null);
    assert.equal(stored.history.at(-1).state, unresolved);
    // A healthy Target is still reserved: no new preparation or confirmation can dispatch.
    broken = false;
    await assert.rejects(composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id }), error => error.statusCode === 409);
    await assert.rejects(composed.confirm(candidate.id, attempt.id, executor, { ...confirmation(attempt), idempotencyKey: 'redispatch' }), error => error.statusCode === 409);
    await assert.rejects(composed.cancel(candidate.id, attempt.id, executor), error => error.statusCode === 409);
    assert.equal(calls.filter(call => call.units).length, 1);
    // Only a read-back that observes the same Target settles the outcome and frees the reservation.
    attempt = await composed.verify(candidate.id, attempt.id, executor);
    assert.equal(attempt.state, scenario === 'partial' ? 'verification-failed' : 'verified');
    assert.equal(attempt.evidence.verificationError, undefined);
    assert.equal(calls.filter(call => call.units).length, 1);
  });
});

test('MR-08 composed: promotion keeps the exact frozen candidate and profile, goes stale with review inputs, and partial receipts block plain retry', async t => {
  const { composed, delivery, calls, candidate, mutate } = await setup(t);
  const first = await delivery.connections.create(executor, target());
  let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: first.id });
  attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
  attempt = await composed.verify(candidate.id, attempt.id, executor);
  assert.equal(attempt.state, 'verified');
  // Another platform version than the bound composed profile is refused at promotion.
  const otherPlatform = await delivery.connections.create(executor, target('2026.1', 'other-platform.example.invalid'));
  await assert.rejects(composed.promote(candidate.id, attempt.id, executor, { revision: candidate.revision, connectionId: otherPlatform.id, idempotencyKey: 'x' }), error => error.statusCode === 409);
  const second = await delivery.connections.create(executor, target(PROFILE.platformVersion, 'composed-stage.example.invalid'));
  let promoted = await composed.promote(candidate.id, attempt.id, executor, { revision: candidate.revision, connectionId: second.id, idempotencyKey: 'p' });
  assert.deepEqual(promoted.composed.targetProfile, attempt.composed.targetProfile);
  assert.deepEqual(promoted.evidence.units.map(unit => unit.status), ['pending', 'pending']);
  const packet = await composed.packet(candidate.id, promoted.id, executor);
  assert.equal(packet.inputs.composed.targetProfile.digest, PROFILE.digest);
  assert.equal(packet.inputsDigest, (await composed.packet(candidate.id, attempt.id, executor)).inputsDigest);
  promoted = await composed.confirm(candidate.id, promoted.id, executor, { ...confirmation(promoted), idempotencyKey: 'promoted' });
  assert.equal((await composed.verify(candidate.id, promoted.id, executor)).state, 'verified');
  assert.equal(calls.length, 2);
  // New review evidence: the candidate is stale, so neither promotion nor its packet stays current.
  await mutate('comment');
  const third = await delivery.connections.create(executor, target(PROFILE.platformVersion, 'composed-third.example.invalid'));
  await assert.rejects(composed.promote(candidate.id, promoted.id, executor, { revision: candidate.revision, connectionId: third.id, idempotencyKey: 'stale' }), error => error.statusCode === 409);
  assert.equal((await composed.packet(candidate.id, promoted.id, executor)).outcome.candidateStatus, 'stale');
  assert.equal((await composed.packet(candidate.id, promoted.id, executor)).outcome.verificationCurrent, false);
});

test('MR-08 composed: an applied unit receipt with an unchanged inventory reconciles as diverged, never as not-applied', async t => {
  const { composed, delivery, calls, candidate } = await setup(t, { adapters: { synthetic: opts => syntheticAdapter({ ...opts, calls: [], scenario: 'partial' }) } });
  const connection = await delivery.connections.create(executor, target());
  let attempt = await composed.prepare(candidate.id, executor, { revision: candidate.revision, connectionId: connection.id });
  attempt = await composed.confirm(candidate.id, attempt.id, executor, confirmation(attempt));
  assert.equal(attempt.state, 'partial-outcome');
  await assert.rejects(composed.retry(candidate.id, attempt.id, executor, { idempotencyKey: 'r' }), error => error.statusCode === 409);
  attempt = await composed.verify(candidate.id, attempt.id, executor);
  assert.equal(attempt.state, 'verification-failed');
  assert.equal(attempt.evidence.reconciliation.outcome, 'diverged');
  assert.equal(attempt.evidence.reconciliation.fromState, 'partial-outcome');
  await assert.rejects(composed.retry(candidate.id, attempt.id, executor, { idempotencyKey: 'r' }), error => error.statusCode === 409 && /идемпотентный/.test(error.message));
  assert.equal(calls.length, 0);
});

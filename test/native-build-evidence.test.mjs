import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BUILD_EVIDENCE_CONTRACT, BUILD_EVIDENCE_JOB, BUILD_EVIDENCE_MAX_AGE_MS, BUILD_EVIDENCE_SOURCE, COMPILER_SERVICES, NOT_ESTABLISHED, admittedBuildEvidence,
  buildEvidencePayload, buildEvidenceRequestDigest, composedBuildInputs, resolvedBuildCapture, configuredBuildEvidenceSource, currentBuildEvidence, validateBuildEvidence,
  validateBuildEvidenceRequest } from '../lib/native-build-evidence.mjs';
import { CAPABILITY_CATALOG, CAPABILITY_CATALOG_SOURCE, changesDigest } from '../lib/elma365-native-contracts.mjs';
import { configuredTargetProfileObserver, observedTargetProfileReport } from '../lib/native-materialization-bridge.mjs';
import { solutionBuildEvidence, composedBuildEligibility } from '../lib/composed-build-eligibility.mjs';
import { jobKinds } from '../lib/bridge.mjs';
import { bridgeWorker, hex, observe, observedReport, producedBuildEvidence, unavailableBuildEvidence, WORKER } from './native-contract-fixtures.mjs';
import { policyScenario, WIDGET, TEMPLATE, keyOf } from './manifest-policy-fixtures.mjs';

// Wiki consumer of elma365-native-build-evidence@1 (netbka/elma365#60 PR #112, Wiki P8). Contract
// parity uses the elma365 test vectors' shapes and reason names; every value is synthetic. No worker,
// Target, licence or native tool is involved.
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const key = (...parts) => JSON.stringify(parts);
const component = (service, kind, code) => ({ key: key(service, 'synthetic.app', ...(service === 'processor' ? [kind] : []), code), service, kind, digest: sha(service + code) });
const FORM = component('widgets', 'widget', 'form'), VIEWER = component('widgets', 'widget', 'viewer');
const APPROVAL = component('processor', 'template', 'approval'), BOARD = component('pages', 'page', 'board'), LOOSE = { ...component('widgets', 'x', 'loose'), kind: null };
const AT = '2026-10-17T08:00:00.000Z', AT_MS = Date.parse(AT), PROFILE = hex('a');
const report = (extra = {}) => observedReport({ targetId: 'dev2', targetProfileDigest: PROFILE, observedAt: '2026-10-17T07:50:00.000Z', runId: 'observation-run-1',
  worker: { ...WORKER }, ...extra });
const payload = (extra = {}) => buildEvidencePayload({ runId: '7d0b8f8e-2f4c-4b8e-9d55-0d2d1c5e9a01', target: 'dev2', nativeRevision: WORKER.nativeRevision,
  captures: [{ solution: 'synthetic_contracts', checksum: hex('e'), components: [FORM, VIEWER, APPROVAL] }],
  changes: [{ solution: 'synthetic_contracts', key: FORM.key, op: 'replace', digest: FORM.digest, service: 'widgets', kind: 'widget' }], ...extra });
const produce = (request = payload(), options = {}) => producedBuildEvidence(request, { report: report(), issuedAt: AT, ...options });
const check = (doc, extra = {}) => validateBuildEvidence(doc, { payload: payload(), nativeRevision: WORKER.nativeRevision, now: AT_MS + 1000, targetReport: report(), ...extra });
const reasons = verdict => [...new Set(verdict.errors.map(row => row.reason))].sort();
const clone = value => JSON.parse(JSON.stringify(value));

test('the consumer is pinned to the merged elma365 producer and the vendored catalog', () => {
  assert.deepEqual(BUILD_EVIDENCE_CONTRACT, { id: 'elma365-native-build-evidence', version: 1 });
  assert.equal(BUILD_EVIDENCE_JOB, 'buildEvidence');
  assert.deepEqual([BUILD_EVIDENCE_SOURCE.pullRequest, BUILD_EVIDENCE_SOURCE.merged, BUILD_EVIDENCE_SOURCE.revision],
    [112, true, '00a29fb03dc8b7d6f90f08dc4dbfcc1ae8ee555d']);
  assert.ok(jobKinds.includes('buildEvidence'), 'the bridge store recognises the job kind');
  assert.deepEqual(COMPILER_SERVICES, ['widgets'], 'widget compilation does not certify process runtime');
  assert.ok(NOT_ESTABLISHED.includes('process-runtime-compiler') && NOT_ESTABLISHED.includes('entitlement-observation'));
  assert.equal(CAPABILITY_CATALOG_SOURCE.intact, true);
  assert.equal(CAPABILITY_CATALOG.catalogDigest, '60048542c76aaa748b4c0f5e1e8a888a497cf17ab337e7cb10a6a2364467b58c');
});

test('a produced document binds request, nonce, Target, worker, compiler lock and catalog coverage', () => {
  const doc = produce();
  assert.deepEqual(check(doc), { valid: true, errors: [], usable: true });
  assert.equal(doc.requestDigest, buildEvidenceRequestDigest(payload()));
  assert.equal(doc.coverage.changesDigest, changesDigest(payload().changes));
  assert.deepEqual(doc.coverage.units[0].targetPrecondition.evidenceRef, report().evidenceRef);
  // Without the worker's own observation no unit carries a precondition, and it says so.
  const unobserved = produce(payload(), { report: null });
  assert.ok(unobserved.missing.includes('target-observation'));
  assert.deepEqual(check(unobserved).usable, true);
});

test('parity: replayed, foreign, stale, future, retargeted and other-revision documents are rejected with the elma365 reasons', () => {
  const doc = produce();
  assert.deepEqual(reasons(check(doc, { payload: payload({ runId: 'another-run' }) })), ['foreign-run', 'request-mismatch']);
  const replay = clone(doc); replay.producer.runId = 'another-run';
  assert.deepEqual(reasons(check(replay)), ['foreign-run']);
  assert.deepEqual(reasons(check(doc, { now: AT_MS + BUILD_EVIDENCE_MAX_AGE_MS + 1 })), ['stale-evidence']);
  assert.deepEqual(reasons(check(doc, { now: AT_MS - 10 * 60 * 1000 })), ['future-evidence']);
  const retargeted = clone(doc); retargeted.targetId = retargeted.environment = 'main-dev';
  assert.deepEqual(reasons(check(retargeted)), ['target-mismatch']);
  assert.deepEqual(reasons(check(doc, { nativeRevision: hex('d', 40) })), ['worker-revision-mismatch']);
  const changedCapture = payload(); changedCapture.captures[0].checksum = hex('1');
  assert.ok(reasons(check(doc, { payload: changedCapture })).includes('request-mismatch'));
  assert.ok(reasons(check(doc, { payload: changedCapture })).includes('invalid-coverage-declaration'));
  assert.ok(reasons(check(doc, { payload: payload({ changes: [] }) })).includes('request-mismatch'));
});

test('parity: unknown kinds, kindless components and unsupported edits stay unsupported; relabelling is caught', async () => {
  const local = payload({ captures: [{ solution: 'synthetic_contracts', checksum: hex('e'), components: [FORM, APPROVAL, BOARD, LOOSE] }],
    changes: [{ solution: 'synthetic_contracts', key: APPROVAL.key, op: 'replace', digest: APPROVAL.digest, service: 'processor', kind: 'template' }] });
  const doc = produce(local);
  const unit = doc.coverage.units[0];
  assert.equal(unit.status, 'unsupported');
  assert.deepEqual(unit.unsupportedMembers.map(row => [row.key, row.reason]).sort(), [[LOOSE.key, 'unknown-capability'], [BOARD.key, 'unknown-capability'],
    [APPROVAL.key, 'edit-unsupported']].sort());
  assert.equal(check(doc, { payload: local }).usable, true, 'an honest unsupported declaration is valid evidence of unsupport');
  const relabelled = clone(doc);
  relabelled.coverage.units[0] = { ...unit, status: 'supported', unsupportedMembers: [],
    members: [...unit.members, ...unit.unsupportedMembers.map(row => ({ solution: row.solution, key: row.key, digest: row.digest, evidenceBasis: 'native-real-export' }))]
      .sort((a, b) => a.key < b.key ? -1 : 1) };
  const verdict = check(relabelled, { payload: local });
  assert.deepEqual(reasons(verdict), ['invalid-coverage-declaration']);
  assert.ok(verdict.errors[0].errors.includes('capability-mismatch'));
  // Through the Wiki adapter the honest declaration blocks the coverage gate with the unsupported members.
  const capture = { ...local.captures[0], scope: 'full', components: local.captures[0].components.map(row => ({ ...row, namespace: 'synthetic.app', code: 'x' })),
    ambiguities: [], unclassifiedFiles: [], dependencies: { schemaVersion: 1, rows: [] } };
  const { observation } = await observe({ targetProfileDigest: PROFILE, observedAt: AT });
  const evidence = solutionBuildEvidence({ capture, changes: local.changes, declarations: [doc.coverage], observation, now: AT });
  assert.ok(evidence.coverage.adapterBlockers.some(row => row.reason === 'unsupported-native-unit-member'));
  const gates = composedBuildEligibility({ ...evidence, now: AT });
  assert.equal(gates.gates.find(row => row.id === 'coverage').status, 'blocked');
});

test('parity: compiler locks, over-claims, hidden facts, unavailable documents, shape and hygiene', () => {
  const doc = produce();
  const mutate = change => { const copy = clone(doc); change(copy); return reasons(check(copy)); };
  assert.deepEqual(mutate(row => { row.compiler.services = ['processor', 'widgets']; }), ['unsupported-compiler-scope']);
  assert.deepEqual(mutate(row => { row.compiler.services = []; }), ['unsupported-compiler-scope']);
  assert.deepEqual(mutate(row => { row.compiler.services = ['widgets', 'widgets']; }), ['unsupported-compiler-scope']);
  assert.deepEqual(mutate(row => { row.compiler.profileDigest = hex('9'); }), ['compiler-profile-mismatch']);
  assert.deepEqual(mutate(row => { row.publicationReady = true; }), ['over-claim']);
  assert.deepEqual(mutate(row => { row.missing = row.missing.filter(fact => fact !== 'required-bindings'); }), ['hidden-missing-fact']);
  assert.deepEqual(mutate(row => { row.extra = true; }), ['document-shape']);
  assert.ok(mutate(row => { row.profile.platformVersion = 'C:\\elma\\bin'; }).length > 0, 'a host path is refused');
  assert.ok(mutate(row => { row.coverage.targetProfileDigest = hex('7'); }).includes('coverage-profile-mismatch'));
  assert.deepEqual(mutate(row => { row.targetObservation = null; }), ['unobserved-target-precondition']);
  assert.deepEqual(reasons(check(doc, { targetReport: report({ runId: 'other-observation' }) })), ['target-observation-mismatch']);
  assert.deepEqual(reasons(check(doc, { targetReport: report({ targetProfileDigest: hex('5') }) })), ['stale-target-profile', 'target-observation-mismatch']);
  assert.deepEqual(reasons(check(doc, { catalog: null })), ['capability-catalog-unavailable']);
  const unavailable = unavailableBuildEvidence(payload(), 'worker-profile-unbound', { issuedAt: AT });
  assert.deepEqual(check(unavailable), { valid: true, errors: [], usable: false });
  assert.deepEqual(reasons(check({ ...unavailable, compiler: doc.compiler })), ['unavailable-with-evidence']);
});

test('requests: exactly the contract fields, no host, credential, verified flag or paid claim', () => {
  assert.deepEqual(validateBuildEvidenceRequest(payload()), { valid: true, errors: [] });
  for (const extra of [{ host: 'dev2.example.invalid' }, { verified: true }, { catalog: {} }, { compilerLock: {} }])
    assert.deepEqual(reasons(validateBuildEvidenceRequest({ ...payload(), ...extra })), ['request-shape'], JSON.stringify(extra));
  const paid = payload(); paid.captures[0].components[0].paid = true;
  assert.ok(reasons(validateBuildEvidenceRequest(paid)).includes('invalid-component'));
  assert.ok(reasons(validateBuildEvidenceRequest(payload({ runId: 'token=abcdef0123456789abcdef' }))).length > 0);
  assert.ok(reasons(validateBuildEvidenceRequest(payload({ nativeRevision: hex('0', 40) }))).includes('invalid-native-revision'));
  const removed = { ...payload(), changes: [{ solution: 'synthetic_contracts', key: VIEWER.key, op: 'remove', digest: VIEWER.digest }] };
  assert.ok(reasons(validateBuildEvidenceRequest(removed)).includes('invalid-change'), 'a remove names no resulting digest');
});

// A real bridgeStore with an in-process worker answering targetProfile, then buildEvidence.
async function admitted(t, { answer = (request, observed) => ({ evidence: producedBuildEvidence(request, { report: observed }) }), jobKinds: kinds,
  env: extra = {} } = {}) {
  let observed = null;
  const worker = await bridgeWorker({ jobKinds: kinds ?? ['health', 'targetProfile', 'buildEvidence'], respond: async request => {
    if (request.contract.id === BUILD_EVIDENCE_CONTRACT.id) return answer(request, observed);
    observed = observedReport({ targetId: request.targetId, environment: request.environment, runId: request.runId, targetProfileDigest: PROFILE, observedAt: new Date().toISOString() });
    return { report: observed };
  } });
  t.after(() => worker.close());
  const env = { ...worker.env, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'dev2', ...extra };
  const observer = configuredTargetProfileObserver({ env, bridges: worker.store, log: () => {} });
  const [profile] = await Promise.all([observer.observe({}), worker.serve()]);
  assert.equal(profile.status, 'observed');
  const source = configuredBuildEvidenceSource({ env, bridges: worker.store, log: () => {} });
  const captures = [{ solution: 'synthetic_contracts', checksum: hex('e'), components: [FORM, VIEWER, APPROVAL] }];
  const changes = [{ solution: 'synthetic_contracts', key: FORM.key, op: 'replace', digest: FORM.digest, service: 'widgets', kind: 'widget' }];
  return { worker, source, observation: profile.observation, captures, changes };
}

test('the bridge source admits one fresh produced document, only in process, only for its inputs and observation', async t => {
  const { worker, source, observation, captures, changes } = await admitted(t);
  const [answer, job] = await Promise.all([source.request({ captures, changes, observation }), worker.serve()]);
  assert.equal(answer.status, 'produced', JSON.stringify(answer));
  assert.deepEqual(Object.keys(job.payload).sort(), ['captures', 'changes', 'contract', 'environment', 'nativeRevision', 'runId', 'targetId']);
  assert.deepEqual([job.payload.targetId, job.payload.nativeRevision], ['dev2', WORKER.nativeRevision]);
  const evidence = answer.evidence;
  assert.ok(admittedBuildEvidence(evidence));
  assert.equal(admittedBuildEvidence(structuredClone(evidence)), null, 'a copy carries no provenance');
  assert.equal(admittedBuildEvidence(JSON.parse(JSON.stringify(evidence))), null, 'a deserialized document is not evidence');
  const use = (extra = {}) => currentBuildEvidence({ evidence, observation, captures, changes, nativeRevision: WORKER.nativeRevision, now: Date.now(), ...extra });
  assert.equal(use().status, 'current');
  assert.deepEqual(use().compiler.services, ['widgets']);
  assert.deepEqual(use({ evidence: structuredClone(evidence) }), { status: 'missing', reason: 'missing-build-evidence' });
  assert.equal(use({ observation: structuredClone(observation) }).reason, 'stale-build-evidence-observation');
  assert.equal(use({ changes: [] }).reason, 'stale-build-evidence-inputs');
  assert.equal(use({ captures: [{ ...captures[0], checksum: hex('1') }] }).reason, 'stale-build-evidence-inputs');
  assert.equal(use({ nativeRevision: hex('d', 40) }).reason, 'worker-revision-mismatch');
  assert.equal(use({ now: Date.now() + BUILD_EVIDENCE_MAX_AGE_MS + 60 * 1000 }).reason, 'stale-evidence');
  // A copied observation is no observation: nothing is requested for it.
  assert.deepEqual(await source.request({ captures, changes, observation: { ...observation } }), { status: 'unavailable', reason: 'unobserved-target-profile', evidence: null });
});

test('the bridge source never admits unavailable, invalid or lost answers, and needs an advertised job', async t => {
  const unavailable = await admitted(t, { answer: request => ({ evidence: unavailableBuildEvidence(request, 'capability-catalog-unavailable') }) });
  const [first] = await Promise.all([unavailable.source.request(unavailable), unavailable.worker.serve()]);
  assert.deepEqual([first.status, first.reason, first.evidence], ['unavailable', 'capability-catalog-unavailable', null]);
  assert.ok(first.missing.includes('native-coverage-declaration'));

  const foreign = await admitted(t, { answer: (request, observed) => ({ evidence: producedBuildEvidence({ ...request, runId: 'replayed-run' }, { report: observed }) }) });
  const [second] = await Promise.all([foreign.source.request(foreign), foreign.worker.serve()]);
  assert.equal(second.status, 'invalid');
  assert.ok(second.errors.includes('foreign-run'));

  const quiet = await admitted(t, { jobKinds: ['health', 'targetProfile'] });
  assert.deepEqual(await quiet.source.request(quiet), { status: 'unavailable', reason: 'build-evidence-not-advertised', evidence: null });
  assert.equal(quiet.worker.jobs.length, 1, 'only the observation job ran');

  // A lost answer is an unknown outcome, never success.
  const lost = await admitted(t, { env: { WIKI_NATIVE_BUILD_EVIDENCE_TIMEOUT_MS: '200' } });
  await assert.rejects(lost.source.request(lost), error => error.code === 'NATIVE_OUTCOME_UNKNOWN' && error.detail === 'timeout');
  // The store refuses a buildEvidence job carrying anything but the contract fields.
  const { bridge } = lost.worker;
  await assert.rejects(lost.worker.store.enqueue(bridge.id, 'buildEvidence', { ...payload(), host: 'dev2.example.invalid' }), error => error.statusCode === 422);
  await assert.rejects(lost.worker.store.enqueue(bridge.id, 'buildEvidence', payload(), { artifact: Buffer.from('candidate') }), error => error.statusCode === 422);
});

test('configuration: only the explicit bridge, owner, revision and Target; never a caller value', () => {
  const env = { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '6f1c2c1e-4a8b-4c55-9d1e-0a1b2c3d4e5f', WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'operator',
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER.nativeRevision, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'dev2' };
  const logs = [];
  assert.equal(configuredBuildEvidenceSource({ env: {}, bridges: null }), null);
  assert.equal(configuredBuildEvidenceSource({ env, bridges: {}, log: message => logs.push(message) }), null, 'only a bridgeStore() store');
  assert.equal(configuredBuildEvidenceSource({ env: { ...env, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'DEV 2' }, bridges: {}, log: message => logs.push(message) }), null);
  assert.ok(logs.every(message => !message.includes(env.WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID) && !message.includes('operator')), 'logs name variables, never values');
});

test('build inputs come from the managed store: the resolved revision, its changes and conservative dependency declarations', async t => {
  const scenario = await policyScenario({ base: [{ ...WIDGET, value: 0 }, { ...TEMPLATE, value: 0 }], change: [{ ...WIDGET, value: 1 }] });
  t.after(scenario.cleanup);
  const { state, artifact, resolution, originals } = scenario;
  const inputs = await composedBuildInputs({ state, artifact, resolution, originals });
  assert.deepEqual(inputs.blockers, []);
  assert.equal(inputs.capture.checksum, resolution.resultDigest);
  assert.deepEqual(inputs.capture.components.map(row => [row.key, row.digest]).sort(), resolution.result.filter(row => row.digest).map(row => [row.key, row.digest]).sort());
  assert.deepEqual(inputs.changes.map(row => [row.key, row.op, row.kind]), [[keyOf(WIDGET), 'replace', 'widget']]);
  // Mutating a declaration of the bound state is another input: the resolution no longer matches it.
  const moved = structuredClone(state);
  moved.artifacts.find(row => row.id === moved.baselineId).dependencies.rows.push({ category: 'dependencies' });
  assert.deepEqual((await composedBuildInputs({ state: moved, artifact, resolution, originals })).blockers.map(row => row.reason), ['stale-resolution']);
  // Missing original bytes make the inputs unbuildable: nothing is requested for them.
  const missing = await composedBuildInputs({ state, artifact, resolution, originals: new Map() });
  assert.equal(missing.capture, null);
  assert.ok(missing.blockers.some(row => row.reason === 'missing-original'));
});

test('a process template change keeps its native blockers: unsupported edit and no process runtime compiler', async t => {
  const scenario = await policyScenario({ base: [{ ...WIDGET, value: 0 }, { ...TEMPLATE, value: 0 }], change: [{ ...TEMPLATE, value: 1 }] });
  t.after(scenario.cleanup);
  const { state, artifact, resolution, originals } = scenario;
  const inputs = await composedBuildInputs({ state, artifact, resolution, originals });
  const request = buildEvidencePayload({ runId: 'synthetic-run', target: 'dev2', nativeRevision: WORKER.nativeRevision, captures: [inputs.capture], changes: inputs.changes });
  assert.deepEqual(validateBuildEvidenceRequest(request), { valid: true, errors: [] });
  const doc = producedBuildEvidence(request, { report: null });
  assert.equal(doc.coverage.units[0].status, 'unsupported');
  assert.ok(doc.coverage.units[0].unsupportedMembers.some(row => row.key === keyOf(TEMPLATE) && row.reason === 'edit-unsupported'));
  assert.deepEqual(doc.compiler.services, ['widgets']);
  assert.ok(doc.missing.includes('process-runtime-compiler'));
});

test('a resolved capture never drops a paid, missing or unknown dependency declaration', () => {
  const declaration = (targetCode, status, source = { namespace: null, code: null, service: null }) => ({ category: 'dependencies', required: true, service: 'widgets',
    targetNamespace: 'vendor', targetCode, source, ownerCode: null, status, providers: [], candidates: status === 'paid-source-unavailable'
      ? [{ code: 'vendor_module', paid: true, version: '2.1.0', observedAt: null }] : [], sourceAvailability: 'unavailable', versionCompatibility: 'not-verified', activation: 'unknown' });
  const report = rows => ({ schemaVersion: 1, provenance: 'manual-upload', rows, publicationReady: false, targetVerification: 'not-run', limitations: [] });
  const removedSource = { service: 'widgets', namespace: 'synthetic.app', code: 'viewer' };
  const base = { components: [], ambiguities: [], unclassifiedFiles: [], dependencies: report([declaration('ext', 'paid-source-unavailable'), declaration('gone', 'provider-not-observed', removedSource)]) };
  const change = { components: [], ambiguities: [], unclassifiedFiles: [], dependencies: report([declaration('new', 'provider-not-observed')]) };
  const capture = resolvedBuildCapture({ solution: 'synthetic_contracts', checksum: hex('e'), sources: [base, change], components: [FORM],
    removed: [JSON.stringify(['widgets', 'synthetic.app', 'viewer'])] });
  assert.deepEqual(capture.dependencies.rows.map(row => [row.targetCode, row.status]).sort(), [['ext', 'paid-source-unavailable'], ['new', 'provider-not-observed']]);
  assert.deepEqual([capture.scope, capture.checksum, capture.ambiguities, capture.unclassifiedFiles], ['full', hex('e'), [], []]);
  // A source without a dependency inventory or without ambiguity accounting never reads as clean.
  const unknown = resolvedBuildCapture({ solution: 'synthetic_contracts', checksum: hex('e'), sources: [base, { components: [] }], components: [FORM] });
  assert.equal(unknown.dependencies, null);
  assert.deepEqual(unknown.ambiguities, [null]);
});

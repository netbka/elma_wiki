import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composedBuildEligibility, solutionBuildEligibility, BUILD_GATES, TARGET_PROFILE_MAX_AGE_MS } from '../lib/composed-build-eligibility.mjs';
import { adaptNativeCoverage, SYNTHETIC_COVERAGE_CONTRACT } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence, SYNTHETIC_RECEIPT_CONTRACT } from '../lib/dependency-resolver.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { parseManagedArtifact } from '../lib/managed-workspace.mjs';
import { INSPECTED_NATIVE_MATERIALIZATION } from '../lib/native-materialization.mjs';
import { createServer } from '../server.mjs';
import { fixture } from './fixture.mjs';
import { hex, sha, nativeDeclaration, installed, observedReport, observe } from './native-contract-fixtures.mjs';

// Synthetic fixtures only: fictional Solutions, modules, Targets and worker. No bridge job reaches ELMA.
const PROFILE = hex('a'), NOW = '2026-10-15T06:00:00.000Z', SOLUTION = 'synthetic_contracts';
const NATIVE_RECEIPTS = { id: 'elma365-dependency-receipt', version: 1 };
const UNAVAILABLE = { available: false, reason: 'native-materialization-unavailable', missing: [...INSPECTED_NATIVE_MATERIALIZATION.missing] };
const component = (code, kind = 'widget') => ({ key: JSON.stringify(['widgets', 'synthetic.app', code]), service: 'widgets', namespace: 'synthetic.app', code, kind, digest: sha(code) });
const dep = (from, to, extra = {}) => ({ category: 'dependencies', service: 'widgets', targetNamespace: 'synthetic.app', targetCode: to,
  source: { service: 'widgets', namespace: 'synthetic.app', code: from }, ...extra });
const capture = (codes, rows = []) => {
  const dependencies = dependencyReport([]); dependencies.rows = rows;
  return { solution: SOLUTION, scope: 'full', checksum: hex('c'), components: codes.map(code => typeof code === 'string' ? component(code) : code),
    ambiguities: [], unclassifiedFiles: [], dependencies };
};
const request = { kind: 'solution', solution: SOLUTION };
const gateOf = (result, id) => result.gates.find(row => row.id === id);
const reasonsOf = (result, id) => gateOf(result, id).reasons.map(row => row.reason);
const statuses = result => Object.fromEntries(result.gates.map(row => [row.id, row.status]));

// Synthetic accounting: one unit per component, an empty synthetic Target.
const syntheticCoverage = artifact => adaptNativeCoverage({ request, artifacts: [artifact], targetProfile: { digest: PROFILE }, declarations: [{
  contract: SYNTHETIC_COVERAGE_CONTRACT, nativeRevision: hex('f', 40), adapter: 'synthetic-native-adapter', evidenceRef: 'synthetic-declaration', targetProfileDigest: PROFILE,
  captures: [{ solution: SOLUTION, artifactChecksum: artifact.checksum }],
  units: artifact.components.map(row => ({ id: row.code, status: 'supported', evidenceRef: 'synthetic-unit', members: [{ solution: SOLUTION, key: row.key, digest: row.digest }],
    targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target' } })) }] });
const syntheticDependencies = plan => resolveDependencyEvidence({ plan, receiptContract: SYNTHETIC_RECEIPT_CONTRACT, now: NOW,
  targetProfile: { targetId: 'synthetic-target', environment: 'synthetic-target', digest: PROFILE, platformVersion: '2025.4', changedAt: '2026-10-01T00:00:00Z' } });
// Native path: a declaration exactly as the elma365 worker derives it, and a bridge observation.
const nativeCoverage = (artifact, report = observedReport({ targetProfileDigest: PROFILE }), digest = PROFILE) => adaptNativeCoverage({ request, artifacts: [artifact],
  targetProfile: { digest }, declarations: [nativeDeclaration({ captures: [artifact], targetProfileDigest: digest, targetReport: report })] });

test('only evidence produced by the adapter, resolver and bridge counts; absent or hand-built evidence is unknown and blocks', () => {
  assert.deepEqual(BUILD_GATES, ['scope', 'coverage', 'dependencies', 'target-profile', 'materialization']);
  assert.throws(() => composedBuildEligibility({}), /Explicit evaluation time/);
  const none = composedBuildEligibility({ now: NOW });
  assert.equal(none.eligible, false);
  assert.deepEqual(statuses(none), { scope: 'unknown', coverage: 'unknown', dependencies: 'unknown', 'target-profile': 'unknown', materialization: 'unknown' });
  assert.deepEqual(reasonsOf(none, 'materialization'), ['native-materialization-unknown']);
  // Copies of genuine results, a hand-built "verified" profile and an available-looking builder claim are not evidence.
  const coverage = syntheticCoverage(capture(['A'])), dependencies = syntheticDependencies(coverage.plan);
  const forged = composedBuildEligibility({ coverage: structuredClone(coverage), dependencies: { ...dependencies, resolutionComplete: true, blockers: [] },
    observation: { report: observedReport({ targetProfileDigest: PROFILE }) }, materialization: { available: 'yes' }, now: NOW });
  assert.deepEqual(reasonsOf(forged, 'scope'), ['unverified-native-coverage']);
  assert.deepEqual(reasonsOf(forged, 'coverage'), ['unverified-native-coverage']);
  assert.deepEqual(reasonsOf(forged, 'dependencies'), ['unverified-dependency-resolution']);
  assert.deepEqual(reasonsOf(forged, 'target-profile'), ['unobserved-target-profile']);
  assert.equal(gateOf(forged, 'materialization').status, 'blocked');
  assert.equal(forged.eligible, false);
});

test('diamond dependencies plan a verified scope, yet synthetic coverage and receipts never make a build eligible', () => {
  const artifact = capture(['A', 'B', 'C', 'D'], [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')]);
  const coverage = syntheticCoverage(artifact), dependencies = syntheticDependencies(coverage.plan);
  assert.deepEqual(coverage.plan.dependencyOrder.map(row => JSON.parse(row.key).at(-1)), ['D', 'B', 'C', 'A']);
  const result = composedBuildEligibility({ coverage, dependencies, materialization: UNAVAILABLE, now: NOW });
  assert.deepEqual(statuses(result), { scope: 'verified', coverage: 'blocked', dependencies: 'blocked', 'target-profile': 'unknown', materialization: 'blocked' });
  assert.ok(reasonsOf(result, 'coverage').includes('synthetic-evidence-only'));
  assert.ok(reasonsOf(result, 'coverage').includes('missing-native-evidence'));
  assert.deepEqual(reasonsOf(result, 'dependencies'), ['synthetic-evidence-only']);
  assert.deepEqual(reasonsOf(result, 'target-profile'), ['unobserved-target-profile']);
  assert.deepEqual(gateOf(result, 'materialization').reasons, [{ reason: 'native-materialization-unavailable', missing: [...UNAVAILABLE.missing].sort() }]);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.evidence, { coverage: 'synthetic', dependencies: 'synthetic', targetProfile: 'unknown' });
});

test('a dependency cycle blocks the release scope with the components it names', () => {
  const coverage = syntheticCoverage(capture(['A', 'B'], [dep('A', 'B'), dep('B', 'A')]));
  const result = composedBuildEligibility({ coverage, dependencies: syntheticDependencies(coverage.plan), materialization: UNAVAILABLE, now: NOW });
  const cycle = gateOf(result, 'scope').reasons.find(row => row.reason === 'dependency-cycle');
  assert.equal(gateOf(result, 'scope').status, 'blocked');
  assert.deepEqual(cycle.components.map(row => JSON.parse(row.key).at(-1)).sort(), ['A', 'B']);
  assert.equal(result.eligible, false);
});

test('with native coverage, an observed Target and native receipts, only native installation evidence and the builder remain', async () => {
  const artifact = capture(['form']);
  const { status, observation } = await observe({ targetProfileDigest: PROFILE });
  assert.equal(status, 'observed');
  const coverage = nativeCoverage(artifact);
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, receiptContract: NATIVE_RECEIPTS, observation, now: NOW });
  const result = composedBuildEligibility({ coverage, dependencies, observation, materialization: UNAVAILABLE, now: NOW });
  assert.deepEqual(statuses(result), { scope: 'verified', coverage: 'blocked', dependencies: 'verified', 'target-profile': 'verified', materialization: 'blocked' });
  assert.deepEqual(gateOf(result, 'coverage').reasons.map(row => [row.reason, row.fact]),
    [['missing-native-evidence', 'native-import-receipt'], ['missing-native-evidence', 'native-installation-observation']]);
  assert.deepEqual(result.evidence, { coverage: 'native', dependencies: 'native-receipt', targetProfile: 'observed' });
  assert.equal(result.targetProfile.digest, PROFILE);
  assert.equal(result.eligible, false);
  assert.equal(result.publicationReady, false); assert.equal(result.executionEnabled, false);
});

test('a missing licensed paid dependency blocks; a paid flag or an unverified receipt is never a lock', async () => {
  const paid = { category: 'dependencies', service: 'widgets', targetNamespace: 'vendor', targetCode: 'ext', source: { service: 'widgets', namespace: 'synthetic.app', code: 'form' },
    status: 'paid-source-unavailable', candidates: [{ code: 'vendor_module', version: '2.1.0', paid: true }] };
  const need = { service: 'widgets', namespace: 'vendor', code: 'ext', provider: { code: 'vendor_module', version: '2.1.0' } };
  const artifact = capture(['form'], [paid]);
  const evaluate = async installedSolutions => {
    const { observation } = await observe({ targetProfileDigest: PROFILE, installedSolutions, requirements: [need] });
    const coverage = nativeCoverage(artifact);
    const dependencies = resolveDependencyEvidence({ plan: coverage.plan, receiptContract: NATIVE_RECEIPTS, observation, now: NOW,
      bindings: [{ name: 'VENDOR_API', kind: 'secret-reference', reference: 'secret-ref:synthetic/vendor-api', targetProfileDigest: PROFILE }] });
    return composedBuildEligibility({ coverage, dependencies, observation, materialization: UNAVAILABLE, now: NOW });
  };
  // Not installed on the Target: nothing provides it.
  let result = await evaluate([]);
  assert.equal(gateOf(result, 'dependencies').status, 'blocked');
  assert.ok(reasonsOf(result, 'dependencies').includes('missing-reference'));
  assert.deepEqual(gateOf(result, 'dependencies').reasons.find(row => row.reason === 'unresolved-dependency').details, ['missing-receipt']);
  // Installed but the entitlement is not verified: the receipt is an assertion, never forged into a lock.
  result = await evaluate([installed('vendor_module', { entitlement: { status: 'unknown', evidenceRef: null } })]);
  assert.ok(gateOf(result, 'dependencies').reasons.find(row => row.reason === 'unresolved-dependency').details.includes('assertion-only-receipt'));
  assert.ok(reasonsOf(result, 'dependencies').includes('missing-reference'));
  // A verified licensed preinstallation observed on the same profile locks it; the gate then names nothing.
  result = await evaluate([installed('vendor_module')]);
  assert.equal(gateOf(result, 'dependencies').status, 'verified');
  assert.equal(result.eligible, false, 'native installation evidence and the builder still block');
  // Without any native receipt contract a readable paid catalog entry stays unknown.
  const coverage = nativeCoverage(artifact);
  const unknown = composedBuildEligibility({ coverage, dependencies: resolveDependencyEvidence({ plan: coverage.plan, now: NOW, targetProfile: null }), materialization: UNAVAILABLE, now: NOW });
  assert.ok(reasonsOf(unknown, 'dependencies').includes('native-receipt-contract-unavailable'));
  assert.ok(reasonsOf(unknown, 'dependencies').includes('unknown-dependency-evidence'));
});

test('an unknown object kind is not covered natively and blocks coverage', async () => {
  const artifact = capture([component('form'), component('odd', 'mystery')]);
  const { observation } = await observe({ targetProfileDigest: PROFILE });
  const coverage = nativeCoverage(artifact);
  const result = composedBuildEligibility({ coverage, dependencies: resolveDependencyEvidence({ plan: coverage.plan, receiptContract: NATIVE_RECEIPTS, observation, now: NOW }),
    observation, materialization: UNAVAILABLE, now: NOW });
  assert.equal(gateOf(result, 'coverage').status, 'blocked');
  const unsupported = gateOf(result, 'coverage').reasons.find(row => row.reason === 'unsupported-native-unit-member');
  assert.deepEqual(unsupported.members.map(row => JSON.parse(row.key).at(-1)), ['odd']);
  assert.ok(reasonsOf(result, 'coverage').includes('unknown-native-import-unit'));
  assert.equal(result.eligible, false);
});

test('a stale Target profile blocks: an old observation, coverage planned for another profile, dependencies checked on another profile', async () => {
  const artifact = capture(['form']);
  const { observation } = await observe({ targetProfileDigest: PROFILE });
  const coverage = nativeCoverage(artifact), at = later => new Date(Date.parse(NOW) + later).toISOString();
  // The same observation more than a day later.
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, receiptContract: NATIVE_RECEIPTS, observation, now: NOW });
  let result = composedBuildEligibility({ coverage, dependencies, observation, materialization: UNAVAILABLE, now: at(TARGET_PROFILE_MAX_AGE_MS + 1) });
  assert.equal(gateOf(result, 'target-profile').status, 'blocked');
  assert.deepEqual(gateOf(result, 'target-profile').reasons, [{ reason: 'stale-target-profile-observation', observedAt: '2026-10-15T00:00:00.000Z' }]);
  // The Target changed: a new observation reports another profile than coverage and dependencies were planned for.
  const changed = await observe({ targetProfileDigest: hex('b') });
  result = composedBuildEligibility({ coverage, dependencies, observation: changed.observation, materialization: UNAVAILABLE, now: NOW });
  assert.ok(reasonsOf(result, 'target-profile').includes('stale-coverage-profile'));
  assert.ok(reasonsOf(result, 'target-profile').includes('stale-dependency-profile'));
  // A declaration made for another profile is not admitted at all.
  result = composedBuildEligibility({ coverage: adaptNativeCoverage({ request, artifacts: [artifact], targetProfile: { digest: PROFILE },
    declarations: [nativeDeclaration({ captures: [artifact], targetProfileDigest: hex('b'), targetReport: observedReport({ targetProfileDigest: hex('b') }) })] }),
  dependencies, observation, materialization: UNAVAILABLE, now: NOW });
  assert.ok(reasonsOf(result, 'target-profile').includes('stale-native-profile'));
  // Coverage admitted for the other profile is planned there, not on the observed Target.
  result = composedBuildEligibility({ coverage: nativeCoverage(artifact, observedReport({ targetProfileDigest: hex('b') }), hex('b')), dependencies, observation,
    materialization: UNAVAILABLE, now: NOW });
  assert.ok(reasonsOf(result, 'target-profile').includes('stale-coverage-profile'));
  // A resolution of another plan is stale for this one.
  result = composedBuildEligibility({ coverage, dependencies: syntheticDependencies(syntheticCoverage(capture(['other'])).plan), observation, materialization: UNAVAILABLE, now: NOW });
  assert.ok(reasonsOf(result, 'dependencies').includes('stale-dependency-resolution'));
  assert.equal(result.eligible, false);
});

test('the result is frozen, serializable and independent of input order', () => {
  const rows = [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')];
  const one = syntheticCoverage(capture(['A', 'B', 'C', 'D'], rows)), two = syntheticCoverage(capture(['D', 'C', 'B', 'A'], [...rows].reverse()));
  const left = composedBuildEligibility({ coverage: one, dependencies: syntheticDependencies(one.plan), materialization: UNAVAILABLE, now: NOW });
  const right = composedBuildEligibility({ coverage: two, dependencies: syntheticDependencies(two.plan), materialization: UNAVAILABLE, now: NOW });
  assert.deepEqual(left, right);
  assert.ok(Object.isFrozen(left) && Object.isFrozen(left.gates[0].reasons));
  assert.deepEqual(JSON.parse(JSON.stringify(left)), left);
});

test('today\'s service: a parsed full capture without declarations or observation names every missing piece', async () => {
  const capture = await parseManagedArtifact(await fixture(), { scope: 'full' });
  const result = solutionBuildEligibility({ capture, materialization: UNAVAILABLE, now: NOW });
  assert.equal(result.eligible, false);
  assert.deepEqual(statuses(result), { scope: 'verified', coverage: 'blocked', dependencies: 'blocked', 'target-profile': 'unknown', materialization: 'blocked' });
  assert.ok(reasonsOf(result, 'coverage').includes('native-coverage-unavailable'));
  assert.ok(reasonsOf(result, 'coverage').includes('unknown-native-import-unit'));
  assert.deepEqual(reasonsOf(result, 'dependencies'), ['unknown-dependency-evidence']);
  assert.ok(reasonsOf(result, 'target-profile').includes('unobserved-target-profile'));
  assert.throws(() => solutionBuildEligibility({ capture: null, now: NOW }), /accepted full capture/);
});

test('the composer eligibility route is authenticated, read-only and reports every gate blocked today', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-build-eligibility-'));
  const server = createServer({ directory, allowLocal: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, headers = { 'X-Elma-Wiki-Request': '1' };
  const login = await fetch(base + '/auth/local', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200);
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const upload = await fetch(base + '/api/solutions/uploads?sharedConfirmed=true', { method: 'POST', body: await fixture(), headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  const created = await fetch(base + '/api/solutions', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sharedConfirmed: true,
    name: 'Synthetic Solution', baselineOwner: 'Vendor', snapshot: { projectId: uploaded.id, snapshotId: uploaded.currentSnapshotId, scope: 'full', scopeConfirmed: true } }) });
  assert.equal(created.status, 201);
  const { id } = await created.json(), route = `${base}/api/solutions/${id}/composed-eligibility`;
  assert.equal((await fetch(route)).status, 404, 'no session reveals nothing');
  const response = await fetch(route, { headers });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.solutionId, id); assert.equal(body.eligible, false);
  assert.deepEqual(body.gates.map(row => row.id), BUILD_GATES);
  assert.ok(body.gates.filter(row => row.id !== 'scope').every(row => row.status !== 'verified' && row.reasons.length > 0));
  assert.deepEqual(body.gates.find(row => row.id === 'materialization').reasons[0].reason, 'native-materialization-unavailable');
  assert.equal((await fetch(route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
  assert.equal((await fetch(`${base}/api/solutions/00000000-0000-4000-8000-000000000000/composed-eligibility`, { headers })).status, 404);
});

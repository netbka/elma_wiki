import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptNativeCoverage, INSPECTED_NATIVE_CONTRACT, NATIVE_COVERAGE_CONTRACTS, SYNTHETIC_COVERAGE_CONTRACT } from '../lib/native-coverage-adapter.mjs';
import { REQUIRED_GLOBAL_DOMAINS } from '../lib/release-scope-planner.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { parseManagedArtifact } from '../lib/managed-workspace.mjs';
import { fixture } from './fixture.mjs';

const PROFILE = { digest: 'synthetic-profile', baselineDigest: 'synthetic-baseline' };
const REVISION = 'f'.repeat(40);
const component = code => ({ key: JSON.stringify(['widgets', 'app', code]), service: 'widgets', namespace: 'app', code, digest: 'digest-' + code });
const ref = (code, solution = 'S') => ({ solution, key: component(code).key });
const member = (code, solution = 'S') => ({ ...ref(code, solution), digest: component(code).digest });
const dep = (from, to) => ({ category: 'dependencies', service: 'widgets', targetNamespace: 'app', targetCode: to, source: { service: 'widgets', namespace: 'app', code: from } });
const capture = (codes, deps = [], solution = 'S') => ({ solution, scope: 'full', checksum: 'checksum-' + solution, components: codes.map(component),
  ambiguities: [], unclassifiedFiles: [], dependencies: dependencyReport(deps) });
const unit = (id, codes, extra = {}) => ({ id, status: 'supported', evidenceRef: 'synthetic-unit', members: codes.map(code => member(code)),
  targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target' }, ...extra });
const declaration = (artifacts, extra = {}) => ({ contract: SYNTHETIC_COVERAGE_CONTRACT, nativeRevision: REVISION, adapter: 'synthetic-native-adapter',
  evidenceRef: 'synthetic-declaration', targetProfileDigest: PROFILE.digest,
  captures: artifacts.map(row => ({ solution: row.solution, artifactChecksum: row.checksum })),
  units: artifacts.flatMap(row => row.components.map(c => unit(c.code, [c.code]))), ...extra });
const adapt = (artifacts, extra = {}) => adaptNativeCoverage({ request: { kind: 'solution', solution: 'S' }, artifacts, targetProfile: PROFILE,
  declarations: [declaration(artifacts)], ...extra });
const reasons = result => [...result.adapterBlockers, ...result.plan.blockers].map(row => row.reason);
const codes = rows => rows.map(row => JSON.parse(row.key).at(-1));

test('no native contract is pinned; current captures stay unknown and never native-complete', async () => {
  assert.deepEqual(NATIVE_COVERAGE_CONTRACTS, []);
  assert.equal(INSPECTED_NATIVE_CONTRACT.status, 'unavailable');
  const parsed = await parseManagedArtifact(await fixture(), { scope: 'full' });
  const result = adaptNativeCoverage({ request: { kind: 'solution', solution: parsed.solution }, artifacts: [parsed], targetProfile: PROFILE });
  assert.ok(reasons(result).includes('native-coverage-unavailable'));
  assert.ok(reasons(result).includes('unknown-native-import-unit'));
  assert.equal(result.evidenceBasis, 'unknown');
  assert.equal(result.wikiAccounting.evidence, 'unknown');
  assert.ok(result.nativeEvidence.required.includes('pinned-native-coverage-contract'));
  assert.equal(result.nativeEvidence.complete, false);
  assert.equal(result.publicationReady, false);
  assert.equal(result.executionEnabled, false);
  const forged = declaration([parsed], { contract: { id: 'elma365-native-coverage', version: 1 } });
  assert.ok(reasons(adaptNativeCoverage({ request: { kind: 'solution', solution: parsed.solution }, artifacts: [parsed], targetProfile: PROFILE,
    declarations: [forged] })).includes('unknown-native-coverage-contract'));
});

test('minimal supported unit plans Wiki accounting but stays synthetic and natively unverified', () => {
  const result = adapt([capture(['A'])]);
  assert.equal(result.plan.planningComplete, true);
  assert.deepEqual(result.plan.nativeImportUnits, ['A']);
  assert.deepEqual(result.plan.targetPreconditions.map(row => row.targetProfileDigest), [PROFILE.digest]);
  assert.deepEqual(result.adapterBlockers.map(row => row.reason), ['synthetic-evidence-only']);
  assert.equal(result.wikiAccounting.planningComplete, false);
  assert.equal(result.wikiAccounting.evidence, 'planned');
  assert.deepEqual(result.nativeEvidence.required, ['native-import-receipt', 'native-installation-observation', 'pinned-native-coverage-contract']);
  assert.equal(result.nativeEvidence.complete, false);
});

test('application membership and digest-bound part expansion reach whole native units', () => {
  const artifact = capture(['A', 'B', 'C'], [dep('B', 'C')]);
  artifact.components[0].structure = { version: 1, elements: [{ id: 'node-1' }], ambiguities: [] };
  const units = [unit('AB', ['A', 'B']), unit('C', ['C'])];
  const part = { solution: 'S', key: component('A').key, componentDigest: component('A').digest, partId: 'node-1', unitId: 'AB' };
  const request = { kind: 'part', component: ref('A'), partId: 'node-1' };
  let result = adapt([artifact], { request, declarations: [declaration([artifact], { units, parts: [part] })] });
  assert.deepEqual(codes(result.plan.requiredComponents), ['A', 'B', 'C']);
  assert.deepEqual(result.plan.nativeImportOrder, ['C', 'AB']);
  assert.ok(result.plan.expansions.some(row => row.reason === 'native-import-unit' && row.component.key === component('B').key));
  assert.equal(result.plan.planningComplete, true);
  assert.ok(reasons(adapt([artifact], { request, declarations: [declaration([artifact], { units })] })).includes('unknown-native-part-expansion'));
  result = adapt([artifact], { request, declarations: [declaration([artifact], { units, parts: [{ ...part, componentDigest: 'old' }] })] });
  assert.ok(reasons(result).includes('stale-native-part-expansion'));
  result = adapt([artifact], { request, declarations: [declaration([artifact], { units, parts: [{ ...part, unitId: 'C' }] })] });
  assert.ok(reasons(result).includes('unknown-native-part-expansion'));
  const applications = [{ solution: 'S', id: 'app', coverage: 'complete', evidenceRef: 'synthetic-membership', members: [ref('B')] }];
  result = adapt([artifact], { request: { kind: 'application', solution: 'S', applicationId: 'app' }, declarations: [declaration([artifact], { units, applications })] });
  assert.deepEqual(codes(result.plan.requestedComponents), ['B']);
  assert.deepEqual(codes(result.plan.requiredComponents), ['A', 'B', 'C']);
  result = adapt([artifact], { request: { kind: 'application', solution: 'S', applicationId: 'app' },
    declarations: [declaration([artifact], { units, applications: [{ ...applications[0], coverage: 'partial' }] })] });
  assert.ok(reasons(result).includes('incomplete-application-inventory'));
});

test('component diamond orders; component and coupled-unit cycles block', () => {
  const diamond = capture(['A', 'B', 'C', 'D'], [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')]);
  assert.deepEqual(codes(adapt([diamond]).plan.dependencyOrder), ['D', 'B', 'C', 'A']);
  const cycle = capture(['A', 'B'], [dep('A', 'B'), dep('B', 'A')]);
  assert.ok(reasons(adapt([cycle])).includes('dependency-cycle'));
  const coupled = capture(['A', 'B', 'C', 'D'], [dep('A', 'B'), dep('C', 'D')]);
  const result = adapt([coupled], { declarations: [declaration([coupled], { units: [unit('left', ['A', 'D']), unit('right', ['B', 'C'])] })] });
  assert.ok(reasons(result).includes('native-import-unit-cycle'));
  assert.equal(result.plan.nativeImportOrder, null);
});

test('unsupported, unbound and unsupported-member units block', () => {
  const artifact = capture(['A']);
  assert.ok(reasons(adapt([artifact], { declarations: [declaration([artifact], { units: [unit('A', ['A'], { status: 'declared' })] })] }))
    .includes('unsupported-native-import-unit'));
  assert.ok(reasons(adapt([artifact], { declarations: [declaration([artifact], { units: [unit('A', ['A'], { unsupportedMembers: [ref('opaque')] })] })] }))
    .includes('unsupported-native-unit-member'));
  const foreign = unit('A', ['A']); foreign.members.push(member('X', 'Other'));
  const result = adapt([artifact], { declarations: [declaration([artifact], { units: [foreign] })] });
  assert.ok(reasons(result).includes('unbound-native-unit-member'));
  assert.ok(reasons(result).includes('missing-component'));
});

test('nonempty Target requires retain-unlisted preservation and the current baseline', () => {
  const artifact = capture(['A']);
  const existing = preservation => unit('A', ['A'], { targetPrecondition: { mode: 'existing-target', evidenceRef: 'synthetic-target',
    requiredBaselineDigest: PROFILE.baselineDigest, ...(preservation ? { preservation } : {}) } });
  let result = adapt([artifact], { declarations: [declaration([artifact], { units: [existing()] })] });
  assert.ok(reasons(result).includes('unproven-target-preservation'));
  assert.ok(reasons(result).includes('unknown-target-precondition'));
  result = adapt([artifact], { declarations: [declaration([artifact], { units: [existing({ policy: 'replace', evidenceRef: 'x' })] })] });
  assert.ok(reasons(result).includes('unproven-target-preservation'));
  result = adapt([artifact], { declarations: [declaration([artifact], { units: [existing({ policy: 'retain-unlisted', evidenceRef: 'synthetic-preservation' })] })] });
  assert.equal(result.plan.planningComplete, true);
  assert.equal(result.plan.targetPreconditions[0].requiredBaselineDigest, PROFILE.baselineDigest);
  result = adapt([artifact], { targetProfile: { ...PROFILE, baselineDigest: 'drifted' },
    declarations: [declaration([artifact], { units: [existing({ policy: 'retain-unlisted', evidenceRef: 'synthetic-preservation' })] })] });
  assert.ok(reasons(result).includes('stale-target-baseline'));
});

test('duplicate providers across declarations block without choosing a winner', () => {
  const artifact = capture(['A']);
  const result = adapt([artifact], { declarations: [declaration([artifact]), declaration([artifact], { adapter: 'other' })] });
  assert.ok(result.adapterBlockers.some(row => row.reason === 'duplicate-native-provider' && row.kind === 'unit'));
  assert.ok(result.adapterBlockers.some(row => row.reason === 'duplicate-native-provider' && row.kind === 'component'));
  assert.ok(reasons(result).includes('ambiguous-native-import-unit') || reasons(result).includes('unsupported-native-import-unit'));
  assert.equal(result.wikiAccounting.planningComplete, false);
});

test('stale capture digest, stale profile and unpinned revisions are not admitted', () => {
  const artifact = capture(['A']);
  let result = adapt([artifact], { declarations: [declaration([{ ...artifact, checksum: 'older-capture' }])] });
  assert.ok(reasons(result).includes('stale-native-capture-binding'));
  assert.ok(reasons(result).includes('unknown-native-import-unit'));
  assert.equal(result.wikiAccounting.evidence, 'unknown');
  result = adapt([artifact], { targetProfile: { digest: 'other-profile' } });
  assert.ok(reasons(result).includes('stale-native-profile'));
  assert.ok(reasons(adapt([artifact], { declarations: [declaration([artifact], { nativeRevision: 'main' })] })).includes('unpinned-native-declaration'));
  assert.ok(reasons(adapt([{ ...artifact, checksum: undefined }])).includes('unbound-capture'));
  const stale = declaration([artifact]); stale.units[0].members[0].digest = 'old-digest';
  assert.ok(reasons(adapt([artifact], { declarations: [stale] })).includes('stale-native-unit-coverage'));
});

const server = (domains, extra = {}) => ({ coverage: 'complete', evidenceRef: 'synthetic-server', solutions: ['S'], requiredGlobalDomains: [], domains, ...extra });
const handled = domain => ({ domain, status: 'externally-provisioned',
  verification: { status: 'verified', evidenceRef: 'synthetic-verification', targetProfileDigest: PROFILE.digest } });

test('full-server completeness cannot pass with unknown globals or missing domain handling', () => {
  const artifact = capture(['A']);
  const serverAdapt = domains => adapt([artifact], { request: { kind: 'server' }, declarations: [declaration([artifact], { server: server(domains) })] });
  let result = serverAdapt(REQUIRED_GLOBAL_DOMAINS.map(handled));
  assert.equal(result.plan.planningComplete, true);
  assert.equal(result.nativeEvidence.complete, false);
  result = serverAdapt(REQUIRED_GLOBAL_DOMAINS.slice(1).map(handled));
  assert.ok(result.plan.blockers.some(row => row.reason === 'unknown-global-domain' && row.domain === REQUIRED_GLOBAL_DOMAINS[0]));
  const declaredOnly = [{ domain: REQUIRED_GLOBAL_DOMAINS[0], status: 'included', evidenceRef: 'synthetic-capture', members: [ref('A')] },
    ...REQUIRED_GLOBAL_DOMAINS.slice(1).map(handled)];
  result = serverAdapt(declaredOnly);
  assert.ok(result.plan.blockers.some(row => row.reason === 'unresolved-global-domain' && row.domain === REQUIRED_GLOBAL_DOMAINS[0]));
  assert.ok(result.nativeEvidence.missing.some(row => row.fact === 'global-domain-executable-handler' && row.domain === REQUIRED_GLOBAL_DOMAINS[0]));
  declaredOnly[0].handler = { status: 'executable', evidenceRef: 'synthetic-handler' };
  assert.equal(serverAdapt(declaredOnly).plan.planningComplete, true);
  const unverified = REQUIRED_GLOBAL_DOMAINS.map(handled); unverified[1].verification.targetProfileDigest = 'stale';
  assert.ok(serverAdapt(unverified).nativeEvidence.missing.some(row => row.fact === 'global-domain-verification'));
  result = serverAdapt([...REQUIRED_GLOBAL_DOMAINS.map(handled), { domain: 'native-extra', status: 'unknown' }]);
  assert.ok(result.plan.blockers.some(row => row.reason === 'unresolved-global-domain' && row.domain === 'native-extra'));
  assert.ok(reasons(adapt([artifact], { request: { kind: 'server' } })).includes('unknown-native-server-inventory'));
  const twice = adapt([artifact], { request: { kind: 'server' }, declarations: [declaration([artifact], { server: server(REQUIRED_GLOBAL_DOMAINS.map(handled)) }),
    declaration([artifact], { units: [], server: server(REQUIRED_GLOBAL_DOMAINS.map(handled)) })] });
  assert.ok(twice.adapterBlockers.some(row => row.reason === 'duplicate-native-provider' && row.kind === 'domain'));
  assert.equal(twice.plan.planningComplete, false);
});

test('adapter output is frozen, serializable, order-independent and leaves inputs untouched', () => {
  const artifact = capture(['A', 'B'], [dep('A', 'B')]);
  const doc = declaration([artifact]), before = JSON.stringify(doc);
  const result = adapt([artifact], { declarations: [doc] });
  assert.equal(JSON.stringify(doc), before);
  assert.throws(() => result.adapterBlockers.push({}), TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const reversed = structuredClone(doc); reversed.units.reverse();
  assert.deepEqual(adapt([artifact], { declarations: [reversed] }).plan, result.plan);
});

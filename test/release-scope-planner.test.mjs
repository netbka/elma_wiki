import test from 'node:test';
import assert from 'node:assert/strict';
import { planReleaseScope, REQUIRED_GLOBAL_DOMAINS } from '../lib/release-scope-planner.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { parseManagedArtifact } from '../lib/managed-workspace.mjs';
import { fixture } from './fixture.mjs';

const component = (code, extra = {}) => ({ key: JSON.stringify(['widgets', 'app', code]), service: 'widgets', namespace: 'app', code, digest: 'digest-' + code, ...extra });
const ref = (code, solution = 'S') => ({ solution, key: component(code).key });
const declaration = (from, to, extra = {}) => ({ category: 'dependencies', service: 'widgets', targetNamespace: 'app', targetCode: to,
  source: { service: 'widgets', namespace: 'app', code: from }, ...extra });
const artifact = (codes, deps = [], extra = {}) => ({ solution: 'S', scope: 'full', components: codes.map(code => component(code)), ambiguities: [], unclassifiedFiles: [],
  dependencies: dependencyReport(deps), ...extra });
const unit = (id, codes, solution = 'S') => ({ id, status: 'supported', adapter: 'synthetic-v1', evidenceRef: 'synthetic-unit-contract',
  targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target', targetProfileDigest: 'synthetic-profile' },
  members: codes.map(code => ({ ...ref(code, solution), digest: component(code).digest })) });
const plan = (capture, extra = {}) => planReleaseScope({ request: { kind: 'solution', solution: 'S' }, artifacts: [capture],
  importUnits: capture.components.map(row => unit(row.code, [row.code])), ...extra });
const reasons = result => result.blockers.map(row => row.reason);
const codes = rows => rows.map(row => JSON.parse(row.key).at(-1));

test('dependency diamond deduplicates closure and orders dependencies before consumers', () => {
  const capture = artifact(['A', 'B', 'C', 'D'], [declaration('A', 'B'), declaration('A', 'C'), declaration('B', 'D'), declaration('C', 'D')]);
  const result = plan(capture, { request: { kind: 'application', solution: 'S', applicationId: 'app' },
    applications: [{ id: 'app', solution: 'S', coverage: 'complete', evidenceRef: 'synthetic-membership', members: [ref('A')] }] });
  assert.deepEqual(codes(result.requiredComponents), ['A', 'B', 'C', 'D']);
  assert.deepEqual(codes(result.dependencyOrder), ['D', 'B', 'C', 'A']);
  assert.equal(result.planningComplete, true);
  assert.equal(result.publicationReady, false);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(codes(result.requestedComponents), ['A']);
});

test('cross-unit cycles and self references outside an admitted unit block and never receive an invented order', () => {
  const stale = unit('A', ['A']); stale.members[0].digest = 'old-digest';
  for (const [deps, importUnits] of [[[declaration('A', 'B'), declaration('B', 'A')], undefined],
    [[declaration('A', 'A')], [stale, unit('B', ['B'])]], [[declaration('A', 'A')], [{ ...unit('A', ['A']), status: 'unknown' }, unit('B', ['B'])]]]) {
    const result = plan(artifact(['A', 'B'], deps), importUnits ? { importUnits } : {});
    assert.ok(reasons(result).includes('dependency-cycle'));
    assert.equal(result.dependencyOrder, null);
    assert.equal(result.dependencyStages, null);
    assert.deepEqual(result.internalDependencyGroups, []);
    assert.equal(result.planningComplete, false);
  }
  const cross = plan(artifact(['A', 'B'], [declaration('A', 'B'), declaration('B', 'A')]));
  assert.deepEqual(cross.blockers.find(row => row.reason === 'dependency-cycle').unitIds, ['A', 'B']);
  assert.equal(cross.nativeImportOrder, null);
});

// A cycle inside one supported, complete, digest-current whole-Solution unit, as the
// native adapter derives `package:<solution>`, is imported as that unit.
const packageCycle = () => artifact(['A', 'B', 'C', 'D', 'E'], [declaration('A', 'B'), declaration('B', 'A'), declaration('B', 'C'),
  declaration('D', 'A'), declaration('A', 'E')]);
const packageUnits = () => [unit('package:S', ['A', 'B', 'C', 'D']), unit('base', ['E'])];

test('a cycle wholly inside one admitted native unit is a package-internal group without an invented component order', () => {
  const capture = packageCycle(), importUnits = packageUnits(), before = JSON.stringify({ capture, importUnits });
  const result = plan(capture, { importUnits });
  assert.equal(JSON.stringify({ capture, importUnits }), before);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.planningComplete, true);
  assert.equal(result.publicationReady, false);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.internalDependencyGroups, [{ unitId: 'package:S', components: [ref('A'), ref('B')] }]);
  assert.equal(result.dependencyOrder, null);
  assert.deepEqual(result.dependencyStages, [{ kind: 'component', component: ref('C') }, { kind: 'component', component: ref('E') },
    { kind: 'package-internal-group', unitId: 'package:S', components: [ref('A'), ref('B')] }, { kind: 'component', component: ref('D') }]);
  assert.deepEqual(result.nativeImportOrder, ['base', 'package:S']);
  assert.ok(result.limitations.some(row => row.includes('no component order')));
  assert.throws(() => result.internalDependencyGroups.push({}), TypeError);
  const reversed = structuredClone(capture); reversed.components.reverse(); reversed.dependencies.rows.reverse();
  const reorderedUnits = packageUnits().reverse(); reorderedUnits.forEach(row => row.members.reverse());
  assert.deepEqual(plan(reversed, { importUnits: reorderedUnits }), result);
  // Acyclic plans keep their total order and expose one stage per component.
  const acyclic = plan(artifact(['A', 'B'], [declaration('A', 'B')]));
  assert.deepEqual(codes(acyclic.dependencyOrder), ['B', 'A']);
  assert.deepEqual(acyclic.dependencyStages.map(row => row.kind), ['component', 'component']);
  assert.deepEqual(acyclic.internalDependencyGroups, []);
  const self = plan(artifact(['A'], [declaration('A', 'A')]));
  assert.equal(self.planningComplete, true);
  assert.deepEqual(self.internalDependencyGroups, [{ unitId: 'A', components: [ref('A')] }]);
  assert.equal(self.dependencyOrder, null);
});

test('a package-internal cycle stays blocked unless its unit is uniquely, completely and currently covered', () => {
  const mutations = {
    stale: units => { units[0].members.find(row => row.key === ref('C').key).digest = 'old-digest'; },
    unsupported: units => { units[0].status = 'unsupported'; },
    unadapted: units => { delete units[0].adapter; },
    incomplete: units => { units[0].members.push({ ...ref('absent'), digest: 'digest-absent' }); },
    invalid: units => { units[0].members.push(units[0].members[0]); },
    duplicateUnit: units => { units.push(structuredClone(units[0])); },
    ambiguousMember: units => { units.push(unit('other', ['B'])); },
    ambiguousSibling: units => { units.push(unit('other', ['C'])); },
    uncoveredMember: units => { units[0].members = units[0].members.filter(row => row.key !== ref('B').key); },
    crossUnit: units => { units[0].members = units[0].members.filter(row => row.key !== ref('B').key); units.push(unit('split', ['B'])); }
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const importUnits = packageUnits(); mutate(importUnits);
    const result = plan(packageCycle(), { importUnits });
    const cycle = result.blockers.find(row => row.reason === 'dependency-cycle');
    assert.deepEqual(cycle?.components, [ref('A'), ref('B')], name);
    assert.deepEqual(result.internalDependencyGroups, [], name);
    assert.equal(result.dependencyOrder, null, name);
    assert.equal(result.dependencyStages, null, name);
    assert.equal(result.nativeImportOrder, null, name);
    assert.equal(result.planningComplete, false, name);
  }
});

test('an admitted internal group does not waive Target, coupled-unit or other coverage gates', () => {
  let importUnits = packageUnits(); delete importUnits[0].targetPrecondition;
  let result = plan(packageCycle(), { importUnits });
  assert.equal(result.internalDependencyGroups.length, 1);
  assert.deepEqual(reasons(result), ['unknown-target-precondition']);
  assert.equal(result.planningComplete, false);
  importUnits = packageUnits(); importUnits[1].targetPrecondition.targetProfileDigest = 'different-target';
  assert.deepEqual(reasons(plan(packageCycle(), { importUnits })), ['inconsistent-target-profile']);
  // E in another unit also depends back on the package: the units, not the components, cycle.
  const coupled = packageCycle(); coupled.dependencies = dependencyReport([...coupled.dependencies.rows, declaration('E', 'C')]);
  result = plan(coupled, { importUnits: packageUnits() });
  assert.ok(reasons(result).includes('native-import-unit-cycle'));
  assert.equal(reasons(result).includes('dependency-cycle'), false);
  assert.equal(result.nativeImportOrder, null);
  const partial = plan({ ...packageCycle(), scope: 'partial', unclassifiedFiles: [{ path: 'opaque' }] }, { importUnits: packageUnits() });
  assert.ok(reasons(partial).includes('incomplete-solution-inventory'));
  assert.ok(reasons(partial).includes('incomplete-capture'));
  assert.equal(partial.planningComplete, false);
});

test('missing, paid, system and unknown-schema prerequisites block without catalog entitlement', () => {
  const capture = artifact(['A'], [declaration('A', 'missing'), declaration('A', 'system', { category: 'sysDependencies' }),
    declaration('A', 'paid'), declaration('A', null)]);
  capture.dependencies.rows.find(row => row.targetCode === 'paid').status = 'paid-source-unavailable';
  capture.dependencies.rows.find(row => row.targetCode === 'paid').candidates = [{ code: 'vendor', paid: true, version: '1' }];
  const result = plan(capture);
  assert.equal(result.prerequisites.length, 3);
  assert.ok(result.prerequisites.some(row => row.code === 'system'));
  assert.ok(result.prerequisites.some(row => row.status === 'paid-source-unavailable'));
  assert.ok(reasons(result).includes('unknown-reference-identity'));
  assert.ok(reasons(result).includes('missing-reference'));
  assert.equal(result.publicationReady, false);
});

test('optional references are explicitly excluded; unknown categories and incomplete sources block', () => {
  const result = plan(artifact(['A'], [declaration('A', 'optional', { category: 'optionalDependencies' }),
    declaration('A', 'A', { category: 'new-category' }), declaration('A', 'unknown', { source: { namespace: 'app' } })]));
  assert.equal(result.optionalReferences[0].code, 'optional');
  assert.ok(reasons(result).includes('unknown-dependency-category'));
  assert.ok(reasons(result).includes('unknown-reference-source'));
  assert.equal(result.prerequisites.some(row => row.code === 'optional'), false);
});

test('same reference in multiple Solutions or duplicate captured components is ambiguous', () => {
  const capture = artifact(['A', 'B'], [declaration('A', 'B')]);
  const other = artifact(['B'], [], { solution: 'Other' });
  const result = plan(capture, { artifacts: [capture, other] });
  assert.ok(reasons(result).includes('ambiguous-reference'));
  assert.ok(reasons(plan(capture, { artifacts: [capture, capture] })).includes('ambiguous-solution-capture'));
  const duplicate = artifact(['A', 'A']);
  assert.ok(reasons(plan(duplicate)).includes('ambiguous-component'));
});

test('native unit expansion reaches sibling dependencies and discloses part expansion', () => {
  const capture = artifact(['A', 'B', 'C'], [declaration('B', 'C')]);
  capture.components[0].structure = { version: 1, elements: [{ id: 'node-1' }], ambiguities: [] };
  const result = plan(capture, { request: { kind: 'part', component: ref('A'), partId: 'node-1' }, importUnits: [unit('app-package', ['A', 'B']), unit('C', ['C'])] });
  assert.deepEqual(codes(result.requiredComponents), ['A', 'B', 'C']);
  assert.ok(result.expansions.some(row => row.reason === 'part-to-component'));
  assert.ok(result.expansions.some(row => row.reason === 'native-import-unit' && row.component.key === component('B').key));
  assert.ok(result.expansions.some(row => row.reason === 'dependency' && row.component.key === component('C').key));
  assert.equal(result.planningComplete, true);
});

test('unknown part/application/Solution and partial Solution inventories are blocked', () => {
  const capture = artifact(['A']);
  assert.ok(reasons(plan(capture, { request: { kind: 'part', component: ref('A'), partId: 'invented' } })).includes('unknown-part-identity'));
  assert.ok(reasons(plan(capture, { request: { kind: 'application', solution: 'S', applicationId: 'app' } })).includes('unknown-application'));
  assert.ok(reasons(plan(capture, { request: { kind: 'solution', solution: 'unknown' } })).includes('missing-solution'));
  assert.ok(reasons(plan({ ...capture, scope: 'partial' })).includes('incomplete-solution-inventory'));
  assert.throws(() => plan(capture, { request: null }), /Explicit release scope/);
});

test('unknown, unsupported, ambiguous and stale native import units are blockers', () => {
  const capture = artifact(['A']);
  assert.ok(reasons(plan(capture, { importUnits: [] })).includes('unknown-native-import-unit'));
  assert.ok(reasons(plan(capture, { importUnits: [unit('one', ['A']), unit('two', ['A'])] })).includes('ambiguous-native-import-unit'));
  assert.ok(reasons(plan(capture, { importUnits: [{ ...unit('one', ['A']), status: 'unknown' }] })).includes('unsupported-native-import-unit'));
  const stale = unit('one', ['A']); stale.members[0].digest = 'old-digest';
  assert.ok(reasons(plan(capture, { importUnits: [stale] })).includes('stale-native-unit-coverage'));
  assert.ok(reasons(plan(capture, { importUnits: [unit('one', ['A', 'absent'])] })).includes('missing-component'));
});

const serverInventory = () => ({ coverage: 'complete', evidenceRef: 'synthetic-server-inventory', solutions: ['S'], targetProfileDigest: 'synthetic-profile',
  requiredGlobalDomains: [], globalDomains: REQUIRED_GLOBAL_DOMAINS.map(domain => ({ domain, status: 'externally-provisioned-and-verified',
    evidenceRef: 'synthetic-native-observation', adapter: 'synthetic-domain-adapter', targetProfileDigest: 'synthetic-profile' })) });

test('all-Solutions inspection bundle cannot satisfy server/global coverage', () => {
  const result = plan(artifact(['A']), { request: { kind: 'server' }, serverInventory: { solutions: ['S'] } });
  assert.ok(reasons(result).includes('unknown-server-inventory'));
  assert.equal(result.blockers.filter(row => row.reason === 'unknown-global-domain').length, REQUIRED_GLOBAL_DOMAINS.length);
});

test('server covers included and externally verified global domains and extra native domains', () => {
  const inventory = serverInventory();
  inventory.globalDomains[0] = { domain: REQUIRED_GLOBAL_DOMAINS[0], status: 'included', evidenceRef: 'synthetic-capture', members: [ref('A')] };
  inventory.requiredGlobalDomains = ['native-extra'];
  let result = plan(artifact(['A']), { request: { kind: 'server' }, serverInventory: inventory });
  assert.ok(result.blockers.some(row => row.reason === 'unknown-global-domain' && row.domain === 'native-extra'));
  inventory.globalDomains.push({ ...inventory.globalDomains[1], domain: 'native-extra' });
  result = plan(artifact(['A']), { request: { kind: 'server' }, serverInventory: inventory });
  assert.equal(result.planningComplete, true);
  assert.equal(result.prerequisites.length, REQUIRED_GLOBAL_DOMAINS.length);
  assert.equal(result.publicationReady, false);
});

test('global unresolved, duplicate, unverified or mismatched Target profile cannot pass', () => {
  for (const mutate of [inventory => { inventory.globalDomains[0].status = 'unresolved'; },
    inventory => { inventory.globalDomains[0].targetProfileDigest = 'other'; },
    inventory => { inventory.globalDomains[0].evidenceRef = ''; },
    inventory => { inventory.globalDomains.push(inventory.globalDomains[0]); }]) {
    const inventory = serverInventory(); mutate(inventory);
    assert.equal(plan(artifact(['A']), { request: { kind: 'server' }, serverInventory: inventory }).planningComplete, false);
  }
});

test('planner is immutable, serializable and independent of inventory order', () => {
  const capture = artifact(['A', 'B', 'C'], [declaration('A', 'B'), declaration('B', 'C')]);
  const before = JSON.stringify(capture), result = plan(capture);
  assert.equal(JSON.stringify(capture), before);
  assert.throws(() => result.requiredComponents.push(ref('X')), TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const reversed = structuredClone(capture); reversed.components.reverse(); reversed.dependencies.rows.reverse();
  assert.deepEqual(plan(reversed, { importUnits: reversed.components.map(row => unit(row.code, [row.code])).reverse() }), result);
});

test('coupled native packages can cycle even with acyclic component references', () => {
  const capture = artifact(['A', 'B', 'C', 'D'], [declaration('A', 'B'), declaration('C', 'D')]);
  const result = plan(capture, { importUnits: [unit('left', ['A', 'D']), unit('right', ['B', 'C'])] });
  assert.ok(reasons(result).includes('native-import-unit-cycle'));
  assert.equal(reasons(result).includes('dependency-cycle'), false);
  assert.equal(result.nativeImportOrder, null);
});

test('nonempty Target requires pinned baseline/profile evidence; mixed profiles block', () => {
  const capture = artifact(['A', 'B']);
  const a = unit('A', ['A']), b = unit('B', ['B']);
  delete a.targetPrecondition;
  assert.ok(reasons(plan(capture, { importUnits: [a, b] })).includes('unknown-target-precondition'));
  a.targetPrecondition = { mode: 'existing-target', evidenceRef: 'synthetic-baseline', targetProfileDigest: 'synthetic-profile' };
  assert.ok(reasons(plan(capture, { importUnits: [a, b] })).includes('unknown-target-precondition'));
  a.targetPrecondition.requiredBaselineDigest = 'synthetic-baseline-digest';
  assert.equal(plan(capture, { importUnits: [a, b] }).planningComplete, true);
  b.targetPrecondition.targetProfileDigest = 'different-target';
  assert.ok(reasons(plan(capture, { importUnits: [a, b] })).includes('inconsistent-target-profile'));
});

test('unclassified/opaque bytes and absent dependency inventory cannot disappear into coverage', () => {
  const capture = artifact(['A']);
  capture.unclassifiedFiles = [{ path: 'unknown-native-bytes' }];
  delete capture.dependencies;
  const result = plan(capture);
  assert.ok(reasons(result).includes('incomplete-capture'));
  assert.ok(reasons(result).includes('unknown-dependency-inventory'));
});

test('duplicate native-unit members and unknown source identities are blockers', () => {
  const capture = artifact(['A'], [declaration('not-captured', 'A')]);
  const nativeUnit = unit('A', ['A']); nativeUnit.members.push(nativeUnit.members[0]);
  const result = plan(capture, { importUnits: [nativeUnit] });
  assert.ok(reasons(result).includes('invalid-native-unit-coverage'));
  assert.ok(reasons(result).includes('unknown-reference-source'));
});

test('server accounts for additional observed global domains even outside the named requirement list', () => {
  const inventory = serverInventory(); inventory.globalDomains.push({ domain: 'observed-extra', status: 'unknown' });
  const result = plan(artifact(['A']), { request: { kind: 'server' }, serverInventory: inventory });
  assert.ok(result.blockers.some(row => row.domain === 'observed-extra' && row.reason === 'unresolved-global-domain'));
});

test('closure crosses captured Solutions while retaining exact qualified component identities', () => {
  const capture = artifact(['A'], [declaration('A', 'B')]), other = artifact(['B'], [], { solution: 'Other' });
  const result = plan(capture, { artifacts: [capture, other], importUnits: [unit('A', ['A']), unit('B', ['B'], 'Other')] });
  assert.equal(result.planningComplete, true);
  assert.ok(result.requiredComponents.some(row => row.solution === 'Other'));
  assert.deepEqual(result.nativeImportOrder, ['B', 'A']);
});

test('readable paid source and supported import declarations do not establish licensed prerequisites', () => {
  const capture = artifact(['A', 'B'], [declaration('A', 'B')]);
  capture.dependencies.rows[0].candidates = [{ code: 'vendor', version: '1', paid: true }];
  const result = plan(capture);
  assert.ok(reasons(result).includes('unverified-licensed-prerequisite'));
  assert.ok(result.prerequisites.some(row => row.status === 'license-not-verified'));
  assert.equal(result.planningComplete, false);
});

test('closure and disclosed expansions are deterministic across coupled-unit/dependency reordering', () => {
  const capture = artifact(['A', 'B', 'C', 'D'], [declaration('A', 'C'), declaration('B', 'D')]);
  capture.components[0].structure = { version: 1, elements: [{ id: 'node-1' }], ambiguities: [] };
  const options = { request: { kind: 'part', component: ref('A'), partId: 'node-1' }, importUnits: [unit('AB', ['A', 'B']), unit('CD', ['C', 'D'])] };
  const expected = plan(capture, options);
  capture.components.reverse(); capture.dependencies.rows.reverse(); options.importUnits.reverse();
  options.importUnits.forEach(row => row.members.reverse());
  assert.deepEqual(plan(capture, options), expected);
});

test('real parser captures are consumed directly; absent native metadata stays unknown', async () => {
  const capture = await parseManagedArtifact(await fixture(), { scope: 'full' });
  const result = planReleaseScope({ request: { kind: 'solution', solution: capture.solution }, artifacts: [capture] });
  assert.ok(result.requiredComponents.length > 0);
  assert.ok(reasons(result).includes('unknown-native-import-unit'));
  assert.equal(result.publicationReady, false);
});

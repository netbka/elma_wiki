import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { planManagedComponentMerge, assertCurrentManagedMergePlan } from '../lib/managed-workspace.mjs';
import { projectStore } from '../lib/projects.mjs';
import { zip } from './fixture.mjs';

// Synthetic B/A/C fixtures: A and C are both prepared against the same accepted
// full base B; A is accepted first, then C is planned against the current state.
const owner = 'synthetic-owner', actor = { id: 'declaring-actor', login: 'synthetic@example.org', provider: 'local' };
const archive = (rows, extra = []) => zip([
  ['package.json', { code: 'synthetic_merge', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: rows.map(([code, , file = code + '.json']) => ({ code, namespace: 'synthetic', kind: 'WIDGET', path: file })) }],
  ...rows.map(([code, value, file = code + '.json']) => ['widgets/' + file, { descriptor: { clientScripts: `const value = ${JSON.stringify(value)};` } }]),
  ...extra
]);
async function setup(t, rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-merge-plan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (rows, scope, extra) => {
    const project = await projects.create(owner, await archive(rows, extra));
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await store.create(owner, { name: 'Synthetic merge', baselineOwner: 'Base', snapshot: await upload(rows, 'full') }, actor);
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const key = code => state.current.find(row => row.code === code).key;
  const scope = (codes, deleted = []) => ({ name: 'Synthetic scope', members: codes.map(key), confirmed: true,
    deletions: deleted.map(code => ({ key: key(code), baseDigest: state.current.find(row => row.code === code).digest, confirmed: true })) });
  const prepare = async (rows, team, extra = {}, files) => store.prepare(state.id, owner, { kind: 'change',
    snapshot: await upload(rows, 'partial', files), expectedRevision: state.revision, team, taskRef: 'SYNTHETIC-' + team,
    sameSourceConfirmed: true, ...extra }, actor);
  const accept = review => store.accept(state.id, owner, review.artifactId, { expectedRevision: review.revision,
    reviewedDigest: review.artifactDigest, reviewedBoundaryKeys: review.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, actor);
  const artifact = review => store.artifact(state.id, owner, review.artifactId);
  return { store, state, base, key, scope, prepare, accept, artifact };
}
const byCode = plan => Object.fromEntries(plan.rows.map(row => [row.code, row]));
const summary = plan => Object.fromEntries(plan.rows.map(row => [row.code, [row.classification, row.status, row.proposal]]));

test('one-sided, identical and divergent edits bind exact B/A/C inputs and keep partial absence unchanged', async t => {
  const { state, base, scope, prepare, accept, artifact, store } = await setup(t,
    [['same', 0], ['aonly', 0], ['conly', 0], ['ident', 0], ['div', 0], ['untouched', 0]]);
  const a = await prepare([['aonly', 1], ['ident', 1], ['div', 1]], 'A', { base, changeScope: scope(['aonly', 'ident', 'div']) });
  const c = await prepare([['same', 0], ['conly', 2], ['ident', 1], ['div', 2]], 'C',
    { base, changeScope: scope(['same', 'conly', 'ident', 'div', 'untouched']) });
  const current = await accept(a), incoming = await artifact(c), before = JSON.stringify(current);
  const plan = planManagedComponentMerge(current, incoming);
  assert.deepEqual(summary(plan), {
    same: ['unchanged', 'clear', 'keep-current'], aonly: ['current-only', 'clear', 'keep-current'],
    conly: ['incoming-only', 'clear', 'take-incoming'], ident: ['identical', 'clear', 'keep-current'],
    div: ['divergent', 'resolution-required', null], untouched: ['unchanged', 'clear', 'keep-current'] });
  assert.equal(plan.status, 'resolution-required'); assert.deepEqual(plan.blockers, []);
  assert.equal(byCode(plan).untouched.incomingChange, 'no-claim');
  assert.equal(byCode(plan).untouched.incoming, null);
  // Exact revisions/digests of every input are bound into the frozen output.
  assert.deepEqual(plan.inputs.base, { status: 'declared', artifactId: state.baselineId, revision: 0,
    checksum: state.artifacts[0].checksum, artifactDigest: plan.inputs.base.artifactDigest, declaration: incoming.baseDeclaration });
  assert.equal(plan.inputs.current.revision, current.revision); assert.equal(plan.inputs.current.workspaceId, state.id);
  assert.equal(plan.inputs.incoming.artifactId, c.artifactId); assert.equal(plan.inputs.incoming.checksum, incoming.checksum);
  assert.equal(plan.inputs.incoming.artifactDigest, c.artifactDigest);
  assert.equal(plan.inputs.incoming.changeScope.status, 'declared');
  // Both contributions and their original source evidence are retained.
  const div = byCode(plan).div;
  assert.equal(div.current.interventionId, a.artifactId); assert.equal(div.current.team, 'A');
  assert.equal(div.incoming.artifactId, c.artifactId); assert.notEqual(div.current.digest, div.incoming.digest);
  assert.deepEqual(div.base.evidence, state.current.find(row => row.code === 'div').evidence);
  assert.ok(div.incoming.evidence.every(row => row.source && /^[0-9a-f]{64}$/.test(row.sha256)));
  for (const flag of ['ancestryVerified', 'automaticMergeEnabled', 'acceptanceEnabled', 'buildEnabled']) assert.equal(plan[flag], false);
  assert.equal(plan.inputs.base.declaration.ancestryVerified, false);
  // Deterministic, frozen and pure.
  assert.deepEqual(planManagedComponentMerge(current, incoming), plan);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.rows[0]));
  assert.equal(JSON.stringify(current), before);
  assert.equal(assertCurrentManagedMergePlan(plan, current, incoming), plan);
  // Changed input invalidates the plan.
  const later = await accept(await prepare([['untouched', 3]], 'D', { expectedRevision: current.revision }));
  assert.throws(() => assertCurrentManagedMergePlan(plan, later, incoming), error => error.statusCode === 409);
  const forged = structuredClone(incoming); forged.components[0].digest = 'f'.repeat(64);
  assert.throws(() => assertCurrentManagedMergePlan(plan, current, forged), /evidence changed/);
  const edited = structuredClone(plan); edited.rows[4].proposal = 'take-incoming';
  assert.throws(() => assertCurrentManagedMergePlan(edited, current, incoming), /inputs changed/);
  const rebased = structuredClone(incoming); rebased.baseDeclaration.checksum = 'wrong';
  assert.throws(() => planManagedComponentMerge(current, rebased), /Declared base evidence changed/);
  const rescoped = structuredClone(incoming); rescoped.changeScopeDeclaration.name = 'Different';
  assert.throws(() => assertCurrentManagedMergePlan(plan, current, rescoped), /inputs changed/);
  const tampered = structuredClone(incoming); tampered.changeScopeDeclaration.members[0].baseEvidence = [];
  assert.throws(() => planManagedComponentMerge(current, tampered), /Change scope evidence changed/);
  assert.equal((await store.get(state.id, owner)).revision, later.revision);
});

test('additions classify current, incoming, identical and divergent sides', async t => {
  const { base, prepare, accept, artifact } = await setup(t, [['a', 0]]);
  const a = await prepare([['x', 1], ['y', 1], ['w', 1]], 'A', { base });
  const c = await prepare([['y', 1], ['z', 2], ['w', 2]], 'C', { base });
  const plan = planManagedComponentMerge(await accept(a), await artifact(c));
  assert.deepEqual(summary(plan), { a: ['unchanged', 'clear', 'keep-current'],
    w: ['addition-divergent', 'resolution-required', null], x: ['addition-current', 'clear', 'keep-current'],
    y: ['addition-identical', 'clear', 'keep-current'], z: ['addition-incoming', 'clear', 'take-incoming'] });
  assert.equal(byCode(plan).w.base, null);
  assert.equal(plan.inputs.incoming.changeScope.status, 'unknown');
});

test('validated tombstones classify delete/edit, edit/delete, one-sided and identical deletions', async t => {
  const { base, scope, prepare, accept, artifact } = await setup(t, [['a', 0], ['b', 0], ['c', 0], ['d', 0], ['keep', 0]]);
  const a = await prepare([['a', 1]], 'A', { base, changeScope: scope(['a', 'b', 'd'], ['b', 'd']) });
  const c = await prepare([['b', 2]], 'C', { base, changeScope: scope(['a', 'b', 'c', 'd'], ['a', 'c', 'd']) });
  const plan = planManagedComponentMerge(await accept(a), await artifact(c));
  assert.deepEqual(summary(plan), { a: ['delete-edit', 'resolution-required', null], b: ['edit-delete', 'resolution-required', null],
    c: ['delete-incoming', 'clear', 'remove'], d: ['delete-identical', 'clear', 'keep-current'], keep: ['unchanged', 'clear', 'keep-current'] });
  assert.deepEqual(byCode(plan).a.incoming.tombstone, { baseDigest: byCode(plan).a.base.digest });
  assert.equal(byCode(plan).a.current.team, 'A');
  assert.equal(byCode(plan).b.current, null);
});

test('unknown base, rename uncertainty, duplicate identity and unknown bytes stay blocked and retained', async t => {
  const { base, key, scope, prepare, artifact, state } = await setup(t, [['a', 0], ['b', 0]]);
  const unknown = planManagedComponentMerge(state, await artifact(await prepare([['a', 1]], 'C')));
  assert.equal(unknown.status, 'blocked'); assert.deepEqual(unknown.rows, []);
  assert.deepEqual(unknown.blockers, [{ reason: 'unknown-base', method: 'not-declared' }]);
  assert.equal(unknown.inputs.base.status, 'unknown');

  // Removing a and adding a2 with identical content may be a rename; it is never matched.
  const a2 = JSON.stringify([...JSON.parse(key('a')).slice(0, -1), 'a2']);
  const renamed = planManagedComponentMerge(state, await artifact(await prepare([['a2', 0]], 'C',
    { base, changeScope: { ...scope(['a'], ['a']), members: [key('a'), a2] } })));
  assert.equal(renamed.status, 'blocked');
  assert.ok(renamed.blockers.some(row => row.reason === 'rename-uncertain'));
  assert.deepEqual(renamed.rows.filter(row => row.status === 'blocked').map(row => row.code).sort(), ['a', 'a2']);
  assert.ok(renamed.rows.filter(row => row.status === 'blocked').every(row => row.proposal === null));

  const duplicate = await artifact(await prepare([['a', 1], ['a', 2, 'other.json']], 'C', { base }, [['extra/unknown.bin', 'opaque']]));
  const plan = planManagedComponentMerge(state, duplicate);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.blockers.some(row => row.reason === 'incoming-ambiguity'));
  assert.deepEqual(byCode(plan).a.blockers, ['duplicate-identity']);
  assert.equal(byCode(plan).a.incomingChange, 'no-claim');
  assert.deepEqual(plan.unknown.incoming.ambiguities, duplicate.ambiguities);
  assert.ok(plan.unknown.incoming.unclassifiedFiles.some(row => row.path === 'extra/unknown.bin'));
});

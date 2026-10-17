import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { planManagedComponentMerge, resolveManagedMerge, assertCurrentManagedResolution, managedResolutionStatus,
  acceptManagedChange, previewManagedChange } from '../lib/managed-workspace.mjs';
import { projectStore } from '../lib/projects.mjs';
import { zip } from './fixture.mjs';

// Synthetic B/A/C fixtures: A and C are prepared against the same accepted full
// base B; A is accepted first, then C is resolved against the current state.
const owner = 'synthetic-owner';
const actor = { id: 'resolver', login: 'resolver@example.org', provider: 'local' };
const other = { id: 'second-resolver', login: 'second@example.org', provider: 'local' };
const archive = rows => zip([
  ['package.json', { code: 'synthetic_merge', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: rows.map(([code]) => ({ code, namespace: 'synthetic', kind: 'WIDGET', path: code + '.json' })) }],
  ...rows.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
async function setup(t, rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-merge-resolution-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (rows, scope) => {
    const project = await projects.create(owner, await archive(rows));
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await store.create(owner, { name: 'Synthetic merge', baselineOwner: 'Base', snapshot: await upload(rows, 'full') }, actor);
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const key = code => state.current.find(row => row.code === code).key;
  const scope = (codes, deleted = []) => ({ name: 'Synthetic scope', members: codes.map(key), confirmed: true,
    deletions: deleted.map(code => ({ key: key(code), baseDigest: state.current.find(row => row.code === code).digest, confirmed: true })) });
  const prepare = async (rows, team, extra = {}) => store.prepare(state.id, owner, { kind: 'change',
    snapshot: await upload(rows, 'partial'), expectedRevision: state.revision, team, taskRef: 'SYNTHETIC-' + team,
    sameSourceConfirmed: true, base, ...extra }, actor);
  const accept = review => store.accept(state.id, owner, review.artifactId, { expectedRevision: review.revision,
    reviewedDigest: review.artifactDigest, reviewedBoundaryKeys: review.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, actor);
  return { directory, projects, store, state, key, scope, prepare, accept };
}
const byCode = rows => Object.fromEntries(rows.map(row => [JSON.parse(row.key).at(-1), row]));
const input = (merge, revision, decisions, extra = {}) => ({ expectedRevision: revision, planDigest: merge.plan.planDigest,
  expectedResolutionId: merge.head?.id ?? null, decisions, reason: 'Synthetic reviewed choice', ...extra });

test('resolution persists actor, reason and exact B/A/C references while preserving untouched content', async t => {
  const { store, state, key, scope, prepare, accept, directory, projects } = await setup(t,
    [['div', 0], ['aonly', 0], ['conly', 0], ['untouched', 0], ['outside', 0]]);
  const a = await prepare([['div', 1], ['aonly', 1]], 'A', { changeScope: scope(['div', 'aonly']) });
  const c = await prepare([['div', 2], ['conly', 2]], 'C', { changeScope: scope(['div', 'conly', 'untouched']) });
  const current = await accept(a);
  const merge = await store.merge(state.id, owner, c.artifactId);
  assert.equal(merge.available, true); assert.equal(merge.plan.status, 'resolution-required'); assert.equal(merge.head, null);
  assert.deepEqual(merge.choices.divergent, ['keep-current', 'take-incoming']);
  // The stale pending review exposes the same plan without enabling acceptance.
  const review = await store.review(state.id, owner, c.artifactId);
  assert.equal(review.stale, true); assert.equal(review.merge.plan.planDigest, merge.plan.planDigest);

  // No default: an omitted, unknown or unsupported choice is rejected.
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, {}), actor), error => error.statusCode === 422);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'remove' }), actor), error => error.statusCode === 422);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming', [key('conly')]: 'keep-current' }), actor), error => error.statusCode === 409);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming' }, { reason: ' ' }), actor), /reason/);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming' })), error => error.statusCode === 401);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, { ...input(merge, current.revision, { [key('div')]: 'take-incoming' }), actor: other }, actor), /Invalid/);

  const resolved = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming' }), actor);
  const head = resolved.head;
  assert.equal(head.status, 'current'); assert.equal(head.sequence, 1); assert.equal(head.parentId, null);
  assert.deepEqual(head.actor, actor); assert.equal(head.reason, 'Synthetic reviewed choice');
  assert.equal(head.planDigest, merge.plan.planDigest); assert.deepEqual(head.inputs, merge.plan.inputs);
  assert.equal(head.inputs.base.artifactId, state.baselineId); assert.equal(head.inputs.current.revision, current.revision);
  assert.equal(head.inputs.incoming.artifactId, c.artifactId);
  assert.deepEqual(head.decisions, [{ key: key('div'), classification: 'divergent', choice: 'take-incoming' }]);
  const result = byCode(head.result);
  assert.deepEqual([result.div.source, result.div.artifactId, result.div.decided], ['incoming', c.artifactId, true]);
  assert.equal(result.div.digest, byCode(merge.plan.rows).div.incoming.digest);
  assert.deepEqual([result.aonly.source, result.aonly.interventionId, result.aonly.decided], ['current', a.artifactId, false]);
  assert.deepEqual([result.conly.source, result.conly.choice], ['incoming', 'take-incoming']);
  // Scoped-but-absent and out-of-scope components keep the current accepted digest.
  for (const code of ['untouched', 'outside']) {
    assert.deepEqual([result[code].source, result[code].choice, result[code].digest],
      ['current', 'keep-current', current.current.find(row => row.code === code).digest]);
  }
  for (const flag of ['ancestryVerified', 'automaticMergeEnabled', 'acceptanceEnabled', 'buildEnabled', 'materialized']) assert.equal(head[flag], false);
  // A resolution is a side record: no workspace mutation, acceptance or bytes.
  const after = await store.get(state.id, owner);
  assert.equal(after.revision, current.revision); assert.deepEqual(after.current, current.current);
  assert.equal(after.audit.at(-1).action, 'merge-resolved'); assert.equal(after.audit.at(-1).actor.id, actor.id);
  assert.deepEqual((await fs.readdir(path.join(directory, 'managed-workspaces', state.id))).filter(file => !file.endsWith('.e365')), ['workspace.json']);

  // Restart reads the committed immutable revision unchanged.
  const restarted = managedWorkspaceStore(directory, projects);
  assert.deepEqual((await restarted.merge(state.id, owner, c.artifactId)).head, head);

  // A replay against the consumed head and a successor that does not name it fail.
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'keep-current' }), actor), /Another resolution/);
  const second = await store.resolveMerge(state.id, owner, c.artifactId, input(resolved, current.revision, { [key('div')]: 'keep-current' }, { reason: 'Revised' }), other);
  assert.equal(second.head.sequence, 2); assert.equal(second.head.parentId, head.id); assert.equal(second.head.parentDigest, head.revisionDigest);
  assert.deepEqual(second.history.map(row => [row.id, row.status]), [[head.id, 'superseded'], [second.head.id, 'current']]);
  assert.deepEqual(second.history[0], { ...head, status: 'superseded' }, 'earlier revision is retained unchanged');
  assert.equal(byCode(second.head.result).div.source, 'current');
});

test('stale base, plan, workspace and resolution inputs are rejected; dependent resolution becomes stale', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['div', 0], ['later', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const c = await prepare([['div', 2]], 'C', { changeScope: scope(['div']) });
  const current = await accept(a), merge = await store.merge(state.id, owner, c.artifactId);
  const choice = { [key('div')]: 'take-incoming' };
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, choice, { planDigest: 'f'.repeat(64) }), actor), /Merge plan changed/);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, state.revision, choice), actor), /revision changed/);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, { ...input(merge, current.revision, choice), expectedResolutionId: undefined }, actor), /explicitly/);
  const resolved = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, choice), actor);

  // A later accepted change moves A: the earlier decision is stale, never rebased.
  const d = await prepare([['later', 3]], 'D', { expectedRevision: current.revision, base: undefined });
  const moved = await accept(d);
  const stale = await store.merge(state.id, owner, c.artifactId);
  assert.equal(stale.head.status, 'stale'); assert.notEqual(stale.plan.planDigest, resolved.plan.planDigest);
  assert.equal(stale.head.revisionDigest, resolved.head.revisionDigest);
  assert.equal((await store.review(state.id, owner, c.artifactId)).merge.head.status, 'stale');
  // The old plan digest and revision cannot be reused; the new plan needs fresh decisions.
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(resolved, moved.revision, choice), actor), /Merge plan changed/);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(stale, current.revision, choice), actor), /revision changed/);
  const fresh = await store.resolveMerge(state.id, owner, c.artifactId, input(stale, moved.revision, choice), actor);
  assert.equal(fresh.head.status, 'current'); assert.equal(fresh.head.parentId, resolved.head.id);
  assert.equal(fresh.head.inputs.current.revision, moved.revision);

  // Replacing the change makes its resolutions stale and blocks further writes.
  const replacement = await prepare([['div', 4]], 'C', { expectedRevision: moved.revision, supersedesArtifactId: c.artifactId, changeScope: scope(['div']) });
  const replaced = await store.merge(state.id, owner, c.artifactId);
  assert.deepEqual([replaced.available, replaced.reason, replaced.head.status], [false, 'superseded', 'stale']);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(fresh, moved.revision, choice), actor), /replaced/);
  assert.equal((await store.merge(state.id, owner, replacement.artifactId)).head, null, 'decisions are never copied to a replacement');

  // Tampered stored evidence fails closed in the domain check.
  const tampered = structuredClone(fresh.head); delete tampered.status; tampered.reason = 'forged';
  assert.equal(managedResolutionStatus(tampered, fresh.plan), 'corrupt');
});

test('two concurrent resolutions of the same reviewed head cannot both commit', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['div', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const c = await prepare([['div', 2]], 'C', { changeScope: scope(['div']) });
  const current = await accept(a), merge = await store.merge(state.id, owner, c.artifactId);
  const results = await Promise.allSettled([
    store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'keep-current' }, { reason: 'First' }), actor),
    store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming' }, { reason: 'Second' }), other)
  ]);
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.statusCode, 409);
  const stored = await store.merge(state.id, owner, c.artifactId);
  assert.equal(stored.history.length, 1); assert.equal(stored.head.reason, 'First'); assert.deepEqual(stored.head.actor, actor);
});

test('delete/edit and edit/delete conflicts resolve only to supported whole-component outcomes', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['a', 0], ['b', 0], ['keep', 0]]);
  const a = await prepare([['a', 1]], 'A', { changeScope: scope(['a', 'b'], ['b']) });
  const c = await prepare([['b', 2]], 'C', { changeScope: scope(['a', 'b'], ['a']) });
  const current = await accept(a), merge = await store.merge(state.id, owner, c.artifactId);
  const rows = byCode(merge.plan.rows);
  assert.deepEqual([rows.a.classification, rows.b.classification], ['delete-edit', 'edit-delete']);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('a')]: 'take-incoming', [key('b')]: 'keep-current' }), actor), error => error.statusCode === 422);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('a')]: 'remove', [key('b')]: 'remove' }), actor), error => error.statusCode === 422);
  const removed = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('a')]: 'remove', [key('b')]: 'take-incoming' }), actor);
  const result = byCode(removed.head.result);
  assert.deepEqual([result.a.source, result.a.digest], ['absent', null]);
  assert.deepEqual([result.b.source, result.b.digest, result.b.artifactId], ['incoming', rows.b.incoming.digest, c.artifactId]);
  assert.deepEqual([result.keep.source, result.keep.digest], ['current', rows.keep.current.digest]);
  const kept = await store.resolveMerge(state.id, owner, c.artifactId, input(removed, current.revision, { [key('a')]: 'keep-current', [key('b')]: 'keep-current' }), actor);
  const second = byCode(kept.head.result);
  assert.deepEqual([second.a.source, second.a.digest], ['current', rows.a.current.digest]);
  assert.deepEqual([second.b.source, second.b.digest], ['absent', null], 'keeping A means b stays removed');
});

test('blocked evidence cannot be resolved and a failed atomic write keeps the committed resolution', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['a', 0], ['div', 0]]);
  const unknown = await prepare([['a', 1]], 'C', { base: undefined });
  const blocked = await store.merge(state.id, owner, unknown.artifactId);
  assert.equal(blocked.plan.status, 'blocked'); assert.deepEqual(blocked.plan.rows, []);
  await assert.rejects(store.resolveMerge(state.id, owner, unknown.artifactId, input(blocked, state.revision, {}), actor), error => error.statusCode === 422);
  // Rename uncertainty is blocked; identity is never inferred to make it resolvable.
  const a2 = JSON.stringify([...JSON.parse(key('a')).slice(0, -1), 'a2']);
  const renamed = await prepare([['a2', 0]], 'C', { changeScope: { ...scope(['a'], ['a']), members: [key('a'), a2] } });
  const uncertain = await store.merge(state.id, owner, renamed.artifactId);
  assert.ok(uncertain.plan.blockers.some(row => row.reason === 'rename-uncertain'));
  await assert.rejects(store.resolveMerge(state.id, owner, renamed.artifactId, input(uncertain, state.revision, {}), actor), /Blocked/);

  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const c = await prepare([['div', 2]], 'C', { changeScope: scope(['div']) });
  const current = await accept(a), merge = await store.merge(state.id, owner, c.artifactId);
  const committed = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'keep-current' }), actor);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to.endsWith('workspace.json')) throw Object.assign(Error('Synthetic metadata write failure'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(committed, current.revision, { [key('div')]: 'take-incoming' }), actor), /Synthetic metadata/);
  t.mock.restoreAll();
  const after = await store.merge(state.id, owner, c.artifactId);
  assert.deepEqual(after.head, committed.head); assert.equal(after.history.length, 1);
  // The committed head is still the one a retry must name.
  assert.equal((await store.resolveMerge(state.id, owner, c.artifactId, input(after, current.revision, { [key('div')]: 'take-incoming' }), actor)).head.sequence, 2);
});

test('pure resolution helper binds the plan digest and rejects changed inputs', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['div', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const c = await prepare([['div', 2]], 'C', { changeScope: scope(['div']) });
  const current = await accept(a), artifact = await store.artifact(state.id, owner, c.artifactId);
  const plan = planManagedComponentMerge(current, artifact);
  const resolution = resolveManagedMerge(plan, { decisions: { [key('div')]: 'take-incoming' }, reason: 'Pure', actor });
  assert.ok(Object.isFrozen(resolution) && Object.isFrozen(resolution.result[0]));
  assert.equal(assertCurrentManagedResolution(resolution, current, artifact), resolution);
  const forged = structuredClone(artifact); forged.components[0].digest = 'f'.repeat(64);
  assert.throws(() => assertCurrentManagedResolution(resolution, current, forged), error => error.statusCode === 409);
  const foreign = { ...resolution, inputs: { ...resolution.inputs, incoming: { artifactId: 'other' } } };
  assert.throws(() => resolveManagedMerge(plan, { decisions: { [key('div')]: 'keep-current' }, reason: 'Child', actor, parent: foreign }), /another change/);
});

test('an advanced baseline makes the declared base stale and blocks resolving the earlier plan', async t => {
  const { store, state, key, scope, prepare, accept, projects } = await setup(t, [['div', 0], ['keep', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const c = await prepare([['div', 2]], 'C', { changeScope: scope(['div']) });
  const current = await accept(a), merge = await store.merge(state.id, owner, c.artifactId);
  const resolved = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'take-incoming' }), actor);
  const project = await projects.create(owner, await archive([['div', 1], ['keep', 0]]));
  const full = await store.prepare(state.id, owner, { kind: 'reconciliation', expectedRevision: current.revision, baselineOwner: 'Base', sameSourceConfirmed: true,
    snapshot: { projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true } }, actor);
  const advanced = await store.accept(state.id, owner, full.artifactId, { expectedRevision: current.revision, reviewedDigest: full.artifactDigest, resolutions: {} }, actor);
  const stale = await store.merge(state.id, owner, c.artifactId);
  assert.deepEqual([stale.available, stale.reason, stale.head.status], [false, 'plan-unavailable', 'stale']);
  assert.match(stale.message, /stale|changed|Source/i);
  await assert.rejects(store.resolveMerge(state.id, owner, c.artifactId, input(resolved, advanced.revision, { [key('div')]: 'take-incoming' }), actor), error => error.statusCode === 409);
  assert.deepEqual((await store.merge(state.id, owner, c.artifactId)).history.map(row => row.revisionDigest), [resolved.head.revisionDigest]);
});

test('accepting a resolved change makes its resolution the accepted merged revision', async t => {
  const { store, state, key, scope, prepare, accept, directory, projects } = await setup(t, [['div', 0], ['conly', 0], ['keep', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const current = await accept(a);
  const c = await prepare([['div', 2], ['conly', 2]], 'C', { expectedRevision: current.revision, changeScope: scope(['div', 'conly']) });
  // Without a decision the cross-team overlap still blocks; nothing wins by upload order.
  await assert.rejects(accept(c), /Cross-team overlap/);
  const merge = await store.merge(state.id, owner, c.artifactId), rows = byCode(merge.plan.rows);
  const resolved = await store.resolveMerge(state.id, owner, c.artifactId, input(merge, current.revision, { [key('div')]: 'keep-current' }), actor);
  const accepted = await accept(c), components = byCode(accepted.current);
  assert.equal(accepted.revision, current.revision + 1);
  assert.deepEqual([components.div.digest, components.div.interventionId, components.div.team], [rows.div.current.digest, a.artifactId, 'A']);
  assert.deepEqual([components.conly.digest, components.conly.interventionId, components.conly.team], [rows.conly.incoming.digest, c.artifactId, 'C']);
  assert.equal(components.keep.digest, byCode(current.current).keep.digest);
  assert.deepEqual(accepted.changes.at(-1).resolution, { id: resolved.head.id, revisionDigest: resolved.head.revisionDigest,
    resultDigest: resolved.head.resultDigest, planDigest: resolved.head.planDigest, acceptedFromRevision: current.revision });
  // The pre-acceptance inputs a build re-derives the plan from stay private to the store.
  assert.equal('acceptedMerge' in accepted, false);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json'), 'utf8'));
  assert.deepEqual([stored.acceptedMerge.artifactId, stored.acceptedMerge.resolutionId, stored.acceptedMerge.revision], [c.artifactId, resolved.head.id, accepted.revision]);
  assert.equal(stored.acceptedMerge.before.revision, current.revision);
  assert.deepEqual(stored.acceptedMerge.before.current, current.current);
  assert.equal(stored.completedReviews.at(-1).acceptedDecision.mergeResolutionId, resolved.head.id);
  assert.deepEqual((await managedWorkspaceStore(directory, projects).get(state.id, owner)).current, accepted.current, 'restart reads the accepted merged revision');
  // A later conflict-free change records its empty resolution at acceptance and becomes the
  // accepted merged revision. Its base copy of `conly` keeps the accepted edit instead of reverting it.
  const d = await prepare([['keep', 3], ['conly', 0]], 'C', { expectedRevision: accepted.revision, changeScope: scope(['keep', 'conly']) });
  const latest = await accept(d), merged = byCode(latest.current);
  assert.equal(merged.conly.digest, components.conly.digest, 'a base copy in the partial keeps the accepted edit');
  assert.notEqual(merged.keep.digest, components.keep.digest);
  const after = JSON.parse(await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json'), 'utf8'));
  const automatic = after.mergeResolutions.at(-1);
  assert.deepEqual([after.acceptedMerge.artifactId, after.acceptedMerge.resolutionId, after.acceptedMerge.revision], [d.artifactId, automatic.id, latest.revision]);
  assert.deepEqual([automatic.planStatus, automatic.decisions, automatic.actor.login], ['clear', [], actor.login]);
  assert.equal(latest.changes.at(-1).resolution.id, automatic.id);
});

test('a clear change is resolved at acceptance only with a recorded actor; otherwise the accepted merged revision is cleared', async t => {
  const { store, state, scope, prepare, accept, directory } = await setup(t, [['div', 0], ['keep', 0]]);
  const read = async () => JSON.parse(await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json'), 'utf8'));
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const current = await accept(a);
  assert.equal((await read()).acceptedMerge.artifactId, a.artifactId);
  const b = await prepare([['keep', 1]], 'A', { expectedRevision: current.revision, changeScope: scope(['keep']) });
  await store.accept(state.id, owner, b.artifactId, { expectedRevision: b.revision, reviewedDigest: b.artifactDigest, reviewedBoundaryKeys: b.rows.filter(row => row.boundaryCrossing).map(row => row.key) });
  const stored = await read();
  assert.equal(stored.acceptedMerge, undefined);
  assert.equal(stored.mergeResolutions.length, 1);
});

test('the pure reducer applies the chosen side and refuses stale or corrupt resolutions', async t => {
  const { store, state, key, scope, prepare, accept } = await setup(t, [['div', 0], ['gone', 0]]);
  const a = await prepare([['div', 1]], 'A', { changeScope: scope(['div']) });
  const current = await accept(a);
  const c = await prepare([['div', 2]], 'C', { expectedRevision: current.revision, changeScope: scope(['div', 'gone'], ['gone']) });
  const artifact = await store.artifact(state.id, owner, c.artifactId), plan = planManagedComponentMerge(current, artifact);
  const options = resolution => ({ expectedRevision: current.revision, reviewedDigest: previewManagedChange(current, artifact, { team: 'C' }).artifactDigest,
    team: 'C', taskRef: 'SYNTHETIC-C', reviewedBoundaryKeys: c.rows.filter(row => row.boundaryCrossing).map(row => row.key), resolution });
  const incoming = resolveManagedMerge(plan, { decisions: { [key('div')]: 'take-incoming' }, reason: 'Take C', actor });
  const next = acceptManagedChange(current, artifact, options(incoming)), components = byCode(next.current);
  assert.deepEqual([components.div.digest, components.div.team], [byCode(plan.rows).div.incoming.digest, 'C']);
  assert.equal(components.gone, undefined, 'a validated tombstone removes the component');
  assert.equal(next.changes.at(-1).resolution.id, incoming.id);
  // A resolution of another plan or with edited evidence is refused, never applied.
  const earlier = resolveManagedMerge(planManagedComponentMerge(state, artifact), { decisions: {}, reason: 'Old plan', actor });
  assert.throws(() => acceptManagedChange(current, artifact, options(earlier)), error => error.statusCode === 409 && /changed/.test(error.message));
  const corrupt = { ...incoming, reason: 'Forged' };
  assert.throws(() => acceptManagedChange(current, artifact, options(corrupt)), error => error.statusCode === 409 && /corrupt/.test(error.message));
});

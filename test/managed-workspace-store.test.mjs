import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zip } from './fixture.mjs';
import { projectStore } from '../lib/projects.mjs';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';

const owner = 'synthetic-owner', foreign = 'synthetic-other-owner';
const status = code => error => error.statusCode === code;
const archive = (entries, extra = []) => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }]),
  ...extra
]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-managed-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (entries, scope, user = owner, extra = []) => {
    const bytes = await archive(entries, extra), project = await projects.create(user, bytes);
    return { bytes, project, ref: { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true } };
  };
  const base = await upload([['a', 'base'], ['b', 'untouched']], 'full');
  const create = (snapshot = base.ref) => store.create(owner, { name: 'Synthetic managed workspace', baselineOwner: 'Korus', snapshot });
  return { directory, projects, store, upload, base, create };
}
const changeInput = (snapshot, revision = 0) => ({ kind: 'change', snapshot, expectedRevision: revision, team: 'Internal', taskRef: 'SYNTHETIC-1', sameSourceConfirmed: true });
const decisions = preview => ({ expectedRevision: preview.revision, reviewedDigest: preview.artifactDigest });

test('accepted export preserves exact full bytes and all metadata across project deletion and store restart', async t => {
  const { directory, projects, store, base, create } = await setup(t);
  const state = await create();
  const before = await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json'));
  const result = await store.acceptedExport(state.id, owner, state.revision);
  assert.deepEqual(result.bytes, base.bytes);
  assert.equal(result.evidence.artifactId, state.baselineId);
  assert.equal(result.evidence.snapshot.snapshotId, base.ref.snapshotId);
  assert.equal(result.evidence.sha256, state.artifacts[0].checksum);
  assert.ok(result.evidence.inventory.some(row => row.path === 'package.json'));
  assert.ok(result.evidence.inventory.some(row => row.path === 'widgets/manifest.json'));
  assert.equal(result.evidence.deploymentAuthorized, false);
  assert.equal(result.evidence.verified, false);
  assert.equal(result.evidence.checks.readBack, 'not-run');
  assert.deepEqual(await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json')), before);
  await projects.delete(base.project.id, owner);
  const restarted = managedWorkspaceStore(directory, projects);
  assert.deepEqual(await restarted.acceptedExport(state.id, owner, state.revision), result);
  await assert.rejects(restarted.acceptedExport(state.id, foreign, state.revision), status(404));
  await assert.rejects(restarted.acceptedExport(state.id, owner, state.revision + 1), status(409));
  await assert.rejects(restarted.acceptedExport(state.id, owner), status(409));
  await fs.appendFile(path.join(directory, 'managed-workspaces', state.id, state.baselineId + '.e365'), 'corrupt');
  await assert.rejects(restarted.acceptedExport(state.id, owner, state.revision), /checksum/);
});

test('accepted export blocks pending, archived and partial no-op state until a later full review', async t => {
  const { store, upload, create } = await setup(t);
  let state = await create();
  const partial = await upload([['a', 'base']], 'partial');
  const review = await store.prepare(state.id, owner, changeInput(partial.ref));
  await assert.rejects(store.acceptedExport(state.id, owner, state.revision), /pending reviews/);
  state = await store.accept(state.id, owner, review.artifactId, decisions(review));
  // Even identical component content cannot account for partial metadata.
  await assert.rejects(store.acceptedExport(state.id, owner, state.revision), /later reviewed full export/);
  const full = await upload([['a', 'base'], ['b', 'untouched']], 'full');
  const reconciliation = await store.prepare(state.id, owner, { kind: 'reconciliation', snapshot: full.ref,
    expectedRevision: state.revision, baselineOwner: 'Korus', sameSourceConfirmed: true });
  state = await store.accept(state.id, owner, reconciliation.artifactId, decisions(reconciliation));
  assert.deepEqual((await store.acceptedExport(state.id, owner, state.revision)).bytes, full.bytes);
  const performedBy = { id: owner, login: 'synthetic@example.org', provider: 'local' };
  const finding = await store.comment(state.id, owner, reconciliation.artifactId, {
    expectedRevision: state.revision, expectedDiscussionRevision: 0, type: 'reject', text: 'New evidence needs review'
  }, performedBy);
  await assert.rejects(store.acceptedExport(state.id, owner, state.revision), /open findings/);
  await store.comment(state.id, owner, reconciliation.artifactId, {
    expectedRevision: state.revision, expectedDiscussionRevision: finding.version, type: 'resolve',
    parentId: finding.findings[0].id, text: 'Reviewed the new evidence'
  }, performedBy);
  assert.deepEqual((await store.acceptedExport(state.id, owner, state.revision)).bytes, full.bytes);
  state = await store.setArchived(state.id, owner, { archived: true, expectedRevision: state.revision });
  await assert.rejects(store.acceptedExport(state.id, owner, state.revision), /Reopen/);
});

test('accepted full reconciliation retaining a local component cannot masquerade as a physical export', async t => {
  const { store, upload, create } = await setup(t);
  let state = await create();
  const local = await upload([['a', 'ours']], 'partial');
  const change = await store.prepare(state.id, owner, changeInput(local.ref));
  state = await store.accept(state.id, owner, change.artifactId, { ...decisions(change), reviewedBoundaryKeys: change.rows.filter(row => row.boundaryCrossing).map(row => row.key) });
  const full = await upload([['a', 'theirs'], ['b', 'untouched']], 'full');
  const review = await store.prepare(state.id, owner, { kind: 'reconciliation', snapshot: full.ref,
    expectedRevision: state.revision, baselineOwner: 'Korus', sameSourceConfirmed: true });
  const conflict = review.rows.find(row => row.classification === 'conflict');
  state = await store.accept(state.id, owner, review.artifactId,
    { ...decisions(review), resolutions: { [conflict.key]: 'keep-working' } });
  await assert.rejects(store.acceptedExport(state.id, owner, state.revision), /retained or ambiguous/);
});

test('persisted baseline, partial change, conflict, reconciliation and archive/reopen retain exact artifacts', async t => {
  const { directory, projects, store, upload, base, create } = await setup(t);
  const initial = await create(), local = await upload([['x', 'ours']], 'partial');
  assert.notEqual(initial.id, base.project.id);
  assert.equal(initial.artifacts[0].snapshot.snapshotId, base.ref.snapshotId);
  assert.equal(initial.artifacts[0].scopeDeclaration.method, 'explicit-assertion');
  const prepared = await store.prepare(initial.id, owner, changeInput(local.ref));
  const restarted = managedWorkspaceStore(directory, projects);
  assert.deepEqual(await restarted.preview(initial.id, owner, prepared.artifactId), prepared);
  let state = await restarted.accept(initial.id, owner, prepared.artifactId, decisions(prepared));
  assert.equal(state.current.length, 3);
  assert.equal(state.current.find(row => row.code === 'b').team, 'Korus');
  assert.equal(state.current.find(row => row.code === 'x').team, 'Internal');
  const vendor = await upload([['a', 'vendor'], ['b', 'untouched'], ['x', 'theirs']], 'full');
  const reconciliation = await restarted.prepare(state.id, owner, { kind: 'reconciliation', snapshot: vendor.ref,
    expectedRevision: state.revision, baselineOwner: 'Korus', sameSourceConfirmed: true });
  const conflict = reconciliation.rows.find(row => row.classification === 'conflict');
  assert.ok(conflict);
  await assert.rejects(restarted.accept(state.id, owner, reconciliation.artifactId, decisions(reconciliation)), /Resolve each conflict/);
  state = await restarted.accept(state.id, owner, reconciliation.artifactId, { ...decisions(reconciliation), resolutions: { [conflict.key]: 'keep-working' } });
  assert.equal(state.baselineId, reconciliation.artifactId);
  assert.equal(state.current.find(row => row.code === 'x').team, 'Internal');
  assert.equal(state.artifacts.length, 3); assert.equal(state.reconciliations.length, 1);
  state = await restarted.setArchived(state.id, owner, { archived: true, expectedRevision: state.revision });
  assert.equal((await restarted.list(owner)).length, 0);
  assert.equal((await restarted.list(owner, { archived: true }))[0].id, state.id);
  await assert.rejects(restarted.prepare(state.id, owner, changeInput(local.ref, state.revision)), /Reopen/);
  state = await restarted.setArchived(state.id, owner, { archived: false, expectedRevision: state.revision });
  const finalStore = managedWorkspaceStore(directory, projects);
  assert.deepEqual(await finalStore.get(state.id, owner), state);
  assert.deepEqual(await finalStore.original(state.id, owner, initial.baselineId), base.bytes);
  assert.deepEqual(state.history.map(row => row.type), ['created', 'change-accepted', 'baseline-accepted', 'archived', 'reopened']);
});

test('explicit snapshot/scope and authenticated ownership are required; payloads cannot forge Source or owner', async t => {
  const { store, upload, base, create } = await setup(t);
  const partial = await upload([['x', 'local']], 'partial'), other = await upload([['a', 'foreign']], 'full', foreign);
  for (const snapshot of [{ ...base.ref, snapshotId: undefined }, { ...base.ref, scopeConfirmed: false }, partial.ref,
    { ...base.ref, source: { connectionId: 'forged' } }, { ...base.ref, projectId: '../escape' }])
    await assert.rejects(create(snapshot), status(400));
  await assert.rejects(create(other.ref), /not found|\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d/);
  await assert.rejects(create({ ...base.ref, snapshotId: other.ref.snapshotId }), /not found|\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d/);
  await assert.rejects(store.create(owner, { name: 'x', baselineOwner: 'Korus', snapshot: base.ref, owner: foreign }), status(400));
  await assert.rejects(store.create('', { name: 'x', baselineOwner: 'Korus', snapshot: base.ref }), status(401));
  assert.equal((await store.list(owner)).length, 0);
  const state = await create(), prepared = await store.prepare(state.id, owner, changeInput(partial.ref));
  for (const operation of [
    () => store.get(state.id, foreign), () => store.original(state.id, foreign, state.baselineId),
    () => store.prepare(state.id, foreign, changeInput(partial.ref)), () => store.preview(state.id, foreign, prepared.artifactId),
    () => store.accept(state.id, foreign, prepared.artifactId, decisions(prepared)),
    () => store.setArchived(state.id, foreign, { archived: true, expectedRevision: 0 }),
    () => store.get('../escape', owner), () => store.original(state.id, owner, '../escape')
  ]) await assert.rejects(operation, status(404));
  assert.deepEqual(await store.list(foreign), []);
  assert.equal((await store.get(state.id, owner)).revision, 0);
});

test('attribution is pinned before async capture; stale, replayed and concurrent decisions cannot overwrite accepted work', async t => {
  const { store, upload, create } = await setup(t), state = await create();
  const first = await upload([['x', 'first']], 'partial'), second = await upload([['y', 'second']], 'partial');
  const request = changeInput(first.ref), preparing = store.prepare(state.id, owner, request);
  request.team = 'Changed after submission'; request.snapshot.scope = 'full';
  const a = await preparing, b = await store.prepare(state.id, owner, changeInput(second.ref));
  assert.equal(a.options.team, 'Internal');
  await assert.rejects(store.accept(state.id, owner, a.artifactId, { ...decisions(a), reviewedDigest: 'wrong' }), status(409));
  await assert.rejects(store.accept(state.id, owner, a.artifactId, { ...decisions(a), team: 'Forged' }), status(400));
  await assert.rejects(store.accept(state.id, owner, a.artifactId, { ...decisions(a), reviewedBoundaryKeys: 'not-a-list' }), status(400));
  const outcomes = await Promise.allSettled([store.accept(state.id, owner, a.artifactId, decisions(a)), store.accept(state.id, owner, b.artifactId, decisions(b))]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(row => row.status === 'rejected').reason.statusCode, 409);
  const current = await store.get(state.id, owner);
  assert.equal(current.revision, 1); assert.equal(current.changes[0].team, 'Internal');
  assert.equal(current.current.length, 3); assert.equal(current.pending[0].stale, true);
  await assert.rejects(store.accept(state.id, owner, a.artifactId, decisions(a)), status(404));
  await assert.rejects(store.preview(state.id, owner, b.artifactId), status(409));
  await assert.rejects(store.setArchived(state.id, owner, { archived: true, expectedRevision: 0 }), status(409));
});

test('snapshot capture pins the selected historical artifact and survives Source append, reparse and project deletion', async t => {
  const { directory, projects, store } = await setup(t);
  const source = { connectionId: 'synthetic-source', solutionRef: 'synthetic_solution' }, bytes = await archive([['a', 'old']]);
  const project = await projects.createSource(owner, bytes, source), before = await projects.get(project.id, owner);
  const latest = await projects.appendSource(project.id, owner, await archive([['a', 'new']]), source, project.currentSnapshotId);
  await projects.reparse(project.id, owner);
  const state = await store.create(owner, { name: 'Pinned historical snapshot', baselineOwner: 'Korus',
    snapshot: { projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true } });
  assert.equal(state.artifacts[0].snapshot.parserRevision, before.activeRevision);
  assert.deepEqual(state.artifacts[0].snapshot.source, source);
  assert.equal((await projects.listSnapshots(project.id, owner)).currentSnapshotId, latest.id);
  await projects.delete(project.id, owner);
  const reopened = managedWorkspaceStore(directory, projects);
  assert.deepEqual(await reopened.get(state.id, owner), state);
  assert.deepEqual(await reopened.original(state.id, owner, state.baselineId), bytes);
});

test('unknown evidence remains reviewable but cannot be accepted; full packages cannot be added as partial changes', async t => {
  const { store, upload, base, create } = await setup(t), state = await create();
  const unknown = await upload([['x', 'local']], 'partial', owner, [['widgets/unknown.txt', 'unclassified synthetic bytes']]);
  await assert.rejects(create({ ...unknown.ref, scope: 'full' }), status(422));
  await assert.rejects(store.prepare(state.id, owner, changeInput(base.ref)), status(400));
  const prepared = await store.prepare(state.id, owner, changeInput(unknown.ref));
  assert.ok(prepared.ambiguities.length);
  await assert.rejects(store.accept(state.id, owner, prepared.artifactId, decisions(prepared)), status(422));
  const current = await store.get(state.id, owner);
  assert.equal(current.revision, 0); assert.equal(current.pending.length, 1);
  assert.deepEqual(await store.original(state.id, owner, prepared.artifactId), unknown.bytes);
});

test('corrupt captured bytes block read and acceptance without altering the persisted revision', async t => {
  const { directory, store, upload, create } = await setup(t), state = await create();
  const change = await upload([['x', 'local']], 'partial'), prepared = await store.prepare(state.id, owner, changeInput(change.ref));
  const file = path.join(directory, 'managed-workspaces', state.id, prepared.artifactId + '.e365');
  await fs.writeFile(file, 'tampered synthetic bytes');
  await assert.rejects(store.accept(state.id, owner, prepared.artifactId, decisions(prepared)), /checksum/);
  await assert.rejects(store.get(state.id, owner), /checksum/);
  await assert.rejects(store.original(state.id, owner, prepared.artifactId), /checksum/);
  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'managed-workspaces', state.id, 'workspace.json'), 'utf8'));
  assert.equal(persisted.state.revision, 0); assert.equal(persisted.pending.length, 1);
  await fs.writeFile(file, change.bytes);
  assert.equal((await store.get(state.id, owner)).revision, 0);
  const view = await store.get(state.id, owner); view.current.length = 0;
  assert.equal((await store.get(state.id, owner)).current.length, 2);
});

test('failed atomic metadata replacement preserves the last committed state and does not publish a prepared artifact', async t => {
  const { directory, store, upload, create } = await setup(t), state = await create();
  const change = await upload([['x', 'local']], 'partial'), rename = fs.rename;
  const rejectMetadata = () => t.mock.method(fs, 'rename', async (from, to) => {
    if (to.endsWith('workspace.json')) throw Object.assign(Error('Synthetic metadata write failure'), { code: 'EIO' });
    return rename(from, to);
  });
  rejectMetadata();
  await assert.rejects(store.prepare(state.id, owner, changeInput(change.ref)), /Synthetic metadata/);
  assert.deepEqual(await store.get(state.id, owner), state);
  assert.deepEqual((await fs.readdir(path.join(directory, 'managed-workspaces', state.id))).sort(), [state.baselineId + '.e365', 'workspace.json'].sort());
  t.mock.restoreAll();
  const prepared = await store.prepare(state.id, owner, changeInput(change.ref));
  rejectMetadata();
  await assert.rejects(store.accept(state.id, owner, prepared.artifactId, decisions(prepared)), /Synthetic metadata/);
  const current = await store.get(state.id, owner);
  assert.equal(current.revision, 0); assert.equal(current.pending.length, 1);
  assert.deepEqual(await store.original(state.id, owner, prepared.artifactId), change.bytes);
  t.mock.restoreAll();
  assert.equal((await store.accept(state.id, owner, prepared.artifactId, decisions(prepared))).revision, 1);
});

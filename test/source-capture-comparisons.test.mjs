import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectStore } from '../lib/projects.mjs';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { zip } from './fixture.mjs';

const bytes = (value, include = true) => zip([
  ['package.json', { code: 'synthetic_capture', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: include ? [{ code: 'form', namespace: 'synthetic.records', kind: 'WIDGET', path: 'form.json' }] : [] }],
  ...(include ? [['widgets/form.json', { descriptor: { fields: [], clientScripts: value } }]] : [])
]);
const source = { connectionId: 'synthetic-dev', solutionRef: 'synthetic_capture' };
const snapshot = project => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true });

test('full Source capture sequence survives pending reviews, restart, selection and partial changes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-source-sequence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const first = await projects.createSource('actor', await bytes('first'), source);
  let state = await store.create('actor', { name: 'Synthetic capture', baselineOwner: 'Team', snapshot: snapshot(first) });
  assert.equal(state.sourceComparisons[0].status, 'first-capture');
  const initial = state.sourceComparisons[0];
  const appended = await projects.appendSource(first.id, 'actor', await bytes('unselected'), source, first.currentSnapshotId);
  await projects.selectSnapshot(first.id, 'actor', first.currentSnapshotId, appended.id);
  const second = await projects.createSource('actor', await bytes('second'), source);
  const p2 = await store.prepare(state.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(second) });
  const partial = await projects.createSource('actor', await bytes('partial'), source);
  await store.prepare(state.id, 'actor', { kind: 'change', expectedRevision: 0, snapshot: { ...snapshot(partial), scope: 'partial' }, team: 'Team', taskRef: 'SYNTHETIC' });
  const third = await projects.createSource('actor', await bytes('second'), source);
  await store.prepare(state.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(third) });
  const restarted = managedWorkspaceStore(directory, projectStore(directory));
  state = await restarted.get(state.id, 'actor');
  assert.equal(state.sourceComparisons.length, 3);
  assert.deepEqual(state.sourceComparisons[0], initial);
  assert.equal(state.sourceComparisons[2].before.artifactId, p2.artifactId);
  assert.equal(state.sourceComparisons[2].before.snapshot.projectId, second.id);
  assert.ok(state.sourceComparisons[2].review.rows.every(row => row.baselineDigest === row.incomingDigest));
  assert.equal(state.baselineId, initial.after.artifactId, 'capture comparison never accepts a pending version');
  const fourth = await projects.createSource('actor', await bytes('', false), source);
  await restarted.prepare(state.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(fourth) });
  state = await restarted.get(state.id, 'actor');
  assert.equal(state.sourceComparisons.at(-1).review.rows[0].removed, true, 'absence is deletion only between full captures');
  assert.equal(state.sourceComparisons.at(-1).installedStateEstablished, false);
  await assert.rejects(restarted.get(state.id, 'another-actor'), { statusCode: 404 });
});

test('upload assertions never establish a named Source; legacy capture order stays unknown', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-source-unknown-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const first = await projects.create('actor', await bytes('first'));
  const state = await store.create('actor', { name: 'Synthetic upload', baselineOwner: 'Team', snapshot: snapshot(first) });
  assert.equal(state.sourceComparisons[0].status, 'unknown-source');
  const file = path.join(directory, 'managed-workspaces', state.id, 'workspace.json');
  const record = JSON.parse(await fs.readFile(file)); delete record.sourceComparisons;
  await fs.writeFile(file, JSON.stringify(record));
  const next = await projects.createSource('actor', await bytes('next'), source);
  await store.prepare(state.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(next), sameSourceConfirmed: true });
  const result = (await store.get(state.id, 'actor')).sourceComparisons[0];
  assert.equal(result.status, 'history-unavailable'); assert.equal(result.before, null);
  assert.equal(result.ancestryVerified, false);
});

test('closed no-change full captures remain the next capture base without becoming accepted', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-source-closed-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const first = await projects.createSource('actor', await bytes('same'), source);
  const initial = await store.create('actor', { name: 'Synthetic capture', baselineOwner: 'Team', snapshot: snapshot(first) });
  const second = await projects.createSource('actor', await bytes('same'), source);
  const preview = await store.prepare(initial.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(second) });
  await store.close(initial.id, 'actor', preview.artifactId, { expectedRevision: 0, reviewedDigest: preview.artifactDigest });
  const third = await projects.createSource('actor', await bytes('next'), source);
  await store.prepare(initial.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(third) });
  const current = await store.get(initial.id, 'actor');
  assert.equal(current.baselineId, initial.baselineId);
  assert.equal(current.sourceComparisons.at(-1).before.artifactId, preview.artifactId);
  assert.equal(current.sourceComparisons.at(-1).before.snapshot.projectId, second.id);
});

test('an unsupported previous full capture cannot become a clear comparison when the next capture is readable', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-source-ambiguous-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const first = await projects.createSource('actor', await bytes('same'), source);
  const initial = await store.create('actor', { name: 'Synthetic capture', baselineOwner: 'Team', snapshot: snapshot(first) });
  const unsupported = await projects.createSource('actor', await zip([
    ['package.json', { code: source.solutionRef, type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [] }], ['unknown.bin', Buffer.from([0, 1, 2])]
  ]), source);
  const preview = await store.prepare(initial.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(unsupported) });
  const third = await projects.createSource('actor', await bytes('next'), source);
  await store.prepare(initial.id, 'actor', { kind: 'reconciliation', expectedRevision: 0, snapshot: snapshot(third) });
  const comparison = (await store.get(initial.id, 'actor')).sourceComparisons.at(-1);
  assert.equal(comparison.status, 'ambiguous');
  assert.equal(comparison.before.artifactId, preview.artifactId);
  assert.ok(comparison.beforeEvidence.ambiguities.some(row => row.reason === 'unclassified-file'));
  assert.equal(comparison.beforeEvidence.unclassifiedFiles[0].path, 'unknown.bin');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { previewManagedChange, acceptManagedChange } from '../lib/managed-workspace.mjs';
import { projectStore } from '../lib/projects.mjs';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from './fixture.mjs';

const owner = 'synthetic-owner', actor = { id: 'declaring-actor', login: 'synthetic@example.org', provider: 'local' };
const archive = rows => zip([
  ['package.json', { code: 'synthetic_base', type: 'SOLUTION', retainedMetadata: 'synthetic' }],
  ['widgets/manifest.json', { entities: rows.map(([code]) => ({ code, namespace: 'synthetic', kind: 'WIDGET', path: code + '.json' })) }],
  ...rows.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-change-base-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (rows, scope) => {
    const bytes = await archive(rows), project = await projects.create(owner, bytes);
    return { bytes, project, ref: { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true } };
  };
  const full = await upload([['a', 0], ['b', 0], ['untouched', 0]], 'full');
  const state = await store.create(owner, { name: 'Synthetic ancestry', baselineOwner: 'Team', snapshot: full.ref }, actor);
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const prepare = (snapshot, extra = {}) => store.prepare(state.id, owner, { kind: 'change', snapshot,
    expectedRevision: state.revision, team: 'Team', taskRef: 'SYNTHETIC', sameSourceConfirmed: true, ...extra }, actor);
  return { directory, projects, store, upload, full, state, base, prepare };
}
const accept = (store, state, review) => store.accept(state.id, owner, review.artifactId, {
  expectedRevision: review.revision, reviewedDigest: review.artifactDigest,
  reviewedBoundaryKeys: review.rows.filter(row => row.boundaryCrossing).map(row => row.key)
}, actor);


const key = (state, code) => state.current.find(row => row.code === code).key;
const scope = (members, deletions = []) => ({ name: 'Synthetic captured components', members, deletions, confirmed: true });
const deletion = (state, code) => { const row = state.current.find(row => row.code === code); return { key: row.key, baseDigest: row.digest, confirmed: true }; };

test('bounded partials preserve absent members, explicit scope and exact original evidence after restart', async t => {
  const { directory, projects, store, upload, state, base, prepare } = await setup(t);
  const first = await prepare((await upload([['a', 1]], 'partial')).ref, { base, changeScope: scope([key(state, 'a')]) });
  const second = await prepare((await upload([['b', 2]], 'partial')).ref, { base, changeScope: scope([key(state, 'b')]) });
  assert.equal(first.changeScopeDeclaration.declaredBy, actor.id);
  assert.equal(first.changeScopeDeclaration.baseChecksum, state.artifacts[0].checksum);
  assert.deepEqual(first.changeScopeDeclaration.members[0].baseEvidence, state.current.find(row => row.code === 'a').evidence);
  assert.equal(first.changeScopeDeclaration.ancestryVerified, false);
  assert.equal(first.changeScopeDeclaration.automaticMergeEnabled, false);
  assert.equal(first.changeScopeDeclaration.buildEnabled, false);
  await projects.delete((await projects.get(state.artifacts[0].snapshot.projectId, owner)).id, owner);
  const restarted = managedWorkspaceStore(directory, projects);
  assert.deepEqual(await restarted.preview(state.id, owner, first.artifactId), first);
  assert.deepEqual((await restarted.get(state.id, owner)).pending[1].changeScopeDeclaration, second.changeScopeDeclaration);
  let current = await accept(restarted, state, first);
  assert.equal(current.current.length, 3);
  assert.equal(current.current.find(row => row.code === 'b').digest, state.current.find(row => row.code === 'b').digest);
  await assert.rejects(accept(restarted, current, second), /revision changed/);
  assert.deepEqual((await restarted.review(state.id, owner, first.artifactId)).changeScopeDeclaration, first.changeScopeDeclaration);
  const refreshed = await restarted.prepare(state.id, owner, { kind: 'change', snapshot: { projectId: second.snapshot.projectId, snapshotId: second.snapshot.snapshotId, scope: 'partial', scopeConfirmed: true },
    expectedRevision: current.revision, team: 'Team', taskRef: 'SECOND', sameSourceConfirmed: true,
    base, changeScope: scope([key(state, 'b')]), supersedesArtifactId: second.artifactId }, actor);
  current = await accept(restarted, current, refreshed);
  assert.equal(current.current.find(row => row.code === 'a').digest, first.changeScopeDeclaration.members[0].incomingDigest);
  assert.equal(current.current.find(row => row.code === 'b').digest, refreshed.changeScopeDeclaration.members[0].incomingDigest);
  assert.equal(current.current.find(row => row.code === 'untouched').digest, state.current.find(row => row.code === 'untouched').digest);
});

test('explicit deletion requires exact reviewed digest and boundary approval, survives restart and blocks physical export', async t => {
  const { directory, projects, store, upload, state, base, prepare, full } = await setup(t);
  const review = await prepare((await upload([], 'partial')).ref, { base,
    changeScope: scope([key(state, 'a')], [deletion(state, 'a')]) });
  assert.equal(review.rows[0].classification, 'component-deleted');
  const restarted = managedWorkspaceStore(directory, projects);
  await assert.rejects(restarted.accept(state.id, owner, review.artifactId, {
    expectedRevision: 0, reviewedDigest: review.artifactDigest }, actor), /boundary crossing/);
  await assert.rejects(restarted.accept(state.id, owner, review.artifactId, {
    expectedRevision: 0, reviewedDigest: 'wrong', reviewedBoundaryKeys: [key(state, 'a')] }, actor), /reviewed partial/);
  const current = await accept(restarted, state, review);
  assert.deepEqual(current.current.map(row => row.code).sort(), ['b', 'untouched']);
  assert.deepEqual(await restarted.original(state.id, owner, state.baselineId), full.bytes);
  assert.equal(current.changes[0].rows[0].explicitDeletion, true);
  assert.deepEqual((await managedWorkspaceStore(directory, projects).get(state.id, owner)).artifacts.at(-1).changeScopeDeclaration, review.changeScopeDeclaration);
  await assert.rejects(restarted.acceptedExport(state.id, owner, current.revision), /later reviewed full/);
});

test('unknown legacy scope cannot imply deletion or retroactive scope', async t => {
  const { store, upload, state, prepare } = await setup(t);
  const review = await prepare((await upload([], 'partial')).ref);
  assert.equal(review.changeScopeDeclaration.status, 'unknown');
  assert.equal(review.rows.length, 0);
  assert.equal((await accept(store, state, review)).current.length, 3);
});

test('foreign members, duplicate claims, forged evidence and partial contamination fail before persistence', async t => {
  const { store, upload, state, base, prepare } = await setup(t);
  const part = (await upload([['a', 1]], 'partial')).ref;
  const a = key(state, 'a'), b = key(state, 'b');
  for (const invalid of [null, scope([]), scope([a, a]), scope(['foreign']), scope([b]),
    { ...scope([a]), confirmed: false }, { ...scope([a]), declaredBy: 'forged' },
    scope([a], [deletion(state, 'a')]), scope([a, b], [{ ...deletion(state, 'b'), baseDigest: 'wrong' }]),
    scope([a, b], [{ ...deletion(state, 'b'), confirmed: false }]),
    scope([a, b], [deletion(state, 'b'), deletion(state, 'b')])]) {
    await assert.rejects(prepare(part, { base, changeScope: invalid }));
  }
  await assert.rejects(prepare(part, { changeScope: scope([a]) }), /declared accepted full base/);
  assert.equal((await store.get(state.id, owner)).pending.length, 0);
});

test('ambiguous captured identities block explicit declarations', async t => {
  const { projects, store, state, base, prepare } = await setup(t);
  const bytes = await zip([['package.json', { code: 'synthetic_base', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'a', namespace: 'synthetic', kind: 'WIDGET', path: 'a.json' },
      { code: 'a', namespace: 'synthetic', kind: 'WIDGET', path: 'other.json' }] }],
    ['widgets/a.json', { descriptor: {} }], ['widgets/other.json', { descriptor: {} }]]);
  const project = await projects.create(owner, bytes);
  const ref = { projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'partial', scopeConfirmed: true };
  await assert.rejects(prepare(ref, { base, changeScope: scope([key(state, 'a')]) }), /unambiguous/);
  assert.equal((await store.get(state.id, owner)).pending.length, 0);
});

test('deletion of edited member or historical baseline is blocked rather than resolving delete/edit overlap', async t => {
  const { store, upload, state, base, prepare } = await setup(t);
  let current = await accept(store, state, await prepare((await upload([['a', 1]], 'partial')).ref));
  const empty = (await upload([], 'partial')).ref;
  const input = { kind: 'change', snapshot: empty, expectedRevision: current.revision, team: 'Team',
    taskRef: 'DELETE', sameSourceConfirmed: true, base, changeScope: scope([key(state, 'a')], [deletion(state, 'a')]) };
  await assert.rejects(store.prepare(state.id, owner, input, actor), /member changed/);
  const full = await upload([['a', 1], ['b', 0], ['untouched', 0]], 'full');
  const review = await store.prepare(state.id, owner, { kind: 'reconciliation', snapshot: full.ref,
    expectedRevision: current.revision, baselineOwner: 'Team', sameSourceConfirmed: true }, actor);
  current = await store.accept(state.id, owner, review.artifactId, { expectedRevision: current.revision, reviewedDigest: review.artifactDigest }, actor);
  await assert.rejects(store.prepare(state.id, owner, { ...input, expectedRevision: current.revision,
    changeScope: scope([key(state, 'b')], [deletion(state, 'b')]) }, actor), /base or member changed/);
  await assert.rejects(store.prepare(state.id, owner, { ...input, expectedRevision: current.revision,
    base: { ...base, revision: current.revision } }, actor), /acceptance revision/);
});

test('reducer revalidates scope checksum, member evidence and source binding against immutable artifacts', async t => {
  const { store, upload, state, base, prepare } = await setup(t);
  const review = await prepare((await upload([['a', 1]], 'partial')).ref, { base, changeScope: scope([key(state, 'a')]) });
  const artifact = await store.artifact(state.id, owner, review.artifactId);
  const renamed = structuredClone(artifact); renamed.changeScopeDeclaration.name = 'Different scope assertion';
  assert.throws(() => acceptManagedChange(state, renamed, { expectedRevision: 0, reviewedDigest: review.artifactDigest,
    team: 'Team', taskRef: 'SYNTHETIC', reviewedBoundaryKeys: [key(state, 'a')] }), /reviewed partial/);
  for (const mutate of [row => row.changeScopeDeclaration.artifactChecksum = 'wrong',
    row => row.changeScopeDeclaration.members[0].baseEvidence = [],
    row => row.sourceDeclaration.baselineId = 'foreign']) {
    const forged = structuredClone(artifact); mutate(forged);
    assert.throws(() => previewManagedChange(state, forged, { team: 'Team' }), /evidence changed|Source/);
  }
});

test('shared Solution preparation API attributes bounded scope and rejects foreign roots, forged actors and anonymous writes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-change-base-api-'));
  const secret = 'SYNTHETIC_BASE_LINK_SECRET', authOrigin = 'http://127.0.0.1:43171';
  const server = createServer({ directory, baseUrl: authOrigin, sendEmail: undefined,
    sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function login(email) {
    const url = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: authOrigin }).issue(email));
    const response = await fetch(origin + url.pathname + url.search, { redirect: 'manual' });
    assert.equal(response.status, 303); return response.headers.getSetCookie()[0].split(';')[0];
  }
  const alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const post = (route, value, cookie = alice, raw = false, extra = {}) => fetch(origin + route, { method: 'POST',
    headers: { ...(cookie ? { cookie } : {}), 'X-Elma-Wiki-Request': '1', 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...extra },
    body: raw ? value : JSON.stringify(value) });
  const json = async (response, status) => { assert.equal(response.status, status); return response.json(); };
  const full = await json(await post('/api/solutions/uploads', await archive([['a', 0]]), alice, true), 201);
  const state = await json(await post('/api/solutions', { name: 'Synthetic API', baselineOwner: 'Team',
    snapshot: { projectId: full.id, snapshotId: full.currentSnapshotId, scope: 'full', scopeConfirmed: true } }), 201);
  const partial = await json(await post('/api/solutions/uploads', await archive([['a', 1]]), bob, true), 201);
  const input = { kind: 'change', expectedRevision: 0, team: 'Team', taskRef: 'SYNTHETIC', sameSourceConfirmed: true,
    snapshot: { projectId: partial.id, snapshotId: partial.currentSnapshotId, scope: 'partial', scopeConfirmed: true },
    base: { artifactId: state.baselineId, revision: 0, confirmed: true },
    changeScope: scope([state.current[0].key]) };
  const route = `/api/solutions/${state.id}/prepare`;
  await json(await post(route, input, null), 404);
  await json(await post(route, input, bob, false, { Origin: 'https://foreign.example.invalid' }), 403);
  await json(await post(route, { ...input, base: { ...input.base, declaredBy: 'forged' } }, bob), 400);
  await json(await post(route, { ...input, base: { ...input.base, artifactId: full.id } }, bob), 409);
  await json(await post(route, { ...input, changeScope: { ...input.changeScope, declaredBy: 'forged' } }, bob), 400);
  const review = await json(await post(route, input, bob), 201);
  const session = await (await fetch(origin + '/api/session', { headers: { cookie: bob } })).json();
  assert.equal(review.baseDeclaration.declaredBy, session.user.id);
  assert.equal(review.changeScopeDeclaration.declaredBy, session.user.id);
  const result = await (await fetch(origin + `/api/solutions/${state.id}/artifacts/${review.artifactId}/review`, { headers: { cookie: alice } })).json();
  assert.deepEqual(result.baseDeclaration, review.baseDeclaration);
  assert.deepEqual(result.changeScopeDeclaration, review.changeScopeDeclaration);
});

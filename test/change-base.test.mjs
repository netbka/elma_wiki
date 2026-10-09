import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { previewManagedChange } from '../lib/managed-workspace.mjs';
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

test('two partials pin the same explicit full base; restart and upload deletion preserve originals and declarations', async t => {
  const { directory, projects, store, upload, full, state, base, prepare } = await setup(t);
  const a = await upload([['a', 1]], 'partial'), c = await upload([['b', 2]], 'partial');
  const first = await prepare(a.ref, { base }), second = await prepare(c.ref, { base });
  for (const review of [first, second]) {
    assert.equal(review.baseDeclaration.status, 'declared');
    assert.equal(review.baseDeclaration.artifactId, state.baselineId);
    assert.equal(review.baseDeclaration.checksum, state.artifacts[0].checksum);
    assert.equal(review.baseDeclaration.declaredBy, actor.id);
    assert.equal(review.baseDeclaration.ancestryVerified, false);
    assert.equal(review.baseDeclaration.snapshot.snapshotId, full.ref.snapshotId);
    assert.deepEqual(review.baseDeclaration.scopeDeclaration, state.artifacts[0].scopeDeclaration);
  }
  await projects.delete(full.project.id, owner);
  const restarted = managedWorkspaceStore(directory, projects);
  assert.deepEqual((await restarted.review(state.id, owner, first.artifactId)).baseDeclaration, first.baseDeclaration);
  assert.deepEqual(await restarted.original(state.id, owner, state.baselineId), full.bytes);
  const pending = (await restarted.get(state.id, owner)).pending;
  assert.deepEqual(pending[1].baseDeclaration, second.baseDeclaration);
  await assert.rejects(restarted.review(state.id, 'foreign-owner', first.artifactId), error => error.statusCode === 404);
});

test('Source assertion, shared-source content, upload order and same team never infer change ancestry', async t => {
  const { store, upload, state, prepare } = await setup(t);
  const first = await prepare((await upload([['a', 1]], 'partial')).ref);
  assert.equal(first.baseDeclaration.status, 'unknown');
  let current = await accept(store, state, first);
  const sharedCapture = await upload([['a', 1], ['b', 2]], 'partial');
  const second = await store.prepare(state.id, owner, { kind: 'change', snapshot: sharedCapture.ref,
    expectedRevision: current.revision, team: 'Team', taskRef: 'SYNTHETIC-2', sameSourceConfirmed: true }, actor);
  assert.equal(second.baseDeclaration.status, 'unknown');
  assert.equal(second.baseDeclaration.ancestryVerified, false);
  assert.equal(Object.hasOwn(second.baseDeclaration, 'artifactId'), false);
  current = await accept(store, state, second);
  assert.equal(current.current.length, 3, 'absence in partial archives never deletes untouched objects');
  const untouched = state.current.find(row => JSON.parse(row.key)[2] === 'untouched');
  assert.ok(untouched);
  assert.equal(current.current.find(row => row.key === untouched.key).digest, untouched.digest);
  assert.equal((await store.review(state.id, owner, second.artifactId)).baseDeclaration.status, 'unknown');
});

test('base membership, full scope, acceptance revision and strict fields are validated before capture', async t => {
  const { store, upload, full, state, base, prepare } = await setup(t);
  const part = await upload([['a', 1]], 'partial');
  const pending = await prepare(part.ref);
  const other = await store.create(owner, { name: 'Other', baselineOwner: 'Team', snapshot: full.ref }, actor);
  for (const invalid of [null, {}, { ...base, confirmed: false }, { ...base, revision: 1 },
    { ...base, revision: -1 }, { ...base, artifactId: other.baselineId },
    { ...base, artifactId: pending.artifactId }, { ...base, checksum: state.artifacts[0].checksum },
    { ...base, declaredBy: 'forged' }, { ...base, source: { connectionId: 'forged' } }]) {
    await assert.rejects(prepare(part.ref, { base: invalid }));
  }
  const current = await accept(store, state, pending);
  await assert.rejects(store.prepare(state.id, owner, { kind: 'change', snapshot: part.ref,
    expectedRevision: current.revision, team: 'Team', taskRef: 'SYNTHETIC', sameSourceConfirmed: true,
    base: { artifactId: pending.artifactId, revision: current.revision, confirmed: true } }, actor), /accepted full/);
});

test('historical full bases stay immutable after a later reconciliation; reviewed digest includes the declaration', async t => {
  const { store, upload, state, base } = await setup(t);
  const nextFull = await upload([['a', 1], ['b', 0], ['untouched', 0]], 'full');
  const review = await store.prepare(state.id, owner, { kind: 'reconciliation', snapshot: nextFull.ref,
    expectedRevision: 0, baselineOwner: 'Team', sameSourceConfirmed: true, base }, actor);
  const current = await store.accept(state.id, owner, review.artifactId, {
    expectedRevision: review.revision, reviewedDigest: review.artifactDigest
  }, actor);
  const part = await upload([['b', 2]], 'partial');
  const input = { kind: 'change', snapshot: part.ref, expectedRevision: current.revision,
    team: 'Team', taskRef: 'SYNTHETIC', sameSourceConfirmed: true };
  const oldBased = await store.prepare(state.id, owner, { ...input, base }, actor);
  const newBased = await store.prepare(state.id, owner, { ...input,
    base: { artifactId: current.baselineId, revision: current.revision, confirmed: true } }, actor);
  assert.equal(oldBased.baseDeclaration.artifactId, state.baselineId);
  assert.equal(newBased.baseDeclaration.artifactId, current.baselineId);
  assert.notEqual(oldBased.artifactDigest, newBased.artifactDigest);
  const original = await store.artifact(state.id, owner, oldBased.artifactId);
  const changedDeclaration = structuredClone(original);
  changedDeclaration.baseDeclaration = structuredClone(newBased.baseDeclaration);
  assert.notEqual(previewManagedChange(current, original, { team: 'Team' }).artifactDigest,
    previewManagedChange(current, changedDeclaration, { team: 'Team' }).artifactDigest,
    'changing only base evidence invalidates the reviewed digest');
  await assert.rejects(store.accept(state.id, owner, oldBased.artifactId, {
    expectedRevision: oldBased.revision, reviewedDigest: newBased.artifactDigest
  }, actor), /reviewed/);
  assert.equal((await store.review(state.id, owner, oldBased.artifactId)).baseDeclaration.ancestryVerified, false);
});

test('legacy records disclose unrecorded ancestry without retroactive inference or persistence', async t => {
  const { directory, store, upload, state, prepare } = await setup(t);
  const review = await prepare((await upload([['a', 1]], 'partial')).ref);
  const file = path.join(directory, 'managed-workspaces', state.id, 'workspace.json');
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  delete record.pending[0].artifact.baseDeclaration;
  await fs.writeFile(file, JSON.stringify(record));
  const before = await fs.readFile(file);
  const result = await store.review(state.id, owner, review.artifactId);
  assert.deepEqual(result.baseDeclaration, { schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false });
  assert.deepEqual(await fs.readFile(file), before);
});

test('shared Solution preparation API attributes explicit bases and rejects foreign roots, forged actors and anonymous writes', async t => {
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
    base: { artifactId: state.baselineId, revision: 0, confirmed: true } };
  const route = `/api/solutions/${state.id}/prepare`;
  await json(await post(route, input, null), 404);
  await json(await post(route, input, bob, false, { Origin: 'https://foreign.example.invalid' }), 403);
  await json(await post(route, { ...input, base: { ...input.base, declaredBy: 'forged' } }, bob), 400);
  await json(await post(route, { ...input, base: { ...input.base, artifactId: full.id } }, bob), 409);
  const review = await json(await post(route, input, bob), 201);
  const session = await (await fetch(origin + '/api/session', { headers: { cookie: bob } })).json();
  assert.equal(review.baseDeclaration.declaredBy, session.user.id);
  const result = await (await fetch(origin + `/api/solutions/${state.id}/artifacts/${review.artifactId}/review`, { headers: { cookie: alice } })).json();
  assert.deepEqual(result.baseDeclaration, review.baseDeclaration);
});

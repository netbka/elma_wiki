import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { projectStore } from '../lib/projects.mjs';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { zip } from './fixture.mjs';

const endpoint = '/api/managed-workspaces';
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
const creation = snapshot => ({ name: 'Synthetic workspace', baselineOwner: 'Vendor', snapshot });
const change = (snapshot, expectedRevision = 0) => ({ kind: 'change', snapshot, expectedRevision,
  team: 'Internal', taskRef: 'TEST-1', sameSourceConfirmed: true });
const decisions = preview => ({ expectedRevision: preview.revision, reviewedDigest: preview.artifactDigest });
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value)); return value;
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-managed-api-'));
  let server, cookie;
  const projects = projectStore(directory);
  const request = (route = '', options = {}) => fetch(`http://127.0.0.1:${server.address().port}${endpoint}${route}`,
    { ...options, headers: { cookie, ...options.headers } });
  const post = (route, input, headers = {}) => request(route, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  const start = async () => {
    server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const login = await fetch(`http://127.0.0.1:${server.address().port}/auth/local`,
      { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1' } });
    assert.equal(login.status, 200); cookie = login.headers.getSetCookie()[0].split(';')[0];
  };
  const close = () => new Promise(resolve => server.close(resolve));
  t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  await start();
  const upload = async (entries, scope, { owner = 'local', source } = {}) => {
    const bytes = await archive(entries), project = source ? await projects.createSource(owner, bytes, source) : await projects.create(owner, bytes);
    return { bytes, project, ref: { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true } };
  };
  const badHost = () => new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${server.address().port}${endpoint}`, { headers: { Host: 'foreign.invalid' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject);
  });
  return { directory, projects, request, post, upload, badHost, restart: async () => { await close(); await start(); } };
}

test('HTTP lifecycle pins a full baseline, reviews changes/conflicts, restores proposals and archives/reopens', async t => {
  const { projects, request, post, upload, restart } = await setup(t);
  const baseline = await upload([['a', 'base'], ['b', 'untouched']], 'full');
  let state = await json(await post('', creation(baseline.ref)), 201), id = '/' + state.id;
  assert.equal((await json(await request()))[0].id, state.id);
  assert.equal(state.revision, 0);
  const initialAcceptedAt = state.baselineAcceptedAt;
  assert.equal(initialAcceptedAt, state.createdAt);
  const local = await upload([['a', 'ours'], ['x', 'added']], 'partial');
  const preview = await json(await post(id + '/prepare', change(local.ref)), 201);
  const artifact = id + '/artifacts/' + preview.artifactId;
  await restart();
  assert.deepEqual(await json(await request(artifact + '/preview')), preview);
  assert.equal(preview.sourceDeclaration.baselineId, state.baselineId);
  await json(await post(artifact + '/accept', decisions(preview)), 409);
  await json(await post(artifact + '/accept', { ...decisions(preview), reviewedDigest: 'substituted' }), 409);
  state = await json(await post(artifact + '/accept', { ...decisions(preview),
    reviewedBoundaryKeys: preview.rows.filter(row => row.boundaryCrossing).map(row => row.key) }));
  assert.equal(state.current.length, 3);
  assert.equal(state.baselineAcceptedAt, initialAcceptedAt);
  assert.equal(state.current.find(row => row.code === 'b').team, 'Vendor');
  await json(await post(artifact + '/accept', decisions(preview)), 404);
  const next = await upload([['a', 'vendor'], ['b', 'untouched'], ['x', 'added']], 'full');
  const reconciliation = await json(await post(id + '/prepare', { kind: 'reconciliation', snapshot: next.ref,
    expectedRevision: state.revision, baselineOwner: 'Vendor', sameSourceConfirmed: true }), 201);
  const review = id + '/artifacts/' + reconciliation.artifactId;
  await json(await post(review + '/accept', decisions(reconciliation)), 409);
  const conflict = reconciliation.rows.find(row => row.classification === 'conflict');
  state = await json(await post(review + '/accept', { ...decisions(reconciliation), resolutions: { [conflict.key]: 'keep-working' } }));
  assert.equal(state.baselineId, reconciliation.artifactId);
  assert.equal(state.baselineAcceptedAt, state.updatedAt);
  const refreshedAcceptedAt = state.baselineAcceptedAt;
  assert.equal(state.current.find(row => row.code === 'a').team, 'Internal');
  assert.equal(state.current.find(row => row.code === 'x').team, 'Vendor');
  state = await json(await post(id + '/archive', { archived: true, expectedRevision: state.revision }));
  assert.deepEqual(await json(await request()), []);
  assert.equal((await json(await request('?archived=true')))[0].id, state.id);
  await json(await post(id + '/prepare', change(local.ref, state.revision)), 409);
  state = await json(await post(id + '/archive', { archived: false, expectedRevision: state.revision }));
  assert.equal(state.baselineAcceptedAt, refreshedAcceptedAt);
  await projects.reparse(baseline.project.id, 'local');
  await projects.delete(baseline.project.id, 'local');
  await restart();
  assert.deepEqual(await json(await request(id)), state);
  const original = await request(id + '/artifacts/' + state.artifacts[0].id + '/original');
  assert.equal(original.status, 200); assert.equal(original.headers.get('cache-control'), 'no-store');
  assert.match(original.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), baseline.bytes);
});

test('HTTP authentication precedes shared artifact reads; checksum, method, CSRF and JSON gates remain enforced', async t => {
  const { directory, projects, request, post, upload, badHost } = await setup(t);
  const foreignSnapshot = await upload([['a', 'private']], 'full', { owner: 'foreign' });
  const foreign = await managedWorkspaceStore(directory, projects).create('foreign', creation(foreignSnapshot.ref));
  await fs.writeFile(path.join(directory, 'managed-workspaces', foreign.id, foreign.baselineId + '.e365'), 'corrupt private artifact');
  const foreignPath = '/' + foreign.id, missing = '/' + crypto.randomUUID();
  const anon = { headers: { cookie: '' } };
  await json(await request('', anon), 401);
  for (const id of [foreignPath, missing]) {
    for (const suffix of ['', '/artifacts/' + foreign.baselineId + '/preview', '/artifacts/' + foreign.baselineId + '/original']) {
      await json(await request(id + suffix), id === foreignPath ? 409 : 404);
      await json(await request(id + suffix, anon), 404);
    }
    for (const suffix of ['/prepare', '/archive', '/artifacts/' + foreign.baselineId + '/accept'])
      await json(await request(id + suffix, { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1' }, body: '{malformed' }), id === foreignPath ? 415 : 404);
  }
  assert.equal((await json(await request()))[0].id,foreign.id);
  await json(await post('', creation(foreignSnapshot.ref)), 201);
  const base = await upload([['a', 'base']], 'full'), input = creation(base.ref);
  await json(await post('', input, { 'X-Elma-Wiki-Request': '0' }), 403);
  await json(await post('', input, { Origin: 'https://foreign.invalid' }), 403);
  assert.equal(await badHost(), 403);
  await json(await post('', input, { 'Content-Type': 'text/plain' }), 415);
  for (const invalid of [null, [], { ...input, owner: 'foreign' }, { ...input, snapshot: { ...base.ref, source: 'forged' } },
    { ...input, snapshot: { ...base.ref, scopeConfirmed: false } }, { ...input, snapshot: { ...base.ref, snapshotId: undefined } }])
    await json(await post('', invalid), 400);
  await json(await post('', { ...input, snapshot: { ...base.ref, snapshotId: foreignSnapshot.ref.snapshotId } }), 404);
  await json(await request('', { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: '{' }), 400);
  await json(await post('', { name: 'x'.repeat(256 * 1024) }), 400);
  const state = await json(await post('', input), 201), id = '/' + state.id;
  for (const route of [id + '/prepare', id + '/archive', id + '/artifacts/' + state.baselineId + '/accept'])
    await json(await request(route), 405);
  await json(await post(id, {}), 405);
  await json(await post(id + '/artifacts/' + state.baselineId + '/original', {}), 405);
  await json(await request('?archived=1'), 400);
  await json(await request(id + '/artifacts/' + foreign.baselineId + '/original'), 404);
});

test('HTTP concurrent decisions, stale proposals and corrupt originals fail closed', async t => {
  const { directory, request, post, upload } = await setup(t);
  const base = await upload([['a', 'base']], 'full'), state = await json(await post('', creation(base.ref)), 201), id = '/' + state.id;
  const first = await upload([['x', 'first']], 'partial'), second = await upload([['y', 'second']], 'partial');
  const a = await json(await post(id + '/prepare', change(first.ref)), 201);
  const b = await json(await post(id + '/prepare', change(second.ref)), 201);
  const results = await Promise.all([a, b].map(preview => post(id + '/artifacts/' + preview.artifactId + '/accept', decisions(preview))));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const saved = await json(await request(id));
  assert.equal(saved.revision, 1); assert.equal(saved.current.length, 2); assert.equal(saved.pending[0].stale, true);
  await json(await request(id + '/artifacts/' + saved.pending[0].artifactId + '/preview'), 409);
  await json(await post(id + '/archive', { archived: true, expectedRevision: 0 }), 409);
  const file = path.join(directory, 'managed-workspaces', state.id, state.baselineId + '.e365');
  await fs.writeFile(file, 'corrupted synthetic bytes');
  await json(await request(id), 409);
  await json(await request(id + '/artifacts/' + state.baselineId + '/original'), 409);
  await json(await post(id + '/archive', { archived: true, expectedRevision: 1 }), 409);
  await fs.writeFile(file, base.bytes);
  assert.equal((await json(await request(id))).revision, 1);
});

test('HTTP Source confirmation is explicit; known different connections cannot be mixed even after a manual baseline refresh', async t => {
  const { request, post, upload } = await setup(t);
  const source = { connectionId: 'synthetic-dev', solutionRef: 'synthetic_solution' };
  const base = await upload([['a', 'base']], 'full', { source });
  let state = await json(await post('', creation(base.ref)), 201), id = '/' + state.id;
  const partial = await upload([['x', 'ours']], 'partial');
  await json(await post(id + '/prepare', { ...change(partial.ref), sameSourceConfirmed: false }), 400);
  const other = await upload([['x', 'elsewhere']], 'partial', { source: { ...source, connectionId: 'synthetic-other' } });
  await json(await post(id + '/prepare', change(other.ref)), 409);
  const full = await upload([['a', 'new']], 'full');
  const prepared = await json(await post(id + '/prepare', { kind: 'reconciliation', snapshot: full.ref,
    expectedRevision: 0, baselineOwner: 'Vendor', sameSourceConfirmed: true }), 201);
  state = await json(await post(id + '/artifacts/' + prepared.artifactId + '/accept', decisions(prepared)));
  await json(await post(id + '/prepare', change(other.ref, state.revision)), 409);
  const manual = await json(await post(id + '/prepare', change(partial.ref, state.revision)), 201);
  assert.equal(manual.snapshot.source, null);
  assert.equal(manual.sourceDeclaration.method, 'explicit-assertion');
  assert.equal(manual.sourceDeclaration.declaredBy, 'local');
  assert.equal((await json(await request(id))).revision, state.revision);
});

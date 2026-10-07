import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { projectStore } from '../lib/projects.mjs';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { zip } from './fixture.mjs';

const endpoint = '/api/solutions';
const secret = 'SYNTHETIC_LINK_SECRET_NOT_A_REAL_CREDENTIAL';
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION', isAuthor: true }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
async function json(response, status = 200) {
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-solutions-'));
  let server;
  const start = async () => {
    const sendVk = Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret });
    server = createServer({ directory, sendEmail: undefined, sendVk });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  };
  const close = () => new Promise(resolve => server.close(resolve));
  await start();
  t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (route, cookie, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`,
    { ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  const post = (route, cookie, input, headers = {}) => request(route, cookie, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  const login = async email => {
    const link = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(link.pathname + link.search, null, { redirect: 'manual' });
    assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    const { user } = await json(await request('/api/session', cookie));
    return { cookie, user };
  };
  const upload = async (cookie, entries, route = endpoint + '/uploads?sharedConfirmed=true') => json(await request(route, cookie, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: await archive(entries) }), 201);
  const ref = (project, scope) => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true });
  const create = (cookie, project) => post(endpoint, cookie, { name: 'Synthetic Solution', baselineOwner: 'Vendor', snapshot: ref(project, 'full'), sharedConfirmed: true });
  return { directory, request, post, login, upload, ref, create, restart: async () => { await close(); await start(); } };
}

test('two trusted VK actors share admitted Solutions and retain distinct upload, acceptance and archive authors after restart', async t => {
  const { directory, request, post, login, upload, ref, create, restart } = await setup(t);
  let a = await login('alice@example.org'), b = await login('bob@example.org');
  const full = await upload(a.cookie, [['base', 1]]);
  assert.deepEqual(full.uploadedBy, a.user);
  let state = await json(await create(b.cookie, full), 201);
  assert.deepEqual(state.createdBy, b.user);
  assert.deepEqual(state.artifacts[0].uploadedBy, a.user);
  assert.equal(state.artifacts[0].scopeDeclaration.declaredBy, b.user.id);
  assert.equal(state.baselineOwner, 'Vendor'); // Product actors do not replace source/team evidence.
  assert.equal((await json(await request(endpoint, a.cookie)))[0].id, state.id);
  assert.deepEqual(await json(await request(endpoint, a.cookie)), await json(await request(endpoint, b.cookie)));
  const partial = await upload(b.cookie, [['added', 2]]), route = endpoint + '/' + state.id;
  const review = await json(await post(route + '/prepare', a.cookie, { kind: 'change', snapshot: ref(partial, 'partial'),
    expectedRevision: state.revision, team: 'Internal', taskRef: 'SYNTHETIC-CHANGE', sameSourceConfirmed: true }), 201);
  const artifact = route + '/artifacts/' + review.artifactId;
  const beforeFailure = await json(await request(route, a.cookie));
  await json(await post(artifact + '/accept', b.cookie, { expectedRevision: review.revision, reviewedDigest: 'forged' }), 409);
  assert.deepEqual(await json(await request(route, b.cookie)), beforeFailure);
  state = await json(await post(artifact + '/accept', b.cookie, { expectedRevision: review.revision, reviewedDigest: review.artifactDigest }));
  assert.deepEqual(state.artifacts.at(-1).uploadedBy, b.user);
  assert.deepEqual(state.audit.map(row => [row.action, row.actor.id]), [
    ['created', b.user.id], ['prepared', a.user.id], ['change-accepted', b.user.id]
  ]);
  state = await json(await post(route + '/archive', a.cookie, { archived: true, expectedRevision: state.revision }));
  assert.deepEqual(state.audit.at(-1).actor, a.user);
  const actorFiles = await fs.readdir(path.join(directory, 'actors'));
  assert.equal(actorFiles.length, 2);
  const stored = await Promise.all(actorFiles.map(file => fs.readFile(path.join(directory, 'actors', file), 'utf8').then(JSON.parse)));
  await restart();
  a = await login('ALICE@example.org'); b = await login('bob@example.org');
  assert.deepEqual(await Promise.all(actorFiles.map(file => fs.readFile(path.join(directory, 'actors', file), 'utf8').then(JSON.parse))), stored);
  assert.equal(a.user.id, 'vk:' + crypto.createHash('sha256').update('alice@example.org').digest('hex'));
  assert.deepEqual(await json(await request(route, b.cookie)), state);
  assert.equal((await json(await request(endpoint + '?archived=true', b.cookie)))[0].id, state.id);
  state = await json(await post(route + '/archive', b.cookie, { archived: false, expectedRevision: state.revision }));
  assert.equal((await json(await request(endpoint, a.cookie)))[0].id, state.id);
  assert.equal(state.audit.at(-1).action, 'reopened');
});

test('shared admission never exposes legacy private uploads or workspaces, and caller fields cannot forge identity', async t => {
  const { directory, request, post, login, upload, ref, create } = await setup(t);
  const a = await login('alice@example.org'), b = await login('bob@example.org');
  const legacy = await upload(a.cookie, [['private', 1]], '/api/projects');
  const oldStore = managedWorkspaceStore(directory, projectStore(directory));
  const old = await oldStore.create(a.user.id, { name: 'Private legacy', baselineOwner: 'Vendor', snapshot: ref(legacy, 'full') });
  assert.deepEqual(await json(await request(endpoint, b.cookie)), []);
  for (const route of ['/api/projects/' + legacy.id + '/data', '/api/managed-workspaces/' + old.id,
    endpoint + '/' + old.id, endpoint + '/' + old.id + '/artifacts/' + old.baselineId + '/original'])
    assert.equal((await request(route, b.cookie)).status, 404);
  await json(await create(a.cookie, legacy), 404); // Matching owner and UUID are not admission.
  const shared = await upload(a.cookie, [['shared', 1]]);
  const input = { name: 'Shared', baselineOwner: 'Vendor', snapshot: ref(shared, 'full'), sharedConfirmed: true };
  for (const extra of [{ owner: b.user.id }, { actor: b.user }, { uploadedBy: b.user }])
    await json(await post(endpoint, a.cookie, { ...input, ...extra }), 400);
  await json(await post(endpoint, a.cookie, { ...input, sharedConfirmed: false }), 400);
  const state = await json(await post(endpoint, a.cookie, input, { 'X-Actor-Id': b.user.id }), 201);
  assert.deepEqual(state.createdBy, a.user);
  assert.deepEqual(await json(await request('/api/managed-workspaces', b.cookie)), []);
  assert.deepEqual(await json(await request('/api/projects', b.cookie)), []);
  assert.equal((await request('/api/projects/' + shared.id + '/data', a.cookie)).status, 404);
  assert.equal((await request('/p/' + shared.id + '/data.json', a.cookie)).status, 404);
  assert.equal((await request('/api/managed-workspaces/' + state.id, a.cookie)).status, 404);
  assert.equal((await request('/api/projects/' + legacy.id + '/data', a.cookie)).status, 200);
});

test('anonymous, cross-origin and unconfirmed catalog writes fail before data access', async t => {
  const { request, post, login, upload, create } = await setup(t);
  const a = await login('alice@example.org');
  const shared = await upload(a.cookie, [['shared', 1]]), state = await json(await create(a.cookie, shared), 201);
  await json(await request(endpoint, null), 401);
  for (const suffix of ['', '/prepare', '/archive', '/artifacts/' + state.baselineId + '/original'])
    assert.equal((await post(endpoint + '/' + state.id + suffix, null, {})).status, 404);
  assert.equal((await request(endpoint + '/' + state.id, null)).status, 404);
  await json(await post(endpoint, a.cookie, {}, { Origin: 'https://foreign.invalid' }), 403);
  await json(await post(endpoint, a.cookie, {}, { 'X-Elma-Wiki-Request': '' }), 403);
  await json(await post(endpoint + '/uploads', null, {}), 401);
  await json(await request(endpoint + '/uploads', a.cookie, { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: await archive([['shared', 1]]) }), 400);
});

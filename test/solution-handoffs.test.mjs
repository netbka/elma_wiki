import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { readArchive } from '../lib/e365.mjs';
import { zip } from './fixture.mjs';

const secret = 'SYNTHETIC_HANDOFF_SECRET', actor = { id: 'synthetic', login: 'synthetic@example.org', provider: 'local' };
const archive = value => zip([['package.json', { code: 'synthetic_solution', type: 'SOLUTION', history: [{ version: 'test' }] }],
  ['widgets/manifest.json', { entities: [{ code: 'base', namespace: 'synthetic', kind: 'WIDGET', path: 'base.json' }] }],
  ['widgets/base.json', { descriptor: { clientScripts: `const value = ${value};` } }]]);
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-solution-handoff-'));
  let server;
  const start = async () => { server = createServer({ directory, sendEmail: undefined,
    sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); };
  const stop = () => new Promise(resolve => server.close(resolve));
  await start(); t.after(async () => { await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (route, cookie, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  const json = async (response, status = 200) => { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value; };
  const post = (route, cookie, input, headers = {}) => request(route, cookie, { method: 'POST', body: JSON.stringify(input),
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers } });
  const login = async email => { const url = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(url.pathname + url.search, null, { redirect: 'manual' }); assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie()[0].split(';')[0]; return { cookie, user: (await json(await request('/api/session', cookie))).user }; };
  const bytes = await archive(1);
  const alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const upload = await json(await request('/api/solutions/uploads?sharedConfirmed=true', alice.cookie, { method: 'POST', body: bytes,
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' } }), 201);
  const state = await json(await post('/api/solutions', alice.cookie, { sharedConfirmed: true, name: 'Synthetic Solution', baselineOwner: 'Vendor',
    snapshot: { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true } }), 201);
  const route = '/api/solutions/' + state.id + '/handoffs';
  const create = async () => json(await post(route, alice.cookie, { expectedRevision: state.revision, title: 'Synthetic handoff', intent: 'Review exact full export', targetIntent: 'Offline operator' }), 201);
  const prepare = async release => {
    const update = async (input, person = bob) => json(await post(route + '/' + release.id, person.cookie, { revision: release.revision, ...input }));
    release = await update({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'No previous package; Target and runtime unverified', notes: '' });
    for (const item of release.changes) release = await update({ action: 'review', path: item.path, decision: 'accepted', reason: 'Exact source reviewed' });
    release = await update({ action: 'freeze' });
    release = await update({ action: 'approve', reason: 'Offline handoff only' }, alice);
    return release;
  };
  return { directory, alice, bob, state, upload, bytes, route, request, post, json, create, prepare,
    restart: async () => { await stop(); await start(); return login('alice@example.org'); } };
}

test('Solution handoff uses the existing release lifecycle and exact full bytes with distinct actors', async t => {
  const { directory, alice, bob, state, upload, bytes, route, request, post, json, create, prepare, restart } = await setup(t);
  let release = await create();
  assert.deepEqual(release.createdBy, alice.user);
  assert.equal(release.sourceAssociation.solutionId, state.id);
  assert.equal(release.sourceAssociation.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(release.source.inventory.length, 3);
  assert.ok(release.source.parserVersion);
  const raw = new releaseStore(path.join(directory, 'shared-solutions'), null);
  await assert.rejects(raw.candidateArtifact(release.id, SOLUTION_CATALOG), /verification is unavailable/);
  release = await prepare(release);
  assert.deepEqual(release.approval.actor, alice.user);
  assert.deepEqual(release.history.find(row => row.action === 'freeze').actor, bob.user);
  const response = await post(route + '/' + release.id + '/bundle', bob.cookie, { revision: release.revision });
  assert.equal(response.status, 200);
  const files = await readArchive(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(files.get('candidate.e365'), bytes);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.deploymentAuthorized, false);
  assert.equal(manifest.verified, false);
  assert.equal(manifest.release.sourceAssociation.artifactId, state.baselineId);
  assert.equal(manifest.release.checks.find(row => row.id === 'target').result, 'not-run');
  assert.equal((await json(await request(route, bob.cookie)))[0].state, 'handed-off');
  await solutionStore(directory).uploads.delete(upload.id, SOLUTION_CATALOG);
  const again = await restart();
  release = await json(await request(route + '/' + release.id, again.cookie));
  assert.equal(release.associationStatus, 'current');
  assert.deepEqual(release.history.at(-1).actor, bob.user);
  assert.equal((await request('/api/releases/' + release.id, again.cookie)).status, 404);
  assert.equal((await request(route, null)).status, 404);
  assert.equal((await request('/api/solutions/' + crypto.randomUUID() + '/handoffs/' + release.id, again.cookie)).status, 404);
  await json(await post(route, again.cookie, { expectedRevision: state.revision, owner: bob.user.id }), 400);
  await json(await post(route + '/' + release.id, again.cookie, { revision: release.revision, action: 'freeze', actor: bob.user }), 400);
  await json(await post(route + '/' + release.id, again.cookie, {}, { Origin: 'https://foreign.example.invalid' }), 403);
});

test('Solution mutation invalidates frozen approval and handoff, with stale history still readable', async t => {
  const { alice, bob, state, route, request, post, json, create, prepare } = await setup(t);
  const release = await prepare(await create());
  await json(await post('/api/solutions/' + state.id + '/archive', alice.cookie, { archived: true, expectedRevision: state.revision }));
  const stale = await json(await request(route + '/' + release.id, bob.cookie));
  assert.equal(stale.associationStatus, 'stale');
  assert.ok(stale.blockers.some(value => /Решение/.test(value)));
  assert.notEqual(stale.state, 'prepared');
  assert.equal((await json(await request(route, bob.cookie)))[0].associationStatus, 'stale');
  await json(await post(route + '/' + release.id + '/bundle', bob.cookie, { revision: release.revision }), 409);
  await json(await post(route + '/' + release.id, alice.cookie, { revision: release.revision, action: 'approve', reason: 'Old approval' }), 409);
});

test('discussion changes invalidate association even without domain revision changes or open findings', async t => {
  const { directory, alice, bob, state, route, request, post, json } = await setup(t);
  const store = solutionStore(directory), bytes = await archive(2), upload = await store.uploads.create(SOLUTION_CATALOG, bytes, 'full.e365', actor);
  const proof = await store.managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'reconciliation', expectedRevision: state.revision,
    snapshot: { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true }, baselineOwner: 'Vendor', sameSourceConfirmed: true }, actor);
  const current = await store.managed.accept(state.id, SOLUTION_CATALOG, proof.artifactId,
    { expectedRevision: proof.revision, reviewedDigest: proof.artifactDigest }, actor);
  const release = await json(await post(route, alice.cookie, { expectedRevision: current.revision, title: 'Current full', intent: 'Offline', targetIntent: 'Operator' }), 201);
  await store.managed.comment(state.id, SOLUTION_CATALOG, proof.artifactId, { expectedRevision: current.revision,
    expectedDiscussionRevision: 1, type: 'comment', text: 'Review evidence added' }, actor);
  assert.equal((await store.managed.get(state.id, SOLUTION_CATALOG)).revision, current.revision);
  assert.equal((await json(await request(route + '/' + release.id, bob.cookie))).associationStatus, 'stale');
  await json(await post(route + '/' + release.id, bob.cookie, { revision: release.revision, action: 'freeze' }), 409);
  const next = await json(await post(route, alice.cookie, { expectedRevision: current.revision, title: 'Fresh review', intent: 'Offline', targetIntent: 'Operator' }), 201);
  assert.notEqual(next.sourceAssociation.reviewDigest, release.sourceAssociation.reviewDigest);
});

test('Solution guard holds through release persistence and refuses approval after a queued archive', async t => {
  const { directory, state, create } = await setup(t);
  const store = solutionStore(directory), release = await create();
  const originalRename = fs.rename;
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { finish = resolve; });
  fs.rename = async (source, target) => {
    if (String(target).endsWith(path.join('releases', release.id, 'release.json'))) { entered(); await hold; }
    return originalRename(source, target);
  };
  let update, archive;
  try {
    update = store.handoffs.change(state.id, release.id, { revision: release.revision, action: 'details',
      title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'Offline only', notes: '' }, actor);
    await started;
    let archived = false;
    archive = store.managed.setArchived(state.id, SOLUTION_CATALOG, { expectedRevision: state.revision, archived: true }, actor).then(value => { archived = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(archived, false, 'Solution mutation cannot race the guarded release write');
    finish(); await update; await archive;
  } finally { finish(); fs.rename = originalRename; await Promise.allSettled([update, archive].filter(Boolean)); }
  await assert.rejects(store.handoffs.change(state.id, release.id, { revision: 2, action: 'approve', reason: 'Stale approval' }, actor), /revision changed|Reopen/);
});

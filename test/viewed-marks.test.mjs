import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from './fixture.mjs';
import { managedFixture } from '../web/managed/fixtures.js';
import { viewedProgress } from '../web/managed/model.js';

const endpoint = '/api/solutions';
const secret = 'SYNTHETIC_VIEWED_MARKS_LINK_SECRET';
const archive = entries => zip([
  ['package.json', { code: 'synthetic_viewed', type: 'SOLUTION', isAuthor: true }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
async function json(response, status = 200) {
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-viewed-'));
  let server;
  const start = async () => {
    server = createServer({ directory, sendEmail: undefined, sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }), bugPublisher: null });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  };
  const close = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  await start();
  t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (route, cookie, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`,
    { ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  const post = (route, cookie, input) => request(route, cookie, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const login = async email => {
    const link = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(link.pathname + link.search, null, { redirect: 'manual' });
    assert.equal(response.status, 303);
    return response.headers.getSetCookie()[0].split(';')[0];
  };
  const upload = async (cookie, entries) => json(await request(endpoint + '/uploads', cookie, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: await archive(entries) }), 201);
  const ref = (project, scope) => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true });
  return { request, post, login, upload, ref, restart: async () => { await close(); await start(); } };
}

test('UX-08: viewed marks are per actor, bind the object digest, clear on a changed correction and survive restart', async t => {
  const { request, post, login, upload, ref, restart } = await setup(t);
  let alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const state = await json(await post(endpoint, alice, { name: 'Synthetic viewed', baselineOwner: 'Vendor', snapshot: ref(await upload(alice, [['base', 1], ['other', 1]]), 'full') }), 201);
  const route = endpoint + '/' + state.id;
  const prepare = async (entries, extra = {}) => json(await post(route + '/prepare', bob, { kind: 'change', snapshot: ref(await upload(bob, entries), 'partial'),
    expectedRevision: state.revision, team: 'Internal', taskRef: 'SYNTHETIC-VIEWED', sameSourceConfirmed: true, ...extra }), 201);
  const first = (await prepare([['base', 2], ['other', 2]])).artifactId;
  const review = (id, cookie) => request(route + '/artifacts/' + id + '/review', cookie).then(response => json(response));
  const mark = (id, cookie, input, status) => post(route + '/artifacts/' + id + '/viewed', cookie, input).then(response => json(response, status));
  const statusOf = (current, code) => current.viewed.rows.find(row => JSON.parse(row.key).at(-1) === code);

  let current = await review(first, alice);
  assert.equal(current.viewed.rows.length, 2); assert.ok(current.viewed.rows.every(row => row.status === 'unviewed' && /^[0-9a-f]{64}$/.test(row.digest)));
  const base = statusOf(current, 'base'), other = statusOf(current, 'other');
  const before = await json(await request(route, alice)), file = { revision: before.revision, updatedAt: before.updatedAt, audit: before.audit.length };

  // Only the session names the actor; the caller states object, shown digest and mark.
  await mark(first, alice, { key: base.key, digest: base.digest, viewed: true, actor: { id: 'forged' } }, 400);
  await mark(first, alice, { key: base.key, digest: base.digest, viewed: 'yes' }, 400);
  await mark(first, alice, { key: base.key, digest: other.digest, viewed: true }, 409);
  await mark(first, alice, { key: 'not-an-object', digest: base.digest, viewed: true }, 409);
  assert.equal((await post(route + '/artifacts/' + first + '/viewed', null, { key: base.key, digest: base.digest, viewed: true })).status, 404);

  let marks = await mark(first, alice, { key: base.key, digest: base.digest, viewed: true });
  assert.equal(statusOf({ viewed: marks }, 'base').status, 'viewed'); assert.equal(marks.actor.login, 'alice@example.org');
  await mark(first, bob, { key: other.key, digest: other.digest, viewed: true });
  // Multi-actor: each person sees only their own marks.
  current = await review(first, alice);
  assert.deepEqual(current.viewed.rows.map(row => row.status), current.viewed.rows.map(row => row.key === base.key ? 'viewed' : 'unviewed'));
  current = await review(first, bob);
  assert.deepEqual(current.viewed.rows.map(row => row.status), current.viewed.rows.map(row => row.key === other.key ? 'viewed' : 'unviewed'));
  // Personal reading progress never advances the Solution, its audit or the discussion.
  const after = await json(await request(route, alice));
  assert.deepEqual({ revision: after.revision, updatedAt: after.updatedAt, audit: after.audit.length }, file);
  assert.equal(current.discussion.version, 0);

  await restart(); alice = await login('alice@example.org'); bob = await login('bob@example.org');
  assert.equal(statusOf(await review(first, alice), 'base').status, 'viewed');
  assert.equal(statusOf(await review(first, bob), 'other').status, 'viewed');

  // A correction continues the change: the edited object loses Alice's mark,
  // the untouched object keeps Bob's, and the replaced review takes no marks.
  const second = (await prepare([['base', 3], ['other', 2]], { supersedesArtifactId: first })).artifactId;
  current = await review(second, alice);
  assert.equal(statusOf(current, 'base').status, 'changed'); assert.notEqual(statusOf(current, 'base').digest, base.digest);
  assert.equal(statusOf(current, 'other').status, 'unviewed');
  assert.equal(statusOf(await review(second, bob), 'other').status, 'viewed');
  await mark(first, alice, { key: base.key, digest: base.digest, viewed: true }, 409);
  const changed = statusOf(current, 'base');
  marks = await mark(second, alice, { key: changed.key, digest: changed.digest, viewed: true });
  assert.equal(statusOf({ viewed: marks }, 'base').status, 'viewed');
  marks = await mark(second, alice, { key: changed.key, digest: changed.digest, viewed: false });
  assert.equal(statusOf({ viewed: marks }, 'base').status, 'unviewed');
  assert.equal(statusOf(await review(second, alice), 'base').status, 'unviewed');
});

test('UX-08 progress counts only current marks on changed objects; fixtures cover marked, cleared-by-change and a second actor', () => {
  assert.equal(viewedProgress(managedFixture('summary-mixed').review), null);
  const marked = viewedProgress(managedFixture('viewed-marked').review);
  assert.deepEqual({ viewed: marked.viewed, total: marked.total, changed: marked.changedSinceViewed, line: marked.line }, { viewed: 2, total: 4, changed: 0, line: 'Просмотрено · 2 из 4' });
  const cleared = viewedProgress(managedFixture('viewed-changed').review);
  assert.deepEqual([cleared.viewed, cleared.total, cleared.changedSinceViewed], [1, 4, 1]);
  const second = managedFixture('viewed-second-actor').review;
  assert.notEqual(second.viewed.actor.id, managedFixture('viewed-marked').review.viewed.actor.id);
  assert.deepEqual([viewedProgress(second).viewed, viewedProgress(second).total], [1, 4]);
  // Marks on unchanged rows never count toward the changed-object progress.
  const unchanged = managedFixture('viewed-marked').review;
  for (const row of unchanged.viewed.rows) row.status = 'viewed';
  assert.equal(viewedProgress(unchanged).viewed, 4);
});

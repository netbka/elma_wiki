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
import { visualSource } from '../web/visual/fixtures.js';

const endpoint = '/api/solutions';
test('bug rejection blocks acceptance once, survives cross-store recovery and refuses stale review without publishing', async t => {
  let publications = 0;
  const publisher = { repository: 'example/synthetic', publish: async () => { publications++; return { number: 85, url: 'https://github.com/example/synthetic/issues/85' }; } };
  const { directory, request, post, login, upload, ref, create, restart } = await setup(t, { bugPublisher: publisher });
  let a = await login('alice@example.org');
  const state = await json(await create(a.cookie, await upload(a.cookie, [['base', 1]])), 201), route = endpoint + '/' + state.id;
  const review = await json(await post(route + '/prepare', a.cookie, { kind: 'change', snapshot: ref(await upload(a.cookie, [['base', 2]]), 'partial'), expectedRevision: state.revision, team: 'Internal', taskRef: 'BUG-TEST', sameSourceConfirmed: true }), 201);
  const input = { id: crypto.randomUUID(), title: 'Synthetic rejection', text: 'x'.repeat(8000), kind: 'reject', publishConfirmed: true, attachments: [], context: { route: '/solutions', viewport: { width: 1280, height: 720, devicePixelRatio: 1 }, solutionId: state.id, artifactId: review.artifactId, expectedRevision: state.revision, expectedDiscussionRevision: 0 } };
  const result = await json(await post('/api/bug-reports', a.cookie, input), 201);
  assert.equal(result.rejection.status, 'applied'); assert.equal(result.status, 'published'); assert.equal(publications, 1);
  let current = await json(await request(route + '/artifacts/' + review.artifactId + '/review', a.cookie));
  assert.equal(current.discussion.blocking, 1); assert.deepEqual(current.discussion.findings[0].actor, a.user);
  assert.equal((await json(await request(route, a.cookie))).pending[0].decision, 'needs-changes');
  await json(await post(route + '/artifacts/' + review.artifactId + '/accept', a.cookie, { expectedRevision: state.revision, reviewedDigest: review.artifactDigest, expectedDiscussionRevision: 1 }), 409);
  // Model a crash after the review store commit but before its receipt reaches the report store.
  const file = path.join(directory, 'bug-reports', input.id, 'report.json');
  const record = JSON.parse(await fs.readFile(file, 'utf8')); delete record.rejection; await fs.writeFile(file, JSON.stringify(record));
  await restart(); a = await login('alice@example.org');
  const restored = await json(await post('/api/bug-reports/' + input.id + '/retry', a.cookie, {}));
  assert.equal(restored.rejection.status, 'applied'); assert.equal(publications, 1);
  current = await json(await request(route + '/artifacts/' + review.artifactId + '/review', a.cookie)); assert.equal(current.discussion.version, 1);
  const stale = await json(await post('/api/bug-reports', a.cookie, { ...input, id: crypto.randomUUID() }), 201);
  assert.equal(stale.status, 'blocked'); assert.equal(stale.issue, null); assert.equal(publications, 1);
  const reused = { expectedRevision: state.revision, expectedDiscussionRevision: 0, type: 'reject', text: 'different', operationId: input.id };
  await json(await post(route + '/artifacts/' + review.artifactId + '/discussion', a.cookie, reused), 409);
});
const secret = 'SYNTHETIC_LINK_SECRET_NOT_A_REAL_CREDENTIAL';
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION', isAuthor: true }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
async function json(response, status = 200) {
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-solutions-'));
  let server;
  const start = async () => {
    const sendVk = Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret });
    server = createServer({ directory, sendEmail: undefined, sendVk, bugPublisher: null, ...options });
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
  const uploadBytes = async (cookie, bytes) => json(await request(endpoint + '/uploads?sharedConfirmed=true', cookie, { method: 'POST',
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: bytes }), 201);
  const ref = (project, scope) => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true });
  const create = (cookie, project) => post(endpoint, cookie, { name: 'Synthetic Solution', baselineOwner: 'Vendor', snapshot: ref(project, 'full'), sharedConfirmed: true });
  return { directory, request, post, login, upload, uploadBytes, ref, create, restart: async () => { await close(); await start(); } };
}

test('accepted export API binds exact shared full bytes to a revision without authorizing delivery', async t => {
  const { request, post, login, uploadBytes, create, restart } = await setup(t);
  let a = await login('alice@example.org'), b = await login('bob@example.org');
  const bytes = await archive([['base', 1]]), project = await uploadBytes(a.cookie, bytes);
  let state = await json(await create(a.cookie, project), 201);
  const route = endpoint + '/' + state.id + '/accepted-export';
  const url = route + '?expectedRevision=' + state.revision;
  const proof = await json(await request(url, b.cookie));
  assert.equal(proof.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(proof.policy, 'accepted-full-export-v1');
  assert.equal(proof.snapshot.checksum, proof.sha256);
  assert.equal(proof.deploymentAuthorized, false);
  assert.equal(proof.verified, false);
  assert.equal(proof.checks.compiler, 'not-run');
  assert.deepEqual(proof.acceptedBy, a.user);
  const original = await request(route + '/original?expectedRevision=' + state.revision, b.cookie);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get('x-artifact-sha256'), proof.sha256);
  assert.equal(original.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
  for (const suffix of ['', '?expectedRevision=-1', '?expectedRevision=0.0', '?expectedRevision=', '?expectedRevision=9007199254740992', '?expectedRevision=0&expectedRevision=0'])
    await json(await request(route + suffix, a.cookie), 400);
  await json(await request(url, null), 404);
  await json(await post(url, a.cookie, {}), 405);
  await json(await request(endpoint + '/' + crypto.randomUUID() + '/accepted-export', a.cookie), 404);
  await restart(); b = await login('bob@example.org'); a = await login('alice@example.org');
  assert.deepEqual(await json(await request(url, b.cookie)), proof);
  state = await json(await post(endpoint + '/' + state.id + '/archive', a.cookie, { expectedRevision: state.revision, archived: true }));
  await json(await request(url, b.cookie), 409);
  await json(await request(route + '?expectedRevision=' + state.revision, b.cookie), 409);
});

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

test('authenticated users share legacy content while roots and actor identity remain distinct', async t => {
  const { directory, request, post, login, upload, ref, create, restart } = await setup(t);
  let a = await login('alice@example.org'), b = await login('bob@example.org');
  const legacy = await upload(a.cookie, [['legacy', 1]], '/api/projects');
  const oldStore = managedWorkspaceStore(directory, projectStore(directory));
  const old = await oldStore.create(a.user.id, { name: 'Private legacy', baselineOwner: 'Vendor', snapshot: ref(legacy, 'full') });
  assert.deepEqual(await json(await request(endpoint, b.cookie)), []);
  for (const route of ['/api/projects/' + legacy.id + '/data', '/api/managed-workspaces/' + old.id]) {
    assert.equal((await request(route, b.cookie)).status, 200);
    assert.equal((await request(route, null)).status, 404);
  }
  for (const route of [endpoint + '/' + old.id, endpoint + '/' + old.id + '/artifacts/' + old.baselineId + '/original',
    endpoint + '/' + old.id + '/accepted-export?expectedRevision=0', endpoint + '/' + old.id + '/accepted-export/original?expectedRevision=0'])
    assert.equal((await request(route, b.cookie)).status, 404);
  await json(await create(a.cookie, legacy), 404); // Matching owner and UUID are not admission.
  const shared = await upload(a.cookie, [['shared', 1]]);
  const input = { name: 'Shared', baselineOwner: 'Vendor', snapshot: ref(shared, 'full'), sharedConfirmed: true };
  for (const extra of [{ owner: b.user.id }, { actor: b.user }, { uploadedBy: b.user }])
    await json(await post(endpoint, a.cookie, { ...input, ...extra }), 400);
  await json(await post(endpoint, a.cookie, { ...input, sharedConfirmed: false }), 400);
  const state = await json(await post(endpoint, a.cookie, input, { 'X-Actor-Id': b.user.id }), 201);
  assert.deepEqual(state.createdBy, a.user);
  assert.equal((await json(await request('/api/managed-workspaces', b.cookie)))[0].id, old.id);
  assert.equal((await json(await request('/api/projects', b.cookie)))[0].id, legacy.id);
  assert.equal((await request('/api/projects/' + shared.id + '/data', a.cookie)).status, 404);
  assert.equal((await request('/p/' + shared.id + '/data.json', a.cookie)).status, 404);
  assert.equal((await request('/api/managed-workspaces/' + state.id, a.cookie)).status, 404);
  assert.equal((await request('/api/projects/' + legacy.id + '/data', a.cookie)).status, 200);
  const metadata = await fs.readFile(path.join(directory,'projects',legacy.id,'project.json'),'utf8');
  await restart(); a = await login('alice@example.org'); b = await login('bob@example.org');
  assert.equal((await json(await request('/api/projects',b.cookie)))[0].id,legacy.id);
  assert.equal((await request('/api/managed-workspaces/'+old.id,b.cookie)).status,200);
  assert.equal(await fs.readFile(path.join(directory,'projects',legacy.id,'project.json'),'utf8'),metadata);
  const stored = JSON.parse(metadata);
  assert.equal(stored.owner,a.user.id); assert.deepEqual(stored.uploadedBy,a.user);
});

test('anonymous and cross-origin writes fail; sharing needs no separate confirmation', async t => {
  const { request, post, login, upload, create, ref } = await setup(t);
  const a = await login('alice@example.org');
  const home = await request('/', a.cookie, { redirect: 'manual' });
  assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/solutions');
  const shell = await request('/solutions', a.cookie); assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Решения/);
  const anonymousShell = await request('/solutions', null, { redirect: 'manual' });
  assert.equal(anonymousShell.status, 302); assert.equal(anonymousShell.headers.get('location'), '/login');
  const shared = await upload(a.cookie, [['shared', 1]]), state = await json(await create(a.cookie, shared), 201);
  await json(await request(endpoint, null), 401);
  for (const suffix of ['', '/prepare', '/archive', '/artifacts/' + state.baselineId + '/original'])
    assert.equal((await post(endpoint + '/' + state.id + suffix, null, {})).status, 404);
  assert.equal((await request(endpoint + '/' + state.id, null)).status, 404);
  await json(await post(endpoint, a.cookie, {}, { Origin: 'https://foreign.invalid' }), 403);
  await json(await post(endpoint, a.cookie, {}, { 'X-Elma-Wiki-Request': '' }), 403);
  await json(await post(endpoint + '/uploads', null, {}), 401);
  const automatic = await json(await request(endpoint + '/uploads', a.cookie, { method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: await archive([['shared', 1]]) }), 201);
  await json(await post(endpoint, a.cookie, { name: 'Automatic sharing', baselineOwner: 'Vendor', snapshot: ref(automatic, 'full') }), 201);
});

test('attributed findings survive explicit corrections and block stale or unresolved acceptance', async t => {
  const { request, post, login, upload, ref, create, restart } = await setup(t);
  let a = await login('alice@example.org'), b = await login('bob@example.org');
  let state = await json(await create(a.cookie, await upload(a.cookie, [['base', 1]])), 201);
  const route = endpoint + '/' + state.id;
  const prepare = async (entries, extra = {}) => json(await post(route + '/prepare', b.cookie, { kind: 'change',
    snapshot: ref(await upload(b.cookie, entries), 'partial'), expectedRevision: state.revision,
    team: 'Internal', taskRef: 'SYNTHETIC-REVIEW', sameSourceConfirmed: true, ...extra }), 201);
  let review = await prepare([['base', 2]]), aid = review.artifactId;
  const pathFor = id => route + '/artifacts/' + id;
  const get = id => request(pathFor(id) + '/review', a.cookie).then(json);
  const event = (id, version, type, text, extra = {}, cookie = a.cookie) => post(pathFor(id) + '/discussion', cookie,
    { expectedRevision: state.revision, expectedDiscussionRevision: version, type, text, ...extra });
  const key = review.rows[0].key;
  for (const forged of [{ actor: b.user }, { author: 'forged' }])
    await json(await event(aid, 0, 'comment', 'Comment', forged), 400);
  await json(await event(aid, 0, 'approve', 'Forged acceptance'), 400);
  await json(await event(aid, 0, 'comment', 'Unrelated key', { componentKey: 'not-an-object' }), 404);
  let discussion = await json(await event(aid, 0, 'comment', '<script>inert</script>', { componentKey: key }));
  assert.deepEqual(discussion.findings[0].actor, a.user);
  discussion = await json(await event(aid, 1, 'reject', 'Return path needs a reason', { componentKey: key }, b.cookie));
  const finding = discussion.findings[1], originalAnchor = finding.anchor;
  assert.equal(discussion.blocking, 1); assert.deepEqual(finding.actor, b.user);
  const accept = (id, proof, version) => post(pathFor(id) + '/accept', a.cookie, { expectedRevision: state.revision,
    reviewedDigest: proof.artifactDigest, reviewedBoundaryKeys: [key], ...(version !== undefined ? { expectedDiscussionRevision: version } : {}) });
  await json(await accept(aid, review), 409);
  await json(await accept(aid, review, 1), 409);
  await json(await accept(aid, review, 2), 409);
  assert.equal((await json(await request(route, a.cookie))).pending[0].decision, 'needs-changes');
  const original = Buffer.from(await (await request(pathFor(aid) + '/original', a.cookie)).arrayBuffer());
  review = await prepare([['base', 3]], { supersedesArtifactId: aid });
  const corrected = review.artifactId;
  const old = await get(aid); assert.equal(old.stale, true); assert.equal(old.supersededBy, corrected);
  await json(await event(aid, 2, 'reply', 'Old page cannot rebind'), 409);
  let current = await get(corrected);
  assert.equal(current.discussion.changeId, aid); assert.equal(current.discussion.findings[1].anchorStatus, 'stale');
  assert.deepEqual(current.discussion.findings[1].anchor, originalAnchor);
  await json(await accept(corrected, current, 2), 409);
  discussion = await json(await event(corrected, 2, 'reply', 'Corrected in this export', { parentId: finding.id }));
  discussion = await json(await event(corrected, 3, 'resolve', 'Reason is present', { parentId: finding.id }, b.cookie));
  assert.equal(discussion.blocking, 0); assert.deepEqual(discussion.events.at(-1).anchor, originalAnchor);
  state = await json(await accept(corrected, current, 4));
  current = await get(corrected); assert.ok(current.acceptedAt); assert.deepEqual(current.acceptedDecision.actor, a.user);
  assert.equal(current.discussion.events.at(-1).type, 'approve');
  const acceptedState = { revision: state.revision, current: state.current, artifacts: state.artifacts };
  discussion = await json(await event(corrected, 5, 'reopen', 'New evidence needs another correction', { parentId: finding.id }, b.cookie));
  state = await json(await request(route, a.cookie));
  assert.equal(state.openFindings.length, 1); assert.equal(state.openFindings[0].artifactId, corrected);
  assert.deepEqual({ revision: state.revision, current: state.current, artifacts: state.artifacts }, acceptedState);
  assert.deepEqual(Buffer.from(await (await request(pathFor(aid) + '/original', b.cookie)).arrayBuffer()), original);
  await restart(); a = await login('alice@example.org'); b = await login('bob@example.org');
  assert.deepEqual((await get(corrected)).discussion, discussion);
  const next = await prepare([['base', 4]], { supersedesArtifactId: corrected });
  assert.equal((await get(corrected)).supersededBy, next.artifactId);
  await json(await event(corrected, 6, 'reply', 'Historical accepted page'), 409);
});

test('finding anchors remain exact, removed, stale or ambiguous without choosing a duplicate identity', async t => {
  const { request, post, login, upload, uploadBytes, ref, create } = await setup(t);
  const a = await login('alice@example.org');
  const state = await json(await create(a.cookie, await upload(a.cookie, [['base', 1], ['watched', 1]])), 201);
  const route = endpoint + '/' + state.id, key = JSON.stringify(['widgets', 'synthetic.records', 'watched']);
  const prepare = async (project, scope, previous) => json(await post(route + '/prepare', a.cookie, {
    kind: scope === 'full' ? 'reconciliation' : 'change', snapshot: ref(project, scope), expectedRevision: state.revision,
    ...(scope === 'full' ? { baselineOwner: 'Vendor' } : { team: 'Internal', taskRef: 'SYNTHETIC' }),
    sameSourceConfirmed: true, ...(previous ? { supersedesArtifactId: previous } : {}) }), 201);
  let review = await prepare(await upload(a.cookie, [['base', 1], ['watched', 2]]), 'full');
  await json(await post(route + '/artifacts/' + review.artifactId + '/discussion', a.cookie,
    { expectedRevision: 0, expectedDiscussionRevision: 0, type: 'reject', text: 'Inspect this field', componentKey: key }));
  const check = async (project, status) => {
    review = await prepare(project, 'full', review.artifactId);
    const detail = await json(await request(route + '/artifacts/' + review.artifactId + '/review', a.cookie));
    assert.equal(detail.discussion.findings[0].anchorStatus, status);
    assert.equal(detail.discussion.blocking, 1); return detail.discussion.findings[0].anchor;
  };
  const anchor = await check(await upload(a.cookie, [['base', 1]]), 'removed');
  assert.deepEqual(await check(await upload(a.cookie, [['base', 1], ['watched', 2]]), 'current'), anchor);
  assert.deepEqual(await check(await upload(a.cookie, [['base', 1], ['watched', 3]]), 'stale'), anchor);
  const duplicate = await zip([
    ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: ['one', 'two'].map(code => ({ code: 'watched', namespace: 'synthetic.records', kind: 'WIDGET', path: code })) }],
    ['widgets/one', { descriptor: { fields: [], clientScripts: 'const value = 2;' } }],
    ['widgets/two', { descriptor: { fields: [], clientScripts: 'const value = 3;' } }]
  ]);
  assert.deepEqual(await check(await uploadBytes(a.cookie, duplicate), 'ambiguous'), anchor);
  const partial = await prepare(await upload(a.cookie, [['watched', 2]]), 'partial');
  await json(await post(route + '/artifacts/' + partial.artifactId + '/discussion', a.cookie,
    { expectedRevision: 0, expectedDiscussionRevision: 0, type: 'comment', text: 'Partial absence is not deletion', componentKey: key }));
  const replaced = await prepare(await upload(a.cookie, [['other', 1]]), 'partial', partial.artifactId);
  const detail = await json(await request(route + '/artifacts/' + replaced.artifactId + '/review', a.cookie));
  assert.equal(detail.discussion.findings[0].anchorStatus, 'stale');
});

test('contextual supported code is shared, attributed and revision guarded while original artifacts stay immutable', async t => {
  const { request, post, login, upload, ref, create } = await setup(t);
  const a = await login('alice@example.org'), b = await login('bob@example.org');
  let state = await json(await create(a.cookie, await upload(a.cookie, [['base', 1]])), 201);
  const route = endpoint + '/' + state.id;
  const prepared = await json(await post(route + '/prepare', a.cookie, { kind: 'change',
    snapshot: ref(await upload(a.cookie, [['base', 2]]), 'partial'), expectedRevision: 0,
    team: 'Internal', taskRef: 'SYNTHETIC-CODE', sameSourceConfirmed: true }), 201);
  const review = await json(await request(route + '/artifacts/' + prepared.artifactId + '/review', b.cookie));
  const context = review.contexts[0]; assert.equal(context.beforeArtifactId, state.baselineId);
  const object = route + '/artifacts/' + context.afterArtifactId + '/objects/' + context.objectRef;
  const source = await json(await request(object, b.cookie));
  assert.equal(source.editable, true); assert.match(source.content, /value = 2/);
  assert.equal((await request(object, null)).status, 404);
  assert.equal((await request(source.editorUrl, null)).status, 404);
  assert.equal((await request(source.editorUrl, b.cookie)).status, 200);
  assert.equal((await request(route + '/artifacts/' + state.baselineId + '/objects/' + '0'.repeat(64), b.cookie)).status, 404);
  const originalUrl = route + '/artifacts/' + prepared.artifactId + '/original';
  const bytes = Buffer.from(await (await request(originalUrl, a.cookie)).arrayBuffer());
  let editor = await json(await request(object + '/workspace', b.cookie));
  const files = { ...editor.files, 'client.ts': 'globalThis.SYNTHETIC_EXECUTED = true; const n: number = 3;' };
  await json(await post(object + '/workspace/save', b.cookie, { revision: editor.revision, files, actor: a.user }), 400);
  const concurrent = await Promise.all([
    post(object + '/workspace/save', b.cookie, { revision: editor.revision, files }),
    post(object + '/workspace/save', a.cookie, { revision: editor.revision, files: { ...files, 'client.ts': 'const n: number = "invalid";' } })
  ]);
  assert.deepEqual(concurrent.map(row => row.status).sort(), [200, 409]);
  editor = await json(await request(object + '/workspace', b.cookie));
  assert.deepEqual(editor.audit[0].actor, concurrent[0].status === 200 ? b.user : a.user);
  editor = await json(await post(object + '/workspace/checkpoint', a.cookie, { revision: editor.revision, label: 'Before review' }));
  assert.deepEqual(editor.audit.at(-1).actor, a.user);
  editor = await json(await post(object + '/workspace/check', b.cookie, { revision: editor.revision }));
  assert.equal(editor.check.typescript, 'failed'); assert.deepEqual(editor.audit.at(-1).actor, b.user);
  assert.equal(globalThis.SYNTHETIC_EXECUTED, undefined);
  assert.deepEqual(Buffer.from(await (await request(originalUrl, b.cookie)).arrayBuffer()), bytes);
  state = await json(await post(route + '/archive', a.cookie, { archived: true, expectedRevision: state.revision }));
  await json(await post(object + '/workspace/save', b.cookie, { revision: editor.revision, files: editor.original }), 409);
  assert.equal((await request(object + '/workspace', b.cookie)).status, 200);
  await json(await post(object + '/workspace/restore', b.cookie, { revision: editor.revision, checkpoint: 'original' }, { Origin: 'https://foreign.invalid' }), 403);
});

test('discussion writes are atomic and older pending records retain conservative review compatibility', async t => {
  const { directory, request, post, login, upload, ref, create } = await setup(t);
  const a = await login('alice@example.org');
  const state = await json(await create(a.cookie, await upload(a.cookie, [['base', 1]])), 201), route = endpoint + '/' + state.id;
  const prepared = await json(await post(route + '/prepare', a.cookie, { kind: 'change',
    snapshot: ref(await upload(a.cookie, [['added', 2]]), 'partial'), expectedRevision: 0,
    team: 'Internal', taskRef: 'SYNTHETIC', sameSourceConfirmed: true }), 201);
  const file = path.join(directory, 'shared-solutions', 'managed-workspaces', state.id, 'workspace.json');
  const before = await fs.readFile(file, 'utf8'), rename = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === file) throw Object.assign(Error('Synthetic disk failure'), { code: 'EIO' });
    return rename(source, destination);
  });
  await json(await post(route + '/artifacts/' + prepared.artifactId + '/discussion', a.cookie,
    { expectedRevision: 0, expectedDiscussionRevision: 0, type: 'reject', text: 'Must not partly persist' }), 400);
  mock.mock.restore(); assert.equal(await fs.readFile(file, 'utf8'), before);
  const record = JSON.parse(before); delete record.pending[0].review; delete record.pending[0].contexts; delete record.pending[0].changeId;
  await fs.writeFile(file, JSON.stringify(record));
  let review = await json(await request(route + '/artifacts/' + prepared.artifactId + '/review', a.cookie));
  assert.equal(review.rows.length, 1); assert.equal(review.discussion.version, 0);
  await json(await post(route + '/archive', a.cookie, { archived: true, expectedRevision: 0 }));
  review = await json(await request(route + '/artifacts/' + prepared.artifactId + '/review', a.cookie));
  assert.equal(review.stale, true); assert.equal(review.artifactDigest, null);
  assert.equal(review.ambiguities[0].reason, 'historical-comparison-unavailable');
});

test('selected visual step findings preserve verified source anchors across exact, changed, removed and duplicate steps', async t => {
  const { directory, request, post, login, uploadBytes, ref, create } = await setup(t);
  const a = await login('alice@example.org'), b = await login('bob@example.org');
  const bytes = raw => zip([['package.json', { code: 'synthetic_visual', type: 'SOLUTION' }],
    ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic', kind: 'PROCESS', path: 'approval.json' }] }],
    ['processor/approval.json', raw]]);
  const raw = structuredClone(visualSource);
  const state = await json(await create(a.cookie, await uploadBytes(a.cookie, await bytes(raw))), 201), route = endpoint + '/' + state.id;
  const prepare = async previous => json(await post(route + '/prepare', b.cookie, { kind: 'reconciliation', baselineOwner: 'Vendor',
    expectedRevision: 0, sameSourceConfirmed: true, snapshot: ref(await uploadBytes(b.cookie, await bytes(raw)), 'full'),
    ...(previous ? { supersedesArtifactId: previous } : {}) }), 201);
  let review = await prepare();
  const pathFor = id => route + '/artifacts/' + id;
  const visual = await json(await request(pathFor(review.artifactId) + '/visual', a.cookie));
  const anchor = visual.processes[0].nodes.find(node => node.id === 'review').anchor, key = JSON.stringify(anchor.object);
  const input = { expectedRevision: 0, expectedDiscussionRevision: 0, type: 'reject', text: 'Return needs a comment', componentKey: key, sourceAnchor: anchor };
  for (const forged of [{ fingerprint: '0'.repeat(64) }, { checksum: '0'.repeat(64) }, { nodeId: 'invented' }, { artifactId: state.baselineId }])
    await json(await post(pathFor(review.artifactId) + '/discussion', b.cookie, { ...input, sourceAnchor: { ...anchor, ...forged } }), 409);
  await json(await post(pathFor(review.artifactId) + '/discussion', b.cookie, { ...input, sourceAnchor: { ...anchor, actor: a.user } }), 400);
  let discussion = await json(await post(pathFor(review.artifactId) + '/discussion', b.cookie, input));
  assert.deepEqual(discussion.findings[0].sourceAnchor, anchor); assert.deepEqual(discussion.findings[0].actor, b.user);
  const recordPath = path.join(directory, 'shared-solutions', 'managed-workspaces', state.id, 'workspace.json');
  const legacy = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  delete legacy.pending[0].sourceAnchors.version;
  await fs.writeFile(recordPath, JSON.stringify(legacy));
  const legacyReview = await json(await request(pathFor(review.artifactId) + '/review', a.cookie));
  assert.equal(legacyReview.discussion.findings[0].anchorStatus, 'ambiguous', 'old cached projections cannot assert current source identity');
  discussion = await json(await post(pathFor(review.artifactId) + '/discussion', b.cookie,
    { ...input, expectedDiscussionRevision: 1, type: 'reply', parentId: discussion.findings[0].id }));
  assert.equal(discussion.findings[0].anchorStatus, 'current', 'a guarded write rebuilds the index from captured bytes');
  const check = async status => {
    review = await prepare(review.artifactId);
    const detail = await json(await request(pathFor(review.artifactId) + '/review', a.cookie));
    assert.equal(detail.discussion.findings[0].anchorStatus, status); assert.deepEqual(detail.discussion.findings[0].sourceAnchor, anchor);
    assert.equal(detail.discussion.blocking, 1); return detail;
  };
  raw.process.items.end.name = 'Unrelated source change'; await check('current');
  raw.process.items.review.settings.unrendered = { sourceRule: 'PRIVATE_SYNTHETIC_RULE' }; await check('stale');
  raw.process.items.review.name = 'Changed task'; await check('stale');
  const removed = raw.process.items.review; delete raw.process.items.review; await check('removed');
  raw.process.items.review = removed; raw.process.items.duplicate = { ...removed, name: 'Duplicate native ID' };
  const detail = await check('ambiguous'), finding = detail.discussion.findings[0];
  discussion = await json(await post(pathFor(review.artifactId) + '/discussion', a.cookie,
    { expectedRevision: 0, expectedDiscussionRevision: 2, type: 'reply', text: 'Identity is still ambiguous', parentId: finding.id }));
  assert.deepEqual(discussion.events.at(-1).sourceAnchor, anchor);
  assert.equal(discussion.findings[0].anchorStatus, 'ambiguous');
});

test('durable merge resolutions are attributed, revision/plan/head guarded and survive restart through the Solutions API', async t => {
  const { request, post, login, upload, ref, create, restart } = await setup(t);
  let a = await login('alice@example.org'), b = await login('bob@example.org');
  const state = await json(await create(a.cookie, await upload(a.cookie, [['div', 0], ['keep', 0]])), 201), route = endpoint + '/' + state.id;
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const prepare = async (cookie, value, team) => json(await post(route + '/prepare', cookie, { kind: 'change', snapshot: ref(await upload(cookie, [['div', value]]), 'partial'),
    expectedRevision: state.revision, team, taskRef: 'MERGE-' + team, sameSourceConfirmed: true, base }), 201);
  const first = await prepare(a.cookie, 1, 'A'), second = await prepare(b.cookie, 2, 'C');
  const current = await json(await post(route + '/artifacts/' + first.artifactId + '/accept', a.cookie, { expectedRevision: state.revision,
    reviewedDigest: first.artifactDigest, reviewedBoundaryKeys: first.rows.filter(row => row.boundaryCrossing).map(row => row.key), expectedDiscussionRevision: 0 }));
  const merge = await json(await request(route + '/artifacts/' + second.artifactId + '/merge', b.cookie));
  assert.equal(merge.plan.status, 'resolution-required');
  const key = merge.plan.rows.find(row => row.classification === 'divergent').key;
  const body = (decision, reason) => ({ expectedRevision: current.revision, planDigest: merge.plan.planDigest, expectedResolutionId: null, decisions: { [key]: decision }, reason });
  assert.equal((await request(route + '/artifacts/' + second.artifactId + '/merge')).status, 404);
  await json(await post(route + '/artifacts/' + second.artifactId + '/merge', b.cookie, { ...body('take-incoming', 'x'), planDigest: 'f'.repeat(64) }), 409);
  await json(await post(route + '/artifacts/' + second.artifactId + '/merge', b.cookie, { ...body('take-incoming', 'x'), actor: a.user }), 400);
  const results = await Promise.all([post(route + '/artifacts/' + second.artifactId + '/merge', a.cookie, body('keep-current', 'Alice keeps A')),
    post(route + '/artifacts/' + second.artifactId + '/merge', b.cookie, body('take-incoming', 'Bob takes C'))]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const winner = results.find(row => row.status === 200) === results[0] ? a : b;
  await restart(); a = await login('alice@example.org');
  const stored = await json(await request(route + '/artifacts/' + second.artifactId + '/merge', a.cookie));
  assert.equal(stored.history.length, 1); assert.deepEqual(stored.head.actor, winner.user); assert.equal(stored.head.status, 'current');
  assert.deepEqual(stored.head.inputs, merge.plan.inputs);
  assert.deepEqual(stored.head.result.find(row => row.key !== key).source, 'current');
  const review = await json(await request(route + '/artifacts/' + second.artifactId + '/review', a.cookie));
  assert.equal(review.stale, true); assert.equal(review.merge.head.id, stored.head.id);
  assert.equal((await json(await request(route, a.cookie))).revision, current.revision, 'resolution does not accept or advance the Solution');
  assert.equal((await post(route + '/artifacts/' + second.artifactId + '/merge', a.cookie, body('keep-current', 'Replay'))).status, 409);
});

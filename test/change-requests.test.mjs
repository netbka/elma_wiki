import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { visualSource } from '../web/visual/fixtures.js';
import { zip } from './fixture.mjs';
import { bugGitHub } from '../lib/bug-reports.mjs';

const secret = 'SYNTHETIC_CHANGE_REQUEST_LOGIN_SECRET';
const archive = raw => zip([
  ['package.json', { code: 'synthetic_requests', type: 'SOLUTION' }],
  ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic.processes', name: 'Synthetic approval', path: 'approval.json', kind: 'PROCESS' }] }],
  ['processor/approval.json', raw]
]);
async function setup(t, publisher = null) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-change-requests-'));
  const cookies = new Map();
  let server;
  const start = async () => {
    server = createServer({ directory, sendEmail: undefined,
      sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }), bugPublisher: publisher, requests: null });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  };
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start(); t.after(async () => { await close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (route, cookie, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    ...options, headers: { ...(cookie ? { cookie: cookies.get(cookie) || cookie } : {}), ...options.headers }
  });
  const json = async (response, status = 200) => { const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result; };
  const post = (route, cookie, value, headers = {}) => request(route, cookie, { method: 'POST', headers: {
    'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const login = async email => {
    const link = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(link.pathname + link.search, null, { redirect: 'manual' }); assert.equal(response.status, 303);
    cookies.set(email, response.headers.getSetCookie()[0].split(';')[0]); return email;
  };
  const upload = async (cookie, raw = visualSource) => json(await request('/api/solutions/uploads?filename=synthetic.e365', cookie, {
    method: 'POST', headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, body: await archive(raw) }), 201);
  const ref = (project, scope) => ({ projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true });
  const a = await login('alice@example.org'), b = await login('bob@example.org');
  const state = await json(await post('/api/solutions', a, { name: 'Synthetic requests', baselineOwner: 'Synthetic team', snapshot: ref(await upload(a), 'full') }), 201);
  const route = `/api/solutions/${state.id}/change-requests`;
  const visual = await json(await request(`/api/solutions/${state.id}/artifacts/${state.baselineId}/visual`, a));
  const sourceAnchor = visual.processes[0].nodes.find(node => node.id === 'review').anchor;
  const input = () => ({ id: crypto.randomUUID(), expectedRevision: state.revision, kind: 'process', urgency: 'normal', title: 'Change synthetic approval',
    text: 'Show a clearer summary before approval.', reason: 'Make review easier.', target: {
      artifactId: state.baselineId, componentKey: JSON.stringify(sourceAnchor.object), sourceAnchor: structuredClone(sourceAnchor) } });
  const event = (version, type, extra) => ({ operationId: crypto.randomUUID(), expectedVersion: version, type, ...extra });
  return { directory, a, b, state, route, input, event, post, request, json, upload, ref, restart: async () => {
    await close(); await start(); await login(a); await login(b);
  } };
}

test('shared request retains exact step anchor and actor across restart without changing review or acceptance state', async t => {
  const { a, b, state, route, input, post, request, json, restart } = await setup(t);
  const value = input(), row = await json(await post(route, a, value), 201);
  assert.equal(row.actor.login, 'alice@example.org'); assert.equal(row.status, 'new'); assert.equal(row.version, 0);
  assert.deepEqual(row.target.sourceAnchor, value.target.sourceAnchor); assert.equal(row.anchorStatus, 'current');
  assert.ok(row.target.anchor.digest); assert.equal(row.inputHash, undefined);
  await restart();
  const restored = await json(await request(`${route}/${row.id}`, b));
  assert.deepEqual(restored.target, row.target); assert.equal(restored.publication, null);
  const list = await json(await request(route, b)); assert.equal(list.requests.length, 1);
  const after = await json(await request(`/api/solutions/${state.id}`, b));
  assert.equal(after.revision, state.revision); assert.deepEqual(after.current, state.current); assert.deepEqual(after.history, state.history);
  assert.deepEqual(await json(await post(route, a, value), 201), row, 'lost-response create is idempotent');
  await json(await post(route, b, value), 409);
  await json(await post(route, a, { ...value, text: 'Different' }), 409);
});

test('status and comments are version-guarded, attributed, retry-safe and completion links only accepted local versions', async t => {
  const { a, b, state, route, input, event, post, request, json, restart } = await setup(t);
  const row = await json(await post(route, a, input()), 201), events = `${route}/${row.id}/events`;
  const comment = event(0, 'comment', { text: 'A synthetic colleague suggestion.' });
  let result = await json(await post(events, b, comment));
  assert.equal(result.events[0].actor.login, 'bob@example.org'); assert.equal(result.events[0].inputHash, undefined);
  assert.deepEqual(await json(await post(events, b, comment)), result);
  await json(await post(events, a, comment), 409);
  await json(await post(events, a, event(0, 'status', { status: 'in-progress' })), 409);
  result = await json(await post(events, a, event(1, 'status', { status: 'in-progress' })));
  assert.equal(result.status, 'in-progress'); assert.equal(result.version, 2);
  await json(await post(events, a, event(2, 'status', { status: 'done', fulfilledArtifactId: crypto.randomUUID() })), 409);
  result = await json(await post(events, b, event(2, 'status', { status: 'done', fulfilledArtifactId: state.baselineId, text: 'Human assertion of completion.' })));
  assert.equal(result.fulfilledArtifactId, state.baselineId);
  await restart(); result = await json(await request(`${route}/${row.id}`, a)); assert.equal(result.events.length, 3);
  result = await json(await post(events, a, event(3, 'status', { status: 'new' })));
  assert.equal(result.fulfilledArtifactId, null);
  const races = await Promise.all(['one', 'two'].map(text => post(events, b, event(4, 'comment', { text }))));
  assert.deepEqual(races.map(response => response.status).sort(), [200, 409]);
});

test('auth, origin, content type, forged actors, malformed anchors, stale revisions and cross-Solution targets fail closed', async t => {
  const { a, state, route, input, post, request, json } = await setup(t);
  await json(await request(route), 401); await json(await post(route, null, input()), 401);
  await json(await post(route, a, input(), { Origin: 'https://other.example' }), 403);
  await json(await post(route, a, input(), { 'Content-Type': 'text/plain' }), 415);
  for (const edit of [
    value => value.actor = { id: 'forged' }, value => value.id = '../outside', value => value.kind = 'deployment',
    value => value.expectedRevision++, value => value.target.componentKey = 'missing',
    value => value.target.artifactId = crypto.randomUUID(), value => value.target.sourceAnchor.fingerprint = 'forged',
    value => value.target.sourceAnchor.nodeId = 'missing', value => value.target.sourceAnchor.pointer = '/not/the/source',
    value => value.target.sourceAnchor.extra = true, value => value.target.anchor = { digest: 'forged' },
    value => value.text = '', value => value.target.componentKey = undefined
  ]) { const value = input(); edit(value); const response = await post(route, a, value); assert.ok(response.status >= 400); }
  const unknown = `/api/solutions/${crypto.randomUUID()}/change-requests`;
  await json(await post(unknown, a, input()), 404);
  const row = await json(await post(route, a, input()), 201);
  await json(await request(`${route}/../outside`, a), 404);
  await json(await post(`${route}/${row.id}/events`, a, { operationId: crypto.randomUUID(), expectedVersion: 0, type: 'comment', text: 'Cannot approve', status: 'done' }), 400);
  const after = await json(await request(`/api/solutions/${state.id}`, a)); assert.equal(after.revision, state.revision);
});

test('publication is opt-in, unconfigured receipts persist, and retry cannot manufacture consent', async t => {
  const { a, b, route, input, post, request, json, restart } = await setup(t);
  const row = await json(await post(route, a, input()), 201), base = `${route}/${row.id}`;
  await json(await post(base + '/retry', a, {}), 409);
  await json(await post(base + '/publish', a, { attachments: [], publishConfirmed: false }), 400);
  assert.equal((await json(await request(base, b))).publication, null);
  const receipt = await json(await post(base + '/publish', b, { attachments: [], publishConfirmed: true }));
  assert.equal(receipt.status, 'unconfigured'); assert.equal(receipt.kind, 'change-request'); assert.equal(receipt.actor.login, 'bob@example.org');
  assert.equal(receipt.context.changeRequestId, row.id); assert.equal(receipt.issue, null); assert.equal(receipt.context.viewport, undefined);
  await restart(); assert.equal((await json(await request(base, a))).publication.status, 'unconfigured');
  assert.equal((await json(await post(base + '/retry', a, {}))).status, 'unconfigured');
  await json(await post('/api/bug-reports', a, { ...receipt, publishConfirmed: true }), 400);
  const maximum = { ...input(), text: 'a'.repeat(8000), reason: 'b'.repeat(2000) };
  const long = await json(await post(route, a, maximum), 201);
  assert.equal((await json(await post(`${route}/${long.id}/publish`, a, { attachments: [], publishConfirmed: true }))).status, 'unconfigured');
});

test('ambiguous GitHub publication reuses the existing receipt and reconciles without duplicate dispatch', async t => {
  let dispatched = 0, recovered = false;
  const github = { repository: 'example/synthetic', publish: async report => { dispatched++; assert.equal(report.kind, 'change-request'); throw Error('Synthetic lost response'); },
    recover: async () => recovered ? { number: 7, url: 'https://github.com/example/synthetic/issues/7' } : null };
  const { a, b, route, input, post, json, restart } = await setup(t, github);
  const row = await json(await post(route, a, input()), 201), base = `${route}/${row.id}`;
  assert.equal((await json(await post(base + '/publish', a, { attachments: [], publishConfirmed: true }))).status, 'unknown');
  await restart(); assert.equal((await json(await post(base + '/retry', b, {}))).status, 'unknown'); assert.equal(dispatched, 1);
  recovered = true;
  assert.equal((await json(await post(base + '/retry', b, {}))).status, 'published'); assert.equal(dispatched, 1);
});

test('captured anchors become stale after an accepted edit; archives remain readable but refuse new mutations or publication', async t => {
  const { a, b, state, route, input, event, post, request, json, upload, ref } = await setup(t);
  const row = await json(await post(route, a, input()), 201), solution = `/api/solutions/${state.id}`;
  const changed = structuredClone(visualSource); changed.process.items.review.name = 'Synthetic revised approval';
  const preview = await json(await post(solution + '/prepare', a, { kind: 'change', snapshot: ref(await upload(a, changed), 'partial'),
    expectedRevision: state.revision, team: 'Synthetic', taskRef: 'Synthetic change', sameSourceConfirmed: true }), 201);
  const accepted = await json(await post(`${solution}/artifacts/${preview.artifactId}/accept`, a, { expectedRevision: preview.revision,
    reviewedDigest: preview.artifactDigest, expectedDiscussionRevision: 0,
    reviewedBoundaryKeys: preview.rows.filter(row => row.boundaryCrossing).map(row => row.key) }));
  const stale = await json(await request(`${route}/${row.id}`, b)); assert.equal(stale.anchorStatus, 'stale');
  assert.deepEqual(stale.target, row.target, 'correction never rewrites the original anchor');
  await json(await post(solution + '/archive', a, { expectedRevision: accepted.revision, archived: true }));
  await json(await request(`${route}/${row.id}`, b));
  await json(await post(route, b, { ...input(), id: crypto.randomUUID() }), 409);
  await json(await post(`${route}/${row.id}/events`, b, event(0, 'comment', { text: 'Blocked while archived' })), 409);
  await json(await post(`${route}/${row.id}/publish`, b, { attachments: [], publishConfirmed: true }), 409);
  assert.equal((await json(await request(`${route}/${row.id}`, b))).publication, null);
});

test('foreign captured artifacts and pending fulfilling versions are refused; checksum corruption blocks reads', async t => {
  const { directory, a, state, route, input, event, post, request, json, upload, ref } = await setup(t);
  const foreign = await json(await post('/api/solutions', a, { name: 'Another synthetic Solution', baselineOwner: 'Synthetic', snapshot: ref(await upload(a), 'full') }), 201);
  const value = input(); value.target.artifactId = foreign.baselineId; delete value.target.sourceAnchor;
  await json(await post(route, a, value), 404);
  const row = await json(await post(route, a, input()), 201);
  const prepared = await json(await post(`/api/solutions/${state.id}/prepare`, a, { kind: 'change', snapshot: ref(await upload(a), 'partial'),
    expectedRevision: state.revision, team: 'Synthetic', taskRef: 'Pending', sameSourceConfirmed: true }), 201);
  await json(await post(`${route}/${row.id}/events`, a, event(0, 'status', { status: 'done', fulfilledArtifactId: prepared.artifactId })), 409);
  await fs.appendFile(path.join(directory, 'shared-solutions', 'managed-workspaces', state.id, state.baselineId + '.e365'), 'corrupt');
  await json(await request(route, a), 409);
});

test('a request cannot reconcile a bug report which happens to use the same UUID', async t => {
  const { a, route, input, post, request, json } = await setup(t), value = input();
  await json(await post('/api/bug-reports', a, { id: value.id, title: 'An unrelated bug', text: 'Synthetic unrelated report', kind: 'bug',
    context: { route: '/solutions', viewport: { width: 1000, height: 800, devicePixelRatio: 1 } }, publishConfirmed: true, attachments: [] }), 201);
  await json(await post(route, a, value), 201);
  await json(await request(`${route}/${value.id}`, a), 409);
  await json(await post(`${route}/${value.id}/retry`, a, {}), 409);
  await json(await post(`${route}/${value.id}/publish`, a, { attachments: [], publishConfirmed: true }), 409);
});

test('GitHub transport labels change requests while omitting authenticated identity', async () => {
  let sent;
  const github = bugGitHub({ repository: 'example/synthetic', token: 'SYNTHETIC_TOKEN', fetchImpl: async (url, options) => {
    sent = JSON.parse(options.body); return new Response(JSON.stringify({ number: 3 }), { status: 200 });
  } });
  await github.publish({ id: crypto.randomUUID(), title: 'Synthetic request', text: 'Requested behavior', kind: 'change-request', attachments: [], actor: { login: 'private@example.org' } }, 'https://wiki.example.org');
  assert.match(sent.body, /Запрос на изменение/); assert.ok(!sent.body.includes('private@example.org'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { inventoryOf } from '../lib/delivery.mjs';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from './fixture.mjs';

const actor = { id: 'synthetic-reviewer', login: 'synthetic@example.org', provider: 'local' };
const archive = value => zip([
  ['package.json', { code: 'synthetic_installed_api', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'sample', namespace: 'synthetic', kind: 'WIDGET', path: 'sample.json' }] }],
  ['widgets/sample.json', { descriptor: { clientScripts: `const value = ${value};` } }]
]);
const target = (inventory = []) => ({ name: 'Synthetic DEV2', role: 'target', environment: 'test', adapter: 'synthetic',
  adapterOptions: { identity: { host: 'installed.example.invalid' }, inventory } });

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-installed-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const solutions = solutionStore(directory), bytes = await archive(1);
  const upload = await solutions.uploads.create(SOLUTION_CATALOG, bytes, 'synthetic.e365', actor);
  const snapshot = { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true };
  let state = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Synthetic', baselineOwner: 'Team', snapshot }, actor);
  const full = await solutions.managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'reconciliation', expectedRevision: 0,
    baselineOwner: 'Team', snapshot, sameSourceConfirmed: true }, actor);
  state = await solutions.managed.accept(state.id, SOLUTION_CATALOG, full.artifactId,
    { expectedRevision: full.revision, reviewedDigest: full.artifactDigest }, actor);
  let release = await solutions.handoffs.create(state.id, { expectedRevision: state.revision, title: 'Synthetic original', intent: 'Synthetic comparison', targetIntent: 'Explicit test only' }, actor);
  const change = async input => { release = await solutions.handoffs.change(state.id, release.id, { revision: release.revision, ...input }, actor); };
  await change({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'Native runtime not tested', notes: '' });
  for (const row of release.changes) await change({ action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic review' });
  await change({ action: 'freeze' }); await change({ action: 'approve', reason: 'Offline review' });

  const secret = 'SYNTHETIC_INSTALLED_API_SECRET';
  const server = createServer({ directory, syntheticDelivery: true, sendEmail: undefined,
    sendVk: Object.assign(async () => {}, { domain: 'example.org', linkSecret: secret }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, cookie, options = {}) => fetch(base + route, { ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  const json = async (response, expected = 200) => { const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value; };
  const post = (route, cookie, input, headers = {}) => request(route, cookie, { method: 'POST', body: JSON.stringify(input),
    headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/json', ...headers } });
  const login = async email => {
    const link = new URL(vkLoginLinks({ secret, domain: 'example.org', baseUrl: 'http://127.0.0.1:43171' }).issue(email));
    const response = await request(link.pathname + link.search, null, { redirect: 'manual' }); assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return { cookie, user: (await json(await request('/api/session', cookie))).user };
  };
  return { state, release, bytes, request, json, post, login };
}

test('Solution installed comparison API derives actor, Target and inventory server-side and never dispatches', async t => {
  const { state, release, bytes, request, json, post, login } = await setup(t);
  const alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const route = `/api/solutions/${state.id}/handoffs/${release.id}/delivery`;
  const empty = await json(await post('/api/connections', alice.cookie, target()), 201);
  const installed = await json(await post('/api/connections', alice.cookie, target(await inventoryOf(bytes))), 201);
  const input = { action: 'compareInstalled', revision: release.revision, connectionId: empty.id };

  await json(await request(route + '?installed', null), 404);
  await json(await post(route, null, input), 404);
  await json(await post(route, alice.cookie, input, { Origin: 'https://foreign.example.invalid' }), 403);
  for (const extra of [{ inventory: [] }, { targetIdentity: { host: 'forged.example.invalid' } }, { installed: true },
    { policy: 'exact' }, { owner: SOLUTION_CATALOG }, { actor: bob.user }, { attemptId: release.id }])
    await json(await post(route, alice.cookie, { ...input, ...extra }), 400);
  // A Target connection belongs to its own actor.
  await json(await post(route, bob.cookie, input), 404);
  await json(await post(route, alice.cookie, { ...input, revision: release.revision + 1 }), 409);
  await json(await post(`/api/releases/${release.id}/delivery`, alice.cookie, input), 404);

  const unknown = await json(await post(route, alice.cookie, input), 201);
  assert.equal(unknown.comparison.status, 'unknown-base');
  assert.equal(unknown.comparison.businessAcceptance, 'not-established');
  assert.equal(unknown.owner, undefined);
  const refused = await json(await post(route, alice.cookie, { ...input, action: 'reconcileInstalled' }), 201);
  assert.equal(refused.installedObservation, undefined, 'a request cannot assert a manual import the Target does not show');

  const reconciled = await json(await post(route, alice.cookie, { ...input, action: 'reconcileInstalled', connectionId: installed.id }), 201);
  assert.equal(reconciled.comparison.status, 'reconciled');
  assert.equal(reconciled.installedObservation.method, 'manual-import-read-back');
  assert.equal(reconciled.installedObservation.evidenceBasis, 'synthetic');
  const compared = await json(await post(route, alice.cookie, { ...input, connectionId: installed.id }), 201);
  assert.equal(compared.comparison.status, 'compared');
  assert.equal(compared.comparison.before.id, reconciled.installedObservation.id);
  assert.deepEqual(compared.comparison.delta.different, []);

  const history = await json(await request(route + '?installed', alice.cookie));
  assert.deepEqual(history.map(row => row.comparison.status), ['unknown-base', 'unknown-base', 'reconciled', 'compared']);
  assert.deepEqual(await json(await request(route, alice.cookie)), [], 'comparisons are not delivery attempts');
  assert.deepEqual(await json(await request(route + '?installed', bob.cookie)), [], 'installed history is scoped to the execution actor');
});

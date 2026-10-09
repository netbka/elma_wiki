import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { deliveryStore, syntheticAdapter, inventoryOf } from '../lib/delivery.mjs';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from './fixture.mjs';

const actor = { id: 'synthetic-reviewer', login: 'synthetic@example.org', provider: 'local' };
const archive = value => zip([
  ['package.json', { code: 'synthetic_shared_delivery', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'sample', namespace: 'synthetic', kind: 'WIDGET', path: 'sample.json' }] }],
  ['widgets/sample.json', { descriptor: { clientScripts: `const value = ${value};` } }]
]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const target = (host = 'shared.example.invalid') => ({ name: 'Synthetic Target', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { identity: { host } } });
const confirm = attempt => ({ idempotencyKey: 'synthetic-once', confirmation: `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}` });

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-shared-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const solutions = solutionStore(directory), projects = projectStore(directory), legacy = releaseStore(directory, projects);
  const bytes = await archive(1), calls = [];
  const upload = await solutions.uploads.create(SOLUTION_CATALOG, bytes, 'synthetic.e365', actor);
  const snapshot = { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true };
  let state = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Synthetic', baselineOwner: 'Team', snapshot }, actor);
  const full = await solutions.managed.prepare(state.id, SOLUTION_CATALOG, { kind: 'reconciliation', expectedRevision: 0,
    baselineOwner: 'Team', snapshot, sameSourceConfirmed: true }, actor);
  state = await solutions.managed.accept(state.id, SOLUTION_CATALOG, full.artifactId,
    { expectedRevision: full.revision, reviewedDigest: full.artifactDigest }, actor);
  let release = await solutions.handoffs.create(state.id, { expectedRevision: state.revision, title: 'Synthetic original', intent: 'Synthetic delivery', targetIntent: 'Explicit test only' }, actor);
  const change = async input => { release = await solutions.handoffs.change(state.id, release.id, { revision: release.revision, ...input }, actor); return release; };
  await change({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'Native runtime not tested', notes: '' });
  for (const row of release.changes) await change({ action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic review' });
  await change({ action: 'freeze' }); await change({ action: 'approve', reason: 'Offline review; explicit Target confirmation separate' });
  const delivery = deliveryStore(directory, legacy, { solutionHandoffs: solutions.handoffs,
    adapters: { synthetic: opts => syntheticAdapter({ ...opts, calls }) }, ...options });
  const shared = delivery.forSolution(state.id);
  const mutate = async mode => {
    if (mode === 'archive') return solutions.managed.setArchived(state.id, SOLUTION_CATALOG, { expectedRevision: state.revision, archived: true }, actor);
    if (mode === 'release') return change({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent, limitations: 'Changed condition', notes: '' });
    const discussion = (await solutions.managed.review(state.id, SOLUTION_CATALOG, full.artifactId)).discussion;
    return solutions.managed.comment(state.id, SOLUTION_CATALOG, full.artifactId, { expectedRevision: state.revision,
      expectedDiscussionRevision: discussion.version, type: mode === 'finding' ? 'reject' : 'comment', text: 'New synthetic evidence' }, actor);
  };
  return { directory, solutions, projects, legacy, bytes, snapshot, state, release, delivery, shared, calls, mutate };
}

test('shared original uses one delivery engine, exact bytes, explicit confirmation and current scoped read-back', async t => {
  const { delivery, shared, state, release, bytes, directory, calls, mutate } = await setup(t);
  const connection = await delivery.connections.create(actor.id, target());
  let attempt = await shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id });
  assert.equal(calls.length, 0);
  assert.deepEqual(attempt.candidateSource, { namespace: 'solution', solutionId: state.id, id: release.id });
  const file = path.join(directory, 'delivery', 'attempts', 'solutions', release.id, attempt.id + '.json');
  assert.equal(JSON.parse(await fs.readFile(file)).sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(shared.confirm(release.id, attempt.id, actor.id, { ...confirm(attempt), confirmation: 'wrong' }), error => error.statusCode === 400);
  attempt = await shared.confirm(release.id, attempt.id, actor.id, confirm(attempt));
  assert.equal(attempt.state, 'deployed-unverified');
  await shared.confirm(release.id, attempt.id, actor.id, confirm(attempt));
  assert.equal(calls.length, 1);
  attempt = await shared.verify(release.id, attempt.id, actor.id);
  assert.equal(attempt.state, 'verified');
  assert.equal(attempt.evidence.comparison.compared, (await inventoryOf(bytes)).length);
  assert.equal((await shared.get(release.id, attempt.id, actor.id)).verificationCurrent, true);
  await mutate('comment');
  const historical = await shared.get(release.id, attempt.id, actor.id);
  assert.equal(historical.state, 'verified');
  assert.equal(historical.candidateStatus, 'stale');
  assert.equal(historical.verificationCurrent, false);
  assert.equal(calls.length, 1);
});

test('async prepare, confirm and read-back cannot commit current evidence after Solution or release mutation', async t => {
  for (const phase of ['prepare', 'confirm', 'verify']) for (const mode of ['comment', 'finding', 'archive', 'release']) await t.test(`${phase}/${mode}`, async sub => {
    const entered = deferred(), finish = deferred(); let pause = false, imports = 0;
    const adapter = syntheticAdapter();
    const inspect = adapter.inspectSolution.bind(adapter), readBack = adapter.readBack.bind(adapter), deploy = adapter.deployCandidate.bind(adapter);
    adapter.inspectSolution = async (...args) => { if (pause && phase !== 'verify') { entered.resolve(); await finish.promise; } return inspect(...args); };
    adapter.readBack = async (...args) => { if (pause) { entered.resolve(); await finish.promise; } return readBack(...args); };
    adapter.deployCandidate = (...args) => { imports++; return deploy(...args); };
    const { delivery, shared, release, mutate } = await setup(sub, { adapters: { synthetic: () => adapter } });
    const connection = await delivery.connections.create(actor.id, target());
    let attempt;
    if (phase !== 'prepare') attempt = await shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id });
    if (phase === 'verify') attempt = await shared.confirm(release.id, attempt.id, actor.id, confirm(attempt));
    pause = true;
    const pending = phase === 'prepare' ? shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id })
      : phase === 'confirm' ? shared.confirm(release.id, attempt.id, actor.id, confirm(attempt)) : shared.verify(release.id, attempt.id, actor.id);
    const observed = assert.rejects(pending, error => error.statusCode === 409);
    await entered.promise; await mutate(mode); finish.resolve(); await observed;
    assert.equal(imports, phase === 'verify' ? 1 : 0);
    const history = await shared.list(release.id, actor.id);
    if (phase === 'prepare') assert.equal(history.length, 0);
    else if (phase === 'confirm') {
      assert.equal(history[0].state, 'prepared');
      assert.equal((await shared.cancel(release.id, attempt.id, actor.id)).state, 'cancelled');
    } else {
      assert.equal(history[0].state, 'verification-failed');
      assert.equal(history[0].verificationCurrent, false);
      assert.equal(history[0].evidence.comparison, null);
    }
  });
});

test('equal release UUIDs stay in separate namespaces while cross-actor Target aliases reserve one host through restart', async t => {
  const { directory, solutions, delivery, shared, release, state, bytes, snapshot, legacy } = await setup(t);
  // Synthetic collision: two valid immutable releases deliberately use one ID.
  // This never migrates a product release or private original between roots.
  const record = JSON.parse(await fs.readFile(path.join(directory, 'shared-solutions', 'releases', release.id, 'release.json')));
  delete record.sourceAssociation; record.owner = 'synthetic-bob';
  await fs.mkdir(path.join(directory, 'releases', release.id), { recursive: true });
  await fs.writeFile(path.join(directory, 'releases', release.id, 'release.json'), JSON.stringify(record));
  await fs.writeFile(path.join(directory, 'releases', release.id, 'source.e365'), bytes);
  const first = await delivery.connections.create(actor.id, target());
  const second = await delivery.connections.create('synthetic-bob', target('SHARED.EXAMPLE.INVALID.'));
  const outcomes = await Promise.allSettled([
    shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: first.id }),
    delivery.prepare(release.id, 'synthetic-bob', { revision: release.revision, connectionId: second.id })
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[1].reason.statusCode, 409);
  assert.equal((await delivery.list(release.id, 'synthetic-bob')).length, 0);
  const attempt = outcomes[0].value;
  await assert.rejects(delivery.get(release.id, attempt.id, 'synthetic-bob'), error => error.statusCode === 404);
  await assert.rejects(shared.get(release.id, attempt.id, 'synthetic-bob'), error => error.statusCode === 404);
  const other = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Other', baselineOwner: 'Team', snapshot }, actor);
  await assert.rejects(delivery.forSolution(other.id).list(release.id, actor.id), error => error.statusCode === 404);
  const file = path.join(directory, 'delivery', 'attempts', 'solutions', release.id, attempt.id + '.json');
  const original = JSON.parse(await fs.readFile(file));
  for (const phase of ['prepared', 'deploying', 'deployed-unverified', 'unknown-outcome']) {
    await fs.writeFile(file, JSON.stringify({ ...original, state: phase, bootId: 'previous-process' }));
    const restarted = deliveryStore(directory, legacy, { solutionHandoffs: solutions.handoffs, adapters: { synthetic: syntheticAdapter } });
    await assert.rejects(restarted.prepare(release.id, 'synthetic-bob', { revision: release.revision, connectionId: second.id }), error => error.statusCode === 409);
    if (phase === 'deploying') assert.equal((await restarted.forSolution(state.id).get(release.id, attempt.id, actor.id)).state, 'unknown-outcome');
  }
  await fs.writeFile(file, JSON.stringify(original));
  await shared.cancel(release.id, attempt.id, actor.id);
  const legacyAttempt = await delivery.prepare(release.id, 'synthetic-bob', { revision: release.revision, connectionId: second.id });
  assert.equal(legacyAttempt.candidateSource, undefined);
  await assert.rejects(shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: first.id }), error => error.statusCode === 409);
  await assert.rejects(shared.get(release.id, legacyAttempt.id, actor.id), error => error.statusCode === 404);
  // An old conflicting preparation with the same attempt UUID in the other
  // namespace must not be exempted as if it were this confirmation's record.
  const collisionFile = path.join(directory, 'delivery', 'attempts', 'solutions', release.id, legacyAttempt.id + '.json');
  await fs.writeFile(collisionFile, JSON.stringify({ ...original, id: legacyAttempt.id }));
  await assert.rejects(delivery.confirm(release.id, legacyAttempt.id, 'synthetic-bob', confirm(legacyAttempt)), error => error.statusCode === 409);
  await shared.cancel(release.id, legacyAttempt.id, actor.id);
  assert.equal((await delivery.cancel(release.id, legacyAttempt.id, 'synthetic-bob')).state, 'cancelled');
});

test('contextual API uses trusted execution actor, rejects cross roots/forgery/foreign connections, and never infers a Target', async t => {
  const { directory, state, release, bytes } = await setup(t);
  const secret = 'SYNTHETIC_SHARED_DELIVERY_SECRET';
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
  const alice = await login('alice@example.org'), bob = await login('bob@example.org');
  const route = `/api/solutions/${state.id}/handoffs/${release.id}/delivery`;
  await json(await request(route, null), 404);
  await json(await request(`/api/releases/${release.id}/delivery`, alice.cookie), 404);
  await json(await request(`/api/solutions/${crypto.randomUUID()}/handoffs/${release.id}/delivery`, alice.cookie), 404);
  const connection = await json(await post('/api/connections', alice.cookie, target()), 201);
  const input = { action: 'prepare', revision: release.revision, connectionId: connection.id };
  await json(await post(route, bob.cookie, input), 404);
  await json(await post(route, alice.cookie, input, { Origin: 'https://foreign.example.invalid' }), 403);
  await json(await post(route, alice.cookie, input, { 'X-Elma-Wiki-Request': '' }), 403);
  for (const extra of [{ owner: SOLUTION_CATALOG }, { actor: bob.user }, { source: 'legacy' }, { bytes: 'forged' }, { solutionId: state.id }])
    await json(await post(route, alice.cookie, { ...input, ...extra }), 400);
  await json(await post(route, alice.cookie, { action: 'prepare', revision: release.revision }), 404);
  let attempt = await json(await post(route, alice.cookie, input), 201);
  assert.equal(attempt.executionActorId, alice.user.id);
  assert.equal(attempt.owner, undefined);
  assert.equal(attempt.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await json(await request(route, bob.cookie)), []);
  await json(await post(route, bob.cookie, { action: 'confirm', attemptId: attempt.id, ...confirm(attempt) }), 404);
  attempt = await json(await post(route, alice.cookie, { action: 'confirm', attemptId: attempt.id, ...confirm(attempt) }));
  assert.equal(attempt.state, 'deployed-unverified');
  attempt = await json(await post(route, alice.cookie, { action: 'verify', attemptId: attempt.id }));
  assert.equal(attempt.state, 'verified');
  assert.equal((await json(await request(route, alice.cookie)))[0].verificationCurrent, true);
  await json(await request(route, alice.cookie, { method: 'DELETE', headers: { 'X-Elma-Wiki-Request': '1' } }), 405);
});

test('final prepare, dispatch and verified persistence hold the Solution guard through the write', async t => {
  for (const phase of ['prepare', 'confirm', 'verify']) await t.test(phase, async sub => {
    const { delivery, shared, release, directory, mutate, calls } = await setup(sub);
    const connection = await delivery.connections.create(actor.id, target());
    let attempt;
    if (phase !== 'prepare') attempt = await shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id });
    if (phase === 'verify') attempt = await shared.confirm(release.id, attempt.id, actor.id, confirm(attempt));
    const entered = deferred(), finish = deferred(), originalRename = fs.rename;
    const finalState = { prepare: 'prepared', confirm: 'deploying', verify: 'verified' }[phase];
    let held = false, mutated = false, mutation;
    fs.rename = async (source, destination) => {
      if (!held && String(destination).startsWith(path.join(directory, 'delivery', 'attempts', 'solutions', release.id)) &&
          JSON.parse(await fs.readFile(source)).state === finalState) {
        held = true; entered.resolve(); await finish.promise;
      }
      return originalRename(source, destination);
    };
    let pending;
    try {
      pending = phase === 'prepare' ? shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id })
        : phase === 'confirm' ? shared.confirm(release.id, attempt.id, actor.id, confirm(attempt)) : shared.verify(release.id, attempt.id, actor.id);
      await entered.promise;
      mutation = mutate('archive').then(() => { mutated = true; });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(mutated, false, 'mutation must wait through the final guarded persistence');
      finish.resolve();
      const committed = await pending; await mutation;
      const historical = await shared.get(release.id, committed.id, actor.id);
      assert.equal(historical.candidateStatus, 'stale');
      assert.equal(historical.verificationCurrent, false);
      assert.equal(calls.length, phase === 'prepare' ? 0 : 1);
    } finally {
      finish.resolve(); fs.rename = originalRename;
      await Promise.allSettled([pending, mutation].filter(Boolean));
    }
  });
});

test('slow shared import holds no candidate queue, keeps stale operation evidence and unknown outcomes recover only by read-back', async t => {
  const entered = deferred(), finish = deferred();
  const adapter = syntheticAdapter({ identity: { host: 'shared.example.invalid' } });
  const deploy = adapter.deployCandidate.bind(adapter); let imports = 0;
  adapter.deployCandidate = async (...args) => { imports++; entered.resolve(); await finish.promise; return deploy(...args); };
  const { directory, solutions, legacy, delivery, shared, release, bytes, state, mutate } = await setup(t, { adapters: { synthetic: () => adapter }, confirmGraceMs: 5 });
  const connection = await delivery.connections.create(actor.id, target());
  let attempt = await shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id });
  const operation = shared.confirm(release.id, attempt.id, actor.id, confirm(attempt));
  await entered.promise; attempt = await operation;
  assert.equal(attempt.state, 'deploying');
  await mutate('comment'); // would deadlock if native work held the Solution queue
  finish.resolve();
  for (let i = 0; i < 100; i++) {
    attempt = await shared.get(release.id, attempt.id, actor.id);
    if (attempt.state !== 'deploying') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(attempt.state, 'deployed-unverified');
  assert.equal(attempt.candidateStatus, 'stale');
  assert.equal(attempt.verificationCurrent, false);
  await assert.rejects(shared.verify(release.id, attempt.id, actor.id), error => error.statusCode === 409);
  assert.equal(imports, 1);
  // Fresh independent lifecycle, then simulate a process interrupted after
  // dispatch. A seeded synthetic Target represents matching observed read-back.
  const fresh = await setup(t);
  const freshConnection = await fresh.delivery.connections.create(actor.id, target());
  const prepared = await fresh.shared.prepare(fresh.release.id, actor.id, { revision: fresh.release.revision, connectionId: freshConnection.id });
  const file = path.join(fresh.directory, 'delivery', 'attempts', 'solutions', fresh.release.id, prepared.id + '.json');
  const record = JSON.parse(await fs.readFile(file));
  await fs.writeFile(file, JSON.stringify({ ...record, state: 'deploying', bootId: 'previous-process', idempotencyKey: 'already-dispatched' }));
  let redispatches = 0;
  const recoveredAdapter = syntheticAdapter({ identity: { host: 'shared.example.invalid' }, inventory: await inventoryOf(fresh.bytes) });
  recoveredAdapter.deployCandidate = async () => { redispatches++; assert.fail('unknown outcome redispatched'); };
  const restarted = deliveryStore(fresh.directory, fresh.legacy, { solutionHandoffs: fresh.solutions.handoffs, adapters: { synthetic: () => recoveredAdapter } });
  const contextual = restarted.forSolution(fresh.state.id);
  assert.equal((await contextual.get(fresh.release.id, prepared.id, actor.id)).state, 'unknown-outcome');
  await assert.rejects(contextual.confirm(fresh.release.id, prepared.id, actor.id, confirm(prepared)), error => error.statusCode === 409);
  assert.equal((await contextual.verify(fresh.release.id, prepared.id, actor.id)).state, 'verified');
  assert.equal(redispatches, 0);
});

test('atomic dispatch persistence failure never imports; transient sharing retries only persistence', async t => {
  for (const mode of ['permanent', 'sharing']) await t.test(mode, async sub => {
    const { directory, delivery, shared, release, calls } = await setup(sub);
    const connection = await delivery.connections.create(actor.id, target());
    const attempt = await shared.prepare(release.id, actor.id, { revision: release.revision, connectionId: connection.id });
    const originalRename = fs.rename; let refused = false;
    fs.rename = async (source, destination) => {
      if (!refused && String(destination).startsWith(path.join(directory, 'delivery', 'attempts', 'solutions', release.id)) &&
          JSON.parse(await fs.readFile(source)).state === 'deploying') {
        refused = true;
        throw Object.assign(Error('Synthetic persistence failure'), { code: mode === 'permanent' ? 'EACCES' : 'EPERM' });
      }
      return originalRename(source, destination);
    };
    try {
      if (mode === 'permanent') {
        await assert.rejects(shared.confirm(release.id, attempt.id, actor.id, confirm(attempt)), error => error.code === 'EACCES');
        assert.equal(calls.length, 0);
        assert.equal((await shared.get(release.id, attempt.id, actor.id)).state, 'prepared');
        assert.equal((await shared.cancel(release.id, attempt.id, actor.id)).state, 'cancelled');
      } else {
        assert.equal((await shared.confirm(release.id, attempt.id, actor.id, confirm(attempt))).state, 'deployed-unverified');
        assert.equal(calls.length, 1);
        assert.equal((await shared.get(release.id, attempt.id, actor.id)).state, 'deployed-unverified');
      }
      assert.equal(refused, true);
    } finally { fs.rename = originalRename; }
  });
});

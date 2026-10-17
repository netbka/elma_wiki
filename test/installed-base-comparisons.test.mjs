import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { deliveryStore, inventoryOf, syntheticAdapter } from '../lib/delivery.mjs';
import { zip } from './fixture.mjs';
import { readArchive } from '../lib/e365.mjs';
import { targetPresets } from '../lib/target-presets.mjs';

const archive = value => zip([['package.json', { code: 'synthetic_install', type: 'SOLUTION' }], ['widgets/form.json', { value }]]);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const target = { name: 'Synthetic DEV2', role: 'target', environment: 'test', adapter: 'synthetic' };
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-installed-base-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const solutionId = crypto.randomUUID(), candidates = new Map(), calls = [];
  const state = { inventory: [], host: 'synthetic.example.invalid', onRead: async () => {}, fail: false };
  const provider = {
    async authorize(solution, id) { if (solution !== solutionId || !candidates.has(id)) throw Object.assign(Error('Not found'), { statusCode: 404 }); },
    async withCandidate(solution, id, operation) { await this.authorize(solution, id); const current = candidates.get(id); if (!current.approval) throw Object.assign(Error('Stale candidate'), { statusCode: 409 }); return operation({ ...structuredClone(current), bytes: Buffer.from(current.bytes) }); }
  };
  const options = { solutionHandoffs: provider, adapters: { synthetic: () => ({
    ...syntheticAdapter({ calls }),
    async inspectSolution() { return { inventory: structuredClone(state.inventory), version: 'synthetic-1' }; },
    async deployCandidate(candidate) { calls.push(candidate.sha256); state.inventory = await inventoryOf(candidate.bytes); return { ok: true, operationId: crypto.randomUUID() }; },
    async health() { return { ok: true, identity: { host: state.host, version: 'synthetic-1' } }; },
    async readBack() { if (state.fail) throw Object.assign(Error('Unavailable'), { statusCode: 503 }); const result = { inventory: structuredClone(state.inventory), version: 'synthetic-1' }; await state.onRead(); return result; }
  }) } };
  const delivery = deliveryStore(directory, {}, options), facade = delivery.forSolution(solutionId);
  const connection = await delivery.connections.create('actor', target);
  const candidate = async value => {
    const bytes = await archive(value), id = crypto.randomUUID();
    candidates.set(id, { id, code: 'synthetic_install', bytes, revision: 1,
      approval: { revision: 1 }, candidate: { id: crypto.randomUUID(), sha256: sha(bytes) },
      sourceAssociation: { solutionId, revision: candidates.size, artifactId: crypto.randomUUID(), sha256: sha(bytes), policy: 'accepted-full-export-v1' } });
    return id;
  };
  const input = { revision: 1, connectionId: connection.id };
  return { directory, solutionId, candidates, state, calls, delivery, facade, connection, candidate, input, options };
}

test('manual reconciliation requires actual read-back; exact installed inventory stays distinct from the next candidate', async t => {
  const { directory, candidates, state, calls, facade, candidate, input, solutionId, options } = await setup(t);
  const a = await candidate('A');
  assert.equal((await facade.compareInstalled(a, 'actor', input)).comparison.status, 'unknown-base');
  assert.equal((await facade.reconcileInstalled(a, 'actor', input)).installedObservation, undefined, 'caller approval cannot prove a manual import');
  state.inventory = await inventoryOf(candidates.get(a).bytes);
  const reconciled = await facade.reconcileInstalled(a, 'actor', input);
  assert.equal(reconciled.comparison.status, 'reconciled');
  assert.equal(reconciled.installedObservation.method, 'manual-import-read-back');
  assert.equal(reconciled.installedObservation.businessAcceptance, 'not-established');
  assert.equal(calls.length, 0, 'read-only reconciliation never dispatches');
  const b = await candidate('B'), c = await candidate('C');
  const next = await facade.compareInstalled(b, 'actor', input);
  assert.equal(next.comparison.status, 'compared');
  assert.equal(next.comparison.before.candidate.sha256, candidates.get(a).candidate.sha256);
  assert.equal(next.proposed.sha256, candidates.get(b).candidate.sha256);
  assert.deepEqual(next.comparison.delta.different, ['widgets/form.json']);
  state.inventory = await inventoryOf(candidates.get(c).bytes);
  assert.equal((await facade.compareInstalled(b, 'actor', input)).comparison.status, 'drifted');
  state.inventory = reconciled.installedObservation.inventory;
  const restarted = deliveryStore(directory, {}, options).forSolution(solutionId);
  assert.equal((await restarted.compareInstalled(b, 'actor', input)).comparison.before.id, reconciled.installedObservation.id);
  assert.deepEqual((await restarted.installedHistory(a, 'actor')).at(-1), reconciled);
  assert.equal((await restarted.list(a, 'actor')).length, 0, 'observations are not delivery attempts');
  state.inventory = await inventoryOf(candidates.get(b).bytes);
  const updated = await restarted.reconcileInstalled(b, 'actor', input);
  assert.equal(updated.installedObservation.sequence, reconciled.installedObservation.sequence + 1);
  assert.equal(updated.comparison.delta, null);
  assert.equal((await restarted.compareInstalled(c, 'actor', input)).comparison.before.id, updated.installedObservation.id);
  await assert.rejects(restarted.compareInstalled(b, 'actor', { ...input, installed: true }), { statusCode: 400 });
  await assert.rejects(restarted.compareInstalled(b, 'other-actor', input), { statusCode: 404 });
});

test('partial, failed, unknown and interrupted deliveries never advance a base or permit manual reconciliation', async t => {
  for (const outcome of ['partial-outcome', 'failed', 'unknown-outcome', 'deploying']) await t.test(outcome, async t => {
    const { directory, candidates, state, facade, candidate, input, solutionId } = await setup(t);
    const a = await candidate('A'), b = await candidate('B');
    state.inventory = await inventoryOf(candidates.get(a).bytes);
    const old = await facade.reconcileInstalled(a, 'actor', input);
    const id = crypto.randomUUID(), dest = path.join(directory, 'delivery', 'attempts', 'solutions', b);
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, id + '.json'), JSON.stringify({ id, releaseId: b, candidateSource: { namespace: 'solution', solutionId, id: b },
      owner: 'actor', createdAt: new Date().toISOString(), state: outcome, targetIdentity: old.installedObservation.targetIdentity,
      history: [{ state: 'deploying' }], bootId: 'previous-process' }));
    state.inventory = await inventoryOf(candidates.get(b).bytes);
    const result = await facade.reconcileInstalled(b, 'actor', input);
    assert.equal(result.comparison.status, 'unresolved-outcome');
    assert.equal(result.installedObservation, undefined);
    assert.equal(result.comparison.before.id, old.installedObservation.id);
    assert.equal(result.comparison.delta, null);
  });
});

test('changed identity, stale candidate and failed/malformed reads preserve earlier facts without advancing', async t => {
  const { candidates, state, facade, candidate, input } = await setup(t);
  const a = await candidate('A'); state.inventory = await inventoryOf(candidates.get(a).bytes);
  const baseline = await facade.reconcileInstalled(a, 'actor', input);
  const b = await candidate('B');
  state.onRead = async () => { candidates.get(b).sourceAssociation.revision++; };
  await assert.rejects(facade.reconcileInstalled(b, 'actor', input), { statusCode: 409 });
  state.onRead = async () => { state.host = 'other.example.invalid'; };
  await assert.rejects(facade.compareInstalled(b, 'actor', input), { statusCode: 409 });
  state.onRead = async () => {};
  assert.equal((await facade.compareInstalled(b, 'actor', input)).comparison.status, 'unknown-base', 'a different Target identity cannot reuse the previous base');
  state.host = 'synthetic.example.invalid'; state.onRead = async () => {}; state.fail = true;
  await assert.rejects(facade.compareInstalled(b, 'actor', input), { statusCode: 503 });
  state.fail = false; state.inventory = [{ path: '../invalid', sha256: '0'.repeat(64) }];
  await assert.rejects(facade.reconcileInstalled(b, 'actor', input), { statusCode: 502 });
  state.inventory = baseline.installedObservation.inventory;
  assert.equal((await facade.compareInstalled(b, 'actor', input)).comparison.before.id, baseline.installedObservation.id);
  const errors = (await facade.installedHistory(b, 'actor')).filter(row => row.comparison.status === 'observation-failed');
  assert.equal(errors.length, 4);
  assert.equal(errors.filter(row => row.readBack?.identityContinuous).length, 1, 'stale candidate keeps its exact historical observation');
});

test('verified delivery establishes a scoped base only after read-back; later review does not rewrite that historical fact', async t => {
  const { candidates, state, facade, candidate, input } = await setup(t);
  const a = await candidate('A');
  let attempt = await facade.prepare(a, 'actor', input);
  attempt = await facade.confirm(a, attempt.id, 'actor', { idempotencyKey: 'synthetic-delivery', confirmation: `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}` });
  assert.equal(attempt.state, 'deployed-unverified'); assert.equal(attempt.installedObservation, undefined);
  const verified = await facade.verify(a, attempt.id, 'actor');
  assert.equal(verified.installedObservation.method, 'delivery-read-back');
  assert.deepEqual(verified.installedObservation.inventory, state.inventory);
  assert.equal(verified.installedObservations.length, 1);
  candidates.get(a).approval = null;
  const b = await candidate('B');
  const result = await facade.compareInstalled(b, 'actor', input);
  assert.equal(result.comparison.before.candidate.sha256, verified.sha256);
  assert.equal(result.comparison.before.businessAcceptance, 'not-established');
});

test('profile alone cannot establish installation; normalized manual reconciliation requires matching metadata bytes', async t => {
  const { directory, candidates, state, candidate, options, solutionId } = await setup(t);
  const a = await candidate('A'), bytes = candidates.get(a).bytes;
  const presets = targetPresets({ WIKI_TARGET_DEV_URL: 'https://donor.example.invalid', WIKI_TARGET_DEV2_URL: 'https://synthetic.example.invalid',
    WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: sha(bytes) });
  let metadata = false;
  const adapter = options.adapters.synthetic();
  const delivery = deliveryStore(directory, {}, { ...options, presets, presetAdapter: () => ({ ...adapter,
    async readBack(code, request) {
      const result = await adapter.readBack(code, request);
      if (metadata) {
        const files = await readArchive(bytes);
        result.metadataFiles = request.metadata.paths.map(name => ({ path: name, sha256: sha(files.get(name)), contentBase64: files.get(name).toString('base64') }));
      }
      return result;
    }
  }) });
  await delivery.connections.probe('preset-dev2', 'actor');
  const facade = delivery.forSolution(solutionId), input = { revision: 1, connectionId: 'preset-dev2' };
  assert.deepEqual(await facade.installedHistory(a, 'actor'), [], 'a successful profile/health probe records no installation');
  state.inventory = await inventoryOf(bytes);
  await assert.rejects(facade.reconcileInstalled(a, 'actor', input), { statusCode: 502 });
  assert.equal((await facade.installedHistory(a, 'actor'))[0].installedObservation, undefined);
  metadata = true;
  const result = await facade.reconcileInstalled(a, 'actor', input);
  assert.equal(result.comparison.status, 'reconciled');
  assert.equal(result.installedObservation.policy.id, 'import-normalized-v1');
  assert.equal(result.installedObservation.businessAcceptance, 'not-established');
});

test('failed final evidence persistence never advances the installed base', async t => {
  const { facade, candidate, input } = await setup(t), id = await candidate('A');
  let attempt = await facade.prepare(id, 'actor', input);
  attempt = await facade.confirm(id, attempt.id, 'actor', { idempotencyKey: 'synthetic-persistence', confirmation: `DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}` });
  const rename = fs.rename;
  fs.rename = async (...args) => { fs.rename = rename; throw Object.assign(Error('Synthetic persistence failure'), { code: 'EIO' }); };
  try { await assert.rejects(facade.verify(id, attempt.id, 'actor'), { code: 'EIO' }); }
  finally { fs.rename = rename; }
  assert.equal((await facade.get(id, attempt.id, 'actor')).installedObservation, undefined);
  assert.equal((await facade.compareInstalled(id, 'actor', input)).comparison.status, 'unknown-base');
});

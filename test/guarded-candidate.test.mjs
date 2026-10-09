import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { zip } from './fixture.mjs';

const actor = { id: 'synthetic-actor', login: 'synthetic@example.org', provider: 'local' };
const archive = value => zip([
  ['package.json', { code: 'synthetic_guard', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'sample', namespace: 'synthetic', kind: 'WIDGET', path: 'sample.json' }] }],
  ['widgets/sample.json', { descriptor: { clientScripts: `const value = ${value};` } }]
]);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-guarded-candidate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = solutionStore(directory), bytes = await archive(1);
  const upload = await store.uploads.create(SOLUTION_CATALOG, bytes, 'synthetic.e365', actor);
  const snapshot = { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true };
  let state = await store.managed.create(SOLUTION_CATALOG, { name: 'Synthetic guard', baselineOwner: 'Team', snapshot }, actor);
  // Establish a completed, commentable full review while retaining exact bytes.
  const full = await store.managed.prepare(state.id, SOLUTION_CATALOG, {
    kind: 'reconciliation', expectedRevision: 0, baselineOwner: 'Team', snapshot, sameSourceConfirmed: true
  }, actor);
  state = await store.managed.accept(state.id, SOLUTION_CATALOG, full.artifactId, {
    expectedRevision: full.revision, reviewedDigest: full.artifactDigest
  }, actor);
  const handoffs = store.handoffs;
  let release = await handoffs.create(state.id, { expectedRevision: state.revision, title: 'Synthetic handoff',
    intent: 'Offline only', targetIntent: 'No native target' }, actor);
  const change = async input => { release = await handoffs.change(state.id, release.id, { revision: release.revision, ...input }, actor); return release; };
  await change({ action: 'details', title: release.title, intent: release.intent, targetIntent: release.targetIntent,
    limitations: 'Native target and runtime unverified', notes: '' });
  for (const row of release.changes) await change({ action: 'review', path: row.path, decision: 'accepted', reason: 'Synthetic source reviewed' });
  await change({ action: 'freeze' }); await change({ action: 'approve', reason: 'Offline only' });
  return { directory, store, state, handoffs, release, bytes, change, full };
}

test('shared final candidate callback carries exact approved bytes and returns its consumer result without authorizing dispatch', async t => {
  const { handoffs, state, release, bytes } = await setup(t);
  const result = await handoffs.withCandidate(state.id, release.id, candidate => {
    assert.deepEqual(candidate.bytes, bytes);
    assert.equal(candidate.revision, release.revision);
    assert.equal(candidate.candidate.sha256, release.candidate.sha256);
    assert.equal(candidate.sourceAssociation.reviewDigest, release.sourceAssociation.reviewDigest);
    assert.equal(candidate.approval.scope, 'offline-handoff-only');
    assert.equal(candidate.candidate.deployable, false);
    return { syntheticCommit: true };
  });
  assert.deepEqual(result, { syntheticCommit: true });
});

test('final callback after paused preflight refuses comment, finding, archive and release changes', async t => {
  for (const mode of ['comment', 'finding', 'archive', 'release']) await t.test(mode, async sub => {
    const { store, handoffs, state, release, change, full } = await setup(sub);
    const paused = deferred(), reached = deferred(); let calls = 0;
    const finalOperation = (async () => {
      reached.resolve(); await paused.promise;
      return handoffs.withCandidate(state.id, release.id, () => { calls++; });
    })();
    await reached.promise;
    if (mode === 'archive') await store.managed.setArchived(state.id, SOLUTION_CATALOG,
      { archived: true, expectedRevision: state.revision }, actor);
    else if (mode === 'release') await change({ action: 'details', title: release.title,
      intent: release.intent, targetIntent: release.targetIntent, limitations: 'New condition', notes: '' });
    else {
      const discussion = (await store.managed.review(state.id, SOLUTION_CATALOG, full.artifactId)).discussion;
      await store.managed.comment(state.id, SOLUTION_CATALOG, full.artifactId, {
        expectedRevision: state.revision, expectedDiscussionRevision: discussion.version,
        type: mode === 'finding' ? 'reject' : 'comment', text: 'New synthetic evidence'
      }, actor);
    }
    paused.resolve();
    await assert.rejects(finalOperation, error => error.statusCode === 409);
    assert.equal(calls, 0);
  });
});

test('Solution guard remains held through final persistence while an archive waits; subsequent reads are stale', async t => {
  const { directory, store, handoffs, state, release } = await setup(t);
  const entered = deferred(), finish = deferred(), order = [];
  const evidenceFile = path.join(directory, 'synthetic-final-evidence.json');
  const commit = handoffs.withCandidate(state.id, release.id, async candidate => {
    entered.resolve(); await finish.promise;
    await fs.writeFile(evidenceFile, JSON.stringify({ sha256: candidate.candidate.sha256 }));
    order.push('committed'); return 'committed';
  });
  await entered.promise;
  const archive = store.managed.setArchived(state.id, SOLUTION_CATALOG,
    { archived: true, expectedRevision: state.revision }, actor).then(value => { order.push('archived'); return value; });
  finish.resolve();
  assert.equal(await commit, 'committed'); await archive;
  assert.deepEqual(order, ['committed', 'archived']);
  assert.equal(JSON.parse(await fs.readFile(evidenceFile, 'utf8')).sha256, release.candidate.sha256);
  await assert.rejects(handoffs.withCandidate(state.id, release.id, () => assert.fail('stale callback ran')), error => error.statusCode === 409);
});

test('candidate callback holds release mutation queue and releases all guards after consumer failure', async t => {
  const { handoffs, state, release, change } = await setup(t);
  const entered = deferred(), finish = deferred(), order = [];
  const failure = handoffs.withCandidate(state.id, release.id, async () => {
    entered.resolve(); await finish.promise; order.push('consumer-failed'); throw Error('Synthetic consumer failure');
  });
  const observedFailure = assert.rejects(failure, /Synthetic consumer failure/);
  await entered.promise;
  const mutation = change({ action: 'details', title: release.title, intent: release.intent,
    targetIntent: release.targetIntent, limitations: 'Queued change', notes: '' }).then(value => { order.push('release-edited'); return value; });
  finish.resolve(); await observedFailure; await mutation;
  assert.deepEqual(order, ['consumer-failed', 'release-edited']);
  await assert.rejects(handoffs.withCandidate(state.id, release.id, () => assert.fail('invalid candidate callback')), /approved immutable/);
});

test('trusted callback preserves Solution pairing, legacy-root identity, checksum and unconfigured association refusal', async t => {
  const { directory, store, handoffs, state, release, bytes } = await setup(t);
  const upload = await store.uploads.create(SOLUTION_CATALOG, bytes, 'other.e365', actor);
  const other = await store.managed.create(SOLUTION_CATALOG, { name: 'Other', baselineOwner: 'Team',
    snapshot: { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true } }, actor);
  await assert.rejects(handoffs.withCandidate(other.id, release.id, () => assert.fail('foreign Solution')), error => error.statusCode === 404);
  const legacy = releaseStore(directory, null, { sharedAccess: true });
  await assert.rejects(legacy.withCandidate(release.id, actor.id, () => assert.fail('cross-root')), error => error.statusCode === 404);
  const unguarded = releaseStore(path.join(directory, 'shared-solutions'), null);
  await assert.rejects(unguarded.withCandidate(release.id, SOLUTION_CATALOG, () => assert.fail('missing guard')), /verification is unavailable/);
  await assert.rejects(handoffs.withCandidate(state.id, release.id, null), /trusted candidate operation/);
  await fs.appendFile(path.join(directory, 'shared-solutions', 'releases', release.id, 'source.e365'), 'corrupt');
  await assert.rejects(handoffs.withCandidate(state.id, release.id, () => assert.fail('corrupt bytes')), /сумма/);
});

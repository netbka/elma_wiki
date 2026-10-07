import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { reviewGate, workspaceSummary, componentName, workspaceUrl, solutionNextAction } from '../web/managed/model.js';

test('review requires explicit boundary decisions and per-conflict choices; ambiguity and cross-team overlap never become ready', () => {
  const partial = managedFixture('review').review;
  assert.ok(reviewGate(partial));
  assert.equal(reviewGate(partial, partial.rows.map(row => row.key)), '');
  const full = managedFixture('conflict').review;
  assert.ok(reviewGate(full));
  assert.ok(reviewGate(full, [], { [full.rows[0].key]: 'automatic-merge' }));
  assert.equal(reviewGate(full, [], { [full.rows[0].key]: 'keep-working' }), '');
  for (const mode of ['ambiguous', 'overlap']) {
    const review = managedFixture(mode).review;
    assert.ok(reviewGate(review, review.rows.map(row => row.key), Object.fromEntries(review.rows.map(row => [row.key, 'take-snapshot']))));
  }
  assert.ok(reviewGate({ ...partial, stale: true }, partial.rows.map(row => row.key)));
});
test('overview summaries distinguish a manual Source assertion, accepted baseline and current interventions', () => {
  const state = managedFixture().workspace, summary = workspaceSummary(state);
  assert.equal(summary.changed, 1); assert.equal(summary.pending, 0);
  assert.equal(summary.baseline.id, state.baselineId); assert.match(summary.source, /не проверено/);
  state.artifacts.unshift({ id: 'old', snapshot: { source: { connectionId: 'synthetic-dev' } } });
  assert.equal(workspaceSummary(state).source, 'synthetic-dev', 'manual baseline does not erase known workspace Source');
  assert.equal(workspaceSummary({ changedComponents: 5, pendingCount: 2, baselineSnapshot: { source: { connectionId: 'synthetic-source' } } }).pending, 2);
  assert.equal(componentName('["widgets","synthetic","contract"]'), 'contract');
  assert.equal(componentName('<img src=x>'), '<img src=x>'); // renderer must use textContent, never HTML
  assert.equal(workspaceUrl('a&b', 'review', 'x/y'), '/workspaces?id=a%26b&view=review&artifact=x%2Fy');
});
test('one next action prioritizes blockers, fresh review and stale recovery over adding more work', () => {
  assert.equal(solutionNextAction(null).view, 'create');
  assert.equal(solutionNextAction(managedFixture('no-source').workspace).state, 'no-source');
  assert.equal(solutionNextAction(managedFixture('archived').workspace).action, 'reopen');
  const ready = managedFixture().workspace; ready.changes = [];
  assert.equal(solutionNextAction(ready).view, 'change');
  const pending = managedFixture('pending').workspace;
  assert.equal(solutionNextAction(pending).artifact, pending.pending[0].artifactId);
  pending.pending.push({ artifactId: 'conflict', kind: 'reconciliation', attention: { conflicts: 1 }, stale: false });
  assert.equal(solutionNextAction(pending).artifact, 'conflict');
  pending.pending.forEach(row => row.stale = true);
  assert.equal(solutionNextAction(pending).state, 'stale');
  assert.equal(solutionNextAction(pending).view, 'change');
  assert.equal(solutionNextAction(managedFixture('needs-fixes').workspace).state, 'needs-fixes');
  assert.equal(solutionNextAction(managedFixture('needs-fixes').workspace).artifact, 'synthetic-review');
  const reopened = managedFixture().workspace;
  reopened.openFindings = [{ artifactId: 'accepted-review', text: 'New evidence' }];
  assert.equal(solutionNextAction(reopened).artifact, 'accepted-review');
  assert.equal(solutionNextAction(reopened).view, 'review');
  assert.equal(solutionNextAction(managedFixture().workspace).view, 'solution');
  assert.equal(solutionNextAction(ready, { error: 'offline' }).label, 'Обновить состояние');
  ready.delivery = { supported: true, state: 'deployed-unverified' };
  assert.equal(solutionNextAction(ready).state, 'test-awaiting-verification');
  ready.delivery.state = 'verified'; assert.equal(solutionNextAction(ready).state, 'verified');
  ready.delivery.supported = false; assert.equal(solutionNextAction(ready).state, 'ready');
  assert.equal(workspaceUrl('a&b', 'review', 'x/y', '/solutions'), '/solutions?id=a%26b&view=review&artifact=x%2Fy');
});
test('unresolved findings block acceptance independently of object boundaries and anchor freshness', () => {
  for (const mode of ['review-findings','review-stale-anchor','review-removed-anchor','review-ambiguous-anchor']) {
    const review = managedFixture(mode).review;
    assert.match(reviewGate(review, review.rows.map(row => row.key)), /замечания/);
  }
  const resolved = managedFixture('review-resolved').review;
  assert.equal(reviewGate(resolved, resolved.rows.map(row => row.key)), '');
});

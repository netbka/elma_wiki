import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { reviewGate, workspaceSummary, componentName, workspaceUrl } from '../web/managed/model.js';

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

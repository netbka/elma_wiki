import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceComparisonView, installedComparisonView } from '../web/managed/comparisons.js';
import { comparisonFixture } from '../web/managed/comparison-fixtures.js';
import { solutionDeliveryClient, composedDeliveryClient } from '../web/managed/delivery-client.js';

test('source capture comparison shows changed and unchanged rows separately and refuses uncertain sources', () => {
  const fixture = comparisonFixture(), comparison = fixture.sourceHistory[0];
  assert.equal(sourceComparisonView(comparison).rows.length, 1);
  assert.equal(sourceComparisonView(comparison).unchanged.length, 1);
  for (const status of ['ambiguous', 'first-capture', 'different-source', 'unknown-source', 'history-unavailable', 'unexpected']) {
    const view = sourceComparisonView({ ...comparison, status });
    assert.equal(view.comparable, false); assert.deepEqual(view.rows, []);
  }
  assert.equal(sourceComparisonView().comparable, false);
});

test('only the exact current candidate and observed matching base expose a deployment delta', () => {
  const { record, release, connections } = comparisonFixture();
  const view = () => installedComparisonView(record, release, connections[0].id);
  assert.equal(view().current, true); assert.ok(view().delta);
  for (const status of ['drifted', 'unknown-base', 'unresolved-outcome', 'observation-failed', 'reconciled']) {
    record.comparison.status = status; assert.equal(view().delta, null);
  }
  record.comparison.status = 'compared';
  for (const field of ['sha256', 'candidateId', 'releaseRevision']) {
    const old = record.proposed[field]; record.proposed[field] = 'changed';
    assert.equal(view().current, false); assert.equal(view().delta, null); record.proposed[field] = old;
  }
  assert.equal(installedComparisonView(record, release, 'other-target').delta, null);
});

test('contextual comparison clients retain exact namespaces and do not dispatch delivery actions', async () => {
  for (const [factory, segment] of [[solutionDeliveryClient, 'handoffs'], [composedDeliveryClient, 'composed']]) {
    const calls = [], client = factory('solution/a', async (...args) => { calls.push(args); return []; });
    await client.installedHistory('candidate/b');
    await client.installedAction('candidate/b', { action: 'compareInstalled', revision: 2, connectionId: 'preset-dev2' });
    assert.equal(calls[0][0], `/api/solutions/solution%2Fa/${segment}/candidate%2Fb/delivery?installed=true`);
    assert.equal(calls[1][1].action, 'compareInstalled');
    assert.equal(calls.length, 2);
  }
});

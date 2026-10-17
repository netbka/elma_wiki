import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceComparisonView, installedComparisonView, latestInstalledRecord, installedObservationAt } from '../web/managed/comparisons.js';
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

test('later delivery verification supersedes an unresolved comparison even when the attempt was created first', () => {
  const { record, release, connections } = comparisonFixture(), connection = connections[0];
  const delivery = { id: 'delivery', connection, createdAt: '2026-10-17T09:00:00Z',
    installedObservation: { at: '2026-10-17T11:00:00Z', sequence: 1, candidate: record.proposed } };
  const unresolved = { ...record, createdAt: '2026-10-17T10:00:00Z', comparison: { status: 'unresolved-outcome' } };
  assert.equal(latestInstalledRecord([delivery, unresolved], connection.id), delivery);
  assert.equal(installedObservationAt(delivery), '2026-10-17T11:00:00Z');
  assert.equal(installedComparisonView(delivery, release, connection.id).current, true);
  assert.equal(installedComparisonView(delivery, release, connection.id).delta, null);
  const compared = { ...record, createdAt: '2026-10-17T11:00:00Z', comparison: { ...record.comparison,
    observed: { at: '2026-10-17T11:00:00Z' }, before: { sequence: 1 } } };
  assert.equal(latestInstalledRecord([delivery, unresolved, compared], connection.id), compared, 'a comparison observing that same sequence wins a clock-tick tie');
  delivery.evidence = { verificationError: { at: '2026-10-17T12:00:00Z' } };
  assert.equal(latestInstalledRecord([delivery, compared], connection.id), delivery);
  assert.notEqual(installedComparisonView(delivery, release, connection.id).status, installedComparisonView({ ...delivery, evidence: undefined }, release, connection.id).status);
});

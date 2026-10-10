import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { mergeResolutionView, mergeGate } from '../web/managed/merge.js';

test('merge view requires an explicit supported choice and reason; no version is preselected', () => {
  const view = mergeResolutionView(managedFixture('merge-required').review.merge);
  assert.equal(view.visible, true); assert.equal(view.editable, true); assert.equal(view.head, null);
  assert.deepEqual(view.required.map(row => [row.name, row.options.map(([value]) => value)]), [['limit', ['keep-current', 'take-incoming']]]);
  assert.deepEqual(view.preserved.map(row => row.name), ['category', 'contract']);
  assert.match(mergeGate(view), /каждого конфликта/);
  assert.match(mergeGate(view, { [view.required[0].key]: 'remove' }, 'x'), /каждого конфликта/, 'unsupported choice for this classification');
  assert.match(mergeGate(view, { [view.required[0].key]: 'take-incoming' }, '  '), /причину/);
  assert.equal(mergeGate(view, { [view.required[0].key]: 'take-incoming' }, 'Согласовано'), '');
});

test('saved, stale and blocked resolutions stay attributed and never become editable when blocked', () => {
  const resolved = mergeResolutionView(managedFixture('merge-resolved').review.merge);
  assert.equal(resolved.head.status, 'current'); assert.equal(resolved.head.actor, 'reviewer@example.org');
  assert.deepEqual(resolved.head.decisions, [{ name: 'limit', text: 'Взять версию из этого изменения' }]);
  assert.equal(resolved.editable, true, 'a new revision may follow a current head');
  const stale = mergeResolutionView(managedFixture('merge-stale').review.merge);
  assert.equal(stale.head.status, 'stale'); assert.match(stale.head.statusLabel, /Устарело/);
  const blocked = mergeResolutionView(managedFixture('merge-blocked').review.merge);
  assert.equal(blocked.editable, false); assert.deepEqual(blocked.required, []);
  assert.match(blocked.blocked[0].reasons[0], /переименование/);
  assert.ok(mergeGate(blocked, {}, 'x'));
  // Superseded and completed changes show history without a write path.
  const merge = structuredClone(managedFixture('merge-resolved').review.merge);
  Object.assign(merge, { available: false, reason: 'superseded', plan: null, head: { ...merge.head, status: 'stale' } });
  const superseded = mergeResolutionView(merge);
  assert.equal(superseded.visible, true); assert.equal(superseded.editable, false); assert.match(superseded.unavailable, /не переносятся/);
  // An unknown-base or conflict-free plan adds nothing to the existing review.
  const clear = structuredClone(managedFixture('merge-required').review.merge);
  clear.plan.status = 'clear'; assert.equal(mergeResolutionView(clear).visible, false);
  clear.plan.inputs.base.status = 'unknown'; clear.plan.status = 'blocked'; assert.equal(mergeResolutionView(clear).visible, false);
});

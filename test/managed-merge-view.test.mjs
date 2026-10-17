import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { reviewGate, reviewSummary, reviewRows, reviewBucket } from '../web/managed/model.js';
import { mergeResolutionView, mergeGate, partInput, mergeSubmission } from '../web/managed/merge.js';

test('same-team divergence blocks acceptance until a current resolution, independently of boundary checks', () => {
  const review = managedFixture('merge-same-team').review;
  const boundary = review.rows.filter(row => row.boundaryCrossing).map(row => row.key);
  assert.equal(review.stale, false); assert.equal(review.rows.some(row => row.conflict), false);
  const before = structuredClone(review);
  assert.equal(reviewSummary(review).counts.conflicts, 1);
  assert.equal(reviewBucket(reviewRows(review)[0]), 'conflicts');
  assert.deepEqual(review, before, 'display projection preserves source evidence');
  assert.match(reviewGate(review, boundary), /Разрешите конфликт выше/);
  const resolved = managedFixture('merge-same-team-resolved').review;
  assert.equal(reviewSummary(resolved).counts.conflicts, 0, 'a current saved resolution clears the semantic conflict count');
  assert.equal(reviewGate(resolved, boundary), '');
  const stale = structuredClone(resolved); stale.merge.head.status = 'stale';
  assert.equal(reviewSummary(stale).counts.conflicts, 1, 'a stale resolution restores the conflict count');
  assert.match(reviewGate(stale, boundary), /Разрешите конфликт выше/);
});

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

test('a process with complete stable part IDs offers an explicit part merge with part choices and findings', () => {
  const view = mergeResolutionView(managedFixture('merge-parts').review.merge);
  const process = view.required.find(row => row.parts);
  assert.deepEqual(process.options.map(([value]) => value), ['keep-current', 'take-incoming', 'merge-parts']);
  assert.equal(process.parts.available, true);
  assert.deepEqual(process.parts.required.map(part => [part.name, part.options.map(([value]) => value)]), [['Шаг Проверка руководителем', ['keep-current', 'take-incoming']]]);
  assert.deepEqual(process.parts.findings.map(finding => finding.type), ['behaviour-combined', 'dependency-impact']);
  assert.deepEqual(process.parts.findings[1].parts, ['Переменная Лимит']);
  // Widgets without part IDs keep whole-component choices only.
  assert.deepEqual(view.required.find(row => row.name === 'limit').options.map(([value]) => value), ['keep-current', 'take-incoming']);
  const decisions = { [process.key]: 'merge-parts', [view.required.find(row => row.name === 'limit').key]: 'keep-current' };
  assert.match(mergeGate(view, decisions, 'Согласовано'), /каждой части/);
  const partDecisions = { [process.key]: { [process.parts.required[0].id]: 'take-incoming' } };
  assert.equal(mergeGate(view, decisions, 'Согласовано', partDecisions), '');
  assert.deepEqual(partInput(view, decisions, partDecisions), { partDecisions });
  assert.deepEqual(partInput(view, { ...decisions, [process.key]: 'keep-current' }, partDecisions), {});
  // The submit path uses the same gate as the save button: a complete part choice is sent, a missing one is not.
  const merge = managedFixture('merge-parts').review.merge;
  assert.equal(mergeSubmission(merge, view, decisions, 'Согласовано'), null);
  assert.deepEqual(mergeSubmission(merge, view, decisions, 'Согласовано', partDecisions), { expectedRevision: merge.plan.inputs.current.revision,
    planDigest: merge.plan.planDigest, expectedResolutionId: view.head?.id ?? null, decisions, reason: 'Согласовано', partDecisions });
});

test('a blocked part plan keeps only the whole-component choice and names the reason', () => {
  const view = mergeResolutionView(managedFixture('merge-parts-blocked').review.merge);
  const process = view.required.find(row => row.parts);
  assert.equal(process.parts.available, false);
  assert.deepEqual(process.options.map(([value]) => value), ['keep-current', 'take-incoming']);
  assert.match(process.parts.reasons[0], /идентификатор/);
  // Without the server's part choice the option is never offered.
  const merge = structuredClone(managedFixture('merge-parts').review.merge); delete merge.partMergeChoice;
  assert.equal(mergeResolutionView(merge).required.find(row => row.parts).parts.available, false);
});

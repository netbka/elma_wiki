import test from 'node:test';
import assert from 'node:assert/strict';
import { composerView, composerGate, composedCandidateRow, composedDeliveryRelease, composerBuildView } from '../web/managed/composer.js';
import { composedCandidateFixture, solutionComposerFixture, composerNextActionFixture } from '../web/managed/composer-fixtures.js';
import { solutionNextAction } from '../web/managed/model.js';
import { deliveryPanelView } from '../web/releases/delivery-model.js';

test('build is blocked unless the server reports it available; an absent capability is never treated as working', () => {
  for (const build of [undefined, null, {}, { available: 'yes' }, solutionComposerFixture().model.composed.build]) {
    const view = composerBuildView(build);
    assert.equal(view.available, false); assert.match(view.reason, /недоступна|elma365#60/);
  }
  const pinned = composerBuildView(solutionComposerFixture().model.composed.build);
  assert.equal(pinned.missing.length, 4); assert.match(pinned.missing[0], /нативный исполнитель/);
  assert.match(pinned.reason, /elma365-native-materialization@1 закреплён/); assert.doesNotMatch(pinned.reason, /не опубликован/);
  assert.match(composerBuildView({ available: false, contracts: [], missing: [] }).reason, /закреплённого контракта .* нет/);
  // Every key is rendered; an unknown future key keeps a safe neutral label.
  assert.deepEqual(composerBuildView({ available: false, contracts: [], missing: ['future-gap'] }).missing, ['не описанное требование: future-gap']);
  assert.equal(composerBuildView({ available: true }).available, true);
  const empty = composerView({ candidates: [], build: null });
  assert.deepEqual(empty.rows, []); assert.match(empty.summary, /Собранных конфигураций нет/);
});

test('candidates project stale, awaiting and approved states truthfully; synthetic builds are never release-eligible', () => {
  const stale = composedCandidateRow(composedCandidateFixture({ status: 'stale', approved: true }));
  assert.equal(stale.status, 'stale'); assert.equal(stale.canApprove, false); assert.equal(stale.canRevoke, false); assert.equal(stale.deliverable, false);
  const awaiting = composedCandidateRow(composedCandidateFixture());
  assert.equal(awaiting.status, 'awaiting-approval'); assert.equal(awaiting.canApprove, true); assert.equal(awaiting.approval, null);
  const approved = composedCandidateRow(composedCandidateFixture({ approved: true }));
  assert.equal(approved.status, 'approved'); assert.equal(approved.canRevoke, true); assert.equal(approved.deliverable, true);
  assert.equal(approved.native, false); assert.match(approved.evidenceLabel, /не нативный пакет ELMA, к выпуску не допускается/);
  assert.deepEqual(approved.units.map(unit => unit.id), ['contract-fields', 'contract-approval', 'contract-forms'], 'import order kept');
  // An approval for an older revision is not current approval.
  const outdated = composedCandidateFixture({ approved: true }); outdated.revision = 3;
  assert.equal(composedCandidateRow(outdated).status, 'awaiting-approval');
  const native = composedCandidateRow({ ...composedCandidateFixture(), evidenceBasis: 'native', releaseEligible: true });
  assert.equal(native.native, true);
});

test('list is ordered, selection is explicit and a missing selection is reported', () => {
  const { model } = solutionComposerFixture('list');
  const view = composerView({ ...model.composed, candidates: [...model.composed.candidates].reverse() });
  assert.deepEqual(view.rows.map(row => row.status), ['stale', 'awaiting-approval']);
  assert.equal(view.selected, null); assert.match(view.summary, /ожидающая решения/);
  assert.equal(composerView({ candidates: model.composed.candidates, selectedId: 'unknown' }).missingSelection, true);
  assert.match(composerView({ candidates: [composedCandidateFixture({ status: 'stale' })] }).summary, /устарели/);
});

test('decisions require a reason and a current candidate in the matching state', () => {
  const awaiting = composedCandidateRow(composedCandidateFixture()), approved = composedCandidateRow(composedCandidateFixture({ approved: true }));
  assert.match(composerGate(awaiting, 'approve', ' '), /причину/);
  assert.equal(composerGate(awaiting, 'approve', 'Сверено'), '');
  assert.ok(composerGate(awaiting, 'revoke', 'x')); assert.ok(composerGate(approved, 'approve', 'x'));
  assert.equal(composerGate(approved, 'revoke', 'Найдена ошибка'), '');
  assert.match(composerGate(composedCandidateRow(composedCandidateFixture({ status: 'stale' })), 'approve', 'x'), /устарела/);
  assert.ok(composerGate(null, 'approve', 'x'));
});

test('the shared delivery ViewModel accepts a composed candidate and blocks stale or unapproved bytes', () => {
  const { data, candidates } = solutionComposerFixture('partial-outcome');
  const release = composedDeliveryRelease(candidates.approved);
  const view = deliveryPanelView(release, data);
  assert.equal(view.current, true); assert.equal(view.canVerify, true); assert.equal(view.canPrepare, false, 'partial outcome holds the reservation');
  assert.match(view.next, /повтор операции запрещён/);
  const ready = solutionComposerFixture('approved');
  assert.equal(deliveryPanelView(composedDeliveryRelease(ready.candidates.approved), ready.data).canPrepare, true);
  assert.equal(deliveryPanelView(composedDeliveryRelease(ready.candidates.awaiting), ready.data).canPrepare, false);
  assert.equal(deliveryPanelView(composedDeliveryRelease(composedCandidateFixture({ status: 'stale', approved: true })), ready.data).canPrepare, false);
});

test('next action follows the product map: compare, resolve or establish base, build (blocked) and verify', () => {
  const action = mode => { const model = composerNextActionFixture(mode); return solutionNextAction(model.workspace, model); };
  assert.deepEqual([action('compare').state, action('compare').label], ['compare', 'Сравнить изменения']);
  assert.deepEqual([action('resolve').state, action('resolve').label, action('resolve').view], ['conflict', 'Разрешить конфликт', 'review']);
  assert.deepEqual([action('unknown-base').state, action('unknown-base').view, action('unknown-base').artifact], ['unknown-base', 'change', 'synthetic-review']);
  const blocked = action('build-blocked');
  assert.deepEqual([blocked.state, blocked.view], ['build-blocked', 'compose']); assert.match(blocked.summary, /заблокирована/);
  const review = action('review-build');
  assert.deepEqual([review.state, review.label, review.view, review.candidate], ['review-build', 'Рассмотреть сборку', 'compose', composedCandidateFixture().id]);
  const verify = action('verify');
  assert.deepEqual([verify.state, verify.label, verify.candidate], ['verify', 'Проверить конфигурацию', composedCandidateFixture().id]);
  assert.match(verify.summary, /принятая учебная сборка/i);
  // Available build only when the server says so; stale candidates do not count as built.
  const workspace = composerNextActionFixture('overview').workspace;
  assert.equal(solutionNextAction(workspace, { composed: { candidates: [composedCandidateFixture({ status: 'stale' })], build: { available: true } } }).state, 'build');
  // Without composer data the review-only projection is unchanged.
  assert.equal(solutionNextAction(workspace).state, 'accepted');
  // A Solution with no accepted change never jumps to build.
  const ready = structuredClone(workspace); ready.changes = [];
  assert.equal(solutionNextAction(ready, { composed: { candidates: [], build: null } }).state, 'ready');
  // Open review work still outranks the composer.
  const pending = composerNextActionFixture('resolve');
  assert.equal(solutionNextAction(pending.workspace, { composed: { candidates: [composedCandidateFixture()], build: null } }).state, 'conflict');
  // An approval for an older candidate revision does not unlock verification.
  const outdated = composedCandidateFixture({ approved: true }); outdated.revision = 3;
  assert.equal(solutionNextAction(workspace, { composed: { candidates: [outdated], build: null } }).state, 'review-build');
});

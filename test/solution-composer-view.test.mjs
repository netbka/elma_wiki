import test from 'node:test';
import assert from 'node:assert/strict';
import { composerView, composerGate, composedCandidateRow, composedDeliveryRelease, composerBuildView, buildEligibilityView, buildReasonLine, buildFailureView, targetProfileView, targetProfileFailureView } from '../web/managed/composer.js';
import { composedCandidateFixture, solutionComposerFixture, composerNextActionFixture, eligibilityFixtures, availableBuild, verifiedEligibility, buildResponseFixtures,
  targetProfileFixtures, profileEligibility, profileResponseFixtures } from '../web/managed/composer-fixtures.js';
import { solutionNextAction, acceptedMergeTarget, reviewGate } from '../web/managed/model.js';
import { managedFixture } from '../web/managed/fixtures.js';
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

test('native provenance survives pending installation evidence; unknown provenance is never called synthetic', () => {
  const { candidates } = solutionComposerFixture('native-pending');
  const before = structuredClone(candidates.approved);
  const row = composedCandidateRow(candidates.approved);
  assert.equal(row.native, true); assert.equal(row.releaseEligible, false); assert.equal(row.deliverable, false);
  assert.match(row.evidenceLabel, /Нативная сборка/); assert.match(row.evidenceLabel, /к выпуску не допускается/);
  assert.doesNotMatch(row.evidenceLabel, /Учебная|синтетический сборщик/);
  assert.equal(composedCandidateRow({ ...candidates.approved, releaseEligible: true }).releaseEligible, false, 'pending evidence still prevents readiness');
  const workspace = composerNextActionFixture('verify').workspace;
  const next = solutionNextAction(workspace, { composed: { candidates: [candidates.approved] } });
  assert.match(next.summary, /Нативная конфигурация/); assert.doesNotMatch(next.summary, /учебная/);
  const unknown = solutionComposerFixture('unknown-evidence').candidates.approved;
  assert.equal(composedCandidateRow(unknown).native, false);
  assert.match(composedCandidateRow(unknown).evidenceLabel, /не подтверждено/);
  assert.match(solutionNextAction(workspace, { composed: { candidates: [unknown] } }).summary, /не подтверждено/);
  assert.deepEqual(candidates.approved, before, 'projection does not mutate candidate or delivery evidence');
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
  // Available build only when the server says so and every eligibility gate is verified; stale candidates do not count as built.
  const workspace = composerNextActionFixture('overview').workspace;
  const verified = { eligible: true, gates: ['scope', 'coverage', 'dependencies', 'target-profile', 'materialization'].map(id => ({ id, status: 'verified', reasons: [] })) };
  assert.equal(solutionNextAction(workspace, { composed: { candidates: [composedCandidateFixture({ status: 'stale' })], build: { available: true }, eligibility: verified } }).state, 'build');
  for (const eligibility of [undefined, { loadError: 'x' }, eligibilityFixtures.current, { ...verified, eligible: false }, { eligible: true, gates: [{ id: 'scope', status: 'blocked', reasons: [] }] }]) {
    const next = solutionNextAction(workspace, { composed: { candidates: [], build: { available: true }, eligibility } });
    assert.equal(next.state, 'build-blocked'); assert.match(next.summary, /профиль Target не подтверждены/);
  }
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

test('composer shows every eligibility gate and each blocking reason; a build is offered only when all gates are verified', () => {
  const gates = buildEligibilityView(eligibilityFixtures.gates);
  assert.equal(gates.loaded, true); assert.equal(gates.eligible, false);
  assert.deepEqual(gates.gates.map(row => [row.id, row.label, row.statusLabel]), [['scope', 'Состав выпуска', 'заблокировано'], ['coverage', 'Нативное покрытие', 'заблокировано'],
    ['dependencies', 'Зависимости и лицензии', 'заблокировано'], ['target-profile', 'Профиль Target', 'заблокировано'], ['materialization', 'Нативная сборка', 'заблокировано']]);
  const lines = Object.fromEntries(gates.gates.map(row => [row.id, row.reasons]));
  assert.deepEqual(lines.scope, ['объекты зависят друг от друга по кругу · contract → approval']);
  assert.equal(lines.coverage[0], 'вид объекта не поддерживается нативной сборкой · единица установки package:synthetic_solution · объект mystery');
  assert.match(lines.coverage[1], /нет нативного подтверждения установки .* не хватает: квитанция импорта/);
  assert.deepEqual(lines.dependencies, ['платный модуль: лицензия на Target не подтверждена · модуль vendor.signature', 'зависимость не закреплена · модуль vendor.signature · нет подтверждения с Target']);
  assert.deepEqual(lines['target-profile'], ['профиль Target прочитан больше суток назад', 'зависимости проверены для другого профиля Target']);
  assert.match(lines.materialization[0], /^нативный сборщик недоступен · .*нативный исполнитель/);
  // Today's service: nothing is eligible, the unverified gates name their reasons and the verified scope names none.
  const current = buildEligibilityView(eligibilityFixtures.current);
  assert.deepEqual(current.gates.map(row => row.status), ['verified', 'blocked', 'blocked', 'unknown', 'blocked']);
  assert.deepEqual(current.gates[0].reasons, []); assert.ok(current.gates.slice(1).every(row => row.reasons.length > 0));
  assert.match(current.gates[3].reasons.join(' '), /профиль Target не прочитан с сервера/);
  // Unknown reasons stay visible; long per-object lists are capped with a count.
  assert.equal(buildReasonLine({ reason: 'future-reason' }), 'не описанная причина: future-reason');
  const many = buildEligibilityView({ eligible: false, gates: [{ id: 'coverage', status: 'blocked', reasons: Array.from({ length: 8 }, (_, i) => ({ reason: 'unknown-native-import-unit', solution: 's', key: JSON.stringify(['widgets', 'n', 'c' + i]) })) }] });
  assert.equal(many.gates[0].reasons.length, 6); assert.match(many.gates[0].reasons.at(-1), /и ещё 3$/);
  // Not loaded, failed or malformed eligibility never enables the build, even with an available builder.
  for (const eligibility of [undefined, null, { loadError: 'x' }, { eligible: true }, { eligible: true, gates: [{ id: 'scope', status: 'unknown', reasons: [] }] }]) {
    const view = composerView({ candidates: [], build: { available: true }, eligibility });
    assert.equal(view.build.available, false); assert.match(view.build.reason, /не подтверждены/);
  }
  const verified = { eligible: true, gates: ['scope', 'coverage', 'dependencies', 'target-profile', 'materialization'].map(id => ({ id, status: 'verified', reasons: [] })) };
  assert.equal(composerView({ candidates: [], build: { available: true }, eligibility: verified }).build.available, true);
  // The materialization reason stays when the builder itself is unavailable.
  assert.match(composerView({ candidates: [], build: solutionComposerFixture().model.composed.build, eligibility: verified }).build.reason, /elma365#60/);
});

test('only the latest accepted change with a merge resolution, at the current revision, is offered for a build', () => {
  const { workspace } = managedFixture('overview');
  assert.deepEqual(acceptedMergeTarget(workspace), { artifactId: 'synthetic-change', expectedRevision: workspace.revision });
  const variant = change => { const state = structuredClone(workspace); change(state); return acceptedMergeTarget(state); };
  assert.equal(variant(state => { delete state.changes[0].resolution; }), null, 'accepted without a three-way merge');
  assert.equal(variant(state => { state.revision++; state.history.push({ type: 'reopened', revision: state.revision }); }), null, 'archived and reopened since');
  assert.equal(variant(state => { state.history.push({ type: 'baseline-accepted', id: 'later', revision: ++state.revision }); }), null, 'a later reconciliation');
  assert.equal(variant(state => { state.status = 'archived'; }), null);
  assert.equal(variant(state => { state.openFindings = [{ id: 'finding' }]; }), null);
  assert.deepEqual(variant(state => { state.pending = [{ artifactId: 'next', kind: 'change' }]; }), { artifactId: 'synthetic-change', expectedRevision: workspace.revision }, 'a pending change does not move the accepted revision');
  // The next action names the missing merge instead of offering a build that the server refuses.
  const composed = { candidates: [], build: availableBuild, eligibility: verifiedEligibility };
  assert.equal(solutionNextAction(workspace, { composed }).state, 'build');
  const unmerged = structuredClone(workspace); delete unmerged.changes[0].resolution;
  const next = solutionNextAction(unmerged, { composed });
  assert.deepEqual([next.state, next.view], ['build-blocked', 'compose']); assert.match(next.summary, /не прошла сравнение трёх версий/);
});

test('a refused or lost build names its reason and asks for a fresh read only when inputs moved', () => {
  const view = key => buildFailureView(buildResponseFixtures[key]);
  const blocked = view('blocked');
  assert.match(blocked.message, /заблокирована/); assert.equal(blocked.refresh, false);
  assert.deepEqual(blocked.reasons, ['платный модуль: лицензия на Target не подтверждена · модуль vendor.signature', 'зависимость не закреплена · модуль vendor.signature · нет подтверждения с Target']);
  assert.deepEqual([view('failed').refresh, view('failed').reasons], [false, ['нативная проверка пакета не пройдена']]);
  for (const key of ['stale', 'notAccepted', 'inProgress', 'staleFreeze', 'lost']) assert.equal(view(key).refresh, true, key);
  assert.deepEqual(view('stale').reasons, ['входные данные изменились во время сборки']);
  assert.match(view('notAccepted').message, /не готова к сборке/, 'an English server refusal is never shown as the notice');
  assert.match(view('lost').message, /не получен/);
  assert.match(buildFailureView({ status: 500, body: { error: 'x' } }).message, /отказал/);
  assert.match(buildFailureView({ status: 409, body: { outcome: 'blocked', gates: 'not-a-list', blockers: [null, { reason: 7 }] } }).message, /заблокирована/);
});

test('a current whole-component resolution opens acceptance of a cross-team change; a part merge does not', () => {
  const review = structuredClone(managedFixture('merge-resolved').review);
  review.stale = false; review.rows = review.rows.map((row, index) => index === 0 ? { ...row, conflict: true } : row);
  const boundary = review.rows.filter(row => row.boundaryCrossing).map(row => row.key);
  assert.equal(reviewGate(review, boundary), '');
  assert.match(reviewGate(review), /Подтвердите каждое изменение/, 'boundary confirmations still apply');
  const unresolved = structuredClone(review); unresolved.merge.head = null;
  assert.match(reviewGate(unresolved), /Разрешите конфликт выше/);
  const stale = structuredClone(review); stale.merge.head.status = 'stale';
  assert.match(reviewGate(stale), /Разрешите конфликт выше/);
  const withoutPlan = structuredClone(unresolved); withoutPlan.merge = { available: false, reason: 'plan-unavailable', head: null };
  assert.match(reviewGate(withoutPlan), /новый полный снимок/);
  const parts = structuredClone(review); parts.merge.head.decisions = [{ ...parts.merge.head.decisions[0], choice: 'merge-parts', parts: [] }];
  assert.match(reviewGate(parts), /Объединение по частям/);
});

test('Target profile refresh: offered only to the configured operator, every result and stale input stated, never inferred', () => {
  const view = mode => targetProfileView(profileEligibility(mode));
  assert.deepEqual(targetProfileView(null), { shown: false });
  assert.deepEqual(targetProfileView(eligibilityFixtures.current), { shown: false }, 'an older server shape offers nothing');
  assert.deepEqual(targetProfileView({ loadError: 'x', targetProfileRefresh: targetProfileFixtures.ready }), { shown: false });
  const unconfigured = view('unconfigured');
  assert.deepEqual([unconfigured.state, unconfigured.canRefresh, unconfigured.operator], ['target-profile-observation-unconfigured', false, false]);
  assert.match(unconfigured.message, /не настроено/);
  assert.equal(targetProfileView({ revision: 1, targetProfileRefresh: { ...targetProfileFixtures.unconfigured, reason: 'target-not-designated', target: 'dev' } }).state, 'target-not-designated');
  const other = view('not-operator');
  assert.deepEqual([other.state, other.canRefresh, other.operator], ['never', false, false]);
  const ready = view('ready');
  assert.deepEqual([ready.state, ready.canRefresh, ready.target, ready.expectedRevision], ['never', true, 'DEV2', 3]);
  assert.equal(targetProfileView({ targetProfileRefresh: targetProfileFixtures.ready }).canRefresh, false, 'no revision, no request');
  assert.deepEqual([view('progress').state, view('progress').canRefresh], ['in-progress', false]);
  const observed = view('observed');
  assert.equal(observed.state, 'observed'); assert.match(observed.profile, /DEV2 · платформа synthetic-2026\.10 · cccccccccccc/);
  assert.equal(view('stale').state, 'stale'); assert.equal(view('stale').profile, '', 'a stale profile is not shown as current');
  assert.deepEqual([view('unavailable').state, view('unavailable').details], ['unavailable', ['нет доступа к Target']]);
  assert.deepEqual([view('invalid').state, view('invalid').details], ['invalid', ['отчёт не подтверждает это задание чтения']]);
  assert.deepEqual([view('unknown').state, view('unknown').details], ['unknown', ['время ожидания истекло']]);
  assert.deepEqual(targetProfileView({ revision: 1, targetProfileRefresh: { ...targetProfileFixtures.ready, last: { outcome: 'invalid', errors: ['future-check'] } } }).details,
    ['причина проверки: future-check']);
  // The observed profile alone never makes the build eligible: coverage stays unacquired.
  const eligibility = profileEligibility('observed');
  assert.equal(buildEligibilityView(eligibility).eligible, false);
  assert.equal(composerView({ build: availableBuild, eligibility }).build.available, false);
});

test('Target profile refresh failures: a moved Solution, unknown outcome or lost response need a fresh read', () => {
  const invalid = targetProfileFailureView(profileResponseFixtures.invalid);
  assert.deepEqual([invalid.message, invalid.reasons, invalid.refresh], ['Отчёт о профиле Target не принят.', ['исполнитель другой версии'], false]);
  const stale = targetProfileFailureView(profileResponseFixtures.stale);
  assert.equal(stale.refresh, true); assert.deepEqual(stale.reasons, ['версия решения изменилась']);
  assert.equal(targetProfileFailureView({ status: 502, body: { outcome: 'unknown', reason: 'lost-result' }, requiresRefresh: true }).refresh, true);
  assert.equal(targetProfileFailureView({ status: 403, body: { outcome: 'refused', reason: 'operator-only' } }).reasons[0], 'действие доступно только оператору моста');
  const lost = targetProfileFailureView(profileResponseFixtures.lost);
  assert.equal(lost.refresh, true); assert.match(lost.message, /не повторяется автоматически/);
});

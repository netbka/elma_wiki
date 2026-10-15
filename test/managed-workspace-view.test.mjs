import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFixture } from '../web/managed/fixtures.js';
import { dateLabel, moduleCards, activityFeed, relativeTime, solutionStatus, lifecycleSteps, reviewGate, workspaceSummary, componentName, workspaceUrl, solutionNextAction, responsibilityLabel, responsibilityReport, hasAcceptedFullExport, objectLabel, objectCode, objectFromKey, objectKindLabel, objectModule, isSystemObject, groupObjects, reviewSummary, reviewBucket, groupDependencies } from '../web/managed/model.js';
import { solutionHandoffFixture } from '../web/managed/handoff-fixtures.js';

test('handoff navigation requires a matching accepted full state and stays separate from delivery evidence', () => {
  const state = solutionHandoffFixture().workspace;
  assert.equal(hasAcceptedFullExport(state), true);
  state.artifacts.push({ id: 'partial-no-op', scope: 'partial' });
  assert.equal(hasAcceptedFullExport(state), false);
  state.artifacts.pop(); state.current[0].digest = 'different';
  assert.equal(hasAcceptedFullExport(state), false);
  assert.equal(hasAcceptedFullExport(managedFixture('needs-fixes').workspace), false);
  assert.equal(solutionHandoffFixture('stale').handoff.blockers.length > 0, true);
  assert.equal(solutionHandoffFixture('prepared').handoff.checks.find(row => row.id === 'target').result, 'not-run');
});

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
  assert.equal(solutionNextAction(ready).view, 'full'); // UX-01: the only way to a new version is to pull again
  assert.equal(solutionNextAction(ready).label, 'Обновить');
  const pending = managedFixture('pending').workspace;
  assert.equal(solutionNextAction(pending).artifact, pending.pending[0].artifactId);
  pending.pending.push({ artifactId: 'conflict', kind: 'reconciliation', attention: { conflicts: 1 }, stale: false });
  assert.equal(solutionNextAction(pending).artifact, 'conflict');
  pending.pending.forEach(row => row.stale = true);
  assert.equal(solutionNextAction(pending).state, 'compare');
  assert.equal(solutionNextAction(pending).label, 'Сравнить изменения');
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
test('process reports expose precise boundaries and previous teams without claiming native authors or merging files', () => {
  const { workspace, review } = managedFixture('elements-boundary'), report = responsibilityReport(workspace, review);
  assert.match(report, /Korus/); assert.match(report, /граница: true/); assert.match(report, /авторы публикаций ELMA.*не установлены/);
  assert.match(report, /не является пакетом установки/);
  assert.equal(responsibilityLabel({ responsibility: { elements: [{ team: 'Korus' }, { team: 'Internal' }, { team: 'Korus' }, { team: null }] } }), 'Korus: 2 · Internal: 1 · Не установлена: 1');
  assert.match(responsibilityLabel({ service: 'processor', team: 'Korus' }), /части не установлены/);
  assert.equal(reviewGate(managedFixture('elements-added').review), '');
  const conflict = managedFixture('elements-conflict').review;
  assert.ok(reviewGate(conflict)); assert.equal(reviewGate(conflict, [], { [conflict.rows[0].key]: 'take-snapshot' }), '');
});

test('UX-02: business name first, technical code second; objects group by module and kind, system objects aside', () => {
  const widget = { key: JSON.stringify(['widgets', 'contract_management.contracts', 'create_form']), service: 'widgets', namespace: 'contract_management.contracts', code: 'create_form', kind: 'WIDGET', name: 'Форма создания договора' };
  assert.deepEqual(objectLabel(widget), { text: 'Форма создания договора', secondary: 'create_form', technical: false });
  assert.deepEqual(objectLabel({ ...widget, name: 'create_form' }), { text: 'create_form', secondary: '', technical: false }, 'a name equal to the code is not repeated');
  assert.deepEqual(objectLabel({ ...widget, name: null, code: 'form_01a11b42-6c2a-7767-b10f-fdb60bdc6139' }).technical, true, 'a name-less GUID form is marked technical');
  const permission = { key: JSON.stringify(['permissionsSettings', 'contract_management', 'permissionSettings', 'contracts']), service: 'permissionsSettings', namespace: 'contract_management', code: 'contracts', kind: 'permissionSettings' };
  assert.equal(objectLabel(permission).text, 'contract_management · contracts · permissionSettings', 'long keys keep the previous technical label');
  assert.equal(objectCode({ key: '["widgets","x","y"]' }), 'y');
  assert.equal(objectLabel({ key: permission.key }).text, 'contract_management · contracts · permissionSettings', 'a row known only by its key (an object a review adds) is labelled from the key');
  assert.deepEqual(objectFromKey(permission.key), { key: permission.key, service: 'permissionsSettings', namespace: 'contract_management', code: 'contracts', kind: 'permissionSettings' });
  assert.equal(objectModule(objectFromKey(widget.key)), 'contract_management');
  assert.deepEqual(objectFromKey('not-json'), { key: 'not-json' });
  assert.equal(objectKindLabel({ service: 'processor' }), 'Процессы'); assert.equal(objectKindLabel({ service: 'applications' }), 'Данные'); assert.equal(objectKindLabel({ service: 'unknown' }), 'Прочее');
  assert.equal(objectModule(widget), 'contract_management'); assert.equal(objectModule({}), '');
  assert.equal(isSystemObject(permission), true); assert.equal(isSystemObject({ ...widget, name: null, code: '__default' }), true); assert.equal(isSystemObject(widget), false);
  const rows = managedFixture('solution').workspace.current, grouped = groupObjects(rows);
  assert.deepEqual(grouped.modules.map(group => group.module), ['contract_management', 'synthetic']);
  assert.deepEqual(grouped.modules[0].kinds.map(kind => kind.kind), ['processes', 'data'], 'kinds follow display order');
  assert.equal(grouped.system.length, 3, 'permissions, __default and localization are system objects');
  assert.equal(grouped.modules.reduce((n, group) => n + group.count, 0) + grouped.system.length, rows.length, 'every row is shown once');
});

test('UX-03: the review summary counts every row once, names a no-change version and groups dependencies by target', () => {
  const mixed = managedFixture('summary-mixed').review, summary = reviewSummary(mixed, mixed.rows);
  assert.deepEqual(summary.counts, { modified: 1, added: 1, removed: 1, conflicts: 1, unchanged: 3, unknown: 0 });
  assert.equal(summary.changed, 4); assert.equal(summary.total, 7); assert.equal(summary.noDifference, false);
  assert.equal(summary.line, 'Изменено 1 · Добавлено 1 · Удалено 1 · Конфликтов 1 · Без изменений 3');
  assert.equal(summary.dependencyProblems, 14);
  const none = managedFixture('summary-no-changes').review;
  assert.equal(reviewSummary(none).noDifference, true);
  assert.equal(reviewSummary({ ...none, ambiguities: [{ reason: 'unknown' }] }).noDifference, false, 'unknown parts are never "no difference"');
  assert.equal(reviewBucket({ classification: 'component-modified', conflict: true }), 'conflicts', 'a cross-team conflict wins over the classification');
  const grouped = groupDependencies(mixed.dependencies.rows);
  assert.equal(grouped.length, 2); assert.equal(grouped[0].required, true, 'required first'); assert.equal(grouped[1].count, 14);
});

test('UX-03b decision choices: a closed gate disables acceptance with its reason, discussion enables fixes/comment, accepted or closed or stale reviews offer nothing', async () => {
  const { decisionChoices, decisionDefault, canCloseWithoutChanges, reviewSummary } = await import('../web/managed/model.js');
  const partial = managedFixture('review').review;
  const blocked = decisionChoices(partial);
  assert.deepEqual(blocked.map(choice => [choice.id, choice.disabled]), [['accept', true], ['request-fixes', false], ['comment', false]]);
  assert.equal(blocked[0].reason, reviewGate(partial));
  assert.equal(decisionDefault(blocked), 'request-fixes');
  const open = decisionChoices(partial, '');
  assert.equal(open[0].disabled, false); assert.equal(decisionDefault(open), 'accept');
  const silent = { ...partial, discussion: null };
  assert.deepEqual(decisionChoices(silent, '').map(choice => choice.id), ['accept']);
  assert.deepEqual(decisionChoices({ ...partial, acceptedAt: 'x' }), []);
  assert.deepEqual(decisionChoices({ ...partial, closedAt: 'x' }), []);
  assert.deepEqual(decisionChoices({ ...partial, stale: true }), []);
  assert.equal(decisionDefault([{ id: 'accept', disabled: true }]), null);
  const none = managedFixture('summary-no-changes').review, mixed = managedFixture('summary-mixed').review;
  assert.equal(canCloseWithoutChanges(none, reviewSummary(none)), true);
  assert.equal(canCloseWithoutChanges(mixed, reviewSummary(mixed)), false);
  assert.equal(canCloseWithoutChanges({ ...none, ambiguities: [{ reason: 'x' }] }, reviewSummary({ ...none, ambiguities: [{ reason: 'x' }] })), false);
  assert.equal(canCloseWithoutChanges(managedFixture('summary-closed').review, reviewSummary(none)), false);
});

test('UX-04: the header badge and stepper project every row of the next-action map; unavailable steps carry a reason', async () => {
  const { composerNextActionFixture } = await import('../web/managed/composer-fixtures.js');
  const project = model => { const next = solutionNextAction(model.workspace, model); return { status: solutionStatus(next).key, steps: lifecycleSteps(model.workspace, next) }; };
  const shape = steps => steps.map(step => step.id + ':' + step.state + (step.reason ? '/' + step.reason : '')).join(' ');
  const rest = 'build:next verify:next release:unavailable/ещё не доступно';
  const cases = [
    [managedFixture('no-source'), 'working', 'load:current compare:next review:next ' + rest],
    [composerNextActionFixture('compare'), 'awaitingReview', 'load:done compare:current review:next ' + rest],
    [managedFixture('pending'), 'awaitingReview', 'load:done compare:done review:current ' + rest],
    [managedFixture('needs-fixes'), 'awaitingReview', 'load:done compare:done review:current ' + rest],
    [managedFixture('pending-conflict'), 'conflict', 'load:done compare:done review:current ' + rest],
    [composerNextActionFixture('unknown-base'), 'conflict', 'load:done compare:done review:current ' + rest],
    [managedFixture('overview'), 'accepted', 'load:done compare:done review:done build:unavailable/нет сборщика verify:next release:unavailable/ещё не доступно'],
    [composerNextActionFixture('build-blocked'), 'accepted', 'load:done compare:done review:done build:unavailable/нет сборщика verify:next release:unavailable/ещё не доступно'],
    [managedFixture('lifecycle-build'), 'accepted', 'load:done compare:done review:done build:current verify:next release:unavailable/ещё не доступно'],
    [composerNextActionFixture('review-build'), 'accepted', 'load:done compare:done review:done build:current verify:next release:unavailable/ещё не доступно'],
    [composerNextActionFixture('verify'), 'accepted', 'load:done compare:done review:done build:done verify:current release:unavailable/ещё не доступно'],
    [managedFixture('lifecycle-verified'), 'accepted', 'load:done compare:done review:done build:done verify:done release:unavailable/ещё не доступно'],
    [managedFixture('archived'), 'archived', 'load:done compare:done review:done ' + rest]
  ];
  for (const [model, status, steps] of cases) assert.deepEqual([project(model).status, shape(project(model).steps)], [status, steps]);
  const ready = managedFixture('overview'); ready.workspace.changes = [];
  assert.equal(shape(project(ready).steps), 'load:done compare:current review:next ' + rest);
  assert.equal(solutionStatus(solutionNextAction(ready.workspace)).label, 'В работе');
  // Exactly one current step while the Solution is active, none in the archive, no stepper on error or stale pages.
  for (const [model] of cases) assert.equal(project(model).steps.filter(step => step.current).length, model.workspace.status === 'archived' ? 0 : 1);
  assert.deepEqual(lifecycleSteps(ready.workspace, { state: 'stale' }), []);
  assert.deepEqual(lifecycleSteps(null, solutionNextAction(null)), []);
});

test('UX-05: module cards count business rows by kind, the activity list names people and relative times, and the fixture shows two distinct actors', () => {
  const cards = moduleCards(managedFixture('solution').workspace.current);
  assert.deepEqual(cards.map(card => [card.module, card.processes.length, card.forms.length, card.data.length, card.system]), [['contract_management', 1, 0, 2, 3], ['synthetic', 0, 3, 0, 0]]);
  const model = managedFixture('about-saved'), feed = activityFeed(model.workspace, 8, model.now);
  assert.deepEqual(feed.map(row => [row.label, row.actor.name, row.actor.initials, row.when]),
    [['Изменение принято', 'Reviewer', 'R', '2 ч назад'], ['Комментарий', 'Reviewer', 'R', '4 ч назад'], ['Решение загружено', 'Uploader', 'U', '5 ч назад']]);
  assert.equal(new Set(feed.map(row => row.actor.name)).size, 2);
  assert.equal(activityFeed({ audit: [] }).length, 0);
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.equal(relativeTime('2026-10-15T11:59:40Z', now), 'только что');
  assert.equal(relativeTime('2026-10-14T10:00:00Z', now), 'вчера');
  assert.equal(relativeTime('2026-10-01T13:00:00Z', now), dateLabel('2026-10-01T13:00:00Z'));
  assert.equal(model.about.purpose.saved.sourceStatus, 'current'); assert.equal(managedFixture('about-stale').about.purpose.saved.sourceStatus, 'stale');
  assert.equal(managedFixture('about-empty').about.purpose.saved, null); assert.equal(managedFixture('about-generated').aboutEditing, true);
});

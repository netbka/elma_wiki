import { visualFixture } from '../visual/fixtures.js';
const names = { contract: 'Заявка на командировку', approval: 'Утверждение командировки', comment: 'Комментарий к заявке' };
const component = (code, team = 'Команда внедрения', changed = false) => ({ code, key: JSON.stringify(['widgets', 'synthetic.records', code]), team,
  service: 'widgets', namespace: 'synthetic.records', kind: 'WIDGET', name: names[code] || null,
  interventionId: changed ? 'synthetic-change' : null, digest: 'a'.repeat(64) });
export function managedFixture(mode = 'overview') {
  const at = '2026-10-07T12:00:00Z', base = { id: 'synthetic-baseline', scope: 'full', checksum: 'a'.repeat(64), snapshot: {
    projectId: 'synthetic-project', snapshotId: 'synthetic-snapshot', checksum: 'a'.repeat(64), source: null, createdAt: at
  }, scopeDeclaration: { scope: 'full', method: 'explicit-assertion', declaredAt: at } };
  const workspace = { id: 'synthetic-workspace', name: 'Командировки и расходы', status: 'active', revision: 1,
    baselineId: base.id, baselineOwner: 'Команда внедрения', baselineAcceptedAt: at, artifacts: [base],
    current: [component('contract'), component('approval'), component('comment', 'Внутренняя команда', true),
      { code: 'synthetic', key: JSON.stringify(['pages', 'global', 'synthetic']), team: 'Команда внедрения', service: 'pages', namespace: 'global', kind: 'page', name: 'Служебные поездки', interventionId: null, digest: 'a'.repeat(64) }],
    changes: [{ id: 'synthetic-change', resolution: { id: 'synthetic-resolution', revisionDigest: 'd'.repeat(64), resultDigest: 'e'.repeat(64), planDigest: 'f'.repeat(64), acceptedFromRevision: 0 } }],
    reconciliations: [], history: [{ type: 'created', baselineId: base.id }, { type: 'change-accepted', id: 'synthetic-change', revision: 1 }], pending: [] };
  base.components = ['contract', 'approval'].map(code => ({ key: component(code).key, digest: 'a'.repeat(64) }));
  // UX-05: attributed activity with two distinct people; the synthetic clock keeps relative times stable.
  const uploader = { id: 'synthetic-uploader', login: 'uploader@example.org', provider: 'vk-teams' }, reviewer = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'vk-teams' };
  workspace.audit = [{ action: 'created', actor: uploader, at: '2026-10-07T09:00:00Z', artifactId: base.id }, { action: 'review-comment', actor: reviewer, at: '2026-10-07T10:30:00Z', artifactId: 'synthetic-review' },
    { action: 'change-accepted', actor: reviewer, at: at, artifactId: 'synthetic-review' }];
  const now = Date.parse('2026-10-07T14:00:00Z');
  const review = { kind: mode === 'conflict' ? 'reconciliation' : 'change', revision: 1, artifactId: 'synthetic-review', artifactDigest: 'b'.repeat(64),
    options: mode === 'conflict' ? { baselineOwner: 'Команда внедрения' } : { team: 'Внутренняя команда', taskRef: 'DEMO-12' },
    snapshot: base.snapshot, ambiguities: [], rows: [{ ...component('contract'), classification: 'component-modified', previousTeam: 'Команда внедрения', boundaryCrossing: true }] };
  const actor = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'vk-teams' };
  review.uploadedBy = { ...actor, id: 'synthetic-uploader', login: 'uploader@example.org' };
  review.discussion = { changeId: 'synthetic-change', version: 0, findings: [], events: [], blocking: 0 };
  if (mode.startsWith('review-')) {
    const type = mode === 'review-comment' ? 'comment' : 'reject';
    const finding = { id: 'synthetic-finding', type, actor, text: 'При возврате нужно объяснить причину и сохранить введённый текст.',
      createdAt: at, anchor: { key: review.rows[0].key, digest: 'c'.repeat(64) }, anchorStatus: 'current', status: 'open', replies: [] };
    if (['review-resolved', 'review-accepted'].includes(mode)) {
      finding.status = 'resolved'; finding.resolution = { actor, text: 'Причина обязательна в исправленном экспорте.', type: 'resolve' };
    }
    for (const status of ['stale', 'removed', 'ambiguous']) if (mode === `review-${status}-anchor`) finding.anchorStatus = status;
    review.discussion = { ...review.discussion, version: 2, findings: [finding], blocking: type === 'reject' && finding.status === 'open' ? 1 : 0 };
    review.contexts = [{ key: review.rows[0].key, objectRef: 'd'.repeat(64), beforeArtifactId: 'synthetic-before', afterArtifactId: review.artifactId }];
    if (mode === 'review-accepted') { review.acceptedAt = at; review.acceptedDecision = { actor, boundaryKeys: [finding.anchor.key], resolutions: null }; }
  }
  // UX-03: summary line, chips, ribbon and grouping on a mixed review and on a no-change version.
  if (['summary-mixed', 'summary-no-changes', 'summary-closed'].includes(mode) || mode.startsWith('viewed-')) {
    const extra = (service, namespace, code, kind, name, classification, extraFields = {}) => ({ code, key: JSON.stringify(service === 'widgets' ? [service, namespace, code] : [service, namespace, kind, code]),
      service, namespace, kind, name, classification, previousTeam: 'Команда внедрения', digest: 'a'.repeat(64), ...extraFields });
    review.kind = 'reconciliation'; review.options = { baselineOwner: 'Команда внедрения' };
    review.snapshot = { ...base.snapshot, source: { connectionId: 'config-api-dev', solutionRef: 'travel_expenses' } };
    review.baseDeclaration = { schemaVersion: 1, status: 'declared', method: 'source-sequence', artifactId: base.id, revision: 0, checksum: base.checksum, scope: 'full', ancestryVerified: false };
    review.dependencies = { provenance: 'configured-source-capture', rows: [
      ...Array.from({ length: 14 }, () => ({ required: false, service: 'processor', targetNamespace: '_system_catalogs', targetCode: '_my_companies', status: 'provider-not-observed' })),
      { required: true, service: 'widgets', targetNamespace: '_clients', targetCode: '_companies', status: 'component-source-present' }] };
    review.rows = mode !== 'summary-mixed' && !mode.startsWith('viewed-')
      ? [{ ...component('contract'), classification: 'unchanged' }, { ...component('approval'), classification: 'unchanged' }, extra('permissionsSettings', 'synthetic', 'contract', 'permissionSettings', null, 'unchanged')]
      : [extra('processor', 'travel_expenses.trips', 'trip_approval', 'template', 'Утверждение командировки', 'external-change'),
        extra('widgets', 'travel_expenses.trips', 'request_form', 'WIDGET', 'Форма заявки', 'intervention-added', { previousTeam: null }),
        extra('applications', 'travel_expenses', 'currencies', 'directory', 'Валюты', 'component-deleted', { removed: true }),
        { ...component('contract'), classification: 'conflict' },
        { ...component('approval'), classification: 'unchanged' }, { ...component('comment'), classification: 'unchanged' },
        extra('permissionsSettings', 'travel_expenses', 'trips', 'permissionSettings', null, 'unchanged')];
  }
  // UX-08: per-actor "Просмотрено" marks on the mixed review. Each projection is
  // one actor's own marks: the reviewer marked two objects; in viewed-changed the
  // second of them changed after the mark; the second reviewer sees only their
  // own single mark, never the first reviewer's.
  if (mode.startsWith('viewed-')) {
    const secondReviewer = { id: 'synthetic-second-reviewer', login: 'second.reviewer@example.org', provider: 'vk-teams' };
    const marks = { 'viewed-marked': ['viewed', 'viewed'], 'viewed-changed': ['viewed', 'changed'], 'viewed-second-actor': ['unviewed', 'unviewed', 'viewed'] }[mode] || [];
    const changed = review.rows.filter(row => row.classification !== 'unchanged');
    review.viewed = { actor: mode === 'viewed-second-actor' ? secondReviewer : actor, rows: review.rows.map((row, index) => {
      const status = marks[changed.indexOf(row)] || 'unviewed';
      return { key: row.key, digest: String(index).repeat(64), status, at: status === 'unviewed' ? null : at };
    }) };
  }
  if (mode === 'conflict') review.rows[0].classification = 'conflict';
  if (mode === 'overlap') review.rows[0].conflict = true;
  if (mode === 'ambiguous') review.ambiguities = [{ reason: 'unknown', source: 'synthetic/unknown.json' }];
  if (mode.startsWith('elements-')) {
    const conflict = mode === 'elements-conflict', boundary = ['elements-boundary','elements-unknown'].includes(mode);
    review.kind = conflict ? 'reconciliation' : 'change';
    if (conflict) review.options = { baselineOwner: 'Korus' };
    review.rows = [{ key: JSON.stringify(['processor','synthetic','approval']), classification: conflict ? 'conflict' : 'component-modified', boundaryCrossing: boundary,
      elements: { complete: mode !== 'elements-unknown', residualChanged: mode === 'elements-unknown', ambiguities: [], rows: [
        { id: '["node","y"]', kind: 'node', code: 'y', name: 'Проверить бюджет', team: 'Korus', classification: boundary ? 'element-modified' : 'unchanged', boundaryCrossing: boundary },
        { id: '["node","x"]', kind: 'node', code: 'x', name: 'Дополнительное согласование', team: conflict ? 'Внутренняя команда' : null, classification: conflict ? 'conflict' : 'element-added', conflict },
        ...['comment','returnReason'].map(code => ({ id: JSON.stringify(['variable',code]), kind: 'variable', code, name: code, team: conflict ? 'Внутренняя команда' : null, classification: conflict ? 'known-change-incorporated' : 'element-added' }))
      ] } }];
  }
  // UX-03b: a version closed without changes, and the decision dialog open on a review.
  if (mode === 'summary-closed') { review.closedAt = at; review.closedDecision = { actor, reason: 'no-difference' }; }
  if (mode === 'archived') { workspace.status = 'archived'; workspace.history.push({ type: 'archived' }); }
  if (mode === 'pending') workspace.pending = [{ artifactId: review.artifactId, kind: review.kind, revision: 1, stale: false, options: review.options }];
  const model = { synthetic: true, shared: true, home: '/solutions', api: '/api/solutions', view: 'overview', workspace };
  if (['review', 'conflict', 'overlap', 'ambiguous', 'decision'].includes(mode) || mode.startsWith('review-') || mode.startsWith('elements-') || mode.startsWith('summary-') || mode.startsWith('viewed-')) Object.assign(model, { view: 'review', review });
  if (mode === 'decision') model.decisionOpen = true;
  if (['create', 'create-legacy', 'empty', 'list', 'loading', 'load-error'].includes(mode) || mode.startsWith('pull-')) {
    delete model.workspace; model.view = ['create', 'create-legacy'].includes(mode) || mode.startsWith('pull-') ? 'create' : 'list';
    model.rows = mode === 'list' ? [{ ...workspace, baselineSnapshot: base.snapshot, changedComponents: 1, pendingCount: 2, current: undefined, pending: undefined }] : [];
  }
  // UX-01 fixed entry: server + solution, no scope/base/responsibility questions.
  const pullCatalog = [{ code: 'travel_expenses', name: 'Командировки и расходы' }, { code: 'paid_module', name: 'Платный модуль', paid: true }];
  const pullRecord = { id: 'synthetic-acquisition', server: 'dev', solution: 'travel_expenses', state: 'exporting', progress: { completed: 0, total: 1 }, solutions: [] };
  if (mode === 'create') model.pullCatalog = pullCatalog;
  if (mode === 'create-legacy') model.legacy = true;
  if (mode === 'pull-exporting') model.acquisition = pullRecord;
  if (mode === 'pull-ready') model.acquisition = { ...pullRecord, state: 'ready', progress: { completed: 1, total: 1 }, solutions: [{ code: 'travel_expenses', project: { id: 'synthetic-project', currentSnapshotId: 'synthetic-snapshot' } }] };
  if (mode === 'pull-failed') model.acquisition = { ...pullRecord, state: 'failed', error: 'Экспорт не завершён. Начните новую загрузку.' };
  if (mode === 'pull-unavailable') model.pullUnavailable = true;
  if (mode === 'update') { base.snapshot.source = { connectionId: 'config-api-dev', solutionRef: 'travel_expenses' }; model.view = 'full'; }
  if (mode === 'change') model.view = 'change';
  if (mode === 'changes') model.view = 'changes';
  if (['flows', 'screens', 'flows-error', 'flows-unknown'].includes(mode)) {
    // UX-06: the solution inventory plus the captured projections of its artifact.
    model.view = mode === 'screens' ? 'solution' : 'flows';
    const visual = visualFixture(mode === 'flows-unknown' ? 'unknown' : 'source'); visual.artifactId = base.id; visual.processes[0].name = names.approval;
    visual.processes[0].object = ['processor', 'travel_expenses.trips', 'template', 'trip_approval'];
    visual.objects = [
      { object: ['widgets', 'synthetic.records', 'contract'], service: 'widgets', code: 'contract', name: names.contract, source: 'widgets/contract.json', fields: [
        { code: 'number', name: 'Номер', type: 'STRING', required: true, fingerprint: '1'.repeat(64), pointer: 'widgets/contract.json#/descriptor/fields/0' },
        { code: 'amount', name: 'Сумма', type: 'MONEY', required: false, fingerprint: '2'.repeat(64), pointer: 'widgets/contract.json#/descriptor/fields/1' }] },
      { object: ['widgets', 'synthetic.records', 'approval'], service: 'widgets', code: 'approval', name: names.approval, source: 'widgets/approval.json', fields: [] },
      { object: ['applications', 'travel_expenses', 'application', 'trips'], service: 'applications', code: 'trips', name: 'Командировки', source: 'applications/trips.json', fields: [
        { code: 'title', name: 'Название', type: 'STRING', required: true, fingerprint: '3'.repeat(64), pointer: 'applications/trips.json#/fields/0' }] }
    ];
    model.visuals = { [base.id]: mode === 'flows-error' ? { error: 'Схема не получена: учебная ошибка.' } : visual };
  }
  if (['solution', 'flows', 'screens', 'flows-error', 'flows-unknown'].includes(mode) || mode.startsWith('request')) {
    model.view = ['flows', 'flows-error', 'flows-unknown'].includes(mode) ? 'flows' : mode.startsWith('request') ? 'requests' : 'solution';
    // UX-02: a second module, a process, data objects and system objects show grouping, names and the collapsed group.
    const extra = (service, namespace, code, kind, name) => ({ code, key: JSON.stringify(kind && service !== 'widgets' ? [service, namespace, kind, code] : [service, namespace, code]), team: 'Команда внедрения',
      service, namespace, kind, name, interventionId: null, digest: 'a'.repeat(64) });
    workspace.current.push(extra('processor', 'travel_expenses.trips', 'trip_approval', 'template', 'Утверждение командировки'),
      extra('applications', 'travel_expenses', 'trips', 'application', 'Командировки'),
      extra('applications', 'travel_expenses', 'currencies', 'directory', 'Валюты'),
      extra('permissionsSettings', 'travel_expenses', 'trips', 'permissionSettings', null),
      extra('widgets', 'travel_expenses', '__default', 'WIDGET', null),
      extra('localizer', 'travel_expenses', '', 'localization', null));
    base.components = workspace.current.map(row => ({ key: row.key, digest: row.digest }));
  }
  if (['flows', 'screens'].includes(mode) || mode.startsWith('request')) {
    // UX-07: three requests of two people: a new one from a step (urgent), one in work on a
    // field of a screen whose object changed since, one done in the accepted version; the
    // whole-Solution one is rejected. Flows and screens show the chips (the field one on its
    // field row too); the request modes show the tab.
    const processKey = JSON.stringify(['processor', 'travel_expenses.trips', 'template', 'trip_approval']), screenKey = component('contract').key;
    const amountField = { artifactId: base.id, checksum: base.checksum, object: JSON.parse(screenKey), code: 'amount', name: 'Сумма', type: 'MONEY', pointer: 'widgets/contract.json#/descriptor/fields/1', fingerprint: '2'.repeat(64) };
    const sourceAnchor = { artifactId: base.id, checksum: base.checksum, object: ['processor', 'travel_expenses.trips', 'template', 'trip_approval'], nodeId: 'review', pointer: 'processor/trip_approval.json#/process/items/review', fingerprint: 'f'.repeat(64) };
    const request = (id, extra) => ({ id, kind: 'process', urgency: 'normal', status: 'new', version: 0, fulfilledArtifactId: null, events: [], actor: reviewer, createdAt: '2026-10-07T12:30:00Z', updatedAt: '2026-10-07T12:30:00Z',
      target: { artifactId: base.id, checksum: base.checksum, revision: 1, anchor: null }, anchorStatus: 'current', ...extra });
    const rows = [
      request('00000000-0000-4000-8000-000000000101', { title: 'Показывать сумму до утверждения', text: 'На шаге утверждения руководитель должен видеть сумму заявки и валюту, не открывая форму.', reason: 'Сейчас приходится открывать заявку отдельно.', urgency: 'urgent',
        target: { artifactId: base.id, checksum: base.checksum, revision: 1, anchor: { key: processKey, digest: 'a'.repeat(64) }, sourceAnchor }, createdAt: '2026-10-07T13:40:00Z', updatedAt: '2026-10-07T13:40:00Z' }),
      request('00000000-0000-4000-8000-000000000102', { kind: 'screen', title: 'Сумма обязательна', text: 'Заявку нельзя отправить без суммы.', status: 'in-progress', version: 2, actor: uploader, anchorStatus: 'stale',
        target: { artifactId: base.id, checksum: base.checksum, revision: 1, anchor: { key: screenKey, digest: 'b'.repeat(64) }, fieldAnchor: amountField }, createdAt: '2026-10-06T09:10:00Z', updatedAt: '2026-10-07T10:00:00Z',
        events: [{ id: '00000000-0000-4000-8000-000000000201', type: 'comment', text: 'Согласовано с бухгалтерией.', actor: reviewer, at: '2026-10-06T15:00:00Z' }, { id: '00000000-0000-4000-8000-000000000202', type: 'status', status: 'in-progress', fulfilledArtifactId: null, text: '', actor: reviewer, at: '2026-10-07T10:00:00Z' }] }),
      request('00000000-0000-4000-8000-000000000103', { kind: 'data', title: 'Справочник валют: добавить код', text: 'В справочнике валют нужен буквенный код для отчётов.', status: 'done', version: 1, fulfilledArtifactId: base.id,
        target: { artifactId: base.id, checksum: base.checksum, revision: 1, anchor: { key: JSON.stringify(['applications', 'travel_expenses', 'directory', 'currencies']), digest: 'a'.repeat(64) } }, createdAt: '2026-10-05T08:00:00Z', updatedAt: '2026-10-07T12:00:00Z',
        events: [{ id: '00000000-0000-4000-8000-000000000203', type: 'status', status: 'done', fulfilledArtifactId: base.id, text: 'Код добавлен в принятой версии.', actor: uploader, at: '2026-10-07T12:00:00Z' }] }),
      request('00000000-0000-4000-8000-000000000104', { kind: 'screen', title: 'Единый стиль кнопок', text: 'Кнопки на всех экранах решения должны выглядеть одинаково.', status: 'rejected', version: 1, anchorStatus: 'stale',
        target: { artifactId: base.id, checksum: base.checksum, revision: 0, anchor: null }, createdAt: '2026-10-04T08:00:00Z', updatedAt: '2026-10-05T12:00:00Z',
        events: [{ id: '00000000-0000-4000-8000-000000000204', type: 'status', status: 'rejected', fulfilledArtifactId: null, text: 'Стиль задаёт платформа.', actor: reviewer, at: '2026-10-05T12:00:00Z' }] })
    ];
    model.requests = { requests: mode === 'requests-empty' ? [] : rows, publication: { repository: 'example/synthetic', attachmentPolicy: 'github', limits: { attachments: 5 } } };
    if (mode === 'requests-error') model.requests = { loadError: 'Сервис запросов недоступен.' };
    if (mode === 'requests-object') model.object = processKey;
    if (['request-record', 'request-published'].includes(mode)) {
      model.request = rows[0].id;
      if (mode === 'request-published') model.requests.selectedPublication = { id: '00000000-0000-4000-8000-000000000085', status: 'published', context: { changeRequestId: rows[0].id }, issue: { number: 85, url: 'https://github.com/example/synthetic/issues/85' } };
    }
    if (mode === 'request-form') model.requestForm = { kind: 'process', row: workspace.current.find(row => row.key === processKey), anchor: sourceAnchor, stepName: 'Проверить бюджет' };
    // The form opened from the field row "Сумма" of Экраны и данные: the request anchors to that field.
    if (mode === 'request-form-field') model.requestForm = { kind: 'screen', row: workspace.current.find(row => row.key === screenKey), fieldName: 'Сумма', fieldCode: 'amount',
      field: { code: 'amount', name: 'Сумма', type: 'MONEY', required: false, fingerprint: '2'.repeat(64), pointer: amountField.pointer, artifactId: base.id } };
  }
  if (mode === 'native-components') {
    model.view = 'solution';
    workspace.current = ['permissionSettings','pagePermissions'].map(kind => ({...component('records'),service:'permissionsSettings',namespace:'synthetic',kind,key:JSON.stringify(['permissionsSettings','synthetic',kind,'records'])}));
    workspace.current.push({...component(''),service:'localizer',namespace:'synthetic',kind:'localization',key:JSON.stringify(['localizer','synthetic','localization',''])});
  }
  if (mode === 'paid-dependencies') {
    model.view = 'solution';
    base.dependencies = { schemaVersion: 1, provenance: 'manual-upload', publicationReady: false, targetVerification: 'not-run', rows: [
      { category: 'dependencies', required: true, service: 'widgets', targetNamespace: 'synthetic.paid', targetCode: 'form', status: 'paid-source-unavailable',
        sourceAvailability: 'unavailable', versionCompatibility: 'not-verified', activation: 'unknown', candidates: [{ code: 'synthetic_provider', paid: true, version: '1.0' }] }
    ] };
  }
  if (mode.startsWith('change-')) {
    // A later accepted full update makes the initial export a historical base.
    const update = { ...structuredClone(base), id: 'synthetic-update', checksum: 'e'.repeat(64),
      snapshot: { ...base.snapshot, snapshotId: 'synthetic-update-snapshot', checksum: 'e'.repeat(64), createdAt: '2026-10-08T09:00:00Z' } };
    update.components = [...base.components, { key: component('comment').key, digest: 'e'.repeat(64) }];
    Object.assign(workspace, { artifacts: [base, update], baselineId: update.id, revision: 3, reconciliations: [{ id: update.id }],
      history: [...workspace.history, { type: 'baseline-accepted', id: update.id, revision: 2 }] });
    model.view = 'change';
    const draft = { revision: 2, owner: 'Внутренняя команда', task: 'DEMO-14 · категория поездки', baseId: base.id, scopeEnabled: true,
      scopeName: 'Категория поездки', selected: [component('contract').key], extra: JSON.stringify(['widgets', 'synthetic.records', 'category']), captured: null };
    if (mode === 'change-draft') model.draft = { ...draft, uncertain: true };
    if (mode === 'change-rejected') { model.draft = { ...draft, revision: 3 }; model.error = 'Объект состава не найден ни в выбранной базе, ни в загруженном экспорте. Черновик сохранён.'; }
  }
  if (mode === 'base-declared' || mode === 'base-unknown') {
    model.view = 'review'; model.review = review;
    review.baseDeclaration = mode === 'base-unknown' ? { schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false }
      : { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', artifactId: base.id, revision: 0, checksum: base.checksum, scope: 'full', ancestryVerified: false };
    review.changeScopeDeclaration = mode === 'base-unknown' ? { schemaVersion: 1, status: 'unknown', method: 'not-recorded' }
      : { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', name: 'Категория поездки', deletions: [], baseArtifactId: base.id, baseRevision: 0,
        members: [{ key: component('approval').key, baseDigest: 'a'.repeat(64), incomingDigest: null }, { key: component('contract').key, baseDigest: 'a'.repeat(64), incomingDigest: 'b'.repeat(64) }],
        ancestryVerified: false, automaticMergeEnabled: false, buildEnabled: false };
  }
  if (mode.startsWith('merge-')) {
    // Synthetic B/A/C plan: A (accepted) and this change edited the same limit.
    model.view = 'review'; model.review = review; review.stale = true; workspace.revision = 2;
    review.baseDeclaration = { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', artifactId: base.id, revision: 0, checksum: base.checksum, scope: 'full', ancestryVerified: false };
    const ref = (digest, extra = {}) => ({ digest, evidence: [], ...extra });
    const row = (code, classification, status, proposal, extra = {}) => ({ key: component(code).key, service: 'widgets', namespace: 'synthetic.records', code, kind: 'WIDGET',
      classification, status, proposal, blockers: [], base: ref('a'.repeat(64), { artifactId: base.id }), current: ref('a'.repeat(64), { team: 'Команда внедрения', interventionId: null }), incoming: null, ...extra });
    const blocked = mode === 'merge-blocked';
    const rows = [
      row('limit', 'divergent', blocked ? 'blocked' : 'resolution-required', null, { current: ref('c'.repeat(64), { team: 'Внутренняя команда', interventionId: 'synthetic-change' }), incoming: ref('d'.repeat(64), { artifactId: review.artifactId }), blockers: blocked ? ['rename-uncertain'] : [] }),
      row('category', 'incoming-only', 'clear', 'take-incoming', { incoming: ref('e'.repeat(64), { artifactId: review.artifactId }) }),
      row('contract', 'unchanged', 'clear', 'keep-current')
    ];
    if (mode.startsWith('merge-parts')) {
      // MR-02 part plan: both teams edited the approval process; parts are matched by native ID only.
      const partsBlocked = mode === 'merge-parts-blocked';
      const part = (kind, code, name, classification, status, proposal, digests, extra = {}) => ({ id: JSON.stringify([kind, code]), kind, code, classification,
        currentChange: digests[1] === digests[0] ? 'none' : 'modified', incomingChange: digests[2] === digests[0] ? 'none' : 'modified',
        base: { digest: digests[0], name }, current: { digest: digests[1], name }, incoming: { digest: digests[2], name }, blockers: [], status, proposal, ...extra });
      const partRows = [
        part('node', 'review', 'Проверка руководителем', partsBlocked ? 'current-only' : 'divergent', partsBlocked ? 'clear' : 'resolution-required', partsBlocked ? 'keep-current' : null, ['1'.repeat(64), '2'.repeat(64), partsBlocked ? '1'.repeat(64) : '3'.repeat(64)]),
        part('node', 'accounting', 'Проверка бухгалтерией', 'incoming-only', 'clear', 'take-incoming', ['4'.repeat(64), '4'.repeat(64), '5'.repeat(64)]),
        part('variable', 'limit', 'Лимит', 'current-only', 'clear', 'keep-current', ['6'.repeat(64), '7'.repeat(64), '6'.repeat(64)])
      ];
      if (partsBlocked) partRows.push({ ...part('node', 'notify', 'Уведомление', 'addition-incoming', 'blocked', null, [null, null, '8'.repeat(64)], { blockers: ['rename-uncertain'] }), base: null, current: null, currentChange: 'absent', incomingChange: 'added' },
        { ...part('node', 'inform', 'Уведомление', 'current-only', 'blocked', null, ['9'.repeat(64), null, '9'.repeat(64)], { blockers: ['rename-uncertain'] }), current: null, currentChange: 'removed', incomingChange: 'none' });
      rows.unshift({ key: JSON.stringify(['processor', 'synthetic', 'approval']), service: 'processor', namespace: 'synthetic', code: 'approval', kind: 'PROCESS',
        classification: 'divergent', status: 'resolution-required', proposal: null, blockers: [], base: ref('a'.repeat(64), { artifactId: base.id }),
        current: ref('c'.repeat(64), { team: 'Внутренняя команда', interventionId: 'synthetic-change' }), incoming: ref('d'.repeat(64), { artifactId: review.artifactId }),
        parts: { method: 'process-element-three-way', status: partsBlocked ? 'blocked' : 'resolution-required', blockers: partsBlocked ? [{ reason: 'rename-uncertain' }] : [], rows: partRows,
          findings: [{ type: 'behaviour-combined', severity: 'review', current: [partRows[0].id, partRows[2].id], incoming: [partRows[1].id] },
            { type: 'dependency-impact', severity: 'review', dependency: 'variable', input: 'current', parts: [partRows[2].id], affected: [partRows[1].id] }] } });
    }
    const plan = { schemaVersion: 1, method: 'whole-component-three-way', status: blocked ? 'blocked' : 'resolution-required', blockers: blocked ? [{ reason: 'rename-uncertain' }] : [], rows,
      inputs: { base: { status: 'declared', artifactId: base.id, revision: 0, checksum: base.checksum }, current: { workspaceId: workspace.id, revision: mode === 'merge-stale' ? 3 : 2, baselineId: base.id, digest: 'f'.repeat(64) },
        incoming: { artifactId: review.artifactId, checksum: 'b'.repeat(64), artifactDigest: review.artifactDigest } },
      planDigest: '1'.repeat(64), ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false };
    const resolution = { schemaVersion: 1, method: 'whole-component-resolution', id: 'synthetic-resolution', sequence: 1, parentId: null, planDigest: mode === 'merge-stale' ? '0'.repeat(64) : plan.planDigest,
      inputs: { ...plan.inputs, current: { ...plan.inputs.current, revision: 2 } }, decisions: [{ key: rows[0].key, classification: 'divergent', choice: 'take-incoming' }],
      reason: 'Лимит согласован с финансовым отделом в DEMO-14.', actor, at, ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false, materialized: false };
    const head = ['merge-resolved', 'merge-stale'].includes(mode) ? { ...resolution, status: mode === 'merge-stale' ? 'stale' : 'current' } : null;
    review.merge = { artifactId: review.artifactId, available: true, reason: null, message: null, plan, partMergeChoice: 'merge-parts',
      choices: { divergent: ['keep-current', 'take-incoming'], 'addition-divergent': ['keep-current', 'take-incoming'], 'delete-edit': ['keep-current', 'remove'], 'edit-delete': ['keep-current', 'take-incoming'] },
      head, history: head ? [head] : [] };
  }
  if (mode === 'no-source') workspace.baselineId = null;
  if (mode === 'needs-fixes') workspace.pending = [{ artifactId: review.artifactId, kind: 'change', revision: 1, stale: false, decision: 'needs-changes', options: review.options }];
  if (mode === 'pending-conflict') workspace.pending = [{ artifactId: review.artifactId, kind: 'reconciliation', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 }, options: { baselineOwner: 'Команда внедрения' } }];
  // UX-04: header stepper states after acceptance. The build step is current only when the
  // server reported an available builder; a verified delivery leaves release unavailable.
  // Hypothetical: a builder and every build eligibility gate verified (no such evidence exists today).
  if (mode === 'lifecycle-build') model.composed = { candidates: [], build: { available: true },
    eligibility: { eligible: true, gates: ['scope', 'coverage', 'dependencies', 'target-profile', 'materialization'].map(id => ({ id, status: 'verified', reasons: [] })) } };
  if (mode === 'lifecycle-verified') workspace.delivery = { supported: true, state: 'verified' };
  // An approved training build (evidence basis synthetic, not native): Сборка is done
  // only as "учебная сборка", Проверка is the current step.
  if (mode === 'lifecycle-synthetic') {
    const at = '2026-10-14T09:00:00Z', actor = { id: 'synthetic-actor-reviewer', login: 'reviewer@example.org', display: 'Reviewer' };
    model.composed = { build: { available: true }, eligibility: { eligible: true, gates: [] }, candidates: [{ schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111',
      solutionId: workspace.id, code: 'synthetic_solution', revision: 2, createdAt: at, candidate: { id: '21111111-1111-4111-8111-111111111111', sha256: 'a'.repeat(64), size: 2048, provenance: 'composed-native-materialization', createdAt: at },
      units: [{ id: 'contract-fields', adapter: 'synthetic' }], targetProfile: { digest: 'c'.repeat(64), platformVersion: 'synthetic-2026.10' }, evidenceBasis: 'synthetic', releaseEligible: false,
      frozenBy: actor, approval: { actor, at, revision: 2, candidateId: '21111111-1111-4111-8111-111111111111', sha256: 'a'.repeat(64), reason: 'Учебная сборка сверена с принятыми изменениями.', scope: 'composed-candidate-review' },
      history: [{ action: 'freeze', actor, at, revision: 1 }], inputsStatus: 'current', deliverable: true }] };
  }
  if (mode.startsWith('about-')) {
    // A screen without a namespace makes a "Без модуля" card: titled, counted, not explainable.
    workspace.current.push({ code: 'orphan_form', key: JSON.stringify(['widgets', '', 'orphan_form']), team: 'Команда внедрения', service: 'widgets', namespace: '', kind: 'WIDGET', name: 'Экран без модуля', interventionId: null, digest: 'a'.repeat(64) });
    const draft = { text: 'Решение объединяет модули «synthetic».\n\nsynthetic. Экраны: Заявка на командировку, Утверждение командировки, Комментарий к заявке.\n\nНазначение описано по названиям объектов экспорта. Работа в ELMA не наблюдалась; проверьте и дополните описание.', sources: [], engine: 'declared-names-v1', evidence: 'declared-names', nativeObservation: 'absent' };
    const purpose = { key: 'solution-purpose', title: workspace.name, fingerprint: 'p'.repeat(64), expectedRevision: 1, version: 0, writable: true, reason: null, related: [], draft, saved: null, history: [] };
    const entry = { id: 'synthetic-purpose', key: 'solution-purpose', title: workspace.name, fingerprint: 'p'.repeat(64), text: 'Командировки сотрудников: заявка, утверждение руководителем и бухгалтерией, выдача аванса и отчёт о расходах. Решением пользуются сотрудники и бухгалтерия.', sources: [], actor: uploader, at: '2026-10-07T11:00:00Z' };
    if (['about-saved', 'about-stale'].includes(mode)) Object.assign(purpose, { version: 1, saved: { ...entry, sourceStatus: mode === 'about-stale' ? 'stale' : 'current' }, history: [entry] });
    if (mode === 'about-generated') model.aboutEditing = true;
    if (mode === 'about-error') purpose.loadError = 'Сервис объяснений недоступен.';
    model.about = { purpose: mode === 'about-error' ? { loadError: purpose.loadError } : purpose };
  }
  model.now = now;
  if (mode === 'loading') model.loading = true;
  if (mode === 'load-error') model.error = 'Сервис временно недоступен. Сохранённые пространства не изменены.';
  if (mode === 'stale') { model.view = 'review'; model.stale = true; model.error = 'База изменилась в другой вкладке.'; }
  return model;
}

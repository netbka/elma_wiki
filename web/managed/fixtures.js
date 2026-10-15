const names = { contract: 'Договор', approval: 'Согласование договора', comment: 'Комментарий к договору' };
const component = (code, team = 'Команда внедрения', changed = false) => ({ code, key: JSON.stringify(['widgets', 'synthetic.records', code]), team,
  service: 'widgets', namespace: 'synthetic.records', kind: 'WIDGET', name: names[code] || null,
  interventionId: changed ? 'synthetic-change' : null, digest: 'a'.repeat(64) });
export function managedFixture(mode = 'overview') {
  const at = '2026-10-07T12:00:00Z', base = { id: 'synthetic-baseline', scope: 'full', checksum: 'a'.repeat(64), snapshot: {
    projectId: 'synthetic-project', snapshotId: 'synthetic-snapshot', checksum: 'a'.repeat(64), source: null, createdAt: at
  }, scopeDeclaration: { scope: 'full', method: 'explicit-assertion', declaredAt: at } };
  const workspace = { id: 'synthetic-workspace', name: 'Согласование договоров', status: 'active', revision: 1,
    baselineId: base.id, baselineOwner: 'Команда внедрения', baselineAcceptedAt: at, artifacts: [base],
    current: [component('contract'), component('approval'), component('comment', 'Внутренняя команда', true)],
    changes: [{ id: 'synthetic-change' }], reconciliations: [], history: [{ type: 'created', baselineId: base.id }, { type: 'change-accepted' }], pending: [] };
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
  if (['summary-mixed', 'summary-no-changes', 'summary-closed'].includes(mode)) {
    const extra = (service, namespace, code, kind, name, classification, extraFields = {}) => ({ code, key: JSON.stringify(service === 'widgets' ? [service, namespace, code] : [service, namespace, kind, code]),
      service, namespace, kind, name, classification, previousTeam: 'Команда внедрения', digest: 'a'.repeat(64), ...extraFields });
    review.kind = 'reconciliation'; review.options = { baselineOwner: 'Команда внедрения' };
    review.snapshot = { ...base.snapshot, source: { connectionId: 'config-api-dev', solutionRef: 'contract_management' } };
    review.baseDeclaration = { schemaVersion: 1, status: 'declared', method: 'source-sequence', artifactId: base.id, revision: 0, checksum: base.checksum, scope: 'full', ancestryVerified: false };
    review.dependencies = { provenance: 'configured-source-capture', rows: [
      ...Array.from({ length: 14 }, () => ({ required: false, service: 'processor', targetNamespace: '_system_catalogs', targetCode: '_my_companies', status: 'provider-not-observed' })),
      { required: true, service: 'widgets', targetNamespace: '_clients', targetCode: '_companies', status: 'component-source-present' }] };
    review.rows = mode !== 'summary-mixed'
      ? [{ ...component('contract'), classification: 'unchanged' }, { ...component('approval'), classification: 'unchanged' }, extra('permissionsSettings', 'synthetic', 'contract', 'permissionSettings', null, 'unchanged')]
      : [extra('processor', 'contract_management.contracts', 'approval_process', 'template', 'Согласование договора', 'external-change'),
        extra('widgets', 'contract_management.contracts', 'create_form', 'WIDGET', 'Форма создания договора', 'intervention-added', { previousTeam: null }),
        extra('applications', 'contract_management', 'currencies', 'directory', 'Валюты', 'component-deleted', { removed: true }),
        { ...component('contract'), classification: 'conflict' },
        { ...component('approval'), classification: 'unchanged' }, { ...component('comment'), classification: 'unchanged' },
        extra('permissionsSettings', 'contract_management', 'contracts', 'permissionSettings', null, 'unchanged')];
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
        { id: '["node","y"]', kind: 'node', code: 'y', name: 'Проверить договор', team: 'Korus', classification: boundary ? 'element-modified' : 'unchanged', boundaryCrossing: boundary },
        { id: '["node","x"]', kind: 'node', code: 'x', name: 'Дополнительное согласование', team: conflict ? 'Внутренняя команда' : null, classification: conflict ? 'conflict' : 'element-added', conflict },
        ...['comment','returnReason'].map(code => ({ id: JSON.stringify(['variable',code]), kind: 'variable', code, name: code, team: conflict ? 'Внутренняя команда' : null, classification: conflict ? 'known-change-incorporated' : 'element-added' }))
      ] } }];
  }
  // UX-03b: a version closed without changes, and the decision dialog open on a review.
  if (mode === 'summary-closed') { review.closedAt = at; review.closedDecision = { actor, reason: 'no-difference' }; }
  if (mode === 'archived') { workspace.status = 'archived'; workspace.history.push({ type: 'archived' }); }
  if (mode === 'pending') workspace.pending = [{ artifactId: review.artifactId, kind: review.kind, revision: 1, stale: false, options: review.options }];
  const model = { synthetic: true, shared: true, home: '/solutions', api: '/api/solutions', view: 'overview', workspace };
  if (['review', 'conflict', 'overlap', 'ambiguous', 'decision'].includes(mode) || mode.startsWith('review-') || mode.startsWith('elements-') || mode.startsWith('summary-')) Object.assign(model, { view: 'review', review });
  if (mode === 'decision') model.decisionOpen = true;
  if (['create', 'create-legacy', 'empty', 'list', 'loading', 'load-error'].includes(mode) || mode.startsWith('pull-')) {
    delete model.workspace; model.view = ['create', 'create-legacy'].includes(mode) || mode.startsWith('pull-') ? 'create' : 'list';
    model.rows = mode === 'list' ? [{ ...workspace, baselineSnapshot: base.snapshot, changedComponents: 1, pendingCount: 2, current: undefined, pending: undefined }] : [];
  }
  // UX-01 fixed entry: server + solution, no scope/base/responsibility questions.
  const pullCatalog = [{ code: 'travel_expenses', name: 'Командировки и расходы' }, { code: 'paid_module', name: 'Платный модуль', paid: true }];
  const pullRecord = { id: 'synthetic-acquisition', server: 'dev', solution: 'contract_management', state: 'exporting', progress: { completed: 0, total: 1 }, solutions: [] };
  if (mode === 'create') model.pullCatalog = pullCatalog;
  if (mode === 'create-legacy') model.legacy = true;
  if (mode === 'pull-exporting') model.acquisition = pullRecord;
  if (mode === 'pull-ready') model.acquisition = { ...pullRecord, state: 'ready', progress: { completed: 1, total: 1 }, solutions: [{ code: 'contract_management', project: { id: 'synthetic-project', currentSnapshotId: 'synthetic-snapshot' } }] };
  if (mode === 'pull-failed') model.acquisition = { ...pullRecord, state: 'failed', error: 'Экспорт не завершён. Начните новую загрузку.' };
  if (mode === 'pull-unavailable') model.pullUnavailable = true;
  if (mode === 'update') { base.snapshot.source = { connectionId: 'config-api-dev', solutionRef: 'contract_management' }; model.view = 'full'; }
  if (mode === 'change') model.view = 'change';
  if (mode === 'changes') model.view = 'changes';
  if (mode === 'solution') {
    model.view = 'solution';
    // UX-02: a second module, a process, data objects and system objects show grouping, names and the collapsed group.
    const extra = (service, namespace, code, kind, name) => ({ code, key: JSON.stringify(kind && service !== 'widgets' ? [service, namespace, kind, code] : [service, namespace, code]), team: 'Команда внедрения',
      service, namespace, kind, name, interventionId: null, digest: 'a'.repeat(64) });
    workspace.current.push(extra('processor', 'contract_management.contracts', 'approval_process', 'template', 'Согласование договора'),
      extra('applications', 'contract_management', 'contracts', 'application', 'Договоры'),
      extra('applications', 'contract_management', 'currencies', 'directory', 'Валюты'),
      extra('permissionsSettings', 'contract_management', 'contracts', 'permissionSettings', null),
      extra('widgets', 'contract_management', '__default', 'WIDGET', null),
      extra('localizer', 'contract_management', '', 'localization', null));
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
    const draft = { revision: 2, owner: 'Внутренняя команда', task: 'DEMO-14 · категория договора', baseId: base.id, scopeEnabled: true,
      scopeName: 'Категория договора', selected: [component('contract').key], extra: JSON.stringify(['widgets', 'synthetic.records', 'category']), captured: null };
    if (mode === 'change-draft') model.draft = { ...draft, uncertain: true };
    if (mode === 'change-rejected') { model.draft = { ...draft, revision: 3 }; model.error = 'Объект состава не найден ни в выбранной базе, ни в загруженном экспорте. Черновик сохранён.'; }
  }
  if (mode === 'base-declared' || mode === 'base-unknown') {
    model.view = 'review'; model.review = review;
    review.baseDeclaration = mode === 'base-unknown' ? { schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false }
      : { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', artifactId: base.id, revision: 0, checksum: base.checksum, scope: 'full', ancestryVerified: false };
    review.changeScopeDeclaration = mode === 'base-unknown' ? { schemaVersion: 1, status: 'unknown', method: 'not-recorded' }
      : { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', name: 'Категория договора', deletions: [], baseArtifactId: base.id, baseRevision: 0,
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
    const plan = { schemaVersion: 1, method: 'whole-component-three-way', status: blocked ? 'blocked' : 'resolution-required', blockers: blocked ? [{ reason: 'rename-uncertain' }] : [], rows,
      inputs: { base: { status: 'declared', artifactId: base.id, revision: 0, checksum: base.checksum }, current: { workspaceId: workspace.id, revision: mode === 'merge-stale' ? 3 : 2, baselineId: base.id, digest: 'f'.repeat(64) },
        incoming: { artifactId: review.artifactId, checksum: 'b'.repeat(64), artifactDigest: review.artifactDigest } },
      planDigest: '1'.repeat(64), ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false };
    const resolution = { schemaVersion: 1, method: 'whole-component-resolution', id: 'synthetic-resolution', sequence: 1, parentId: null, planDigest: mode === 'merge-stale' ? '0'.repeat(64) : plan.planDigest,
      inputs: { ...plan.inputs, current: { ...plan.inputs.current, revision: 2 } }, decisions: [{ key: rows[0].key, classification: 'divergent', choice: 'take-incoming' }],
      reason: 'Лимит согласован с финансовым отделом в DEMO-14.', actor, at, ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false, materialized: false };
    const head = ['merge-resolved', 'merge-stale'].includes(mode) ? { ...resolution, status: mode === 'merge-stale' ? 'stale' : 'current' } : null;
    review.merge = { artifactId: review.artifactId, available: true, reason: null, message: null, plan,
      choices: { divergent: ['keep-current', 'take-incoming'], 'addition-divergent': ['keep-current', 'take-incoming'], 'delete-edit': ['keep-current', 'remove'], 'edit-delete': ['keep-current', 'take-incoming'] },
      head, history: head ? [head] : [] };
  }
  if (mode === 'no-source') workspace.baselineId = null;
  if (mode === 'needs-fixes') workspace.pending = [{ artifactId: review.artifactId, kind: 'change', revision: 1, stale: false, decision: 'needs-changes', options: review.options }];
  if (mode === 'pending-conflict') workspace.pending = [{ artifactId: review.artifactId, kind: 'reconciliation', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 }, options: { baselineOwner: 'Команда внедрения' } }];
  // UX-04: header stepper states after acceptance. The build step is current only when the
  // server reported an available builder; a verified delivery leaves release unavailable.
  if (mode === 'lifecycle-build') model.composed = { candidates: [], build: { available: true } };
  if (mode === 'lifecycle-verified') workspace.delivery = { supported: true, state: 'verified' };
  if (mode.startsWith('about-')) {
    const draft = { text: 'Решение объединяет модули «synthetic».\n\nsynthetic. Экраны: Договор, Согласование договора, Комментарий к договору.\n\nНазначение описано по названиям объектов экспорта. Работа в ELMA не наблюдалась; проверьте и дополните описание.', sources: [], engine: 'declared-names-v1', evidence: 'declared-names', nativeObservation: 'absent' };
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

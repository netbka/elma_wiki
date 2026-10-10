const component = (code, team = 'Команда внедрения', changed = false) => ({ code, key: JSON.stringify(['widgets', 'synthetic.records', code]), team,
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
  if (mode === 'archived') { workspace.status = 'archived'; workspace.history.push({ type: 'archived' }); }
  if (mode === 'pending') workspace.pending = [{ artifactId: review.artifactId, kind: review.kind, revision: 1, stale: false, options: review.options }];
  const model = { synthetic: true, shared: true, home: '/solutions', api: '/api/solutions', view: 'overview', workspace };
  if (['review', 'conflict', 'overlap', 'ambiguous'].includes(mode) || mode.startsWith('review-') || mode.startsWith('elements-')) Object.assign(model, { view: 'review', review });
  if (['create', 'empty', 'list', 'loading', 'load-error'].includes(mode)) {
    delete model.workspace; model.view = mode === 'create' ? 'create' : 'list';
    model.rows = mode === 'list' ? [{ ...workspace, baselineSnapshot: base.snapshot, changedComponents: 1, pendingCount: 2, current: undefined, pending: undefined }] : [];
  }
  if (mode === 'change') model.view = 'change';
  if (mode === 'changes') model.view = 'changes';
  if (mode === 'solution') model.view = 'solution';
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
  if (mode === 'no-source') workspace.baselineId = null;
  if (mode === 'needs-fixes') workspace.pending = [{ artifactId: review.artifactId, kind: 'change', revision: 1, stale: false, decision: 'needs-changes', options: review.options }];
  if (mode === 'pending-conflict') workspace.pending = [{ artifactId: review.artifactId, kind: 'reconciliation', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 }, options: { baselineOwner: 'Команда внедрения' } }];
  if (mode === 'loading') model.loading = true;
  if (mode === 'load-error') model.error = 'Сервис временно недоступен. Сохранённые пространства не изменены.';
  if (mode === 'stale') { model.view = 'review'; model.stale = true; model.error = 'База изменилась в другой вкладке.'; }
  return model;
}

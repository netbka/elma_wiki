const component = (code, team = 'Команда внедрения', changed = false) => ({ code, key: JSON.stringify(['widgets', 'synthetic.records', code]), team,
  interventionId: changed ? 'synthetic-change' : null, digest: 'a'.repeat(64) });
export function managedFixture(mode = 'overview') {
  const at = '2026-10-07T12:00:00Z', base = { id: 'synthetic-baseline', scope: 'full', checksum: 'a'.repeat(64), snapshot: {
    projectId: 'synthetic-project', snapshotId: 'synthetic-snapshot', source: null, createdAt: at
  }, scopeDeclaration: { scope: 'full', method: 'explicit-assertion', declaredAt: at } };
  const workspace = { id: 'synthetic-workspace', name: 'Согласование договоров', status: 'active', revision: 1,
    baselineId: base.id, baselineOwner: 'Команда внедрения', baselineAcceptedAt: at, artifacts: [base],
    current: [component('contract'), component('approval'), component('comment', 'Внутренняя команда', true)],
    changes: [{ id: 'synthetic-change' }], reconciliations: [], history: [{ type: 'created' }, { type: 'change-accepted' }], pending: [] };
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
  if (mode === 'archived') { workspace.status = 'archived'; workspace.history.push({ type: 'archived' }); }
  if (mode === 'pending') workspace.pending = [{ artifactId: review.artifactId, kind: review.kind, revision: 1, stale: false, options: review.options }];
  const model = { synthetic: true, shared: true, home: '/solutions', api: '/api/solutions', view: 'overview', workspace };
  if (['review', 'conflict', 'overlap', 'ambiguous'].includes(mode) || mode.startsWith('review-')) Object.assign(model, { view: 'review', review });
  if (['create', 'empty', 'list', 'loading', 'load-error'].includes(mode)) {
    delete model.workspace; model.view = mode === 'create' ? 'create' : 'list';
    model.rows = mode === 'list' ? [{ ...workspace, baselineSnapshot: base.snapshot, changedComponents: 1, pendingCount: 2, current: undefined, pending: undefined }] : [];
  }
  if (mode === 'change') model.view = 'change';
  if (mode === 'changes') model.view = 'changes';
  if (mode === 'solution') model.view = 'solution';
  if (mode === 'no-source') workspace.baselineId = null;
  if (mode === 'needs-fixes') workspace.pending = [{ artifactId: review.artifactId, kind: 'change', revision: 1, stale: false, decision: 'needs-changes', options: review.options }];
  if (mode === 'pending-conflict') workspace.pending = [{ artifactId: review.artifactId, kind: 'reconciliation', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 }, options: { baselineOwner: 'Команда внедрения' } }];
  if (mode === 'loading') model.loading = true;
  if (mode === 'load-error') model.error = 'Сервис временно недоступен. Сохранённые пространства не изменены.';
  if (mode === 'stale') { model.view = 'review'; model.stale = true; model.error = 'База изменилась в другой вкладке.'; }
  return model;
}

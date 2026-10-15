import { managedFixture } from './fixtures.js';

// Synthetic composer evidence only: no ELMA, no native package, no release.
const actor = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'vk-teams' };
const build = { available: false, reason: 'native-materialization-unavailable', reference: 'netbka/elma365#60', contracts: ['elma365-native-materialization@1'],
  missing: ['native-materialization-worker', 'baseline-preserving-stage-service', 'process-runtime-compiler', 'isolated-native-assembler'] };
export function composedCandidateFixture({ id = '11111111-1111-4111-8111-111111111111', sha = 'a', status = 'current', approved = false, createdAt = '2026-10-14T09:00:00Z' } = {}) {
  const revision = approved ? 2 : 1;
  return { schemaVersion: 1, id, solutionId: 'synthetic-workspace', code: 'synthetic_solution', revision, createdAt,
    candidate: { id: id.replace(/^1/, '2'), sha256: sha.repeat(64), size: 2048, provenance: 'composed-native-materialization', createdAt },
    units: [{ id: 'contract-fields', adapter: 'synthetic' }, { id: 'contract-approval', adapter: 'synthetic' }, { id: 'contract-forms', adapter: 'synthetic' }],
    targetProfile: { digest: 'c'.repeat(64), platformVersion: 'synthetic-2026.10' }, evidenceBasis: 'synthetic', releaseEligible: false,
    frozenBy: actor, approval: approved ? { actor, at: '2026-10-14T10:00:00Z', revision, candidateId: id.replace(/^1/, '2'), sha256: sha.repeat(64), reason: 'Учебная сборка сверена с принятыми изменениями.', scope: 'composed-candidate-review' } : null,
    history: [{ action: 'freeze', actor, at: createdAt, revision: 1 }], inputsStatus: status, deliverable: status === 'current' && approved };
}

export function solutionComposerFixture(mode = 'build-blocked') {
  const model = managedFixture('overview');
  model.view = 'compose';
  const stale = composedCandidateFixture({ id: '10000000-0000-4000-8000-000000000001', sha: 'e', status: 'stale', createdAt: '2026-10-13T09:00:00Z' });
  const awaiting = composedCandidateFixture();
  const approved = composedCandidateFixture({ approved: true });
  const candidates = { 'build-blocked': [], list: [stale, awaiting], 'awaiting-approval': [stale, awaiting], stale: [stale] }[mode] || [stale, approved];
  const explicit = { list: null, 'build-blocked': null, missing: null, 'awaiting-approval': awaiting, stale };
  const selected = mode in explicit ? explicit[mode] : approved;
  model.composed = { candidates, build, selected, selectedId: mode === 'missing' ? '99999999-9999-4999-8999-999999999999' : selected?.id };
  if (mode === 'load-error') model.composed = { loadError: 'Учебная ошибка: состояние сборок не получено.' };
  // Delivery data in the shared renderer's shape; attempts are synthetic.
  const connection = { id: 'synthetic-target', name: 'Учебный TEST', role: 'target', environment: 'test', adapter: 'synthetic',
    probe: { ok: true, identity: { host: 'test.example.invalid', version: 'synthetic-2026.10' } } };
  const attemptState = { 'delivery-prepared': 'prepared', 'partial-outcome': 'partial-outcome', 'unknown-outcome': 'unknown-outcome', verified: 'verified', 'verification-failed': 'verification-failed', failed: 'failed' }[mode];
  const attempt = attemptState ? { id: 'synthetic-attempt', state: attemptState, solutionCode: approved.code, releaseRevision: approved.revision,
    candidateId: approved.candidate.id, sha256: approved.candidate.sha256, connection, targetIdentity: connection.probe.identity,
    candidateStatus: 'current', verificationCurrent: attemptState === 'verified',
    evidence: { comparison: ['verified', 'verification-failed'].includes(attemptState) ? { policy: 'exact-solution-inventory-v1', match: attemptState === 'verified', compared: 3, missing: [],
      different: attemptState === 'verification-failed' ? ['widgets/form.json'] : [], unexpected: [] } : null, verificationError: null,
      units: attemptState === 'prepared' ? approved.units.map(unit => ({ unitId: unit.id, status: 'pending', operationId: null }))
        : attemptState === 'partial-outcome' ? [{ unitId: 'contract-fields', status: 'applied', operationId: 'synthetic-1' }, { unitId: 'contract-approval', status: 'failed', operationId: 'synthetic-2' }, { unitId: 'contract-forms', status: 'unreported', operationId: null }]
        : approved.units.map(unit => ({ unitId: unit.id, status: attemptState === 'failed' ? 'failed' : attemptState === 'unknown-outcome' ? 'unreported' : 'applied', operationId: null })) },
    history: [{ at: '2026-10-14T11:00:00Z', state: attemptState, note: 'Синтетическое состояние' }] } : null;
  const data = { capabilities: { mode: 'synthetic', liveDelivery: false, composedBuild: build }, connections: [connection], attempts: attempt ? [attempt] : [], bridges: [] };
  return { model, data, connection, candidates: { stale, awaiting, approved } };
}

// Overview next-action states derived from the same server shapes.
export function composerNextActionFixture(mode) {
  const model = managedFixture('overview');
  if (mode === 'build-blocked') model.composed = { candidates: [], build };
  if (mode === 'verify') model.composed = { candidates: [composedCandidateFixture({ approved: true })], build };
  if (mode === 'review-build') model.composed = { candidates: [composedCandidateFixture()], build };
  if (mode === 'compare') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 0, stale: true, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  if (mode === 'resolve') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 },
    baseDeclaration: { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', artifactId: 'synthetic-baseline', ancestryVerified: false }, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  if (mode === 'unknown-base') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 },
    baseDeclaration: { schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false }, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  return model;
}

import { managedFixture } from './fixtures.js';

// Synthetic composer evidence only: no ELMA, no native package, no release.
const actor = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'vk-teams' };
const build = { available: false, reason: 'native-materialization-unavailable', reference: 'netbka/elma365#60', contracts: ['elma365-native-materialization@1'],
  missing: ['native-materialization-worker', 'baseline-preserving-stage-service', 'process-runtime-compiler', 'isolated-native-assembler'] };
// Server build-eligibility shapes (lib/composed-build-eligibility.mjs), synthetic. `current` is what the
// service reports today: no native coverage declaration, no observed Target profile, no native builder.
// `gates` shows each gate blocking: a dependency cycle, an unknown object kind, a missing paid module and a stale profile.
const gate = (id, status, reasons = []) => ({ id, status, reasons });
const key = code => JSON.stringify(['widgets', 'synthetic', code]);
const materializationGate = gate('materialization', 'blocked', [{ reason: 'native-materialization-unavailable', missing: build.missing }]);
export const eligibilityFixtures = {
  current: { schemaVersion: 1, evaluatedAt: '2026-10-14T09:00:00.000Z', eligible: false, gates: [gate('scope', 'verified'),
    gate('coverage', 'blocked', [{ reason: 'native-coverage-unavailable' }, { reason: 'missing-native-evidence', fact: 'pinned-native-coverage-contract', evidence: 'unknown' },
      { reason: 'unknown-native-import-unit', solution: 'synthetic_solution', key: key('base') }, { reason: 'unknown-native-coverage' }]),
    gate('dependencies', 'blocked', [{ reason: 'unknown-dependency-evidence' }]),
    gate('target-profile', 'unknown', [{ reason: 'unbound-plan-target-profile' }, { reason: 'unknown-target-profile' }, { reason: 'unobserved-target-profile' }]), materializationGate],
  evidence: { coverage: 'unknown', dependencies: 'unknown', targetProfile: 'unknown' }, targetProfile: null, publicationReady: false, executionEnabled: false },
  gates: { schemaVersion: 1, evaluatedAt: '2026-10-14T09:00:00.000Z', eligible: false, gates: [
    gate('scope', 'blocked', [{ reason: 'dependency-cycle', components: [{ solution: 'synthetic_solution', key: key('contract') }, { solution: 'synthetic_solution', key: key('approval') }] }]),
    gate('coverage', 'blocked', [{ reason: 'unsupported-native-unit-member', unitId: 'package:synthetic_solution', members: [{ solution: 'synthetic_solution', key: key('mystery') }] },
      { reason: 'missing-native-evidence', fact: 'native-import-receipt', evidence: 'unknown', unitId: 'package:synthetic_solution' }]),
    gate('dependencies', 'blocked', [{ reason: 'unverified-licensed-prerequisite', from: { solution: 'synthetic_solution', key: key('contract') }, service: 'widgets', namespace: 'vendor', code: 'signature',
      status: 'license-not-verified', candidates: [{ code: 'vendor_signature', version: '2.1.0', paid: true }] },
      { reason: 'unresolved-dependency', from: { solution: 'synthetic_solution', key: key('contract') }, service: 'widgets', namespace: 'vendor', code: 'signature', details: ['missing-receipt'] }]),
    gate('target-profile', 'blocked', [{ reason: 'stale-target-profile-observation', observedAt: '2026-10-12T09:00:00.000Z' }, { reason: 'stale-dependency-profile' }]), materializationGate],
  evidence: { coverage: 'native', dependencies: 'native-receipt', targetProfile: 'observed' },
  targetProfile: { targetId: 'synthetic-target', environment: 'synthetic-target', digest: 'c'.repeat(64), platformVersion: 'synthetic-2026.10' }, publicationReady: false, executionEnabled: false }
};
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
  // Synthetic records of native/unknown provenance states; no native execution is claimed.
  if (mode === 'native-pending') Object.assign(approved, { evidenceBasis: 'native', releaseEligible: false,
    pendingNativeEvidence: ['native-import-receipt', 'native-installation-observation'], deliverable: false });
  if (mode === 'unknown-evidence') Object.assign(approved, { evidenceBasis: null, releaseEligible: false, deliverable: false });
  const candidates = { 'build-blocked': [], 'build-gates': [], 'eligibility-load-error': [], list: [stale, awaiting], 'awaiting-approval': [stale, awaiting], stale: [stale] }[mode] || [stale, approved];
  const explicit = { list: null, 'build-blocked': null, 'build-gates': null, 'eligibility-load-error': null, missing: null, 'awaiting-approval': awaiting, stale };
  const selected = mode in explicit ? explicit[mode] : approved;
  const eligibility = mode === 'build-gates' ? eligibilityFixtures.gates : mode === 'eligibility-load-error' ? { loadError: 'Учебная ошибка: проверка сборки не получена.' } : eligibilityFixtures.current;
  model.composed = { candidates, build, eligibility, selected, selectedId: mode === 'missing' ? '99999999-9999-4999-8999-999999999999' : selected?.id };
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
  const eligibility = eligibilityFixtures.current;
  if (mode === 'build-blocked') model.composed = { candidates: [], build, eligibility };
  if (mode === 'verify') model.composed = { candidates: [composedCandidateFixture({ approved: true })], build, eligibility };
  if (mode === 'review-build') model.composed = { candidates: [composedCandidateFixture()], build, eligibility };
  if (mode === 'compare') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 0, stale: true, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  if (mode === 'resolve') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 },
    baseDeclaration: { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', artifactId: 'synthetic-baseline', ancestryVerified: false }, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  if (mode === 'unknown-base') model.workspace.pending = [{ artifactId: 'synthetic-review', kind: 'change', revision: 1, stale: false, attention: { conflicts: 1, unknown: 0 },
    baseDeclaration: { schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false }, options: { team: 'Внутренняя команда', taskRef: 'DEMO-12' } }];
  return model;
}

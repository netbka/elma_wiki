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
const failure = (status, body) => Object.assign(Error(body.error || 'synthetic'), { status, body, requiresRefresh: false });
// Operator Target profile refresh states (lib/target-profile-refresh.mjs `status`), synthetic.
// An admitted observation only removes `unobserved-target-profile`: without a native coverage
// declaration the plan stays unbound to the profile, so the gate and the build remain blocked.
const profile = { targetId: 'dev2', digest: 'c'.repeat(64), platformVersion: 'synthetic-2026.10', observedAt: '2026-10-14T09:00:00.000Z' };
const refreshState = (extra = {}) => ({ configured: true, reason: null, target: 'dev2', operator: true, inProgress: false, current: false, staleInputs: false, last: null, ...extra });
const lastOf = (outcome, extra = {}) => ({ outcome, at: '2026-10-14T09:00:00.000Z', reason: null, errors: [], targetProfile: null, ...extra });
export const targetProfileFixtures = {
  unconfigured: refreshState({ configured: false, reason: 'target-profile-observation-unconfigured', target: null, operator: false }),
  'not-operator': refreshState({ operator: false }),
  ready: refreshState(),
  progress: refreshState({ inProgress: true }),
  observed: refreshState({ current: true, last: lastOf('observed', { targetProfile: profile }) }),
  stale: refreshState({ staleInputs: true, last: lastOf('observed', { targetProfile: profile }) }),
  unavailable: refreshState({ last: lastOf('unavailable', { reason: 'live-target-access-unavailable' }) }),
  invalid: refreshState({ last: lastOf('invalid', { errors: ['unattested-observation'] }) }),
  unknown: refreshState({ last: lastOf('unknown', { reason: 'timeout' }) })
};
const observedEligibility = { ...eligibilityFixtures.current, gates: eligibilityFixtures.current.gates.map(row => row.id === 'target-profile'
  ? gate('target-profile', 'blocked', [{ reason: 'unbound-plan-target-profile' }]) : row),
  evidence: { ...eligibilityFixtures.current.evidence, targetProfile: 'observed' }, targetProfile: { targetId: 'dev2', environment: 'dev2', digest: profile.digest, platformVersion: profile.platformVersion } };
export const profileEligibility = mode => ({ ...(mode === 'observed' ? observedEligibility : eligibilityFixtures.current), revision: 3, targetProfileRefresh: targetProfileFixtures[mode] });
// What the synthetic refresh route answers per story (null: success), as the page's request() throws it.
export const profileResponseFixtures = {
  invalid: failure(422, { outcome: 'invalid', errors: ['native-worker-revision-mismatch'] }),
  stale: failure(409, { outcome: 'stale', reason: 'stale-solution-revision' }),
  lost: Object.assign(Error('Ответ не получен.'), { requiresRefresh: true })
};
// Story mode -> [refresh state, click answer].
export const profileModes = { 'profile-unconfigured': ['unconfigured'], 'profile-not-operator': ['not-operator'], 'profile-ready': ['ready', null],
  'profile-progress': ['progress'], 'profile-observed': ['observed', null], 'profile-stale': ['stale', null], 'profile-unavailable': ['unavailable', null],
  'profile-invalid': ['invalid', 'invalid'], 'profile-unknown': ['unknown', null], 'profile-moved': ['ready', 'stale'], 'profile-lost': ['ready', 'lost'] };
// A builder the server reports available, every gate verified: the build-ready shape.
export const availableBuild = { available: true, reference: 'netbka/elma365#60', contracts: ['elma365-native-materialization@1'], missing: [] };
export const verifiedEligibility = { ...eligibilityFixtures.gates, eligible: true,
  gates: ['scope', 'coverage', 'dependencies', 'target-profile', 'materialization'].map(id => gate(id, 'verified')) };
// Synthetic route responses (POST composed-build / composed): a resolved body or the error the page's request() throws.
export const buildResponseFixtures = {
  validated: { outcome: 'validated', receipt: { status: 'validated', worker: 'synthetic-worker' },
    manifest: { schemaVersion: 1, status: 'materialized', evidenceBasis: 'native', manifestDigest: 'd'.repeat(64), artifacts: [{ id: 'package' }, { id: 'process-runtime' }], blockers: [] } },
  blocked: failure(409, { outcome: 'blocked', gates: [eligibilityFixtures.gates.gates[2]], eligibility: eligibilityFixtures.gates, manifest: null }),
  failed: failure(422, { outcome: 'failed', reasons: [{ reason: 'native-validation-failed' }], receipt: null, manifest: null }),
  stale: failure(409, { outcome: 'stale', reasons: [{ reason: 'stale-build-input' }], receipt: null, manifest: null }),
  notAccepted: failure(409, { error: 'The change is not the latest accepted merged revision of this Solution' }),
  inProgress: failure(409, { outcome: 'in-progress', error: 'synthetic' }),
  staleFreeze: failure(409, { outcome: 'refused', reason: 'stale-build', detail: 'expected-revision', candidate: null }),
  malformed: { outcome: 'validated', manifest: { manifestDigest: 'bad' } },
  lost: Object.assign(Error('Ответ не получен.'), { requiresRefresh: true })
};
// Build-flow story modes: what the synthetic build and freeze routes answer (null: not reached).
export const buildFlowModes = { 'build-ready': ['validated', null], 'build-no-merge': [null, null], 'build-refused': ['blocked', null], 'build-failed': ['failed', null],
  'build-stale': ['stale', null], 'build-not-accepted': ['notAccepted', null], 'build-lost': ['lost', null], 'build-malformed': ['malformed', null],
  'freeze-stale': ['validated', 'staleFreeze'], 'freeze-lost': ['validated', 'lost'] };
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
  if (mode === 'native-pending' || mode === 'test-install') Object.assign(approved, { evidenceBasis: 'native', releaseEligible: false,
    pendingNativeEvidence: ['native-import-receipt', 'native-installation-observation'], deliverable: false });
  if (mode === 'unknown-evidence') Object.assign(approved, { evidenceBasis: null, releaseEligible: false, deliverable: false });
  const candidates = { 'build-blocked': [], 'build-gates': [], 'eligibility-load-error': [], ...Object.fromEntries(Object.keys(profileModes).map(key => [key, []])), list: [stale, awaiting], 'awaiting-approval': [stale, awaiting], stale: [stale] }[mode] || [stale, approved];
  const explicit = { list: null, 'build-blocked': null, 'build-gates': null, 'eligibility-load-error': null, missing: null, ...Object.fromEntries(Object.keys(profileModes).map(key => [key, null])), 'awaiting-approval': awaiting, stale };
  const selected = mode in explicit ? explicit[mode] : approved;
  const eligibility = mode === 'build-gates' ? eligibilityFixtures.gates : mode === 'eligibility-load-error' ? { loadError: 'Учебная ошибка: проверка сборки не получена.' }
    : profileModes[mode] ? profileEligibility(profileModes[mode][0]) : eligibilityFixtures.current;
  model.composed = { candidates, build, eligibility, selected, selectedId: mode === 'missing' ? '99999999-9999-4999-8999-999999999999' : selected?.id };
  if (mode === 'load-error') model.composed = { loadError: 'Учебная ошибка: состояние сборок не получено.' };
  // A builder and every gate verified; `build-no-merge` accepted its last change without a three-way merge.
  if (buildFlowModes[mode]) model.composed = { candidates: [stale], build: availableBuild, eligibility: verifiedEligibility, selected: null, selectedId: null };
  if (mode === 'build-no-merge') delete model.workspace.changes.at(-1).resolution;
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
  // A verified owner-designated DEV2 test install of the native candidate: never release evidence.
  if (mode === 'test-install') {
    const dev2 = { id: 'preset-dev2', name: 'DEV2', role: 'target', environment: 'dev', adapter: 'bridge',
      preset: { id: 'preset-dev2', name: 'DEV2', environmentRole: 'technical', bridgeTarget: 'dev2', host: 'dev2.example.invalid', available: true,
        allowedOperations: ['inspect', 'deploy'], designatedCandidates: [approved.candidate.sha256] },
      probe: { ok: true, hostMatches: true, identity: { host: 'dev2.example.invalid', version: 'synthetic-2026.10' } } };
    Object.assign(data, { capabilities: { bridge: true, composedBuild: build }, connections: [dev2], bridges: [{ id: 'synthetic-bridge', name: 'Учебный мост', online: true, lastSeen: '2026-10-14T11:00:00Z', identity: { host: 'dev2.example.invalid', version: 'synthetic-2026.10' } }], attempts: [{
      id: 'synthetic-test-install', state: 'verified', solutionCode: approved.code, releaseRevision: approved.revision, candidateId: approved.candidate.id, sha256: approved.candidate.sha256,
      connection: dev2, targetIdentity: dev2.probe.identity, candidateStatus: 'current', verificationCurrent: true,
      composed: { pendingNativeEvidence: [...approved.pendingNativeEvidence], deliveryBasis: 'designated-test-install' },
      evidence: { comparison: { policy: 'import-normalized-v1', match: true, compared: 3, missing: [], different: [], unexpected: [] }, verificationError: null,
        units: approved.units.map(unit => ({ unitId: unit.id, status: 'applied', operationId: null })) },
      history: [{ at: '2026-10-14T11:00:00Z', state: 'verified', note: 'Синтетическое состояние' }] }] });
  }
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

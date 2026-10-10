import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencyEvidence, planDigest, NATIVE_RECEIPT_CONTRACTS, SYNTHETIC_RECEIPT_CONTRACT } from '../lib/dependency-resolver.mjs';
import { planReleaseScope } from '../lib/release-scope-planner.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';

// Synthetic fixtures only: no real Target, licence, receipt or module.
const PROFILE = 'synthetic-profile';
const component = (code, namespace = 'app') => ({ key: JSON.stringify(['widgets', namespace, code]), service: 'widgets', namespace, code, digest: 'digest-' + code });
const declaration = (to, extra = {}) => ({ category: 'dependencies', service: 'widgets', targetNamespace: 'vendor', targetCode: to,
  source: { service: 'widgets', namespace: 'app', code: 'A' }, ...extra });
const unit = (code, namespace = 'app', solution = 'S') => ({ id: code, status: 'supported', adapter: 'synthetic-v1', evidenceRef: 'synthetic-unit',
  targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target', targetProfileDigest: PROFILE },
  members: [{ solution, key: component(code, namespace).key, digest: 'digest-' + code }] });
const capture = (rows, components = [component('A')], solution = 'S') => {
  const dependencies = dependencyReport([]);
  dependencies.rows = rows;
  return { solution, scope: 'full', components, ambiguities: [], unclassifiedFiles: [], dependencies };
};
const missingPaid = (candidate = { code: 'vendor-module', version: '2.1', paid: true }) =>
  ({ ...declaration('ext'), status: 'paid-source-unavailable', candidates: candidate ? [candidate] : [] });
const plan = (rows = [missingPaid()], extra = {}) => planReleaseScope({ request: { kind: 'solution', solution: 'S' }, artifacts: [capture(rows)], importUnits: [unit('A')], ...extra });
const targetProfile = { targetId: 'synthetic-target', environment: 'synthetic-test', digest: PROFILE, platformVersion: '2026.10', changedAt: '2026-10-01T00:00:00Z' };
const receipt = (extra = {}) => ({ id: 'r1', contract: { id: SYNTHETIC_RECEIPT_CONTRACT.id, version: 1 }, kind: 'licensed-preinstallation', status: 'verified',
  provider: { code: 'vendor-module', version: '2.1' }, provides: [{ service: 'widgets', namespace: 'vendor', code: 'ext' }],
  targetId: 'synthetic-target', environment: 'synthetic-test', targetProfileDigest: PROFILE, verifiedAt: '2026-10-05T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z',
  provenance: { source: 'native-adapter', adapter: 'synthetic-adapter', evidenceRef: 'synthetic-receipt-evidence' },
  compatibility: { status: 'compatible', platformVersion: '2026.10', evidenceRef: 'synthetic-compat' },
  entitlement: { status: 'verified', evidenceRef: 'synthetic-entitlement' }, activation: { status: 'verified', evidenceRef: 'synthetic-activation' },
  requiredBindings: [{ name: 'VENDOR_API', kind: 'secret-reference' }], ...extra });
const binding = { name: 'VENDOR_API', kind: 'secret-reference', reference: 'secret-ref:synthetic/vendor-api', targetProfileDigest: PROFILE };
const resolve = (extra = {}) => resolveDependencyEvidence({ plan: plan(), targetProfile, receiptContract: SYNTHETIC_RECEIPT_CONTRACT,
  receipts: [receipt()], bindings: [binding], now: '2026-10-09T00:00:00Z', ...extra });
const reasonsOf = result => result.rows[0].reasons;

test('absent native receipt contract keeps every dependency unknown and fails closed', () => {
  assert.deepEqual(NATIVE_RECEIPT_CONTRACTS, []);
  for (const receiptContract of [null, { id: 'elma365-dependency-receipt', version: 1 }, { ...SYNTHETIC_RECEIPT_CONTRACT, version: 2 }]) {
    const result = resolve({ receiptContract });
    assert.equal(result.evidenceBasis, 'unknown');
    assert.equal(result.rows[0].status, 'unknown');
    assert.deepEqual(reasonsOf(result), ['native-receipt-contract-unavailable']);
    assert.ok(result.blockers.some(row => row.reason === 'native-receipt-contract-unavailable'));
    assert.deepEqual(result.locks, []);
    assert.equal(result.resolutionComplete, false);
    assert.equal(result.publicationReady, false);
    assert.equal(result.executionEnabled, false);
  }
});

test('compatible synthetic preinstallation receipt locks the prerequisite but stays labelled synthetic', () => {
  const result = resolve();
  assert.equal(result.rows[0].status, 'locked');
  assert.deepEqual(result.locks.map(row => [row.path, row.receiptId, row.evidence, row.activation]), [['licensed-preinstallation', 'r1', 'synthetic', 'verified-preinstalled']]);
  assert.deepEqual(result.locks[0].bindings, [{ name: 'VENDOR_API', kind: 'secret-reference' }]);
  assert.equal(JSON.stringify(result).includes('secret-ref:synthetic'), false);
  assert.equal(result.evidenceBasis, 'synthetic');
  assert.deepEqual(result.blockers.map(row => row.reason), ['synthetic-evidence-only']);
  assert.equal(result.remainingPlanBlockers.some(row => row.reason === 'missing-reference'), false);
  assert.equal(result.resolutionComplete, false);
  assert.equal(result.publicationReady, false);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.planDigest, planDigest(plan()));
  assert.ok(Object.isFrozen(result.locks[0]));
});

test('incompatible, mismatched, expired, stale, revoked and assertion-only receipts block', () => {
  const cases = [
    [{ compatibility: { status: 'incompatible', platformVersion: '2026.10', evidenceRef: 'x' } }, 'incompatible-receipt'],
    [{ compatibility: undefined }, 'unknown-compatibility'],
    [{ compatibility: { status: 'compatible', platformVersion: '2025.1', evidenceRef: 'x' } }, 'platform-version-mismatch'],
    [{ provider: { code: 'vendor-module', version: '2.0' } }, 'version-mismatch'],
    [{ provider: { code: 'other-module', version: '2.1' } }, 'provider-mismatch'],
    [{ targetProfileDigest: 'other-profile' }, 'target-profile-mismatch'],
    [{ environment: 'prod' }, 'target-environment-mismatch'],
    [{ expiresAt: '2026-10-08T00:00:00Z' }, 'expired-receipt'],
    [{ expiresAt: undefined }, 'unknown-receipt-expiry'],
    [{ verifiedAt: '2026-09-01T00:00:00Z' }, 'stale-receipt'],
    [{ verifiedAt: '2026-12-01T00:00:00Z' }, 'unknown-receipt-verification-time'],
    [{ status: 'revoked' }, 'revoked-receipt'],
    [{ status: 'assertion' }, 'assertion-only-receipt'],
    [{ provenance: { source: 'catalog', adapter: 'x', evidenceRef: 'x' } }, 'assertion-only-receipt'],
    [{ entitlement: undefined }, 'unverified-entitlement'],
    [{ activation: { status: 'unknown' } }, 'unverified-activation'],
    [{ contract: { id: 'other', version: 1 } }, 'receipt-contract-mismatch'],
    [{ kind: 'readable-source' }, 'unknown-receipt-kind']
  ];
  for (const [patch, reason] of cases) {
    const result = resolve({ receipts: [receipt(patch)] });
    assert.equal(result.rows[0].status, 'blocked', reason);
    assert.ok(reasonsOf(result).includes(reason), `${reason}: ${reasonsOf(result)}`);
    assert.deepEqual(result.locks, []);
    assert.ok(result.remainingPlanBlockers.some(row => row.reason === 'missing-reference'));
  }
  const revoked = resolve({ revocations: [{ receiptId: 'r1', revokedAt: '2026-10-06T00:00:00Z' }] });
  assert.ok(reasonsOf(revoked).includes('revoked-receipt'));
  assert.equal(resolve({ revocations: [{ receiptId: 'r1', revokedAt: '2026-10-20T00:00:00Z' }] }).rows[0].status, 'locked');
});

test('missing receipts, bindings and stale or unknown profiles block', () => {
  assert.deepEqual(reasonsOf(resolve({ receipts: [] })), ['missing-receipt']);
  assert.deepEqual(reasonsOf(resolve({ bindings: [] })), ['missing-binding']);
  assert.deepEqual(reasonsOf(resolve({ bindings: [{ ...binding, targetProfileDigest: 'other-profile' }] })), ['binding-profile-mismatch']);
  assert.deepEqual(reasonsOf(resolve({ bindings: [binding, { ...binding, reference: 'secret-ref:synthetic/second' }] })), ['ambiguous-binding']);
  assert.deepEqual(reasonsOf(resolve({ receipts: [receipt({ requiredBindings: undefined })] })), ['unknown-required-bindings']);
  assert.throws(() => resolve({ bindings: [{ ...binding, value: 'raw-secret' }] }), /references only/);
  const stale = resolve({ targetProfile: { ...targetProfile, digest: 'new-profile' }, receipts: [receipt({ targetProfileDigest: 'new-profile' })], bindings: [{ ...binding, targetProfileDigest: 'new-profile' }] });
  assert.ok(stale.blockers.some(row => row.reason === 'stale-target-profile'));
  assert.ok(resolve({ targetProfile: { ...targetProfile, platformVersion: undefined } }).blockers.some(row => row.reason === 'unknown-target-profile'));
  const unbound = resolve({ plan: plan([missingPaid()], { importUnits: [] }) });
  assert.ok(unbound.blockers.some(row => row.reason === 'unbound-plan-target-profile'));
  assert.throws(() => resolve({ now: undefined }), /evaluation time/);
  assert.throws(() => resolve({ receipts: [receipt(), receipt()] }), /unique/);
});

test('duplicate providers and unknown provider identity never choose a winner', () => {
  const second = receipt({ id: 'r2', provider: { code: 'other-module', version: '2.1' } });
  assert.deepEqual(reasonsOf(resolve({ receipts: [receipt(), second] })), ['duplicate-provider']);
  const ambiguous = plan([{ ...missingPaid(), candidates: [{ code: 'vendor-module', version: '2.1', paid: true }, { code: 'other-module', version: '2.1', paid: true }] }]);
  assert.deepEqual(reasonsOf(resolve({ plan: ambiguous })), ['ambiguous-provider']);
  assert.deepEqual(reasonsOf(resolve({ plan: plan([missingPaid(null)]) })), ['unknown-required-provider']);
  assert.deepEqual(reasonsOf(resolve({ plan: plan([missingPaid({ code: 'vendor-module', version: null, paid: true })]) })), ['unknown-required-version']);
  // The same reference captured in two Solutions is a planner duplicate provider.
  const captured = { ...declaration('ext'), status: 'component-source-present', candidates: [] };
  const duplicate = planReleaseScope({ request: { kind: 'solution', solution: 'S' },
    artifacts: [capture([captured]), capture([], [component('ext', 'vendor')], 'P1'), capture([], [component('ext', 'vendor')], 'P2')], importUnits: [unit('A')] });
  assert.deepEqual(reasonsOf(resolve({ plan: duplicate })), ['duplicate-provider']);
});

test('readable paid bytes, catalog membership and paid=false never establish entitlement or activation', () => {
  // Readable paid source: the captured component exists, but the licence is unverified.
  const readable = planReleaseScope({ request: { kind: 'solution', solution: 'S' },
    artifacts: [capture([{ ...declaration('ext'), status: 'component-source-present', candidates: [{ code: 'vendor-module', version: '2.1', paid: true }] }],
      [component('A'), component('ext', 'vendor')])], importUnits: [unit('A'), unit('ext', 'vendor')] });
  assert.ok(readable.blockers.some(row => row.reason === 'unverified-licensed-prerequisite'));
  for (const receipts of [[], [receipt({ status: 'assertion' })], [receipt({ entitlement: { status: 'catalog-member' }, activation: undefined })]]) {
    const result = resolve({ plan: readable, receipts });
    assert.equal(result.rows[0].status, 'blocked');
    assert.ok(result.remainingPlanBlockers.some(row => row.reason === 'unverified-licensed-prerequisite'));
  }
  assert.equal(resolve({ plan: readable }).remainingPlanBlockers.some(row => row.reason === 'unverified-licensed-prerequisite'), false);
  // paid=false is still a missing provider requiring verified receipt evidence.
  const free = plan([missingPaid({ code: 'vendor-module', version: '2.1', paid: false })]);
  assert.deepEqual(reasonsOf(resolve({ plan: free, receipts: [] })), ['missing-receipt']);
  const result = resolve({ plan: free, receipts: [receipt({ entitlement: undefined, activation: undefined })] });
  assert.deepEqual(reasonsOf(result), ['unverified-activation', 'unverified-entitlement']);
});

test('official distribution requires authorization, intact official bytes and an exact artifact digest', () => {
  const dist = (patch = {}) => receipt({ kind: 'official-distribution', activation: undefined,
    distribution: { official: true, intact: true, artifactDigest: 'sha-vendor', authorization: { status: 'authorized', evidenceRef: 'synthetic-authorization' }, ...patch } });
  const artifact = { code: 'vendor-module', version: '2.1', sha256: 'sha-vendor' };
  const ok = resolve({ receipts: [dist()], distributionArtifacts: [artifact] });
  assert.deepEqual(ok.locks.map(row => [row.path, row.artifactDigest, row.activation, row.evidence]), [['official-distribution', 'sha-vendor', 'pending-installation', 'synthetic']]);
  assert.deepEqual(reasonsOf(resolve({ receipts: [dist()] })), ['missing-distribution-artifact']);
  assert.deepEqual(reasonsOf(resolve({ receipts: [dist()], distributionArtifacts: [{ ...artifact, sha256: 'patched' }] })), ['distribution-digest-mismatch']);
  assert.deepEqual(reasonsOf(resolve({ receipts: [dist()], distributionArtifacts: [artifact, { ...artifact, sha256: 'other' }] })), ['ambiguous-distribution-artifact']);
  assert.deepEqual(reasonsOf(resolve({ receipts: [dist({ intact: false })], distributionArtifacts: [artifact] })), ['unverified-distribution-integrity']);
  assert.deepEqual(reasonsOf(resolve({ receipts: [dist({ authorization: { status: 'requested' } })], distributionArtifacts: [artifact] })), ['unauthorized-distribution']);
});

test('output is deterministic under input reordering and leaves inputs untouched', () => {
  const rows = [missingPaid(), { ...missingPaid({ code: 'other-module', version: '1', paid: null }), targetCode: 'second' }];
  const second = receipt({ id: 'r0', provider: { code: 'other-module', version: '1' }, provides: [{ service: 'widgets', namespace: 'vendor', code: 'second' }], requiredBindings: [] });
  const receipts = [receipt(), second], snapshot = JSON.stringify(receipts);
  const a = resolve({ plan: plan(rows), receipts }), b = resolve({ plan: plan([...rows].reverse()), receipts: [...receipts].reverse() });
  assert.deepEqual(a, b);
  assert.equal(a.locks.length, 2);
  assert.equal(JSON.stringify(receipts), snapshot);
});

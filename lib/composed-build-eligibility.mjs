import { adaptNativeCoverage, isNativeCoverageResult } from './native-coverage-adapter.mjs';
import { isDependencyResolution, planDigest, resolveDependencyEvidence, NATIVE_RECEIPT_CONTRACTS } from './dependency-resolver.mjs';
import { observedTargetProfileReport } from './native-materialization-bridge.mjs';
import { RECEIPT_MAX_AGE_MS, wikiTargetProfile } from './elma365-native-contracts.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nonempty = value => typeof value === 'string' && value.length > 0;
const time = value => nonempty(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const sorted = values => [...values].sort((a, b) => compare(canonical(a), canonical(b)));

/** Gates a composed build must pass, in the order the composer shows them. */
export const BUILD_GATES = Object.freeze(['scope', 'coverage', 'dependencies', 'target-profile', 'materialization']);
// An observed Target profile is current for as long as a receipt observed with it
// (elma365-dependency-receipt@1 expiry semantics: at most one day).
export const TARGET_PROFILE_MAX_AGE_MS = RECEIPT_MAX_AGE_MS;

// Planner and resolver reasons belong to the gate that owns the evidence they name.
// Everything else the planner reports is release-scope accounting.
const DEPENDENCY_REASONS = new Set(['missing-reference', 'ambiguous-reference', 'unverified-licensed-prerequisite', 'unknown-reference-identity', 'unknown-reference-source']);
const COVERAGE_REASONS = new Set(['unknown-native-import-unit', 'ambiguous-native-import-unit', 'unsupported-native-import-unit', 'invalid-native-unit-coverage',
  'stale-native-unit-coverage', 'native-import-unit-cycle']);
const TARGET_REASONS = new Set(['unknown-target-precondition', 'inconsistent-target-profile', 'unknown-target-profile', 'unobserved-target-profile',
  'unbound-plan-target-profile', 'stale-target-profile', 'stale-native-profile', 'stale-target-baseline', 'unproven-target-preservation']);
const gateOf = (reason, fallback) => DEPENDENCY_REASONS.has(reason) ? 'dependencies' : COVERAGE_REASONS.has(reason) ? 'coverage'
  : TARGET_REASONS.has(reason) ? 'target-profile' : fallback;

/** Build eligibility for one composed configuration (#94 MR-04/MR-05). Pure apart from
 * reading in-process provenance marks: it combines
 * - the release scope plan and native coverage, accepted only as produced by adaptNativeCoverage;
 * - dependency locks, accepted only as produced by resolveDependencyEvidence for that exact plan;
 * - the Target profile, accepted only as an admitted bridge observation;
 * - native materialization availability as the server reports it.
 * A build is eligible only when every gate is verified. Missing, unknown, synthetic or
 * unverified evidence blocks with a named reason; nothing is inferred or forged here.
 */
export function composedBuildEligibility({ coverage = null, dependencies = null, observation = null, materialization = null, now } = {}) {
  const at = time(now);
  if (at === null) throw Error('Explicit evaluation time is required');
  const reasons = new Map(BUILD_GATES.map(id => [id, new Map()])), unknown = new Set();
  const add = (gate, row) => reasons.get(gate).set(canonical(row), row);

  // Scope and native coverage: one adapter result carries the plan and the adapter's own blockers.
  const genuineCoverage = isNativeCoverageResult(coverage);
  if (!genuineCoverage) {
    const reason = coverage == null ? 'missing-native-coverage' : 'unverified-native-coverage';
    for (const gate of ['scope', 'coverage']) { add(gate, { reason }); unknown.add(gate); }
  }
  const plan = genuineCoverage ? coverage.plan : null;
  const genuineDependencies = isDependencyResolution(dependencies);
  const boundDependencies = genuineDependencies && !!plan && dependencies.planDigest === planDigest(plan);
  // Planner blockers a bound resolution locked (missing or licensed prerequisites) are gone;
  // every other planner blocker stays with the gate that owns it.
  for (const row of plan ? boundDependencies ? dependencies.remainingPlanBlockers : plan.blockers : []) add(gateOf(row.reason, 'scope'), row);
  if (genuineCoverage) {
    for (const row of coverage.adapterBlockers) add(gateOf(row.reason, 'coverage'), row);
    if (coverage.evidenceBasis !== 'native') add('coverage', { reason: coverage.evidenceBasis === 'synthetic' ? 'synthetic-evidence-only' : 'unknown-native-coverage' });
    // Native facts Wiki cannot observe (import receipts, installation, global handlers) stay missing until observed.
    for (const row of coverage.nativeEvidence.missing) add('coverage', { reason: 'missing-native-evidence', ...row });
    if (!coverage.nativeEvidence.complete && !coverage.nativeEvidence.missing.length) add('coverage', { reason: 'missing-native-evidence' });
  }

  // Dependency locks: only a resolution of exactly this plan, under a native receipt contract.
  if (!genuineDependencies) { add('dependencies', { reason: dependencies == null ? 'missing-dependency-resolution' : 'unverified-dependency-resolution' }); unknown.add('dependencies'); }
  else {
    if (plan && !boundDependencies) add('dependencies', { reason: 'stale-dependency-resolution' });
    for (const row of dependencies.blockers) add(gateOf(row.reason, 'dependencies'), row);
    if (dependencies.evidenceBasis !== 'native-receipt' && !dependencies.blockers.some(row => row.reason === 'synthetic-evidence-only'))
      add('dependencies', { reason: dependencies.evidenceBasis === 'synthetic' ? 'synthetic-evidence-only' : 'unknown-dependency-evidence' });
  }

  // Target profile: an admitted read-only bridge observation, current, and the one every input was planned for.
  const report = observedTargetProfileReport(observation), profile = report ? wikiTargetProfile(report) : null;
  if (!profile) { add('target-profile', { reason: 'unobserved-target-profile' }); unknown.add('target-profile'); }
  else {
    const observedAt = time(report.observedAt);
    if (observedAt === null || observedAt > at) add('target-profile', { reason: 'unknown-observation-time' });
    else if (at - observedAt > TARGET_PROFILE_MAX_AGE_MS) add('target-profile', { reason: 'stale-target-profile-observation', observedAt: report.observedAt });
    const planned = [...new Set((plan?.targetPreconditions ?? []).map(row => row.targetProfileDigest))].sort(compare);
    if (plan && planned.some(digest => digest !== profile.digest)) add('target-profile', { reason: 'stale-coverage-profile', planProfiles: planned });
    if (genuineDependencies && dependencies.targetProfile?.digest !== profile.digest) add('target-profile', { reason: 'stale-dependency-profile' });
  }

  // Native materialization as the server reports it; an unreported capability is unknown, never available.
  if (materialization?.available !== true) {
    add('materialization', { reason: nonempty(materialization?.reason) ? materialization.reason : 'native-materialization-unknown',
      missing: Array.isArray(materialization?.missing) ? [...materialization.missing].sort(compare) : [] });
    if (!materialization) unknown.add('materialization');
  }

  const gates = BUILD_GATES.map(id => {
    const rows = sorted(reasons.get(id).values());
    return { id, status: !rows.length ? 'verified' : unknown.has(id) ? 'unknown' : 'blocked', reasons: rows };
  });
  return freeze({ schemaVersion: 1, evaluatedAt: new Date(at).toISOString(), eligible: gates.every(row => row.status === 'verified'), gates,
    evidence: { coverage: genuineCoverage ? coverage.evidenceBasis : 'unknown', dependencies: genuineDependencies ? dependencies.evidenceBasis : 'unknown',
      targetProfile: profile ? 'observed' : 'unknown' },
    targetProfile: profile ? { targetId: profile.targetId, environment: profile.environment, digest: profile.digest, platformVersion: profile.platformVersion } : null,
    planDigest: plan ? planDigest(plan) : null, publicationReady: false, executionEnabled: false });
}

/** Eligibility of a Solution's composed build from what the service holds today: its
 * accepted full capture, any pinned native coverage declarations and an admitted Target
 * profile observation. The service has no declaration source and requests no observation
 * (only the P8 operator path may), so both default to none and the gates stay blocked
 * with their reasons. Nothing here calls a bridge, a provider or ELMA.
 */
export function solutionBuildEligibility({ capture, declarations = [], observation = null, changes = [], materialization = null, receiptContract, now } = {}) {
  if (!nonempty(capture?.solution)) throw Error('The Solution\'s accepted full capture is required');
  const coverage = adaptNativeCoverage({ request: { kind: 'solution', solution: capture.solution }, artifacts: [capture], declarations, changes,
    targetProfile: wikiTargetProfile(observedTargetProfileReport(observation) ?? {}) });
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, receiptContract: receiptContract ?? NATIVE_RECEIPT_CONTRACTS[0], observation, now });
  return composedBuildEligibility({ coverage, dependencies, observation, materialization, now });
}

import { configuredTargetProfileObserver, observedTargetProfileReport } from './native-materialization-bridge.mjs';
import { adaptNativeCoverage } from './native-coverage-adapter.mjs';
import { wikiTargetProfile } from './elma365-native-contracts.mjs';
import { configuredBuildEvidenceSource, admittedBuildEvidence, BUILD_EVIDENCE_MAX_AGE_MS } from './native-build-evidence.mjs';

// Explicit operator Target profile refresh (#94 MR-05, P8). The only path that runs the bridge's
// read-only `targetProfile` job: an authenticated request of the configured bridge owner, for the
// configured designated Target, bound to one Solution's current capture/review/merge state. Admitted
// observations stay in this process only, keyed by Solution and bound to that state; a read never
// observes, a restart forgets them and a copy is never evidence (observedTargetProfileReport).
// After an admitted observation the same refresh asks the same worker for native build evidence
// (`buildEvidence`, elma365-native-build-evidence@1) for the server-derived build inputs; it is held
// with the observation, under the same binding, and is evidence only while admitted and fresh.

/** Targets on which an operator may request a profile observation. */
export const OBSERVATION_TARGETS = Object.freeze(['dev2']);
export const REFRESH_OUTCOMES = Object.freeze(['observed', 'unavailable', 'invalid', 'unknown', 'stale']);
export const BUILD_EVIDENCE_OUTCOMES = Object.freeze(['produced', 'unavailable', 'invalid', 'unknown', 'not-requested']);

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const nonempty = value => typeof value === 'string' && value.length > 0;
const evidenceSummary = row => row ? { outcome: row.outcome, at: row.at, reason: row.reason ?? null, errors: row.errors ?? [], missing: row.missing ?? [],
  issuedAt: row.evidence?.issuedAt ?? null, compilerServices: row.evidence ? [...row.evidence.compilerServices] : [] } : null;
const summary = observation => {
  const report = observedTargetProfileReport(observation), profile = report ? wikiTargetProfile(report) : null;
  return profile ? { targetId: profile.targetId, digest: profile.digest, platformVersion: profile.platformVersion, observedAt: report.observedAt } : null;
};

/** Receipt requirements of a capture: each non-global prerequisite with exactly one catalog provider.
 * Derived only from the accepted capture's plan; a caller never supplies them. */
export function observationRequirements(capture) {
  const { plan } = adaptNativeCoverage({ request: { kind: 'solution', solution: capture.solution }, artifacts: [capture] });
  const rows = new Map();
  for (const row of plan.prerequisites) {
    const candidates = row.candidates || [];
    if (nonempty(row.domain) || candidates.length !== 1 || !nonempty(candidates[0].code)) continue;
    const requirement = { service: row.service, namespace: row.namespace, code: row.code,
      provider: { code: candidates[0].code, version: candidates[0].version ?? null } };
    rows.set(canonical(requirement), requirement);
  }
  return [...rows.entries()].sort(([a], [b]) => compare(a, b)).map(([, row]) => row);
}

/** The service's refresh owner. `env` is the native materialization configuration
 * (WIKI_NATIVE_MATERIALIZATION_*, WIKI_NATIVE_TARGET_PROFILE_*); `bridges` the server's bridge store. */
export function targetProfileRefresh({ env = {}, bridges, log, now = () => new Date().toISOString() } = {}) {
  const observer = configuredTargetProfileObserver({ env, bridges, ...(log ? { log } : {}) });
  const evidenceSource = observer ? configuredBuildEvidenceSource({ env, bridges, ...(log ? { log } : {}) }) : null;
  const owner = observer ? env.WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER : null;
  const designated = !!observer && OBSERVATION_TARGETS.includes(observer.target);
  const entries = new Map(), running = new Set();
  const capability = () => !observer ? { configured: false, reason: 'target-profile-observation-unconfigured', target: null }
    : !designated ? { configured: false, reason: 'target-not-designated', target: observer.target } : { configured: true, reason: null, target: observer.target };

  /** The admitted observation for exactly this binding, or null. Its age is judged by the eligibility gate. */
  const current = (solutionId, binding) => {
    const entry = entries.get(solutionId);
    return entry?.observation && designated && canonical(entry.binding) === canonical(binding) && observedTargetProfileReport(entry.observation) ? entry.observation : null;
  };

  /** The admitted native build evidence held with that observation for exactly this binding, or null.
   * Its bindings to the build inputs and its freshness are checked where it is used (currentBuildEvidence). */
  const evidence = (solutionId, binding) => {
    const held = entries.get(solutionId)?.buildEvidence?.evidence ?? null;
    return current(solutionId, binding) && admittedBuildEvidence(held) ? held : null;
  };

  /** Read-only state for the composer; never observes. */
  const status = (solutionId, binding, actor) => {
    const entry = entries.get(solutionId), held = entry?.observation ?? null, built = entry?.buildEvidence ?? null;
    const usable = evidence(solutionId, binding), age = usable ? Date.parse(now()) - Date.parse(usable.issuedAt) : null;
    return { ...capability(), operator: designated && nonempty(owner) && actor?.id === owner, inProgress: running.has(solutionId),
      current: !!current(solutionId, binding), staleInputs: !!held && canonical(entry.binding) !== canonical(binding),
      last: entry ? { outcome: entry.outcome, at: entry.at, reason: entry.reason ?? null, errors: entry.errors ?? [], targetProfile: summary(held) } : null,
      // Native build evidence (coverage declaration and compiler lock) requested with the last observation.
      buildEvidence: { configured: !!evidenceSource && designated, current: age !== null && age <= BUILD_EVIDENCE_MAX_AGE_MS,
        expired: age !== null && age > BUILD_EVIDENCE_MAX_AGE_MS, last: evidenceSummary(built) } };
  };

  /** One explicit observation. `load()` returns the Solution's build inputs `{revision, capture, binding,
   * changes, blockers}` (capture null without an accepted full capture). Returns `{statusCode, body}`. */
  async function refresh({ solutionId, input, actor, load }) {
    const reply = (statusCode, body, binding = null) => ({ statusCode, body, binding });
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'expectedRevision') || !Number.isInteger(input.expectedRevision))
      return reply(400, { outcome: 'refused', reason: 'invalid-request', error: 'Invalid Target profile refresh request' });
    const cap = capability();
    if (!cap.configured) return reply(409, { outcome: 'unavailable', reason: cap.reason });
    // Shared content access is not bridge control: only the configured bridge owner observes.
    if (!nonempty(owner) || actor?.id !== owner) return reply(403, { outcome: 'refused', reason: 'operator-only' });
    if (running.has(solutionId)) return reply(409, { outcome: 'in-progress', reason: 'target-profile-refresh-in-progress' });
    running.add(solutionId);
    let outcome;
    try { outcome = await observeOnce(solutionId, input, actor, load, reply); }
    finally { running.delete(solutionId); }
    // The refreshed composer state accompanies every completed attempt.
    return outcome.binding ? reply(outcome.statusCode, { ...outcome.body, targetProfileRefresh: status(solutionId, outcome.binding, actor) }) : outcome;
  }

  // Observes once for the binding loaded now; `binding` names the state the reply describes.
  async function observeOnce(solutionId, input, actor, load, reply) {
    const before = await load();
    if (!before.capture) return reply(409, { outcome: 'refused', reason: 'no-accepted-capture' });
    if (before.revision !== input.expectedRevision) return reply(409, { outcome: 'stale', reason: 'stale-solution-revision' });
    const record = (outcome, extra = {}) => entries.set(solutionId, { outcome, at: now(), binding: before.binding, observation: null, ...extra });
    let result;
    try { result = await observer.observe({ requirements: observationRequirements(before.capture) }); }
    catch (error) {
      if (error?.code === 'NATIVE_OUTCOME_UNKNOWN') { record('unknown', { reason: error.detail || 'native-outcome-unknown' }); return reply(502, { outcome: 'unknown', reason: error.detail || 'native-outcome-unknown' }, before.binding); }
      if (!error?.statusCode) throw error;
      record('unavailable', { reason: 'target-profile-bridge-failed' });
      return reply(409, { outcome: 'unavailable', reason: 'target-profile-bridge-failed' }, before.binding);
    }
    const built = result.status === 'observed' ? await requestEvidence(before, result.observation) : null;
    // Inputs that moved while the worker observed make the observation stale; it is never admitted.
    const after = await load();
    if (canonical(after.binding) !== canonical(before.binding)) {
      record('stale', { reason: 'stale-solution-binding' });
      return reply(409, { outcome: 'stale', reason: 'stale-solution-binding' }, after.binding);
    }
    if (result.status === 'observed') {
      entries.set(solutionId, { outcome: 'observed', at: now(), binding: before.binding, observation: result.observation, actor: actor.id, buildEvidence: built });
      return reply(201, { outcome: 'observed', targetProfile: summary(result.observation), buildEvidence: evidenceSummary(built) }, before.binding);
    }
    if (result.status === 'invalid') {
      record('invalid', { errors: [...result.errors] });
      return reply(422, { outcome: 'invalid', errors: [...result.errors] }, before.binding);
    }
    record('unavailable', { reason: result.reason || 'target-profile-unavailable' });
    return reply(409, { outcome: 'unavailable', reason: result.reason || 'target-profile-unavailable' }, before.binding);
  }

  // Native build evidence for the inputs loaded with the observation. A failure is recorded with its
  // reason; it never affects the admitted profile and is never replayed.
  async function requestEvidence(inputs, observation) {
    const row = (outcome, extra = {}) => ({ outcome, at: now(), evidence: null, ...extra });
    if (!evidenceSource) return null;
    if (inputs.blockers?.length) return row('not-requested', { reason: 'unbuildable-inputs', errors: [...new Set(inputs.blockers.map(item => item.reason))].sort(compare) });
    let answer;
    try { answer = await evidenceSource.request({ captures: [inputs.capture], changes: inputs.changes ?? [], observation }); }
    catch (error) {
      if (error?.code === 'NATIVE_OUTCOME_UNKNOWN') return row('unknown', { reason: error.detail || 'native-outcome-unknown' });
      if (!error?.statusCode) throw error;
      return row('unavailable', { reason: 'build-evidence-bridge-failed' });
    }
    if (answer.status === 'produced') return row('produced', { evidence: answer.evidence, missing: [...answer.evidence.missing] });
    if (answer.status === 'invalid') return row('invalid', { errors: [...answer.errors] });
    return row('unavailable', { reason: answer.reason, errors: answer.errors ? [...answer.errors] : [], missing: answer.missing ? [...answer.missing] : [] });
  }

  return Object.freeze({ capability, current, evidence, status, refresh, configured: designated, nativeRevision: evidenceSource?.nativeRevision ?? null });
}

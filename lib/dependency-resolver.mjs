import crypto from 'node:crypto';

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
const refKey = row => canonical([row.service, row.namespace, row.code]);
const BINDING_KINDS = ['secret-reference', 'environment'];

/** Native receipt contracts whose provenance, expiry and compatibility semantics
 * are pinned by the native adapter (elma365#60). None is published yet, so every
 * non-synthetic resolution is unknown. Callers cannot register a contract here.
 */
export const NATIVE_RECEIPT_CONTRACTS = Object.freeze([]);
/** Test-only contract. Receipts under it are accounting fixtures, never release evidence. */
export const SYNTHETIC_RECEIPT_CONTRACT = Object.freeze({ id: 'wiki-synthetic-dependency-receipt', version: 1, synthetic: true,
  semantics: Object.freeze({ provenance: 'synthetic', expiry: 'synthetic', compatibility: 'synthetic' }) });

const contractFor = ref => [...NATIVE_RECEIPT_CONTRACTS, SYNTHETIC_RECEIPT_CONTRACT]
  .find(row => row.id === ref?.id && row.version === ref?.version && ['provenance', 'expiry', 'compatibility'].every(key => nonempty(row.semantics?.[key]))) || null;

/** Content digest binding a resolution to the exact planner output it consumed. */
export const planDigest = plan => crypto.createHash('sha256').update(canonical(plan)).digest('hex');

// Each failed check is a named reason; a receipt is usable only with none.
function receiptFailures(receipt, { prerequisite, provider, profile, contract, revoked, artifacts, now }) {
  const fail = [];
  if (receipt.contract?.id !== contract.id || receipt.contract?.version !== contract.version) fail.push('receipt-contract-mismatch');
  if (receipt.status === 'revoked' || revoked.has(receipt.id)) fail.push('revoked-receipt');
  else if (receipt.status !== 'verified' || receipt.provenance?.source !== 'native-adapter' || !nonempty(receipt.provenance?.adapter) || !nonempty(receipt.provenance?.evidenceRef))
    fail.push('assertion-only-receipt');
  if (receipt.provider?.code !== provider.code) fail.push('provider-mismatch');
  if (!nonempty(provider.version)) fail.push('unknown-required-version');
  else if (receipt.provider?.version !== provider.version) fail.push('version-mismatch');
  if (receipt.targetProfileDigest !== profile.digest) fail.push('target-profile-mismatch');
  if (receipt.targetId !== profile.targetId || receipt.environment !== profile.environment) fail.push('target-environment-mismatch');
  const verifiedAt = time(receipt.verifiedAt), expiresAt = time(receipt.expiresAt);
  if (verifiedAt === null || verifiedAt > now) fail.push('unknown-receipt-verification-time');
  else if (time(profile.changedAt) === null || verifiedAt < time(profile.changedAt)) fail.push('stale-receipt');
  if (expiresAt === null) fail.push('unknown-receipt-expiry');
  else if (expiresAt <= now) fail.push('expired-receipt');
  if (receipt.compatibility?.status === 'incompatible') fail.push('incompatible-receipt');
  else if (receipt.compatibility?.status !== 'compatible' || !nonempty(receipt.compatibility?.evidenceRef)) fail.push('unknown-compatibility');
  else if (receipt.compatibility.platformVersion !== profile.platformVersion) fail.push('platform-version-mismatch');
  // paid=false, catalog membership and readable bytes are not entitlement.
  if (receipt.entitlement?.status !== 'verified' || !nonempty(receipt.entitlement?.evidenceRef)) fail.push('unverified-entitlement');
  if (receipt.kind === 'licensed-preinstallation') {
    if (receipt.activation?.status !== 'verified' || !nonempty(receipt.activation?.evidenceRef)) fail.push('unverified-activation');
  } else if (receipt.kind === 'official-distribution') {
    const dist = receipt.distribution || {};
    if (dist.official !== true || dist.intact !== true) fail.push('unverified-distribution-integrity');
    if (dist.authorization?.status !== 'authorized' || !nonempty(dist.authorization?.evidenceRef)) fail.push('unauthorized-distribution');
    const held = artifacts.filter(row => row.code === provider.code && row.version === provider.version);
    if (!nonempty(dist.artifactDigest) || !held.length) fail.push('missing-distribution-artifact');
    else if (held.length > 1) fail.push('ambiguous-distribution-artifact');
    else if (held[0].sha256 !== dist.artifactDigest) fail.push('distribution-digest-mismatch');
  } else fail.push('unknown-receipt-kind');
  if (!Array.isArray(receipt.provides) || !receipt.provides.some(row => refKey(row) === refKey(prerequisite))) fail.push('reference-not-provided');
  return fail;
}

/** Pure evidence accounting over a planReleaseScope result. It resolves required
 * dependency prerequisites only through exact compatible verified preinstallation
 * receipts or authorized intact official distribution, never through catalog
 * flags or readable bytes. It performs no IO, provider call or installation.
 */
export function resolveDependencyEvidence({ plan, targetProfile, receiptContract = null, receipts = [], revocations = [], bindings = [], distributionArtifacts = [], now } = {}) {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.prerequisites) || !Array.isArray(plan.blockers)) throw Error('Release scope plan is required');
  for (const rows of [receipts, revocations, bindings, distributionArtifacts]) if (!Array.isArray(rows)) throw Error('Resolver inventories must be arrays');
  const at = time(now);
  if (at === null) throw Error('Explicit evaluation time is required');
  if (new Set(receipts.map(row => row?.id)).size !== receipts.length || receipts.some(row => !nonempty(row?.id))) throw Error('Receipt ids must be unique');
  for (const row of bindings) {
    if (!row || Object.keys(row).some(key => !['name', 'kind', 'reference', 'targetProfileDigest'].includes(key)) || !nonempty(row.name) || !BINDING_KINDS.includes(row.kind) || !nonempty(row.reference))
      throw Error('Bindings carry names and references only');
  }
  const blockers = new Map(), block = row => blockers.set(canonical(row), row);
  const profile = { targetId: targetProfile?.targetId, environment: targetProfile?.environment, digest: targetProfile?.digest,
    platformVersion: targetProfile?.platformVersion, changedAt: targetProfile?.changedAt };
  if (!['targetId', 'environment', 'digest', 'platformVersion'].every(key => nonempty(profile[key])) || time(profile.changedAt) === null) block({ reason: 'unknown-target-profile' });
  const planProfiles = new Set((plan.targetPreconditions || []).map(row => row.targetProfileDigest));
  if (!planProfiles.size) block({ reason: 'unbound-plan-target-profile' });
  else if (planProfiles.size > 1 || !planProfiles.has(profile.digest)) block({ reason: 'stale-target-profile', planProfiles: [...planProfiles].sort(compare) });
  const contract = contractFor(receiptContract);
  if (!contract) block({ reason: 'native-receipt-contract-unavailable', contract: receiptContract ? { id: receiptContract.id ?? null, version: receiptContract.version ?? null } : null });
  else if (contract.synthetic) block({ reason: 'synthetic-evidence-only' });
  const revoked = new Set(revocations.filter(row => time(row?.revokedAt) !== null && time(row.revokedAt) <= at).map(row => row.receiptId));
  const planReasons = new Map(plan.blockers.map(row => [canonical({ ...row, reason: undefined }), row.reason]));
  const rows = [], locks = [], satisfied = new Set();
  for (const prerequisite of sorted(plan.prerequisites.filter(row => !nonempty(row.domain)))) {
    const ref = { from: prerequisite.from, service: prerequisite.service, namespace: prerequisite.namespace, code: prerequisite.code };
    const planReason = planReasons.get(canonical(prerequisite));
    const result = reasons => { rows.push({ ...ref, prerequisiteStatus: prerequisite.status, status: reasons ? contract ? 'blocked' : 'unknown' : 'locked', reasons: reasons || [] });
      if (reasons) block({ reason: 'unresolved-dependency', ...ref, details: reasons }); };
    // A dependency captured in several Solutions has no single provider to lock.
    if (planReason === 'ambiguous-reference') { result(['duplicate-provider']); continue; }
    if (!contract) { result(['native-receipt-contract-unavailable']); continue; }
    const candidates = prerequisite.candidates || [];
    if (candidates.length !== 1 || !nonempty(candidates[0].code)) { result([candidates.length ? 'ambiguous-provider' : 'unknown-required-provider']); continue; }
    const provider = { code: candidates[0].code, version: candidates[0].version ?? null };
    const matching = receipts.filter(receipt => Array.isArray(receipt.provides) && receipt.provides.some(row => refKey(row) === refKey(ref)))
      .sort((a, b) => compare(a.id, b.id));
    if (!matching.length) { result(['missing-receipt']); continue; }
    const evaluated = matching.map(receipt => ({ receipt, failures: receiptFailures(receipt, { prerequisite: ref, provider, profile, contract, revoked, artifacts: distributionArtifacts, now: at }) }));
    const usable = evaluated.filter(row => !row.failures.length);
    const verifiedProviders = new Set(matching.filter(receipt => receipt.status === 'verified' && !revoked.has(receipt.id)).map(receipt => receipt.provider?.code));
    if (verifiedProviders.size > 1) { result(['duplicate-provider']); continue; }
    if (!usable.length) { result([...new Set(evaluated.flatMap(row => row.failures))].sort(compare)); continue; }
    const { receipt } = usable[0], missing = [];
    const names = Array.isArray(receipt.requiredBindings) ? receipt.requiredBindings : null;
    if (!names) missing.push('unknown-required-bindings');
    for (const need of names || []) {
      const found = bindings.filter(row => row.name === need?.name && row.kind === need?.kind);
      if (!found.length) missing.push('missing-binding');
      else if (found.length > 1) missing.push('ambiguous-binding');
      else if (found[0].targetProfileDigest !== profile.digest) missing.push('binding-profile-mismatch');
    }
    if (missing.length) { result([...new Set(missing)].sort(compare)); continue; }
    result(null); satisfied.add(canonical(prerequisite));
    locks.push({ ...ref, provider, path: receipt.kind, receiptId: receipt.id, evidenceRef: receipt.provenance.evidenceRef,
      ...(receipt.kind === 'official-distribution' ? { artifactDigest: receipt.distribution.artifactDigest, activation: 'pending-installation' } : { activation: 'verified-preinstalled' }),
      targetProfileDigest: profile.digest, bindings: sorted(names.map(need => ({ name: need.name, kind: need.kind }))),
      evidence: contract.synthetic ? 'synthetic' : 'native-receipt' });
  }
  const remainingPlanBlockers = sorted(plan.blockers.filter(row => !(['missing-reference', 'unverified-licensed-prerequisite'].includes(row.reason) &&
    satisfied.has(canonical({ ...row, reason: undefined })))));
  return freeze({ schemaVersion: 1, planDigest: planDigest(plan),
    receiptContract: contract ? { id: contract.id, version: contract.version, synthetic: contract.synthetic === true } : null,
    evidenceBasis: !contract ? 'unknown' : contract.synthetic ? 'synthetic' : 'native-receipt',
    targetProfile: { targetId: profile.targetId ?? null, environment: profile.environment ?? null, digest: profile.digest ?? null },
    evaluatedAt: new Date(at).toISOString(), rows: sorted(rows), locks: sorted(locks), blockers: sorted(blockers.values()), remainingPlanBlockers,
    resolutionComplete: blockers.size === 0, publicationReady: false, executionEnabled: false,
    limitations: ['Receipts are accounting inputs; actual entitlement, activation and dependency behaviour require native matching-profile evidence.',
      'Binding rows are references only; secret values never enter this record.', 'No purchase, licence provisioning, installation or provider call is performed.'] });
}

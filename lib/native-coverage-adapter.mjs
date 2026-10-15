import { planReleaseScope } from './release-scope-planner.mjs';
import { COVERAGE_CONTRACT, COVERAGE_SOURCE, COVERAGE_SCHEMA_INTACT, CAPABILITY_CATALOG, NATIVE_CONTRACT_SOURCE,
  validateNativeCoverageDeclaration, changesDigest } from './elma365-native-contracts.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const refId = ref => JSON.stringify([ref?.solution, ref?.key]);
const refOf = row => ({ solution: row.solution, key: row.key });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nonempty = value => typeof value === 'string' && value.length > 0;
const sorted = values => [...values].sort((a, b) => compare(canonical(a), canonical(b)));
const contractId = contract => nonempty(contract?.id) && Number.isInteger(contract?.version) ? `${contract.id}@${contract.version}` : null;

// Read-only observation of the native coverage contract this adapter consumes.
// elma365#60 publishes `elma365-native-coverage@1` (PR #103): a capability catalog
// and a per-release declaration with one import
// unit per Solution package, merged as schema revision 1.1). Membership, declaration
// schema, the per-member evidence basis and the changes binding are established; the
// facts below are not, so they stay schema-fixed empty/null and remain missing.
export const INSPECTED_NATIVE_CONTRACT = Object.freeze({
  repository: NATIVE_CONTRACT_SOURCE.repository, issue: 60, pullRequest: NATIVE_CONTRACT_SOURCE.pullRequest, merged: NATIVE_CONTRACT_SOURCE.merged,
  revision: NATIVE_CONTRACT_SOURCE.revision, contract: `${COVERAGE_CONTRACT.id}@${COVERAGE_CONTRACT.version}`, schemaRevision: COVERAGE_SOURCE.schemaRevision,
  status: COVERAGE_SCHEMA_INTACT && CAPABILITY_CATALOG ? 'partial' : 'unavailable',
  missing: Object.freeze(['application-membership', 'part-to-unit-expansion', 'global-domain-inventory', 'global-domain-executable-handlers',
    'target-preservation-policy', 'native-import-receipts'])
});
// Pinned native contracts accepted as native evidence, each with the exact elma365
// revision and vendored schema digest Wiki reviewed. Callers cannot extend it. A
// declaration under it is admitted only when the vendored schema and capability catalog
// are intact and it passes the ported elma365 validation against the exact captures.
export const NATIVE_COVERAGE_CONTRACTS = Object.freeze([
  Object.freeze({ ...COVERAGE_CONTRACT, revision: COVERAGE_SOURCE.revision, schemaSha256: COVERAGE_SOURCE.sha256 })
]);
// Results this module produced. prepareMaterializationRequest accepts coverage only from here,
// so a hand-built object claiming native or complete coverage is refused.
const RESULTS = new WeakSet();
/** True only for a result returned by adaptNativeCoverage in this process. */
export const isNativeCoverageResult = value => !!value && typeof value === 'object' && RESULTS.has(value);
export const SYNTHETIC_COVERAGE_CONTRACT = Object.freeze({ id: 'synthetic-native-coverage', version: 1 });
const SYNTHETIC_ID = contractId(SYNTHETIC_COVERAGE_CONTRACT);
const accepted = contract => contractId(contract) === SYNTHETIC_ID ? 'synthetic'
  : NATIVE_COVERAGE_CONTRACTS.some(row => contractId(row) === contractId(contract)) && COVERAGE_SCHEMA_INTACT && CAPABILITY_CATALOG ? 'native' : null;
const brand = result => { RESULTS.add(result); return result; };
const reasonsOf = verdict => [...new Set(verdict.errors.map(row => row.reason))].sort(compare);

/** Projects pinned native coverage declarations into planReleaseScope inputs and
 * keeps the native facts Wiki cannot observe separate from Wiki accounting.
 * `changes` are the E1 operations of this release ({solution, key, service, kind, op});
 * a native declaration must classify exactly as the vendored capability catalog derives
 * for them. Pure: no IO, provider calls, materialization or eligibility.
 */
export function adaptNativeCoverage({ request, artifacts = [], declarations = [], targetProfile = null, changes = [] } = {}) {
  if (!Array.isArray(artifacts) || !Array.isArray(declarations) || !Array.isArray(changes)) throw Error('Captures, native declarations and changes must be arrays');
  const blockers = new Map(), missing = new Map();
  const block = (reason, details = {}) => { const row = { reason, ...details }; blockers.set(canonical(row), row); };
  const need = (fact, details = {}) => { const row = { fact, evidence: 'unknown', ...details }; missing.set(canonical(row), row); };
  if (!nonempty(targetProfile?.digest)) block('unknown-target-profile');
  if (!declarations.length) block('native-coverage-unavailable', { contract: INSPECTED_NATIVE_CONTRACT.revision });

  const checksums = new Map();
  for (const artifact of artifacts) {
    if (!nonempty(artifact?.checksum)) block('unbound-capture', { solution: artifact?.solution ?? null });
    else checksums.set(artifact.solution, [...(checksums.get(artifact.solution) || []), artifact.checksum]);
  }
  // Admit only declarations bound to the exact supplied captures and Target profile.
  const admitted = [], bases = new Set();
  for (const [index, doc] of declarations.entries()) {
    const basis = accepted(doc?.contract), at = { declaration: index };
    if (!basis) { block('unknown-native-coverage-contract', { ...at, contract: contractId(doc?.contract) }); continue; }
    if (basis === 'native') {
      // Schema, hygiene and the elma365 semantic rules over exactly the bound captures:
      // a self-inconsistent, stale or over-claiming declaration is never admitted.
      const solutions = new Set(Array.isArray(doc.captures) ? doc.captures.map(row => row?.solution) : []);
      const verdict = validateNativeCoverageDeclaration(doc, { catalog: CAPABILITY_CATALOG, changes,
        captures: artifacts.filter(row => solutions.has(row?.solution)) });
      if (!verdict.valid) { block('invalid-native-coverage-declaration', { ...at, errors: reasonsOf(verdict) }); continue; }
    }
    // A claim proven on the synthetic fixture only is synthetic evidence, never native.
    const fixture = basis === 'native' && (doc.evidenceBasis === 'synthetic-fixture' || (doc.units || []).some(unit => unit?.evidenceBasis === 'synthetic-fixture'
      || (unit?.members || []).some(member => member?.evidenceBasis === 'synthetic-fixture')));
    if (fixture) block('synthetic-evidence-only', { ...at, evidenceBasis: 'synthetic-fixture' });
    if (!/^[0-9a-f]{40}$/.test(doc.nativeRevision ?? '') || !nonempty(doc.adapter) || !nonempty(doc.evidenceRef)) { block('unpinned-native-declaration', at); continue; }
    if (!nonempty(targetProfile?.digest) || doc.targetProfileDigest !== targetProfile.digest) { block('stale-native-profile', at); continue; }
    const bound = Array.isArray(doc.captures) ? doc.captures : [];
    const stale = bound.filter(row => (checksums.get(row?.solution) || []).length !== 1 || checksums.get(row.solution)[0] !== row.artifactChecksum);
    if (!bound.length || stale.length) { block('stale-native-capture-binding', { ...at, solutions: sorted(stale.map(row => row?.solution ?? null)) }); continue; }
    admitted.push({ doc, basis: fixture ? 'synthetic' : basis, solutions: new Set(bound.map(row => row.solution)) }); bases.add(fixture ? 'synthetic' : basis);
  }
  if (bases.has('synthetic')) block('synthetic-evidence-only');
  const covers = (entry, solution) => entry.solutions.has(solution);

  // Duplicate providers across declarations never pick a winner.
  const providers = new Map();
  const provide = (kind, id, index) => { const key = canonical([kind, id]); providers.set(key, [...(providers.get(key) || []), index]); };
  for (const [index, { doc }] of admitted.entries()) {
    for (const unit of doc.units || []) {
      provide('unit', unit?.id, index);
      for (const ref of unit?.members || []) provide('component', refId(ref), index);
    }
    for (const app of doc.applications || []) provide('application', refId({ solution: app?.solution, key: app?.id }), index);
    for (const part of doc.parts || []) provide('part', canonical([refId(part), part?.partId]), index);
    for (const domain of doc.server?.domains || []) provide('domain', domain?.domain, index);
    if (doc.server) provide('server', 'inventory', index);
  }
  for (const [key, owners] of providers) if (owners.length > 1) {
    const [kind, id] = JSON.parse(key); block('duplicate-native-provider', { kind, id });
  }

  const importUnits = [], applications = [], parts = [];
  for (const entry of admitted) {
    const { doc } = entry;
    for (const unit of doc.units || []) {
      const members = Array.isArray(unit?.members) ? unit.members : [];
      // A unit may only cover components of captures its declaration is bound to.
      if (members.some(ref => !covers(entry, ref?.solution))) block('unbound-native-unit-member', { unitId: unit?.id ?? null });
      if (Array.isArray(unit?.unsupportedMembers) && unit.unsupportedMembers.length)
        block('unsupported-native-unit-member', { unitId: unit.id, members: sorted(unit.unsupportedMembers.map(refOf)) });
      const condition = unit?.targetPrecondition;
      let targetPrecondition = condition;
      if (condition?.mode === 'existing-target') {
        // A nonempty Target needs an explicit retain-unlisted policy and the pinned baseline.
        if (condition.preservation?.policy !== 'retain-unlisted' || !nonempty(condition.preservation?.evidenceRef)) {
          block('unproven-target-preservation', { unitId: unit.id }); targetPrecondition = undefined;
        } else if (nonempty(targetProfile?.baselineDigest) && condition.requiredBaselineDigest !== targetProfile.baselineDigest) {
          block('stale-target-baseline', { unitId: unit.id }); targetPrecondition = undefined;
        }
      }
      importUnits.push({ id: unit?.id, status: unit?.status, adapter: doc.adapter, evidenceRef: unit?.evidenceRef,
        members: members.map(ref => ({ solution: ref?.solution, key: ref?.key, digest: ref?.digest })),
        ...(targetPrecondition ? { targetPrecondition: { ...targetPrecondition, targetProfileDigest: doc.targetProfileDigest } } : {}) });
      if (unit?.receipt?.status !== 'verified' || !nonempty(unit.receipt.evidenceRef)) need('native-import-receipt', { unitId: unit?.id ?? null });
    }
    for (const app of doc.applications || []) applications.push({ solution: app?.solution, id: app?.id, coverage: app?.coverage, evidenceRef: app?.evidenceRef,
      members: (app?.members || []).map(refOf) });
    for (const part of doc.parts || []) parts.push(part);
  }

  // Part scope expands only through a declared, digest-bound part-to-unit row.
  if (request?.kind === 'part') {
    const want = refId(request.component || {});
    const rows = parts.filter(row => refId(row) === want && row.partId === request.partId);
    const component = artifacts.filter(row => row.solution === request.component?.solution)
      .flatMap(row => row.components || []).filter(row => row.key === request.component?.key);
    if (rows.length !== 1) block(rows.length ? 'duplicate-native-provider' : 'unknown-native-part-expansion', { component: refOf(request.component || {}), partId: request.partId ?? null });
    else if (component.length !== 1 || rows[0].componentDigest !== component[0].digest) block('stale-native-part-expansion', { component: refOf(rows[0]), partId: rows[0].partId });
    else if (!importUnits.some(unit => unit.id === rows[0].unitId && unit.members.some(ref => refId(ref) === want))) block('unknown-native-part-expansion', { component: refOf(rows[0]), partId: rows[0].partId });
  }

  let serverInventory = null;
  const servers = admitted.filter(entry => entry.doc.server);
  if (request?.kind === 'server') {
    if (servers.length !== 1) block(servers.length ? 'duplicate-native-provider' : 'unknown-native-server-inventory');
    const server = servers.length === 1 ? servers[0].doc.server : null;
    if (server) serverInventory = { coverage: server.coverage, evidenceRef: server.evidenceRef, solutions: server.solutions,
      requiredGlobalDomains: server.requiredGlobalDomains, targetProfileDigest: servers[0].doc.targetProfileDigest,
      globalDomains: (server.domains || []).map(row => {
        // A declared domain without an executable handler or verification receipt is
        // projected as unresolved: full-server completeness cannot pass on a claim.
        const handler = row?.handler?.status === 'executable' && nonempty(row.handler.evidenceRef);
        if (row?.status === 'included' && handler) return { domain: row.domain, status: 'included', evidenceRef: row.evidenceRef, members: (row.members || []).map(refOf) };
        if (row?.status === 'externally-provisioned' && row.verification?.status === 'verified' && nonempty(row.verification.evidenceRef) &&
            row.verification.targetProfileDigest === servers[0].doc.targetProfileDigest)
          return { domain: row.domain, status: 'externally-provisioned-and-verified', evidenceRef: row.verification.evidenceRef,
            adapter: servers[0].doc.adapter, targetProfileDigest: row.verification.targetProfileDigest };
        need(row?.status === 'externally-provisioned' ? 'global-domain-verification' : 'global-domain-executable-handler', { domain: row?.domain ?? null });
        return { domain: row?.domain, status: 'unresolved' };
      }) };
  }

  const plannerInputs = { applications, importUnits, serverInventory };
  const plan = planReleaseScope({ request, artifacts, ...plannerInputs });
  for (const unitId of plan.nativeImportUnits) need('native-installation-observation', { unitId });
  if (!bases.has('native')) need('pinned-native-coverage-contract', { revision: INSPECTED_NATIVE_CONTRACT.revision });
  const adapterBlockers = sorted(blockers.values());
  const nativeMissing = sorted(missing.values()).filter(row => row.fact === 'pinned-native-coverage-contract' || row.fact === 'global-domain-executable-handler' ||
    row.fact === 'global-domain-verification' || plan.nativeImportUnits.includes(row.unitId));
  return brand(freeze({ schemaVersion: 1, inspectedNativeContract: INSPECTED_NATIVE_CONTRACT,
    // The release changes native declarations were checked against; the materialization
    // request recomputes it from its own operations.
    changesDigest: changesDigest(changes),
    evidenceBasis: bases.has('synthetic') ? 'synthetic' : bases.has('native') ? 'native' : 'unknown',
    plannerInputs, plan, adapterBlockers,
    // Wiki accounting: declarations are planned evidence, never observed installation.
    wikiAccounting: { evidence: admitted.length ? 'planned' : 'unknown', planningComplete: plan.planningComplete && adapterBlockers.length === 0 },
    // Always incomplete here: installation observation is P6/P8 native work, not planning.
    nativeEvidence: { required: nativeMissing.map(row => row.fact).filter((fact, i, rows) => rows.indexOf(fact) === i), missing: nativeMissing, complete: false },
    publicationReady: false, executionEnabled: false,
    limitations: ['Native coverage declarations are planned evidence; installation, receipts and global handlers require native observation (P6/P8).',
      'Synthetic contract results test Wiki accounting only and always carry synthetic-evidence-only.'] }));
}

import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { readArchiveLayout } from './e365.mjs';
import { parseManagedArtifact, planManagedComponentMerge, managedResolutionStatus } from './managed-workspace.mjs';
import { planDigest } from './dependency-resolver.mjs';
import { E1_CONTRACT, E1_SOURCE, E1_SCHEMA_INTACT, buildE1Envelope, validateE1Request, validateE1Receipt } from './native-materialization-e1.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nonempty = value => typeof value === 'string' && value.length > 0;
const sorted = values => [...values].sort((a, b) => compare(canonical(a), canonical(b)));
const contractId = contract => nonempty(contract?.id) && Number.isInteger(contract?.version) ? `${contract.id}@${contract.version}` : null;
const MANIFEST = /^[^/]+\/manifest\.json$/;
const SYNTHETIC = 'synthetic-evidence-only';
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));

// Read-only observation of the native materialization contract this adapter consumes.
// elma365#60 published E1 (`elma365-native-materialization@1`, PR #89): a request
// envelope, a validation receipt and manifest-regeneration policy v1. No native
// worker implements it yet, so native materialization stays unavailable.
export const INSPECTED_NATIVE_MATERIALIZATION = Object.freeze({
  repository: 'netbka/elma365', issue: 60, revision: E1_SOURCE.revision, contract: 'elma365-native-materialization@1', status: 'unavailable',
  missing: Object.freeze(['native-materialization-worker', 'baseline-preserving-stage-service', 'process-runtime-compiler', 'isolated-native-assembler'])
});
// Pinned native contracts whose validated output counts as native evidence, each
// with the exact elma365 revision and vendored schema digest Wiki reviewed.
// Callers cannot extend it.
export const NATIVE_MATERIALIZATION_CONTRACTS = Object.freeze([
  Object.freeze({ ...E1_CONTRACT, revision: E1_SOURCE.revision, schemaSha256: E1_SOURCE.sha256 })
]);
export const SYNTHETIC_MATERIALIZATION_CONTRACT = Object.freeze({ id: 'wiki-synthetic-native-materialization', version: 1 });
const E1_ID = `${E1_CONTRACT.id}@${E1_CONTRACT.version}`;
const basisOf = contract => contractId(contract) === contractId(SYNTHETIC_MATERIALIZATION_CONTRACT) ? 'synthetic'
  : NATIVE_MATERIALIZATION_CONTRACTS.some(row => contractId(row) === contractId(contract)) && (contractId(contract) !== E1_ID || E1_SCHEMA_INTACT) ? 'native' : null;
// Services whose coupled source/runtime a compiler profile must declare before a
// changed component of that service may be rebuilt. Widget compilation does not
// certify process runtime.
const coupledService = component => component.evidence.some(row => ['client.ts', 'server.ts'].includes(row.role)) || component.service === 'processor';

/** Binds one exact resolved revision (P3), native units (P4), dependency/profile
 * locks (P5), compiler profile and original bytes into a deterministic native
 * materialization request with the expected physical outcome. Pure apart from
 * parsing the supplied bytes; it calls no native tool and enables nothing.
 */
export async function prepareMaterializationRequest({ state, artifact, resolution, coverage, dependencies, compiler, targetProfile, originals = new Map() } = {}) {
  if (!state?.id || !artifact?.id) throw Error('Workspace state and the resolved change artifact are required');
  if (!(originals instanceof Map)) throw Error('Original bytes must be a Map of artifact ID to bytes');
  const blockers = new Map(), block = (reason, details = {}) => { const row = { reason, ...details }; blockers.set(canonical(row), row); };
  const plan = planManagedComponentMerge(state, artifact);
  const status = managedResolutionStatus(resolution, plan);
  if (status !== 'current') block(status === 'corrupt' ? 'corrupt-resolution' : 'stale-resolution');
  if (plan.inputs.base.status !== 'declared') block('unknown-base');
  const byId = new Map([...state.artifacts, artifact].map(row => [row.id, row]));

  // Exact originals: every artifact contributing bytes must be supplied and unchanged.
  const result = status === 'current' ? resolution.result : [];
  const rows = new Map(plan.rows.map(row => [row.key, row]));
  const sourceOf = row => row.source === 'incoming' ? row.artifactId : row.source === 'current' ? row.interventionId ?? state.baselineId : null;
  const baseId = plan.inputs.base.artifactId ?? null;
  const needed = [...new Set([baseId, ...result.map(sourceOf)].filter(Boolean))].sort(compare);
  const files = new Map();
  for (const id of needed) {
    const bytes = originals.get(id), record = byId.get(id);
    if (!record) block('unknown-source-artifact', { artifactId: id });
    else if (!bytes) block('missing-original', { artifactId: id });
    else if (hash(Buffer.from(bytes)) !== record.checksum) block('original-checksum-mismatch', { artifactId: id });
    else files.set(id, (await parseProject(Buffer.from(bytes))).inventory);
  }

  // Whole-component operations: every file of a component comes from one side,
  // so coupled descriptor/source/runtime/resources can never be mixed.
  const base = byId.get(baseId), baseComponents = new Map((base?.components ?? []).map(row => [row.key, row]));
  const operations = [], expectedComponents = [];
  for (const row of result) {
    const planRow = rows.get(row.key), before = baseComponents.get(row.key) ?? null;
    const sourceId = sourceOf(row), source = sourceId ? byId.get(sourceId)?.components.find(item => item.key === row.key) : null;
    if (row.digest && (!source || source.digest !== row.digest)) { block('unlocatable-component-source', { key: row.key, artifactId: sourceId }); continue; }
    const op = !row.digest ? before ? 'remove' : 'absent' : !before ? 'add' : before.digest === row.digest ? 'keep' : 'replace';
    if (op === 'absent') continue;
    if (op !== 'keep' && !planRow) block('unplanned-component', { key: row.key });
    operations.push({ key: row.key, service: (source ?? before).service, op, choice: row.choice, sourceArtifactId: op === 'remove' || op === 'keep' ? baseId : sourceId,
      digest: row.digest, baseDigest: before?.digest ?? null, files: (op === 'remove' ? before : source ?? before).evidence.map(({ role, source: path, sha256 }) => ({ role, path, sha256 })),
      coupled: coupledService(source ?? before) });
    if (row.digest) expectedComponents.push({ key: row.key, digest: row.digest });
  }
  for (const [key, row] of baseComponents) if (!rows.has(key)) {
    operations.push({ key, service: row.service, op: 'keep', choice: 'base', sourceArtifactId: baseId, digest: row.digest, baseDigest: row.digest,
      files: row.evidence.map(({ role, source: path, sha256 }) => ({ role, path, sha256 })), coupled: coupledService(row) });
    expectedComponents.push({ key, digest: row.digest });
  }
  const changed = operations.filter(row => row.op !== 'keep');

  // Expected physical files: baseline bytes unless a changed component owns the path.
  const expected = new Map((files.get(baseId) ?? []).map(row => [row.path, { path: row.path, action: 'preserve', sha256: row.sha256, sourceArtifactId: baseId }]));
  const owners = new Map();
  for (const row of operations) for (const file of row.files) owners.set(file.path, [...(owners.get(file.path) || []), row]);
  for (const [path, rowsForPath] of owners) if (rowsForPath.length > 1 && rowsForPath.some(row => row.op !== 'keep')
    && new Set(rowsForPath.map(row => row.op === 'remove' ? null : row.files.find(file => file.path === path).sha256)).size > 1)
    block('shared-path-conflict', { path, keys: rowsForPath.map(row => row.key).sort(compare) });
  for (const row of changed) for (const file of row.files) {
    if (row.op === 'remove') { if ((owners.get(file.path) || []).every(owner => owner.op === 'remove')) expected.set(file.path, { path: file.path, action: 'remove', sha256: null, sourceArtifactId: null }); continue; }
    const held = (files.get(row.sourceArtifactId) ?? []).find(item => item.path === file.path);
    if (files.has(row.sourceArtifactId) && held?.sha256 !== file.sha256) block('component-file-mismatch', { key: row.key, path: file.path });
    expected.set(file.path, { path: file.path, action: 'replace', sha256: file.sha256, sourceArtifactId: row.sourceArtifactId });
  }
  // Files a replaced component no longer declares leave with its old version.
  for (const row of changed.filter(row => row.op === 'replace')) for (const file of baseComponents.get(row.key).evidence)
    if (!owners.has(file.source)) expected.set(file.source, { path: file.source, action: 'remove', sha256: null, sourceArtifactId: null });
  // A changed service manifest is regenerated natively; only its entity records may differ.
  for (const service of new Set(changed.map(row => row.service))) {
    const path = service + '/manifest.json';
    if (expected.has(path)) expected.set(path, { ...expected.get(path), action: 'native-manifest' });
    else block('missing-service-manifest', { service });
  }

  // P4: every changed component and every sibling of its selected unit is bound by digest.
  const coverageReasons = [...(coverage?.adapterBlockers ?? []), ...(coverage?.plan?.blockers ?? [])].map(row => row.reason).filter(reason => reason !== SYNTHETIC);
  if (coverage?.schemaVersion !== 1 || !coverage.plan) block('missing-native-coverage');
  else if (coverageReasons.length) block('native-coverage-incomplete', { reasons: [...new Set(coverageReasons)].sort(compare) });
  const selected = (coverage?.plannerInputs?.importUnits ?? []).filter(unit => coverage.plan?.nativeImportUnits?.includes(unit.id));
  const resolvedDigest = new Map(operations.map(row => [row.key, row.op === 'remove' ? row.baseDigest : row.digest]));
  for (const row of changed) {
    const units = selected.filter(unit => unit.members.some(member => member.solution === state.solution && member.key === row.key));
    if (units.length !== 1) block(units.length ? 'duplicate-native-unit' : 'uncovered-resolved-component', { key: row.key });
  }
  for (const unit of selected) for (const member of unit.members) if (member.solution === state.solution && resolvedDigest.get(member.key) !== member.digest)
    block('stale-native-unit-member', { unitId: unit.id, key: member.key });

  // P5: the dependency lock must belong to the exact coverage plan and Target profile.
  const dependencyReasons = (dependencies?.blockers ?? []).map(row => row.reason).filter(reason => reason !== SYNTHETIC);
  if (dependencies?.schemaVersion !== 1) block('missing-dependency-resolution');
  else {
    if (!coverage?.plan || dependencies.planDigest !== planDigest(coverage.plan)) block('stale-dependency-resolution');
    if (dependencyReasons.length) block('dependency-resolution-incomplete', { reasons: [...new Set(dependencyReasons)].sort(compare) });
  }
  if (!nonempty(targetProfile?.digest) || !nonempty(targetProfile?.platformVersion)) block('unknown-target-profile');
  else {
    if (dependencies?.targetProfile?.digest !== targetProfile.digest) block('stale-dependency-profile');
    if ((coverage?.plan?.targetPreconditions ?? []).some(row => row.targetProfileDigest !== targetProfile.digest)) block('stale-coverage-profile');
  }

  // Compiler lock: the declared profile must cover every coupled service it rebuilds.
  const lock = compiler && nonempty(compiler.contract) && nonempty(compiler.profileDigest) && nonempty(compiler.evidenceRef) && Array.isArray(compiler.services)
    ? { contract: compiler.contract, profileDigest: compiler.profileDigest, platformVersion: compiler.platformVersion ?? null, evidenceRef: compiler.evidenceRef, services: [...compiler.services].sort(compare) } : null;
  if (!lock) block('missing-compiler-profile');
  else {
    if (nonempty(targetProfile?.platformVersion) && lock.platformVersion !== targetProfile.platformVersion) block('compiler-platform-mismatch');
    for (const service of new Set(changed.filter(row => row.coupled).map(row => row.service))) if (!lock.services.includes(service))
      block('unsupported-compiler-scope', { service });
  }

  const evidenceBasis = coverage?.evidenceBasis === 'synthetic' || dependencies?.evidenceBasis === 'synthetic' ? 'synthetic'
    : coverage?.evidenceBasis === 'native' && dependencies?.evidenceBasis === 'native-receipt' ? 'native' : 'unknown';
  const inputs = { solution: state.solution,
    resolution: status === 'current' ? { id: resolution.id, revisionDigest: resolution.revisionDigest, resultDigest: resolution.resultDigest, planDigest: resolution.planDigest } : null,
    base: base ? { artifactId: base.id, checksum: base.checksum } : null,
    originals: needed.map(id => ({ artifactId: id, checksum: byId.get(id)?.checksum ?? null })),
    coverage: coverage?.plan ? { planDigest: planDigest(coverage.plan), units: sorted(selected.map(unit => ({ id: unit.id, adapter: unit.adapter, members: sorted(unit.members) }))),
      importOrder: coverage.plan.nativeImportOrder ?? null } : null,
    dependencies: dependencies?.schemaVersion === 1 ? { planDigest: dependencies.planDigest, locks: dependencies.locks } : null,
    compiler: lock, targetProfile: { digest: targetProfile?.digest ?? null, platformVersion: targetProfile?.platformVersion ?? null } };
  if (evidenceBasis === 'synthetic') block(SYNTHETIC);
  const blocking = [...blockers.values()].filter(row => row.reason !== SYNTHETIC);
  return freeze({ schemaVersion: 1, method: 'whole-component-native-materialization', inputs, inputsDigest: hash(canonical(inputs)),
    status: blocking.length ? 'blocked' : 'ready', blockers: sorted(blockers.values()), evidenceBasis,
    operations: sorted(operations.filter(row => row.op !== 'keep')), expected: { components: sorted(expectedComponents), files: sorted(expected.values()) },
    // Determinism: unpacked per-path bytes, component digests, outer layout and
    // exact non-entity manifest fields. ZIP container bytes are recorded, not compared.
    determinism: 'unpacked-content-v1', buildEnabled: false, publicationReady: false, executionEnabled: false });
}

const manifestBody = bytes => { const { entities, ...rest } = json(bytes); return rest; };

// Checks one native output artifact against the request's expected outcome.
async function verifyOutput(request, bytes, baseBytes) {
  const failures = new Map(), fail = (reason, details = {}) => { const row = { reason, ...details }; failures.set(canonical(row), row); };
  let parsed;
  try { parsed = await parseProject(bytes); } catch { fail('unreadable-output'); return sorted(failures.values()); }
  const output = new Map(parsed.inventory.map(row => [row.path, row]));
  const baseFiles = (await parseProject(baseBytes)).files;
  for (const file of request.expected.files) {
    const row = output.get(file.path);
    if (file.action === 'remove') { if (row) fail('removed-path-present', { path: file.path }); continue; }
    if (!row) { fail('missing-output-path', { path: file.path }); continue; }
    if (file.action === 'native-manifest') {
      try { if (canonical(manifestBody(parsed.files.get(file.path))) !== canonical(manifestBody(baseFiles.get(file.path)))) fail('manifest-fields-changed', { path: file.path }); }
      catch { fail('unreadable-output-manifest', { path: file.path }); }
    } else if (row.sha256 !== file.sha256) fail(file.action === 'preserve' ? 'preserved-bytes-changed' : 'replaced-bytes-mismatch', { path: file.path });
  }
  const planned = new Set(request.expected.files.map(row => row.path));
  for (const path of output.keys()) if (!planned.has(path)) fail('unexpected-output-path', { path });
  if (canonical(await readArchiveLayout(bytes)) !== canonical(await readArchiveLayout(baseBytes))) fail('native-layout-changed');
  // Semantic check over the regenerated manifests: exactly the resolved components.
  try {
    const result = await parseManagedArtifact(bytes, { scope: 'full', id: 'materialized-output' });
    for (const row of result.ambiguities.filter(row => row.reason !== 'unclassified-file')) fail('output-ambiguity', { detail: row.reason, key: row.key ?? row.source ?? null });
    const actual = new Map(result.components.map(row => [row.key, row.digest])), wanted = new Map(request.expected.components.map(row => [row.key, row.digest]));
    for (const [key, digest] of wanted) if (actual.get(key) !== digest) fail(actual.has(key) ? 'component-digest-mismatch' : 'missing-output-component', { key });
    for (const key of actual.keys()) if (!wanted.has(key)) fail('unexpected-output-component', { key });
    if (result.solution !== request.inputs.solution) fail('output-solution-mismatch');
  } catch { fail('unreadable-output'); }
  return sorted(failures.values());
}

/** Calls the injected native adapter for a ready request and verifies its exact
 * output. Only a pinned native contract with matching native validation of the
 * exact output bytes can produce native evidence; synthetic adapters test
 * Wiki accounting only. Returns a frozen bound build manifest and, when the
 * output was verified, its bytes.
 */
export async function materializeNative({ request, originals = new Map(), adapter = null, now } = {}) {
  if (request?.schemaVersion !== 1 || !nonempty(request.inputsDigest)) throw Error('A materialization request is required');
  if (!Number.isFinite(Date.parse(now))) throw Error('Explicit evaluation time is required');
  const blockers = [...request.blockers], base = { schemaVersion: 1, requestDigest: hash(canonical(request)), inputsDigest: request.inputsDigest,
    solution: request.inputs.solution, evaluatedAt: new Date(Date.parse(now)).toISOString(), inspectedNativeContract: INSPECTED_NATIVE_MATERIALIZATION };
  const finish = (status, { outputs = [], ...extra } = {}) => {
    const list = sorted(blockers.filter((row, index) => blockers.findIndex(other => canonical(other) === canonical(row)) === index));
    const body = { ...base, status, adapter: null, artifacts: [], validation: null, evidenceBasis: 'unknown', ...extra, blockers: list,
      releaseEligible: status === 'materialized' && extra.evidenceBasis === 'native' && !list.length, publicationReady: false, executionEnabled: false };
    // Output bytes stay mutable Buffers outside the frozen manifest.
    return Object.freeze({ manifest: freeze({ ...body, manifestDigest: hash(canonical(body)) }), artifacts: Object.freeze(status === 'materialized' ? outputs : []) });
  };
  if (request.status !== 'ready') return finish('blocked');
  const basis = basisOf(adapter?.contract);
  if (!basis || typeof adapter?.materialize !== 'function') {
    blockers.push({ reason: 'native-materialization-contract-unavailable', contract: contractId(adapter?.contract), revision: INSPECTED_NATIVE_MATERIALIZATION.revision });
    return finish('unavailable');
  }
  if (!/^[0-9a-f]{40}$/.test(adapter.nativeRevision ?? '') || !nonempty(adapter.id)) { blockers.push({ reason: 'unpinned-native-adapter' }); return finish('blocked'); }
  const adapterRef = { id: adapter.id, contract: { id: adapter.contract.id, version: adapter.contract.version }, nativeRevision: adapter.nativeRevision };
  if (basis === 'synthetic') blockers.push({ reason: SYNTHETIC });
  const baseBytes = originals.get(request.inputs.base.artifactId);
  if (!baseBytes || hash(Buffer.from(baseBytes)) !== request.inputs.base.checksum) { blockers.push({ reason: 'missing-original', artifactId: request.inputs.base.artifactId }); return finish('blocked', { adapter: adapterRef }); }
  for (const row of request.inputs.originals) {
    const bytes = originals.get(row.artifactId);
    if (!bytes || hash(Buffer.from(bytes)) !== row.checksum) { blockers.push({ reason: 'missing-original', artifactId: row.artifactId }); return finish('blocked', { adapter: adapterRef }); }
  }
  const supplied = () => new Map(request.inputs.originals.map(row => [row.artifactId, Buffer.from(originals.get(row.artifactId))]));
  // Native evidence is claimed only for the contract's own basis and inputs: a
  // pinned native contract over synthetic inputs remains synthetic.
  const evidenceBasis = basis === 'native' && request.evidenceBasis !== 'native' ? (request.evidenceBasis === 'synthetic' ? 'synthetic' : 'unknown') : basis;
  let response, receiptRef = {};
  if (contractId(adapter.contract) === E1_ID) {
    // E1: Wiki sends only a request the contract accepts and trusts only a receipt
    // bound to this exact request, the pinned worker revision and the output bytes.
    const envelope = buildE1Envelope(request, originals), checked = validateE1Request(envelope, { originals: supplied() });
    if (!checked.valid) {
      blockers.push({ reason: 'native-request-contract-invalid', errors: [...new Set(checked.errors.map(row => row.reason))].sort(compare) });
      return finish('blocked', { adapter: adapterRef });
    }
    let raw;
    try { raw = await adapter.materialize({ envelope: structuredClone(envelope), originals: supplied() }); }
    catch (error) {
      // A timed-out or lost worker result is an unknown outcome, never success.
      blockers.push({ reason: error?.code === 'NATIVE_OUTCOME_UNKNOWN' ? 'native-outcome-unknown' : 'native-materialization-failed' });
      return finish('failed', { adapter: adapterRef });
    }
    const receipt = raw?.receipt, verdict = validateE1Receipt(receipt, request, receipt?.status === 'validated' ? { artifacts: raw?.artifacts } : {});
    if (!verdict.valid) {
      blockers.push({ reason: 'native-receipt-invalid', errors: [...new Set(verdict.errors.map(row => row.reason))].sort(compare) });
      return finish('failed', { adapter: adapterRef });
    }
    receiptRef = { receipt: { status: receipt.status, worker: { ...receipt.worker }, evidenceRef: receipt.evidenceRef,
      unavailable: receipt.unavailable ? { reason: receipt.unavailable.reason, missing: [...receipt.unavailable.missing] } : null } };
    if (receipt.worker.nativeRevision !== adapter.nativeRevision) {
      blockers.push({ reason: 'native-worker-revision-mismatch' }); return finish('failed', { adapter: adapterRef, ...receiptRef });
    }
    if (verdict.state === 'unavailable') {
      blockers.push({ reason: 'native-worker-unavailable', detail: receipt.unavailable.reason }); return finish('unavailable', { adapter: adapterRef, ...receiptRef });
    }
    if (verdict.state === 'failed') { blockers.push({ reason: 'native-validation-failed' }); return finish('failed', { adapter: adapterRef, ...receiptRef }); }
    response = { inputsDigest: receipt.inputsDigest, artifacts: raw.artifacts,
      validation: { status: 'passed', validator: receipt.worker.id, evidenceRef: receipt.evidenceRef, artifactSha256: receipt.artifacts[0].sha256,
        contract: receipt.contract, targetProfileDigest: receipt.targetProfileDigest, compilerProfileDigest: receipt.compilerProfileDigest } };
  } else {
    try { response = await adapter.materialize({ request: structuredClone(request), originals: supplied() }); }
    catch { blockers.push({ reason: 'native-materialization-failed' }); return finish('failed', { adapter: adapterRef }); }
  }
  if (response?.inputsDigest !== request.inputsDigest) { blockers.push({ reason: 'stale-native-output' }); return finish('failed', { adapter: adapterRef }); }
  const outputs = Array.isArray(response.artifacts) ? response.artifacts : [];
  if (outputs.length !== 1 || outputs[0]?.solution !== request.inputs.solution || !outputs[0]?.bytes?.length) {
    blockers.push({ reason: 'unexpected-native-artifacts', count: outputs.length }); return finish('failed', { adapter: adapterRef });
  }
  const bytes = Buffer.from(outputs[0].bytes), sha256 = hash(bytes);
  const failures = await verifyOutput(request, bytes, Buffer.from(baseBytes));
  blockers.push(...failures);
  // Native validation must name this exact output, contract, profile and compiler lock.
  const validation = response.validation;
  const validated = validation?.status === 'passed' && nonempty(validation.validator) && nonempty(validation.evidenceRef)
    && validation.artifactSha256 === sha256 && contractId(validation.contract) === contractId(adapter.contract)
    && validation.targetProfileDigest === request.inputs.targetProfile.digest && validation.compilerProfileDigest === request.inputs.compiler?.profileDigest;
  if (!validation || validation.status !== 'passed') blockers.push({ reason: 'native-validation-missing' });
  else if (!validated) blockers.push({ reason: 'native-validation-mismatch' });
  const counts = Object.fromEntries(['preserve', 'replace', 'remove', 'native-manifest'].map(action => [action, request.expected.files.filter(row => row.action === action).length]));
  const artifact = { solution: request.inputs.solution, sha256, size: bytes.length };
  return finish(failures.length ? 'failed' : 'materialized', { adapter: adapterRef, ...receiptRef, artifacts: [artifact], fileActions: counts,
    validation: validation ? { status: validation.status ?? null, validator: validation.validator ?? null, evidenceRef: validation.evidenceRef ?? null, artifactSha256: validation.artifactSha256 ?? null, matches: validated } : null,
    evidenceBasis, outputs: failures.length ? [] : [{ ...artifact, bytes }] });
}

/** A build manifest is usable only while intact and bound to the current exact inputs. */
export function materializationStatus(manifest, request) {
  if (!manifest?.manifestDigest) return 'corrupt';
  const { manifestDigest, ...body } = manifest;
  if (hash(canonical(body)) !== manifestDigest) return 'corrupt';
  return request?.inputsDigest === manifest.inputsDigest && hash(canonical(request)) === manifest.requestDigest ? 'current' : 'stale';
}

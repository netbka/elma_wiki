import crypto from 'node:crypto';
import { isBridgeStore } from './bridge.mjs';
import { e1HygieneErrors } from './native-materialization-e1.mjs';
import { prepareMaterializationRequest } from './native-materialization.mjs';
import { observedTargetProfileReport } from './native-materialization-bridge.mjs';
import { CAPABILITY_CATALOG, COVERAGE_CONTRACT, changesFromRequest, validateNativeCoverageDeclaration } from './elma365-native-contracts.mjs';

// Wiki consumer of the netbka/elma365 #60 build evidence contract `elma365-native-build-evidence@1`
// (P8). The bridge job `buildEvidence` returns, for exactly the captures and changes this server
// derived, the worker's Target profile digest, its compiler lock and an `elma365-native-coverage@1`
// declaration. The worker's source cannot be imported here, so its consumer rules
// (`validateBuildEvidence`) and request rules (`validateBuildEvidenceRequest`) are ported verbatim
// from BUILD_EVIDENCE_SOURCE. The document is self-attested JSON: trust comes only from a job this
// process enqueued on its configured bridge, with a fresh run id, plus these bindings. Admitted
// documents are registered in process memory; a copy, a deserialized document or a poll
// advertisement is never evidence. Nothing here imports, publishes or executes anything.

/** The reviewed native producer: merged elma365 PR #112 (verified head 0d9e59fb). */
export const BUILD_EVIDENCE_SOURCE = Object.freeze({ repository: 'netbka/elma365', issue: 60, pullRequest: 112, merged: true,
  revision: '00a29fb03dc8b7d6f90f08dc4dbfcc1ae8ee555d', verifiedHead: '0d9e59fb8b74427502b107ab22c3b057f05c6c33',
  path: 'tools/native-materialization/build-evidence.mjs', document: 'docs/enterprise-development/native-build-evidence.md' });
export const BUILD_EVIDENCE_CONTRACT = Object.freeze({ id: 'elma365-native-build-evidence', version: 1 });
export const BUILD_EVIDENCE_JOB = 'buildEvidence';
export const BUILD_EVIDENCE_PRODUCER = Object.freeze({ job: 'build-evidence', mode: 'read-only', transport: 'elma-dev-bridge' });
export const BUILD_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const BUILD_EVIDENCE_MAX_SKEW_MS = 2 * 60 * 1000;
export const MAX_CAPTURES = 20;
export const MAX_COMPONENTS = 5000;
export const MAX_CHANGES = 5000;
/** Facts a build evidence document never establishes (elma365 NOT_ESTABLISHED). */
export const NOT_ESTABLISHED = Object.freeze(['entitlement-observation', 'activation-observation', 'compatibility-observation', 'required-bindings',
  'native-import-receipt', 'native-installation-observation', 'process-runtime-compiler']);
export const UNAVAILABLE_REASONS = Object.freeze(['worker-profile-unbound', 'capability-catalog-unavailable']);
/** elma365 profile.mjs COMPILER_CONTRACT / COMPILER_SERVICES: widget scripts only, no process runtime. */
export const COMPILER_CONTRACT = 'elma-dev compile --verify';
export const COMPILER_SERVICES = Object.freeze(['widgets']);
export const DEFAULT_BUILD_EVIDENCE_TIMEOUT_MS = 5 * 60 * 1000;

const REQUEST_KEYS = ['contract', 'runId', 'targetId', 'environment', 'nativeRevision', 'captures', 'changes'];
const CAPTURE_KEYS = ['solution', 'checksum', 'components'];
const COMPONENT_KEYS = ['key', 'service', 'kind', 'digest'];
const CHANGE_KEYS = ['solution', 'key', 'op', 'digest', 'service', 'kind'];
const DOCUMENT_KEYS = ['contract', 'document', 'status', 'producer', 'targetId', 'environment', 'requestDigest', 'issuedAt', 'worker', 'profile',
  'compiler', 'coverage', 'targetObservation', 'missing', 'unavailable', 'evidenceRef', 'publicationReady', 'executionEnabled'];
const LOCK_KEYS = ['contract', 'profileDigest', 'platformVersion', 'evidenceRef', 'services'];
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TARGET_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,79}$/;
const EVIDENCE_REF = /^build-evidence:[0-9a-f]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys, required = keys) => plain(value) && Object.keys(value).every(key => keys.includes(key)) && required.every(key => key in value);
const identifier = value => typeof value === 'string' && IDENTIFIER.test(value) && !FORBIDDEN_KEYS.has(value);
const revision = value => typeof value === 'string' && HEX40.test(value) && !/^0{40}$/.test(value);
const componentKey = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.trim() === value;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value ? Date.parse(value) : null;
const result = errors => ({ valid: errors.length === 0, errors });
const reasonsOf = errors => [...new Set(errors.map(row => row.reason))].sort(compare);
const positive = value => Number.isSafeInteger(value) && value > 0;
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const outcomeUnknown = detail => Object.assign(Error('native-outcome-unknown'), { code: 'NATIVE_OUTCOME_UNKNOWN', detail });

/** sha256(canonical(payload)): binds a document to exactly the request it answers. */
export const buildEvidenceRequestDigest = payload => sha256(canonical(payload));

/** The job payload for server-derived captures (Wiki capture records) and E1 change rows. */
export function buildEvidencePayload({ runId, target, nativeRevision, captures, changes }) {
  return { contract: { ...BUILD_EVIDENCE_CONTRACT }, runId, targetId: target, environment: target, nativeRevision,
    captures: captures.map(row => ({ solution: row.solution, checksum: row.checksum,
      components: row.components.map(component => ({ key: component.key, service: component.service, kind: component.kind ?? null, digest: component.digest })) })),
    changes: changes.map(row => ({ solution: row.solution, key: row.key, op: row.op, digest: row.op === 'remove' ? null : row.digest ?? null,
      service: row.service ?? null, kind: row.kind ?? null })) };
}

/** elma365 validateBuildEvidenceRequest: fail-closed request shape and hygiene. */
export function validateBuildEvidenceRequest(payload) {
  const errors = [];
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  if (!exactKeys(payload, REQUEST_KEYS)) return result([{ reason: 'request-shape' }]);
  if (!exactKeys(payload.contract, ['id', 'version']) || payload.contract.id !== BUILD_EVIDENCE_CONTRACT.id || payload.contract.version !== BUILD_EVIDENCE_CONTRACT.version) add('unsupported-contract');
  if (!identifier(payload.runId)) add('invalid-run-id');
  if (!TARGET_KEY.test(payload.targetId ?? '') || !TARGET_KEY.test(payload.environment ?? '')) add('invalid-target');
  if (!revision(payload.nativeRevision)) add('invalid-native-revision');
  const { captures, changes } = payload;
  if (!Array.isArray(captures) || !captures.length || captures.length > MAX_CAPTURES) add('invalid-captures');
  else {
    let components = 0;
    for (const [index, capture] of captures.entries()) {
      if (!exactKeys(capture, CAPTURE_KEYS) || !identifier(capture.solution) || !HEX64.test(capture.checksum ?? '') || !Array.isArray(capture.components)) {
        add('invalid-capture', { capture: index }); continue;
      }
      components += capture.components.length;
      const keys = new Set();
      for (const row of capture.components) {
        if (!exactKeys(row, COMPONENT_KEYS) || !componentKey(row.key) || !identifier(row.service) || !(row.kind === null || identifier(row.kind))
          || !HEX64.test(row.digest ?? '')) { add('invalid-component', { capture: index }); break; }
        if (keys.has(row.key)) { add('duplicate-component', { capture: index }); break; }
        keys.add(row.key);
      }
    }
    if (components > MAX_COMPONENTS) add('too-many-components');
    if (new Set(captures.map(row => row?.solution)).size !== captures.length) add('duplicate-capture');
  }
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) add('invalid-changes');
  else {
    const seen = new Set();
    for (const [index, row] of changes.entries()) {
      const ok = exactKeys(row, CHANGE_KEYS, ['solution', 'key', 'op', 'digest']) && identifier(row.solution) && componentKey(row.key)
        && ['replace', 'add', 'remove'].includes(row.op) && (row.op === 'remove' ? row.digest === null : HEX64.test(row.digest ?? ''))
        && (!('service' in row) || row.service === null || identifier(row.service)) && (!('kind' in row) || row.kind === null || identifier(row.kind));
      if (!ok) { add('invalid-change', { change: index }); continue; }
      const id = canonical([row.solution, row.key]);
      if (seen.has(id)) add('duplicate-change', { change: index });
      seen.add(id);
    }
  }
  for (const row of e1HygieneErrors(payload)) add(row.reason, { path: row.path });
  return result(errors);
}

/** elma365 validateBuildEvidence, ported rule for rule. `payload` is the request this server
 * enqueued, `nativeRevision` its pinned worker revision, `catalog` the vendored capability catalog
 * and `targetReport` the observed Target profile report it admitted. Returns {valid, errors, usable};
 * only `usable` (a valid `produced` document) is evidence. */
export function validateBuildEvidence(doc, { payload, nativeRevision, now = Date.now(), maxAgeMs = BUILD_EVIDENCE_MAX_AGE_MS, skewMs = BUILD_EVIDENCE_MAX_SKEW_MS,
  catalog = CAPABILITY_CATALOG, targetReport = null } = {}) {
  const errors = [];
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  const done = () => ({ ...result(errors), usable: errors.length === 0 && doc.status === 'produced' });
  if (!exactKeys(doc, DOCUMENT_KEYS)) return { ...result([{ reason: 'document-shape' }]), usable: false };
  for (const row of e1HygieneErrors(doc)) add(row.reason, { path: row.path });
  if (!exactKeys(doc.contract, ['id', 'version']) || doc.contract.id !== BUILD_EVIDENCE_CONTRACT.id || doc.contract.version !== BUILD_EVIDENCE_CONTRACT.version) add('unsupported-contract');
  if (doc.document !== 'build-evidence' || !['produced', 'unavailable'].includes(doc.status)) add('document-shape');
  if (doc.publicationReady !== false || doc.executionEnabled !== false) add('over-claim');
  if (!validateBuildEvidenceRequest(payload).valid) { add('invalid-request'); return done(); }
  // Binding to the exact request, nonce, Target and pinned worker.
  if (doc.requestDigest !== buildEvidenceRequestDigest(payload)) add('request-mismatch');
  if (!exactKeys(doc.producer, ['job', 'mode', 'transport', 'runId']) || doc.producer.job !== BUILD_EVIDENCE_PRODUCER.job || doc.producer.mode !== BUILD_EVIDENCE_PRODUCER.mode
    || doc.producer.transport !== BUILD_EVIDENCE_PRODUCER.transport) add('unattested-producer');
  else if (doc.producer.runId !== payload.runId) add('foreign-run');
  if (doc.targetId !== payload.targetId || doc.environment !== payload.environment) add('target-mismatch');
  if (!exactKeys(doc.worker, ['id', 'nativeRevision']) || !identifier(doc.worker.id) || !revision(doc.worker.nativeRevision)) add('document-shape');
  else if (!revision(nativeRevision) || doc.worker.nativeRevision !== nativeRevision || payload.nativeRevision !== nativeRevision) add('worker-revision-mismatch');
  const issued = time(doc.issuedAt), current = typeof now === 'number' ? now : Date.parse(now);
  if (issued === null || !Number.isFinite(current)) add('stale-evidence');
  else if (issued > current + skewMs) add('future-evidence');
  else if (current - issued > maxAgeMs) add('stale-evidence');
  if (!Array.isArray(doc.missing) || doc.missing.some(row => typeof row !== 'string') || NOT_ESTABLISHED.some(fact => !doc.missing.includes(fact))) add('hidden-missing-fact');

  if (doc.status === 'unavailable') {
    if (doc.profile !== null || doc.compiler !== null || doc.coverage !== null || doc.targetObservation !== null || doc.evidenceRef !== null
      || !exactKeys(doc.unavailable, ['reason']) || !UNAVAILABLE_REASONS.includes(doc.unavailable.reason)) add('unavailable-with-evidence');
    return done();
  }
  if (doc.unavailable !== null) add('document-shape');
  if (!EVIDENCE_REF.test(doc.evidenceRef ?? '')) add('invalid-evidence-ref');
  const profile = doc.profile;
  if (!exactKeys(profile, ['targetProfileDigest', 'compilerProfileDigest', 'platformVersion']) || !HEX64.test(profile.targetProfileDigest ?? '')
    || !HEX64.test(profile.compilerProfileDigest ?? '') || typeof profile.platformVersion !== 'string' || !VERSION.test(profile.platformVersion)) {
    add('invalid-profile'); return done();
  }
  // Compiler lock: the profile's own compiler, only supported scopes.
  const lock = doc.compiler;
  if (!exactKeys(lock, LOCK_KEYS) || lock.contract !== COMPILER_CONTRACT || !Array.isArray(lock.services)) add('invalid-compiler-lock');
  else {
    if (lock.profileDigest !== profile.compilerProfileDigest || lock.platformVersion !== profile.platformVersion) add('compiler-profile-mismatch');
    if (lock.evidenceRef !== doc.evidenceRef) add('evidence-ref-mismatch');
    if (!lock.services.length || new Set(lock.services).size !== lock.services.length || lock.services.some(service => !COMPILER_SERVICES.includes(service)))
      add('unsupported-compiler-scope');
  }
  // Coverage: the pinned contract and catalog, this profile and worker, exactly the requested captures and changes.
  const coverage = doc.coverage;
  if (!plain(coverage) || coverage.contract?.id !== COVERAGE_CONTRACT.id || coverage.contract?.version !== COVERAGE_CONTRACT.version) { add('invalid-coverage-declaration'); return done(); }
  if (!catalog) { add('capability-catalog-unavailable'); return done(); }
  const verdict = validateNativeCoverageDeclaration(coverage, { catalog, captures: payload.captures, changes: payload.changes });
  if (!verdict.valid) add('invalid-coverage-declaration', { errors: reasonsOf(verdict.errors) });
  if (coverage.targetProfileDigest !== profile.targetProfileDigest || coverage.nativeRevision !== doc.worker?.nativeRevision) add('coverage-profile-mismatch');
  if (coverage.evidenceRef !== doc.evidenceRef) add('evidence-ref-mismatch');
  // Unit preconditions come only from the worker's own observation, which must be the one this server admitted.
  const observation = doc.targetObservation;
  const preconditions = Array.isArray(coverage.units) ? coverage.units.filter(unit => unit?.targetPrecondition).map(unit => unit.targetPrecondition) : [];
  if (observation === null) { if (preconditions.length) add('unobserved-target-precondition'); }
  else if (!exactKeys(observation, ['runId', 'evidenceRef', 'observedAt', 'inventoryDigest']) || !identifier(observation.runId) || time(observation.observedAt) === null) add('invalid-target-observation');
  else {
    if (preconditions.some(row => row.evidenceRef !== observation.evidenceRef)) add('target-observation-mismatch');
    if (Array.isArray(coverage.units) && preconditions.length !== coverage.units.length) add('target-observation-mismatch');
    if (!targetReport || targetReport.status !== 'observed' || targetReport.evidenceRef !== observation.evidenceRef || targetReport.observation?.runId !== observation.runId
      || targetReport.targetProfileDigest !== profile.targetProfileDigest || targetReport.inventoryDigest !== observation.inventoryDigest
      || targetReport.observedAt !== observation.observedAt) add('target-observation-mismatch');
  }
  if (targetReport && targetReport.targetProfileDigest !== profile.targetProfileDigest) add('stale-target-profile');
  return done();
}

// ---------------------------------------------------------------------------
// Server-derived build inputs

// prepareMaterializationRequest blockers that only say the evidence requested here is still absent.
const EVIDENCE_PENDING = new Set(['missing-native-coverage', 'missing-dependency-resolution', 'unknown-target-profile', 'missing-compiler-profile',
  'uncovered-resolved-component']);
const sourceKey = source => ['service', 'namespace', 'code'].every(key => typeof source?.[key] === 'string' && source[key]) ? canonical([source.service, source.namespace, source.code]) : null;

/** The capture and change rows of one accepted merged revision, derived only from the managed store's
 * state, resolution and original bytes (the same request the build prepares). The capture is the
 * resolved revision: every resulting component at its resolved digest, checksum = the resolution's
 * result digest, with the baseline's and contributing artifacts' declarations (resolvedBuildCapture).
 * Returns `{capture, changes, blockers: []}`, or `{capture: null, blockers}` when the inputs
 * themselves are not buildable. */
export async function composedBuildInputs({ state, artifact, resolution, originals }) {
  const request = await prepareMaterializationRequest({ state, artifact, resolution, originals });
  const blockers = request.blockers.filter(row => !EVIDENCE_PENDING.has(row.reason));
  if (blockers.length) return { capture: null, changes: [], blockers: blockers.map(row => ({ ...row })) };
  const byId = new Map([...state.artifacts, artifact].map(row => [row.id, row]));
  const base = byId.get(request.inputs.base?.artifactId);
  if (!base || !HEX64.test(resolution?.resultDigest ?? '')) return { capture: null, changes: [], blockers: [{ reason: 'unknown-base' }] };
  const records = new Map((base.components ?? []).map(row => [row.key, row]));
  const contributing = new Map([[base.id, base]]), removed = new Set();
  for (const op of request.operations) {
    if (op.op === 'remove') { removed.add(sourceKey(records.get(op.key))); records.delete(op.key); continue; }
    const source = byId.get(op.sourceArtifactId), component = source?.components?.find(row => row.key === op.key && row.digest === op.digest);
    if (!component) return { capture: null, changes: [], blockers: [{ reason: 'unlocatable-component-source', key: op.key }] };
    records.set(op.key, component); contributing.set(source.id, source);
  }
  const expected = new Map(request.expected.components.map(row => [row.key, row.digest]));
  if (expected.size !== records.size || [...records].some(([key, row]) => expected.get(key) !== row.digest))
    return { capture: null, changes: [], blockers: [{ reason: 'unresolved-component-set' }] };
  const capture = resolvedBuildCapture({ solution: state.solution, checksum: resolution.resultDigest, sources: [...contributing.values()],
    components: [...records.values()], removed: [...removed] });
  const kinds = new Map([...(base.components ?? []), ...capture.components].map(row => [row.key, row.kind ?? null]));
  const changes = changesFromRequest(request).map(row => ({ ...row, kind: kinds.get(row.key) ?? null }));
  return { capture, changes, blockers: [] };
}

/** The full capture record of a resolved revision. `sources` are the baseline first, then every artifact
 * contributing a changed component; `removed` the JSON [service, namespace, code] keys of removed components.
 * Ambiguities and unclassified files are the union of all sources; a source without the list keeps the
 * capture incomplete. Dependency declarations are the union of all sources, except one whose source
 * component was removed; a source without a dependency inventory leaves the inventory unknown. Paid,
 * missing or unknown declarations are therefore never dropped by a merge. */
export function resolvedBuildCapture({ solution, checksum, sources, components, removed = [] }) {
  const gone = new Set(removed.filter(Boolean));
  const reports = sources.map(row => row.dependencies);
  const rows = new Map();
  for (const report of reports) for (const row of report?.rows ?? []) {
    const source = sourceKey(row.source);
    if (source === null || !gone.has(source)) rows.set(canonical(row), row);
  }
  const union = field => [...new Map(sources.flatMap(row => Array.isArray(row[field]) ? row[field] : [null]).map(row => [canonical(row), row])).values()];
  return { solution, scope: 'full', checksum,
    components: components.map(row => structuredClone(row)).sort((a, b) => compare(a.key, b.key)),
    ambiguities: union('ambiguities'), unclassifiedFiles: union('unclassifiedFiles'),
    dependencies: reports.every(row => row?.schemaVersion === 1 && Array.isArray(row.rows))
      ? { ...structuredClone(sources[0].dependencies), rows: [...rows.values()].map(row => structuredClone(row)).sort((a, b) => compare(canonical(a), canonical(b))) } : null };
}

// ---------------------------------------------------------------------------
// Bridge job `buildEvidence` and admitted documents

const ADMITTED = new WeakMap();
/** The admitted record `{document, payload, observation}` of evidence this process accepted, else null. */
export const admittedBuildEvidence = value => (value && typeof value === 'object' && ADMITTED.get(value)) || null;

// Read-only build evidence source `{request({captures, changes, observation})}` for one owner's bridge and
// its configured Target. Not exported: worker revision and Target come only from configuration.
function bridgeBuildEvidenceSource({ bridges, bridgeId, owner, nativeRevision, target, timeoutMs = DEFAULT_BUILD_EVIDENCE_TIMEOUT_MS, now = () => Date.now() }) {
  if (!isBridgeStore(bridges)) throw Error('A bridge store created by bridgeStore() is required');
  if (!UUID.test(bridgeId ?? '') || typeof owner !== 'string' || !owner) throw Error('An explicit bridge and its owner are required');
  if (!HEX40.test(nativeRevision ?? '')) throw Error('A pinned 40-hex native worker revision is required');
  if (!TARGET_KEY.test(target ?? '')) throw Error('A configured Target id is required');
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) throw Error('The build evidence timeout must be a positive integer of milliseconds');
  return Object.freeze({
    id: 'operator-bridge-build-evidence', contract: { ...BUILD_EVIDENCE_CONTRACT }, nativeRevision, target,
    /** One job for server-derived captures and changes, bound to the admitted Target profile observation. */
    async request({ captures, changes, observation }) {
      const report = observedTargetProfileReport(observation);
      if (!report || report.targetId !== target) return { status: 'unavailable', reason: 'unobserved-target-profile', evidence: null };
      const runId = crypto.randomUUID();
      const payload = buildEvidencePayload({ runId, target, nativeRevision, captures, changes });
      const checked = validateBuildEvidenceRequest(payload);
      if (!checked.valid) return { status: 'unavailable', reason: 'build-evidence-request-unsupported', errors: reasonsOf(checked.errors), evidence: null };
      // Owner isolation, and no job for a worker that does not advertise the read-only job.
      const bridge = await bridges.get(bridgeId, owner);
      if (!bridge?.capabilities?.jobKinds?.includes(BUILD_EVIDENCE_JOB)) return { status: 'unavailable', reason: 'build-evidence-not-advertised', evidence: null };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      let answer;
      try { answer = await bridges.enqueue(bridgeId, BUILD_EVIDENCE_JOB, payload, { signal: controller.signal }); }
      catch (error) { throw error?.code === 'TIMEOUT' ? outcomeUnknown('timeout') : error; }
      finally { clearTimeout(timer); }
      if (!answer || typeof answer !== 'object' || !answer.evidence) throw outcomeUnknown('lost-result');
      if (Object.keys(answer).length !== 1) return { status: 'invalid', errors: ['result-shape'], evidence: null };
      const doc = answer.evidence;
      const verdict = validateBuildEvidence(doc, { payload, nativeRevision, now: now(), catalog: CAPABILITY_CATALOG, targetReport: report });
      if (!verdict.valid) return { status: 'invalid', errors: reasonsOf(verdict.errors), evidence: null };
      if (doc.status === 'unavailable') return { status: 'unavailable', reason: doc.unavailable.reason, missing: [...doc.missing].sort(compare), evidence: null };
      const document = deepFreeze(structuredClone(doc));
      const evidence = Object.freeze({ source: 'operator-bridge', job: BUILD_EVIDENCE_JOB, runId, targetId: target, issuedAt: document.issuedAt,
        evidenceRef: document.evidenceRef, requestDigest: document.requestDigest, targetProfileDigest: document.profile.targetProfileDigest,
        platformVersion: document.profile.platformVersion, compilerServices: Object.freeze([...document.compiler.services]),
        missing: Object.freeze([...document.missing].sort(compare)) });
      ADMITTED.set(evidence, Object.freeze({ document, payload: deepFreeze(structuredClone(payload)), observation, nativeRevision }));
      return { status: 'produced', evidence };
    }
  });
}

/** Explicit opt-in from the same non-secret configuration as the Target profile observer
 * (WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID, _BRIDGE_OWNER, _REVISION, WIKI_NATIVE_TARGET_PROFILE_TARGET;
 * optional WIKI_NATIVE_BUILD_EVIDENCE_TIMEOUT_MS). Missing or malformed configuration leaves it
 * unconfigured (null). `log` names a variable, never a value. */
export function configuredBuildEvidenceSource({ env = {}, bridges, log = message => console.warn(message), now } = {}) {
  const prefix = 'WIKI_NATIVE_MATERIALIZATION_', names = ['BRIDGE_ID', 'BRIDGE_OWNER', 'REVISION'];
  if (!names.some(name => env[prefix + name])) return null;
  const disabled = reason => { log(`Native build evidence over the bridge is disabled: ${reason}`); return null; };
  const missing = names.filter(name => !env[prefix + name]);
  if (missing.length) return disabled(`missing ${missing.map(name => prefix + name).join(', ')}`);
  if (!isBridgeStore(bridges)) return disabled('no bridge store');
  if (!UUID.test(env[prefix + 'BRIDGE_ID'])) return disabled(`${prefix}BRIDGE_ID is not a bridge UUID`);
  if (!HEX40.test(env[prefix + 'REVISION'])) return disabled(`${prefix}REVISION is not a 40-hex revision`);
  if (!TARGET_KEY.test(env.WIKI_NATIVE_TARGET_PROFILE_TARGET ?? '')) return disabled('WIKI_NATIVE_TARGET_PROFILE_TARGET must name the configured Target id');
  const raw = env.WIKI_NATIVE_BUILD_EVIDENCE_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === '' ? DEFAULT_BUILD_EVIDENCE_TIMEOUT_MS : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) return disabled(`WIKI_NATIVE_BUILD_EVIDENCE_TIMEOUT_MS must be a positive integer of milliseconds up to ${MAX_TIMEOUT_MS}`);
  try { return bridgeBuildEvidenceSource({ bridges, bridgeId: env[prefix + 'BRIDGE_ID'], owner: env[prefix + 'BRIDGE_OWNER'], nativeRevision: env[prefix + 'REVISION'],
    target: env.WIKI_NATIVE_TARGET_PROFILE_TARGET, timeoutMs, ...(now ? { now } : {}) }); }
  catch (error) { return disabled(error.message); }
}

/** The admitted document's coverage declaration and compiler lock for exactly these build inputs and
 * this admitted observation, re-validated now, or `{status, reason}` naming why it is not usable. */
export function currentBuildEvidence({ evidence, observation, captures, changes, nativeRevision, now = Date.now() }) {
  const held = admittedBuildEvidence(evidence);
  if (!held) return { status: 'missing', reason: 'missing-build-evidence' };
  const report = observedTargetProfileReport(observation);
  if (!report || held.observation !== observation) return { status: 'stale', reason: 'stale-build-evidence-observation' };
  if (held.nativeRevision !== nativeRevision) return { status: 'stale', reason: 'worker-revision-mismatch' };
  const payload = buildEvidencePayload({ runId: held.payload.runId, target: held.payload.targetId, nativeRevision, captures, changes });
  if (canonical(payload) !== canonical(held.payload)) return { status: 'stale', reason: 'stale-build-evidence-inputs' };
  const verdict = validateBuildEvidence(held.document, { payload: held.payload, nativeRevision, now, catalog: CAPABILITY_CATALOG, targetReport: report });
  if (!verdict.usable) return { status: 'stale', reason: reasonsOf(verdict.errors)[0] ?? 'unusable-build-evidence', errors: reasonsOf(verdict.errors) };
  return { status: 'current', reason: null, declaration: held.document.coverage, compiler: held.document.compiler };
}

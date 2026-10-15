import crypto from 'node:crypto';
import { E1_CONTRACT } from './native-materialization-e1.mjs';
import { isBridgeStore } from './bridge.mjs';
import { RECEIPT_CONTRACT, OBSERVATION_JOB, validateTargetProfileReport } from './elma365-native-contracts.mjs';

// Production E1 adapter over the operator bridge (#94 MR-03, netbka/elma365#60). It enqueues one
// `materialize` job for an explicitly configured bridge connection of an explicit owner, hands the worker
// the E1 envelope and the job-scoped originals by sha256, and waits for the E1 receipt plus the uploaded
// output archive. It decides nothing itself: materializeNative validates the request before the call and
// the receipt (validateE1Receipt, sha256 and size binding) and the exact output bytes after it.
//
// Fail-closed: a timeout, a lost or late result, a removed bridge or a bridge of another owner is an
// unknown outcome and throws; it never reads as success. Nothing here is configured by default.

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX40 = /^[0-9a-f]{40}$/;
export const DEFAULT_MATERIALIZE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_MATERIALIZE_OUTPUT_BYTES = 256 * 1024 * 1024;
const positive = value => Number.isSafeInteger(value) && value > 0;
// setTimeout clamps larger delays to 1 ms, which would fence every job at once.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const outcomeUnknown = detail => Object.assign(Error('native-outcome-unknown'), { code: 'NATIVE_OUTCOME_UNKNOWN', detail });

// Adapters configuredMaterializationAdapter produced in this process. materializeNative claims
// native evidence only for these; any other object with the E1 contract stays non-native.
const CONFIGURED = new WeakSet();
/** True only for an adapter returned by configuredMaterializationAdapter in this process. */
export const isConfiguredMaterializationAdapter = value => !!value && typeof value === 'object' && CONFIGURED.has(value);

// E1 adapter `{envelope, originals} -> {receipt, artifacts}` for one owner's bridge. Not exported:
// the worker revision comes only from configuration (configuredMaterializationAdapter), and only a
// store created by bridgeStore() is accepted.
function bridgeMaterializationAdapter({ bridges, bridgeId, owner, nativeRevision, timeoutMs = DEFAULT_MATERIALIZE_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MATERIALIZE_OUTPUT_BYTES } = {}) {
  if (!isBridgeStore(bridges)) throw Error('A bridge store created by bridgeStore() is required');
  if (!UUID.test(bridgeId ?? '') || typeof owner !== 'string' || !owner) throw Error('An explicit bridge and its owner are required');
  if (!HEX40.test(nativeRevision ?? '')) throw Error('A pinned 40-hex native worker revision is required');
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) throw Error('The materialize timeout must be a positive integer of milliseconds');
  if (!positive(maxOutputBytes) || maxOutputBytes > DEFAULT_MATERIALIZE_OUTPUT_BYTES) throw Error('The output limit must be a positive integer up to 256 MiB');
  return Object.freeze({
    id: 'operator-bridge-materialize', contract: { ...E1_CONTRACT }, nativeRevision,
    async materialize({ envelope, originals }) {
      // Owner isolation: the configured owner must still own the bridge on every call.
      await bridges.get(bridgeId, owner);
      const inputs = envelope.originals.map(row => {
        const bytes = originals.get(row.artifactId);
        if (!bytes || hash(bytes) !== row.sha256 || bytes.length !== row.size) throw Error('Original bytes do not match the envelope');
        return bytes;
      });
      const payload = { contract: { ...E1_CONTRACT }, envelope,
        originals: envelope.originals.map(({ artifactId, sha256, size }) => ({ artifactId, sha256, size })), output: { maxBytes: maxOutputBytes } };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try { result = await bridges.enqueue(bridgeId, 'materialize', payload, { signal: controller.signal, inputs }); }
      catch (error) { throw error?.code === 'TIMEOUT' ? outcomeUnknown('timeout') : error; }
      finally { clearTimeout(timer); }
      if (!result || typeof result !== 'object' || !result.receipt) throw outcomeUnknown('lost-result');
      const output = result.output;
      // The bytes travel separately from the receipt; validateE1Receipt binds them by sha256 and size.
      return { receipt: result.receipt,
        artifacts: output?.bytes ? [{ solution: envelope.request.inputs.solution, bytes: Buffer.from(output.bytes) }] : [] };
    }
  });
}

/** Explicit opt-in from non-secret configuration. Any missing or malformed variable leaves native
 * materialization unconfigured, so materializeNative keeps returning `unavailable`. When the
 * variables are partly set or invalid, `log` receives a reason naming the variable, never a value. */
export function configuredMaterializationAdapter({ env = {}, bridges, log = message => console.warn(message) } = {}) {
  const prefix = 'WIKI_NATIVE_MATERIALIZATION_';
  const names = ['BRIDGE_ID', 'BRIDGE_OWNER', 'REVISION', 'TIMEOUT_MS', 'MAX_OUTPUT_BYTES'];
  if (!names.some(name => env[prefix + name])) return null;
  const disabled = reason => { log(`Native materialization over the bridge is disabled: ${reason}`); return null; };
  const missing = names.slice(0, 3).filter(name => !env[prefix + name]);
  if (missing.length) return disabled(`missing ${missing.map(name => prefix + name).join(', ')}`);
  if (!isBridgeStore(bridges)) return disabled('no bridge store');
  if (!UUID.test(env[prefix + 'BRIDGE_ID'])) return disabled(`${prefix}BRIDGE_ID is not a bridge UUID`);
  if (!HEX40.test(env[prefix + 'REVISION'])) return disabled(`${prefix}REVISION is not a 40-hex revision`);
  const integer = (name, fallback, max) => {
    const raw = env[prefix + name];
    if (raw === undefined || raw === '') return fallback;
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return positive(value) && value <= max ? value : null;
  };
  const timeoutMs = integer('TIMEOUT_MS', DEFAULT_MATERIALIZE_TIMEOUT_MS, MAX_TIMEOUT_MS);
  if (timeoutMs === null) return disabled(`${prefix}TIMEOUT_MS must be a positive integer of milliseconds up to ${MAX_TIMEOUT_MS}`);
  const maxOutputBytes = integer('MAX_OUTPUT_BYTES', DEFAULT_MATERIALIZE_OUTPUT_BYTES, DEFAULT_MATERIALIZE_OUTPUT_BYTES);
  if (maxOutputBytes === null) return disabled(`${prefix}MAX_OUTPUT_BYTES must be a positive integer up to ${DEFAULT_MATERIALIZE_OUTPUT_BYTES}`);
  try {
    const adapter = bridgeMaterializationAdapter({ bridges, bridgeId: env[prefix + 'BRIDGE_ID'], owner: env[prefix + 'BRIDGE_OWNER'], nativeRevision: env[prefix + 'REVISION'], timeoutMs, maxOutputBytes });
    CONFIGURED.add(adapter);
    return adapter;
  }
  catch (error) { return disabled(error.message); }
}

// ---------------------------------------------------------------------------
// Target profile observation (#94 MR-05, elma365#60 P5). Native dependency receipts and the
// native Target profile reach Wiki only through this read-only bridge job: the operator's
// worker observes its own configured Target and reports an `elma365-dependency-receipt@1`
// Target profile report. An observation is admitted only when the report is schema- and
// semantically valid, observed, attested by the worker's read-only observation job
// ({job: target-profile-observation, mode: read-only, transport: elma-dev-bridge, runId})
// with the runId Wiki issued for this job, from the pinned worker revision and for the
// requested Target. Admitted observations are registered here; resolveDependencyEvidence accepts no
// other source, so a caller cannot assert receipts or a profile by building the same shape.

export const TARGET_PROFILE_JOB = 'targetProfile';
export const DEFAULT_OBSERVE_TIMEOUT_MS = 5 * 60 * 1000;
const TARGET_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OBSERVATIONS = new WeakMap();
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const requirementOf = row => ({ service: String(row?.service ?? ''), namespace: String(row?.namespace ?? ''), code: String(row?.code ?? ''),
  provider: { code: String(row?.provider?.code ?? ''), version: row?.provider?.version == null ? null : String(row.provider.version) } });

/** The report of an admitted bridge observation, or null for anything else. */
export const observedTargetProfileReport = observation => (observation && typeof observation === 'object' && OBSERVATIONS.get(observation)) || null;

// Read-only observer `{observe({requirements}) -> {status, observation, ...}}` for one owner's bridge and its
// configured Target id. The elma365 worker (netbka/elma365 #106) requires payload targetId and environment to
// both equal its configured Target id, refuses any other value and answers `unavailable` /
// `target-not-designated` on a non-designated Target, so both fields always carry the configured id. Not exported: the expected worker revision comes only from configuration
// (configuredTargetProfileObserver), and only a store created by bridgeStore() is accepted.
function bridgeTargetProfileObserver({ bridges, bridgeId, owner, nativeRevision, target, timeoutMs = DEFAULT_OBSERVE_TIMEOUT_MS } = {}) {
  if (!isBridgeStore(bridges)) throw Error('A bridge store created by bridgeStore() is required');
  if (!UUID.test(bridgeId ?? '') || typeof owner !== 'string' || !owner) throw Error('An explicit bridge and its owner are required');
  if (!HEX40.test(nativeRevision ?? '')) throw Error('A pinned 40-hex native worker revision is required');
  if (!TARGET_KEY.test(target ?? '')) throw Error('A configured Target id is required');
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) throw Error('The observation timeout must be a positive integer of milliseconds');
  return Object.freeze({
    id: 'operator-bridge-target-profile', contract: { ...RECEIPT_CONTRACT }, nativeRevision, target,
    async observe({ targetId = target, environment = target, requirements = [] } = {}) {
      // Only the configured Target is observed: a caller cannot name another one.
      if (targetId !== target || environment !== target) throw Error('Configured Target only: targetId and environment must both equal the configured Target id');
      if (!Array.isArray(requirements)) throw Error('Requirements must be an array');
      // Owner isolation, and no job for a worker that does not advertise the read-only observation.
      const bridge = await bridges.get(bridgeId, owner);
      if (!bridge?.capabilities?.jobKinds?.includes(TARGET_PROFILE_JOB)) return { status: 'unavailable', reason: 'target-profile-observation-not-advertised', observation: null };
      // A fresh run id binds the report to this job: a replayed or foreign report cannot echo it.
      const runId = crypto.randomUUID();
      const payload = { contract: { ...RECEIPT_CONTRACT }, runId, targetId, environment, requirements: requirements.map(requirementOf) };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try { result = await bridges.enqueue(bridgeId, TARGET_PROFILE_JOB, payload, { signal: controller.signal }); }
      catch (error) { throw error?.code === 'TIMEOUT' ? outcomeUnknown('timeout') : error; }
      finally { clearTimeout(timer); }
      const report = result?.report;
      if (!report) throw outcomeUnknown('lost-result');
      const verdict = validateTargetProfileReport(report);
      if (!verdict.valid) return { status: 'invalid', errors: [...new Set(verdict.errors.map(row => row.reason))].sort(), observation: null };
      const errors = [];
      if (report.worker.nativeRevision !== nativeRevision) errors.push('native-worker-revision-mismatch');
      if (report.targetId !== targetId || report.environment !== environment) errors.push('target-mismatch');
      const attested = report.observation;
      if (report.status === 'observed' && (attested?.job !== OBSERVATION_JOB.job || attested?.mode !== OBSERVATION_JOB.mode
        || attested?.transport !== OBSERVATION_JOB.transport || attested?.runId !== runId)) errors.push('unattested-observation');
      if (errors.length) return { status: 'invalid', errors, observation: null };
      const frozen = deepFreeze(structuredClone(report));
      if (frozen.status !== 'observed') return { status: 'unavailable', reason: frozen.unavailable.reason, report: frozen, observation: null };
      const observation = Object.freeze({ source: 'operator-bridge', job: TARGET_PROFILE_JOB, worker: Object.freeze({ ...frozen.worker }),
        runId, targetId: frozen.targetId, environment: frozen.environment, targetProfileDigest: frozen.targetProfileDigest, observedAt: frozen.observedAt,
        reportDigest: hash(JSON.stringify(frozen)) });
      OBSERVATIONS.set(observation, frozen);
      return { status: 'observed', observation };
    }
  });
}

/** Explicit opt-in from the same non-secret configuration as native materialization
 * (WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID, _BRIDGE_OWNER, _REVISION) plus the bridge's configured
 * Target id WIKI_NATIVE_TARGET_PROFILE_TARGET (optional WIKI_NATIVE_TARGET_PROFILE_TIMEOUT_MS). The expected worker revision is the configured
 * WIKI_NATIVE_MATERIALIZATION_REVISION, never a caller argument. Missing or malformed
 * configuration, or a store not created by bridgeStore(), leaves observation unconfigured
 * (null), so native dependency evidence stays unknown. `log` receives a reason naming the
 * variable, never a value. */
export function configuredTargetProfileObserver({ env = {}, bridges, log = message => console.warn(message) } = {}) {
  // WIKI_NATIVE_TARGET_PROFILE_TARGET names the bridge's configured Target id (the worker's --target); the
  // job's targetId and environment are both that id.
  const prefix = 'WIKI_NATIVE_MATERIALIZATION_', names = ['BRIDGE_ID', 'BRIDGE_OWNER', 'REVISION'];
  if (!names.some(name => env[prefix + name])) return null;
  const disabled = reason => { log(`Target profile observation over the bridge is disabled: ${reason}`); return null; };
  const missing = names.filter(name => !env[prefix + name]);
  if (missing.length) return disabled(`missing ${missing.map(name => prefix + name).join(', ')}`);
  if (!isBridgeStore(bridges)) return disabled('no bridge store');
  if (!UUID.test(env[prefix + 'BRIDGE_ID'])) return disabled(`${prefix}BRIDGE_ID is not a bridge UUID`);
  if (!HEX40.test(env[prefix + 'REVISION'])) return disabled(`${prefix}REVISION is not a 40-hex revision`);
  if (!TARGET_KEY.test(env.WIKI_NATIVE_TARGET_PROFILE_TARGET ?? '')) return disabled('WIKI_NATIVE_TARGET_PROFILE_TARGET must name the configured Target id');
  const raw = env.WIKI_NATIVE_TARGET_PROFILE_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === '' ? DEFAULT_OBSERVE_TIMEOUT_MS : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) return disabled(`WIKI_NATIVE_TARGET_PROFILE_TIMEOUT_MS must be a positive integer of milliseconds up to ${MAX_TIMEOUT_MS}`);
  try { return bridgeTargetProfileObserver({ bridges, bridgeId: env[prefix + 'BRIDGE_ID'], owner: env[prefix + 'BRIDGE_OWNER'], nativeRevision: env[prefix + 'REVISION'],
    target: env.WIKI_NATIVE_TARGET_PROFILE_TARGET, timeoutMs }); }
  catch (error) { return disabled(error.message); }
}

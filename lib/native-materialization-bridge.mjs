import crypto from 'node:crypto';
import { E1_CONTRACT } from './native-materialization-e1.mjs';

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

/** E1 adapter `{envelope, originals} -> {receipt, artifacts}` for one owner's bridge. */
export function bridgeMaterializationAdapter({ bridges, bridgeId, owner, nativeRevision, timeoutMs = DEFAULT_MATERIALIZE_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MATERIALIZE_OUTPUT_BYTES } = {}) {
  if (!bridges || typeof bridges.enqueue !== 'function') throw Error('A bridge store is required');
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
  if (!bridges) return disabled('no bridge store');
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
  try { return bridgeMaterializationAdapter({ bridges, bridgeId: env[prefix + 'BRIDGE_ID'], owner: env[prefix + 'BRIDGE_OWNER'], nativeRevision: env[prefix + 'REVISION'], timeoutMs, maxOutputBytes }); }
  catch (error) { return disabled(error.message); }
}

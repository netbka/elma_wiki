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
const outcomeUnknown = detail => Object.assign(Error('native-outcome-unknown'), { code: 'NATIVE_OUTCOME_UNKNOWN', detail });

/** E1 adapter `{envelope, originals} -> {receipt, artifacts}` for one owner's bridge. */
export function bridgeMaterializationAdapter({ bridges, bridgeId, owner, nativeRevision, timeoutMs = DEFAULT_MATERIALIZE_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MATERIALIZE_OUTPUT_BYTES } = {}) {
  if (!bridges || typeof bridges.enqueue !== 'function') throw Error('A bridge store is required');
  if (!UUID.test(bridgeId ?? '') || typeof owner !== 'string' || !owner) throw Error('An explicit bridge and its owner are required');
  if (!HEX40.test(nativeRevision ?? '')) throw Error('A pinned 40-hex native worker revision is required');
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
 * materialization unconfigured, so materializeNative keeps returning `unavailable`. */
export function configuredMaterializationAdapter({ env = {}, bridges } = {}) {
  const bridgeId = env.WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID, owner = env.WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER;
  const nativeRevision = env.WIKI_NATIVE_MATERIALIZATION_REVISION;
  if (!bridgeId || !owner || !nativeRevision || !bridges) return null;
  try {
    return bridgeMaterializationAdapter({ bridges, bridgeId, owner, nativeRevision,
      timeoutMs: Number(env.WIKI_NATIVE_MATERIALIZATION_TIMEOUT_MS) || DEFAULT_MATERIALIZE_TIMEOUT_MS,
      maxOutputBytes: Number(env.WIKI_NATIVE_MATERIALIZATION_MAX_OUTPUT_BYTES) || DEFAULT_MATERIALIZE_OUTPUT_BYTES });
  } catch { return null; }
}

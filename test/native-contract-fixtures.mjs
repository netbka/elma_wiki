// Synthetic producers for the elma365 #60 native coverage and dependency receipt contracts.
// They mirror the worker side of elma365 tools/native-materialization (declareCoverage,
// observedTargetProfileReport, receiptsFromProfile) so Wiki tests can build schema-valid
// documents. Every value is fictional; no real Target, licence, export or worker is used.
import crypto from 'node:crypto';
import { CAPABILITY_CATALOG, OBSERVATION_JOB, RECEIPT_CONTRACT, RECEIPT_MAX_AGE_MS, deriveCoverageDeclaration, inventoryDigest,
  receiptId } from '../lib/elma365-native-contracts.mjs';
import { bridgeTargetProfileObserver } from '../lib/native-materialization-bridge.mjs';

export const hex = (c, n = 64) => c.repeat(n);
export const WORKER = Object.freeze({ id: 'synthetic-native-worker', nativeRevision: hex('f', 40) });
export const BRIDGE_ID = '00000000-0000-4000-8000-000000000001';
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const refKey = row => canonical([row.service, row.namespace, row.code]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const covers = (namespaces, namespace) => namespaces.some(row => namespace === row || namespace.startsWith(row + '.'));
const proven = row => row?.status === 'verified' && typeof row.evidenceRef === 'string' && row.evidenceRef.length > 0;

/** A synthetic native coverage declaration exactly as elma365 declareCoverage derives it. */
export const nativeDeclaration = ({ captures, changes = [], targetProfileDigest, targetReport = null }) => deriveCoverageDeclaration({ catalog: CAPABILITY_CATALOG,
  captures, changes, targetProfileDigest, nativeRevision: WORKER.nativeRevision, evidenceRef: 'synthetic:coverage-declaration', targetReport });

export const installed = (code, extra = {}) => ({ code, version: '2.1.0', paid: true, opaque: true, identity: hex('9'), namespaces: ['vendor'],
  entitlement: { status: 'verified', evidenceRef: 'synthetic:entitlement' }, activation: { status: 'verified', evidenceRef: 'synthetic:activation' },
  compatibility: { status: 'compatible', evidenceRef: 'synthetic:compatibility' }, requiredBindings: [{ name: 'VENDOR_API', kind: 'secret-reference' }], ...extra });

/** Observed report (elma365 observedTargetProfileReport) with receipts for `requirements`
 * ({service, namespace, code, provider: {code, version}}). */
export function observedReport({ targetId = 'synthetic-target', environment = 'synthetic-test', targetProfileDigest = hex('a'), platformVersion = '2025.4',
  observedAt = '2026-10-15T00:00:00.000Z', changedAt = observedAt, installedSolutions = [], requirements = [], runId = 'synthetic-run',
  worker = WORKER } = {}) {
  const solutions = [...installedSolutions].sort((a, b) => compare(a.code, b.code));
  const report = { contract: { ...RECEIPT_CONTRACT }, document: 'target-profile-report', worker: { ...worker }, status: 'observed', targetId, environment,
    targetProfileDigest, platformVersion, observedAt, changedAt, inventoryDigest: inventoryDigest(solutions), installedSolutions: solutions, receipts: [],
    observation: { ...OBSERVATION_JOB, runId }, unavailable: null, evidenceRef: 'synthetic:target-profile', publicationReady: false, executionEnabled: false };
  const groups = new Map();
  for (const row of requirements) {
    const item = solutions.find(solution => solution.code === row.provider.code);
    if (!item?.version || !covers(item.namespaces, row.namespace)) continue;
    const group = groups.get(item.code) ?? { item, required: new Set(), provides: new Map() };
    group.required.add(row.provider.version ?? null);
    group.provides.set(refKey(row), { service: row.service, namespace: row.namespace, code: row.code });
    groups.set(item.code, group);
  }
  const verifiedAt = Date.parse(observedAt);
  report.receipts = [...groups.values()].map(({ item, required, provides }) => {
    const verified = required.size === 1 && required.has(item.version) && proven(item.entitlement) && proven(item.activation)
      && item.compatibility.status === 'compatible' && !!item.compatibility.evidenceRef && Array.isArray(item.requiredBindings);
    const receipt = { contract: { ...RECEIPT_CONTRACT }, kind: 'licensed-preinstallation', status: verified ? 'verified' : 'unverified',
      provider: { code: item.code, version: item.version }, provides: [...provides.values()].sort((a, b) => compare(refKey(a), refKey(b))),
      targetId, environment, targetProfileDigest, verifiedAt: new Date(verifiedAt).toISOString(), expiresAt: new Date(verifiedAt + RECEIPT_MAX_AGE_MS).toISOString(),
      provenance: { source: 'native-adapter', adapter: worker.id, evidenceRef: report.evidenceRef },
      compatibility: { status: item.compatibility.status, platformVersion, evidenceRef: item.compatibility.evidenceRef },
      entitlement: { ...item.entitlement }, requiredBindings: item.requiredBindings ? item.requiredBindings.map(row => ({ ...row })) : null, activation: { ...item.activation } };
    return { id: receiptId(receipt), ...receipt };
  }).sort((a, b) => compare(a.id, b.id));
  return report;
}

/** An in-memory bridge store whose worker answers `targetProfile` jobs with `respond(payload)`. */
export function fakeBridges({ respond, jobKinds = ['health', 'targetProfile'] } = {}) {
  const jobs = [];
  return { jobs, async get(id, owner) { if (id !== BRIDGE_ID || owner !== 'synthetic-owner') throw Error('Мост не найден'); return { id, capabilities: { jobKinds } }; },
    async enqueue(bridgeId, kind, payload) { jobs.push({ bridgeId, kind, payload: structuredClone(payload) }); return respond(payload); } };
}

/** Admitted bridge observation of `observedReport(options)`, echoing the job's run id. */
export async function observe(options = {}, { patch = report => report } = {}) {
  const observer = bridgeTargetProfileObserver({ bridges: fakeBridges({ respond: payload => ({ report: patch(observedReport({ targetId: payload.targetId,
    environment: payload.environment, runId: payload.runId, ...options })) }) }), bridgeId: BRIDGE_ID, owner: 'synthetic-owner', nativeRevision: WORKER.nativeRevision });
  return observer.observe({ targetId: options.targetId ?? 'synthetic-target', environment: options.environment ?? 'synthetic-test',
    requirements: options.requirements ?? [] });
}

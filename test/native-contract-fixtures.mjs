// Synthetic producers for the elma365 #60 native coverage and dependency receipt contracts.
// They mirror the worker side of elma365 tools/native-materialization (declareCoverage,
// observedTargetProfileReport, receiptsFromProfile) so Wiki tests can build schema-valid
// documents. Every value is fictional; no real Target, licence, export or worker is used.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CAPABILITY_CATALOG, OBSERVATION_JOB, RECEIPT_CONTRACT, RECEIPT_MAX_AGE_MS, deriveCoverageDeclaration, inventoryDigest,
  receiptId } from '../lib/elma365-native-contracts.mjs';
import { bridgeStore } from '../lib/bridge.mjs';
import { configuredTargetProfileObserver } from '../lib/native-materialization-bridge.mjs';
import { BUILD_EVIDENCE_CONTRACT, BUILD_EVIDENCE_PRODUCER, COMPILER_CONTRACT, COMPILER_SERVICES, NOT_ESTABLISHED } from '../lib/native-build-evidence.mjs';

export const hex = (c, n = 64) => c.repeat(n);
export const WORKER = Object.freeze({ id: 'synthetic-native-worker', nativeRevision: hex('f', 40) });
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
export function observedReport({ targetId = 'synthetic-target', environment = targetId, targetProfileDigest = hex('a'), platformVersion = '2025.4',
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

/** A real bridgeStore() in a temporary directory with one registered bridge and an in-process
 * synthetic worker that answers one `targetProfile` job per serve() with `respond(payload)`.
 * `env` is the configuration a deployment would set for it. */
export async function bridgeWorker({ respond = () => { throw Error('no job expected'); }, jobKinds = ['health', 'targetProfile'] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-target-profile-'));
  const store = bridgeStore(directory), { bridge, token } = await store.create('synthetic-owner', { name: 'Synthetic worker' });
  const worker = await store.authenticate(`Bearer ${token}`);
  await store.poll(worker, { capabilities: { jobKinds } });
  const jobs = [];
  const serve = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const job = await store.poll(worker, { waitMs: 50 });
      if (!job) continue;
      jobs.push(job);
      await store.complete(worker, job.id, { ok: true, result: await respond(job.payload) });
      return job;
    }
    throw Error('No job arrived');
  };
  const env = { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'synthetic-owner',
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER.nativeRevision, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'synthetic-target' };
  // Windows may report ENOTEMPTY/EBUSY while the store's last write settles; fs.rm retries those.
  return { store, bridge, worker, env, jobs, serve, close: () => fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) };
}

/** Bridge observation of `observedReport(options)` through a real store, echoing the job's run id. */
export async function observe(options = {}, { patch = report => report, env = {} } = {}) {
  const worker = await bridgeWorker({ respond: payload => ({ report: patch(observedReport({ targetId: payload.targetId,
    environment: payload.environment, runId: payload.runId, ...options })) }) });
  try {
    const observer = configuredTargetProfileObserver({ env: { ...worker.env, ...env }, bridges: worker.store, log: () => {} });
    const [result] = await Promise.all([observer.observe({ requirements: options.requirements ?? [] }), worker.serve()]);
    return result;
  } finally { await worker.close(); }
}

/** A synthetic `elma365-native-build-evidence@1` document exactly as elma365 produceBuildEvidence builds it
 * for `payload`: the worker profile, its widget-only compiler lock and the coverage declaration the
 * capability catalog derives, with unit preconditions only from `report` (the worker's own last
 * observed Target profile report) on the same profile. Fictional values only. */
export function producedBuildEvidence(payload, { report = null, issuedAt = new Date().toISOString(), targetProfileDigest = report?.targetProfileDigest ?? hex('a'),
  compilerProfileDigest = hex('b'), platformVersion = report?.platformVersion ?? '2025.4', worker = { id: 'elma365-native-materialization-worker', nativeRevision: payload.nativeRevision } } = {}) {
  const evidenceRef = 'build-evidence:' + sha(canonical(payload) + issuedAt);
  const usable = report?.status === 'observed' && report.targetProfileDigest === targetProfileDigest && report.targetId === payload.targetId ? report : null;
  const coverage = deriveCoverageDeclaration({ catalog: CAPABILITY_CATALOG, captures: payload.captures, changes: payload.changes, targetProfileDigest,
    nativeRevision: worker.nativeRevision, evidenceRef, targetReport: usable });
  return { contract: { ...BUILD_EVIDENCE_CONTRACT }, document: 'build-evidence', status: 'produced', producer: { ...BUILD_EVIDENCE_PRODUCER, runId: payload.runId },
    targetId: payload.targetId, environment: payload.environment, requestDigest: sha(canonical(payload)), issuedAt, worker: { ...worker },
    profile: { targetProfileDigest, compilerProfileDigest, platformVersion },
    compiler: { contract: COMPILER_CONTRACT, profileDigest: compilerProfileDigest, platformVersion, evidenceRef, services: [...COMPILER_SERVICES] }, coverage,
    targetObservation: usable ? { runId: usable.observation.runId, evidenceRef: usable.evidenceRef, observedAt: usable.observedAt, inventoryDigest: usable.inventoryDigest } : null,
    missing: [...NOT_ESTABLISHED, ...(usable ? [] : ['target-observation'])].sort(compare), unavailable: null, evidenceRef, publicationReady: false, executionEnabled: false };
}

/** The `unavailable` document of elma365 unavailableBuildEvidence. */
export const unavailableBuildEvidence = (payload, reason = 'worker-profile-unbound', { issuedAt = new Date().toISOString() } = {}) => ({
  contract: { ...BUILD_EVIDENCE_CONTRACT }, document: 'build-evidence', status: 'unavailable', producer: { ...BUILD_EVIDENCE_PRODUCER, runId: payload.runId },
  targetId: payload.targetId, environment: payload.environment, requestDigest: sha(canonical(payload)), issuedAt,
  worker: { id: 'elma365-native-materialization-worker', nativeRevision: payload.nativeRevision }, profile: null, compiler: null, coverage: null, targetObservation: null,
  missing: [...NOT_ESTABLISHED, 'target-observation', 'compiler-lock', 'native-coverage-declaration', 'target-profile-digest'].sort(compare),
  unavailable: { reason }, evidenceRef: null, publicationReady: false, executionEnabled: false });

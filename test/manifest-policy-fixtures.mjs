// Synthetic multi-service Contracts-shaped archives for E1 manifest-regeneration policy 2
// (elma365 #104): process templates next to processor records of another kind, and
// permission records told apart only by kind. Every value is fictional. The assembler is
// test-only: it applies whole-component operations and regenerates each changed manifest
// by Wiki component identity, as a policy 2 worker would.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { projectStore } from '../lib/projects.mjs';
import { readArchive } from '../lib/e365.mjs';
import { componentIdentity } from '../lib/native-components.mjs';
import { adaptNativeCoverage, SYNTHETIC_COVERAGE_CONTRACT } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence, SYNTHETIC_RECEIPT_CONTRACT } from '../lib/dependency-resolver.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { prepareMaterializationRequest } from '../lib/native-materialization.mjs';
import { E1_SOURCE, E1_REQUIRED_CHECKS, E1_MANIFEST_POLICY } from '../lib/native-materialization-e1.mjs';
import { zip } from './fixture.mjs';

export const OWNER = 'synthetic-owner';
export const NOW = '2026-10-10T12:00:00.000Z';
export const PROFILE = { targetId: 'synthetic-target', environment: 'isolated', digest: 'a'.repeat(64), platformVersion: '2025.4', changedAt: '2026-10-01T00:00:00.000Z' };
export const COMPILER = { contract: 'synthetic-compiler', profileDigest: 'c'.repeat(64), platformVersion: '2025.4', evidenceRef: 'synthetic-compiler-evidence', services: ['processor', 'widgets'] };
const actor = { id: 'resolver', login: 'resolver@example.org', provider: 'local' };
const NAMESPACE = 'contracts';
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);

/** Wiki component key of a fixture row {service, code, kind}. */
export const keyOf = row => JSON.stringify(componentIdentity({ namespace: NAMESPACE, ...row }));
const fileOf = row => `${row.kind}.${row.code}.json`;
const body = row => row.service === 'processor'
  ? { process: { items: { start: { id: 'start', type: 'start' } }, transitions: [], lanes: [] }, context: [], value: row.value }
  : { value: row.value };

/** Archive of rows [{service, code, kind, value}], one manifest per service in row order. */
export function archive(rows) {
  const services = [...new Set(rows.map(row => row.service))];
  return zip([['package.json', { code: 'synthetic_contracts', type: 'SOLUTION' }],
    ...services.flatMap(service => [[service + '/manifest.json', { nativeUnknown: { keep: true },
      entities: rows.filter(row => row.service === service).map(row => ({ code: row.code, namespace: NAMESPACE, kind: row.kind, path: fileOf(row), nativeHistory: [{ v: row.value }] })) }],
    ...rows.filter(row => row.service === service).map(row => [service + '/' + fileOf(row), body(row)])])]);
}

/** One reviewed same-base change: a full base, a partial change of `change` rows, resolved
 * with no conflict, and the request Wiki prepares with synthetic P4/P5 evidence. */
export async function policyScenario({ base, change, compiler = COMPILER, evidence = syntheticEvidence } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-manifest-policy-'));
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (rows, scope) => {
    const project = await projects.create(OWNER, await archive(rows));
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  let state = await store.create(OWNER, { name: 'Synthetic contracts', baselineOwner: 'Base', snapshot: await upload(base, 'full') }, actor);
  const prepared = await store.prepare(state.id, OWNER, { kind: 'change', snapshot: await upload(change, 'partial'), expectedRevision: (await store.get(state.id, OWNER)).revision,
    team: 'C', taskRef: 'SYNTHETIC-C', sameSourceConfirmed: true, base: { artifactId: state.baselineId, revision: 0, confirmed: true },
    changeScope: { name: 'Synthetic scope', members: change.map(keyOf), confirmed: true, deletions: [] } }, actor);
  const current = await store.get(state.id, OWNER), merge = await store.merge(state.id, OWNER, prepared.artifactId);
  const saved = await store.resolveMerge(state.id, OWNER, prepared.artifactId, { expectedRevision: current.revision, planDigest: merge.plan.planDigest,
    expectedResolutionId: merge.head?.id ?? null, decisions: {}, reason: 'Synthetic reviewed choice' }, actor);
  const { status, ...resolution } = saved.head;
  state = await store.get(state.id, OWNER);
  const artifact = await store.artifact(state.id, OWNER, prepared.artifactId);
  const ids = [...new Set([state.baselineId, prepared.artifactId, ...state.artifacts.map(row => row.id)])];
  const all = new Map(await Promise.all(ids.map(async id => [id, await store.original(state.id, OWNER, id)])));
  const prepare = async (extra = {}) => prepareMaterializationRequest({ state, artifact, resolution, ...(await evidence(resolution)), compiler, targetProfile: PROFILE, originals: all, ...extra });
  const request = await prepare();
  const originals = new Map(request.inputs.originals.map(row => [row.artifactId, all.get(row.artifactId)]));
  return { store, state, artifact, resolution, request, originals, prepare, cleanup };
}

/** P4 over the resolved revision (one synthetic unit per component) and P5 over that plan. */
export function syntheticEvidence(resolution) {
  const components = resolution.result.filter(row => row.digest).map(row => {
    const parts = JSON.parse(row.key), [service, namespace] = parts, code = parts.at(-1), kind = parts.length === 4 ? parts[2] : undefined;
    return { key: row.key, service, namespace, code, ...(kind ? { kind } : {}), digest: row.digest };
  });
  const capture = { solution: 'synthetic_contracts', scope: 'full', checksum: resolution.resultDigest, components, ambiguities: [], unclassifiedFiles: [], dependencies: dependencyReport([]) };
  const coverage = adaptNativeCoverage({ request: { kind: 'solution', solution: 'synthetic_contracts' }, artifacts: [capture], targetProfile: PROFILE,
    declarations: [{ contract: SYNTHETIC_COVERAGE_CONTRACT, nativeRevision: 'f'.repeat(40), adapter: 'synthetic-native-adapter', evidenceRef: 'synthetic-declaration',
      targetProfileDigest: PROFILE.digest, captures: [{ solution: capture.solution, artifactChecksum: capture.checksum }],
      units: components.map((row, index) => ({ id: 'unit-' + index, status: 'supported', evidenceRef: 'synthetic-unit', members: [{ solution: capture.solution, key: row.key, digest: row.digest }],
        targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target' } })) }] });
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, targetProfile: PROFILE, receiptContract: SYNTHETIC_RECEIPT_CONTRACT, now: NOW });
  return { coverage, dependencies };
}

// Wiki identity of a manifest record, as the policy 2 identity profile keys it.
const recordKey = (service, row) => { const parts = componentIdentity({ service, ...row }); return parts ? JSON.stringify(parts) : null; };

/** Test-only assembler: base bytes, whole-component operations, each changed manifest
 * regenerated in place by Wiki identity. `tamper(files)` edits the output map. */
export async function assemble(request, originals, { tamper = files => files } = {}) {
  const read = new Map(await Promise.all([...originals].map(async ([id, bytes]) => [id, await readArchive(Buffer.from(bytes))])));
  const files = new Map(read.get(request.inputs.base.artifactId));
  for (const op of request.operations) for (const file of op.files) {
    if (op.op === 'remove') files.delete(file.path); else files.set(file.path, read.get(op.sourceArtifactId).get(file.path));
  }
  for (const file of request.expected.files) if (file.action === 'remove') files.delete(file.path);
  for (const service of new Set(request.operations.map(op => op.service))) {
    const manifestPath = service + '/manifest.json', manifest = JSON.parse(files.get(manifestPath));
    const recordFor = (id, key) => JSON.parse(read.get(id).get(manifestPath)).entities.find(row => recordKey(service, row) === key);
    for (const op of request.operations.filter(op => op.service === service)) {
      const at = manifest.entities.findIndex(row => recordKey(service, row) === op.key);
      if (op.op === 'remove') manifest.entities.splice(at, 1);
      else if (at >= 0) manifest.entities[at] = recordFor(op.sourceArtifactId, op.key);
      else manifest.entities.push(recordFor(op.sourceArtifactId, op.key));
    }
    files.set(manifestPath, Buffer.from(JSON.stringify(manifest)));
  }
  return zip([...tamper(files)].reverse());
}

/** A validated E1 receipt for `bytes`, naming the policy the request selected. */
export function receiptFor(request, bytes) {
  const sha256 = sha(bytes), files = request.expected.files;
  const check = (id, service = null) => ({ id, service, status: 'passed', tool: { name: 'synthetic-' + id, version: '1' },
    artifactSha256: id === 'original-digests' ? null : sha256, evidenceRef: 'synthetic-check-' + id });
  return { contract: { id: 'elma365-native-materialization', version: 1 }, requestDigest: sha(canonical(request)), inputsDigest: request.inputsDigest,
    worker: { id: 'synthetic-e1-worker', nativeRevision: E1_SOURCE.revision }, status: 'validated', unavailable: null,
    artifacts: [{ solution: request.inputs.solution, sha256, size: bytes.length }],
    coverage: { expectedFiles: files.length, matchedFiles: files.length, unexpectedPaths: 0, expectedComponents: request.expected.components.length,
      matchedComponents: request.expected.components.length,
      actions: Object.fromEntries(['preserve', 'replace', 'remove', 'native-manifest'].map(action => [action, files.filter(row => row.action === action).length])) },
    checks: [...E1_REQUIRED_CHECKS.map(id => check(id)), ...[...new Set(request.operations.filter(op => op.coupled).map(op => op.service))].map(service => check('service-compile', service))],
    manifestPolicy: { ...(request.manifestPolicy ?? E1_MANIFEST_POLICY) }, targetProfileDigest: request.inputs.targetProfile.digest,
    compilerProfileDigest: request.inputs.compiler.profileDigest, evidenceRef: 'synthetic-receipt', publicationReady: false, executionEnabled: false };
}

/** An E1 adapter around the assembler (not configured, so never native evidence). */
export function policyAdapter({ receipt = row => row, tamper } = {}) {
  const calls = [];
  return { calls, id: 'synthetic-e1-worker', contract: { id: 'elma365-native-materialization', version: 1 }, nativeRevision: E1_SOURCE.revision,
    async materialize({ envelope, originals }) {
      calls.push(envelope);
      const bytes = await assemble(envelope.request, originals, { tamper });
      return { receipt: receipt(receiptFor(envelope.request, bytes), envelope.request), artifacts: [{ solution: envelope.request.inputs.solution, bytes }] };
    } };
}

// Fixture editions (mirroring elma365 make_contracts_samebase.py process, process_kind and permissions).
export const TEMPLATE = { service: 'processor', code: 'approval', kind: 'template' };
export const PROCESS = { service: 'processor', code: 'approval', kind: 'process' };
export const SETTINGS = { service: 'permissionsSettings', code: 'contracts', kind: 'permissionSettings' };
export const PAGE = { service: 'permissionsSettings', code: 'contracts', kind: 'pagePermissions' };
// Unchanged permission records of one namespace and code, kept in base order.
export const DIRECTORIES = { service: 'permissionsSettings', code: 'archive', kind: 'applicationDirectoriesPermissions' };
export const ARCHIVE_PAGE = { service: 'permissionsSettings', code: 'archive', kind: 'pagePermissions' };
export const WIDGET = { service: 'widgets', code: 'div', kind: 'widget' };
export const editions = {
  base: [{ ...TEMPLATE, value: 0 }, { ...PROCESS, value: 0 }, { ...SETTINGS, value: 0 }, { ...DIRECTORIES, value: 0 }, { ...ARCHIVE_PAGE, value: 0 }, { ...WIDGET, value: 0 }],
  process: [{ ...TEMPLATE, value: 1 }],
  permissions: [{ ...SETTINGS, value: 1 }, { ...PAGE, value: 1 }],
  widget: [{ ...WIDGET, value: 1 }],
  mixed: [{ ...TEMPLATE, value: 1 }, { ...WIDGET, value: 1 }]
};

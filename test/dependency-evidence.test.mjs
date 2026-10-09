import test from 'node:test';
import assert from 'node:assert/strict';
import { readDependencyCatalog, dependencyReport } from '../lib/dependency-evidence.mjs';
import { fixture, zip } from './fixture.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewManagedChange } from '../lib/managed-workspace.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { configAcquisitions } from '../lib/config-source.mjs';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { configDependencyContext } from '../lib/config-dependency-context.mjs';
const evidence = { schemaVersion: 1, catalog: [{ code: 'provider', paid: true, version: '1.2', namespaces: ['example_module'], observedAt: '2026-10-09T00:00:00Z', activation: 'active', token: 'secret' }] };
const dep = { category: 'dependencies', service: 'widgets', targetNamespace: 'example_module.records', targetCode: 'external', ownerCode: 'provider' };
test('catalog is an assertion; secrets, activation and compatibility are never inherited', () => {
  const catalog = readDependencyCatalog(evidence), report = dependencyReport([dep], { catalog });
  assert.equal(JSON.stringify(catalog).includes('secret'), false);
  assert.equal(report.rows[0].status, 'paid-source-unavailable');
  assert.equal(report.rows[0].activation, 'unknown');
  assert.equal(report.publicationReady, false);
  assert.equal(report.provenance, 'manual-upload');
  assert.throws(() => readDependencyCatalog({ ...evidence, catalog: [...evidence.catalog, ...evidence.catalog] }));
  assert.throws(() => readDependencyCatalog({ ...evidence, catalog: [{ ...evidence.catalog[0], version: { arbitrary: true } }] }));
});
test('exact structural component evidence is distinct from paid catalog, absent and ambiguous providers', () => {
  const entity = { service: dep.service, namespace: dep.targetNamespace, code: dep.targetCode, solution: 'readable', coverage: 'structural' };
  const report = components => dependencyReport([dep], { catalog: readDependencyCatalog(evidence), components }).rows[0];
  assert.equal(report([entity]).status, 'component-source-present');
  assert.equal(report([{ ...entity, coverage: 'unknown' }]).status, 'paid-source-unavailable');
  assert.equal(report([entity, { ...entity, solution: 'other' }]).status, 'ambiguous-provider');
  assert.equal(dependencyReport([dep]).rows[0].status, 'provider-not-observed');
  assert.equal(dependencyReport([{ ...dep, targetCode: null }]).rows[0].status, 'unknown-identity');
});
test('readable dependent custom solution is reviewable; encrypted and unknown local bytes remain blocked', async () => {
  const bytes = await fixture({ target: 'external' }), full = await parseManagedArtifact(bytes, { scope: 'full' });
  const state = createManagedWorkspace(full, { name: 'Custom', baselineOwner: 'Owner' });
  assert.equal(state.artifacts[0].dependencies.rows[0].versionCompatibility, 'not-verified');
  const partial = await parseManagedArtifact(bytes, { scope: 'partial' });
  assert.deepEqual(previewManagedChange(state, partial, { team: 'Owner' }).dependencies, partial.dependencies);
  const encrypted = await parseManagedArtifact(await zip([['package.json', { code: 'global', type: 'CONFIGURATION', paidPackage: true }], ['data', Buffer.from([0, 255])]]), { scope: 'full' });
  assert.throws(() => createManagedWorkspace(encrypted, { name: 'Encrypted', baselineOwner: 'Owner' }), error => error.statusCode === 422 && error.message.includes('зашифровано'));
});
test('catalog context is pinned to exact acquired snapshot and survives managed store restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dependency-context-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let solutions = solutionStore(directory);
  const bytes = await fixture({ target: 'external' }), checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  const bundle = await zip([['config-bundle.json', { format: 'elma-config-bundle', schemaVersion: 1, deployable: false, dependencyEvidence: evidence,
    solutions: [{ code: 'example_solution', status: 'exported', path: 'solutions/example_solution.e365', bytes: bytes.length, sha256: checksum }] }], ['solutions/example_solution.e365', bytes]]);
  const actor = { id: 'synthetic', login: 'synthetic', provider: 'local' };
  const acquisition = await configAcquisitions(directory, solutions.uploads).upload(bundle, actor);
  const project = acquisition.solutions[0].project;
  const state = await solutions.managed.create(SOLUTION_CATALOG, { name: 'Custom', baselineOwner: 'Owner', snapshot: { projectId: project.id, snapshotId: project.currentSnapshotId, scope: 'full', scopeConfirmed: true } }, actor);
  assert.equal(state.artifacts[0].dependencies.rows[0].status, 'paid-source-unavailable');
  solutions = solutionStore(directory);
  assert.deepEqual((await solutions.managed.get(state.id, SOLUTION_CATALOG)).artifacts[0].dependencies, state.artifacts[0].dependencies);
  assert.deepEqual(await configDependencyContext(directory)({ projectId: project.id, snapshotId: project.currentSnapshotId, checksum: '0'.repeat(64) }), {});
});

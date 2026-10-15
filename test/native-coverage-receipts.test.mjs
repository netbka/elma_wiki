import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COVERAGE_SOURCE, RECEIPT_SOURCE, COVERAGE_SCHEMA_INTACT, RECEIPT_SCHEMA_INTACT, CAPABILITY_CATALOG, CAPABILITY_CATALOG_SOURCE, NATIVE_CONTRACT_SOURCE,
  RECEIPT_SEMANTICS, validateNativeCoverageDeclaration, validateCapabilityCatalog, validateDependencyReceipt, validateTargetProfileReport, wikiTargetProfile,
  changesDigest, changesFromRequest } from '../lib/elma365-native-contracts.mjs';
import { adaptNativeCoverage } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence, NATIVE_RECEIPT_CONTRACTS } from '../lib/dependency-resolver.mjs';
import { planReleaseScope } from '../lib/release-scope-planner.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { bridgeStore, isBridgeStore, TARGET_PROFILE_PAYLOAD_KEYS } from '../lib/bridge.mjs';
import * as bridgeModule from '../lib/native-materialization-bridge.mjs';
import { configuredTargetProfileObserver, observedTargetProfileReport } from '../lib/native-materialization-bridge.mjs';
import { isNativeCoverageResult } from '../lib/native-coverage-adapter.mjs';
import { isDependencyResolution } from '../lib/dependency-resolver.mjs';
import { hex, sha, WORKER, nativeDeclaration, installed, observedReport, bridgeWorker, observe } from './native-contract-fixtures.mjs';

// Synthetic fixtures only: fictional Solutions, Target names, receipts and worker.
const PROFILE = hex('a');
const reasons = rows => rows.map(row => row.reason);
const errorsOf = verdict => [...new Set(verdict.errors.map(row => row.reason))].sort();
const component = (service, kind, code, namespace = 'synthetic.app') => ({ key: JSON.stringify([service, namespace, ...(service === 'processor' ? [kind] : []), code]),
  service, namespace, code, kind, digest: sha(code) });
const WIDGET = component('widgets', 'widget', 'form'), VIEWER = component('widgets', 'widget', 'viewer');
const TEMPLATE = component('processor', 'template', 'approval'), COLLECTION = component('appViews', 'collection', 'list');
const capture = (components, solution = 'synthetic_contracts') => ({ solution, scope: 'full', checksum: hex('c'), components, ambiguities: [], unclassifiedFiles: [],
  dependencies: dependencyReport([]) });
const change = (row, op, solution = 'synthetic_contracts') => ({ solution, key: row.key, service: row.service, kind: row.kind, op, digest: op === 'remove' ? null : row.digest });
const request = { kind: 'solution', solution: 'synthetic_contracts' };
const adapt = (artifacts, declaration, extra = {}) => adaptNativeCoverage({ request, artifacts, targetProfile: { digest: PROFILE }, declarations: [declaration], ...extra });
const allReasons = result => [...reasons(result.adapterBlockers), ...reasons(result.plan.blockers)];
const blockerOf = (result, reason) => result.adapterBlockers.find(row => row.reason === reason);

test('both schemas are vendored from the elma365 #103 merge commit and the catalog from #104', async () => {
  assert.deepEqual(NATIVE_CONTRACT_SOURCE, { repository: 'netbka/elma365', pullRequest: 103, issue: 60, merged: true, revision: 'c202d6980e4bfaacf449a6b3b829b8c6580287a7' });
  for (const [source, file] of [[COVERAGE_SOURCE, 'elma365-native-coverage-1.schema.json'], [RECEIPT_SOURCE, 'elma365-dependency-receipt-1.schema.json'],
    [CAPABILITY_CATALOG_SOURCE, 'elma365-native-coverage-1.capabilities.json']]) {
    const text = (await fs.readFile(new URL('../lib/contracts/' + file, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), source.sha256, file);
    assert.equal(source.intact, true, file);
  }
  assert.equal(COVERAGE_SOURCE.schemaRevision, '1.1'); assert.equal(RECEIPT_SOURCE.schemaRevision, '1.1');
  assert.equal(COVERAGE_SCHEMA_INTACT, true); assert.equal(RECEIPT_SCHEMA_INTACT, true);
  assert.equal(CAPABILITY_CATALOG.catalogDigest, '1f926e601b7a163ceb13609f3ba9c9f0dd281f37e8b611063109b3a4df7bb53d');
  assert.deepEqual([CAPABILITY_CATALOG_SOURCE.pullRequest, CAPABILITY_CATALOG_SOURCE.revision], [104, '3d819be5cfbb24c490d323ad845da050f01d6a5e']);
  assert.deepEqual(validateCapabilityCatalog(CAPABILITY_CATALOG), { valid: true, errors: [] });
  assert.deepEqual(NATIVE_RECEIPT_CONTRACTS[0].semantics, RECEIPT_SEMANTICS);
  assert.deepEqual(NATIVE_RECEIPT_CONTRACTS[0].semantics, { provenance: 'elma365-worker-read-only-observation-v1',
    expiry: 'verified-at-plus-at-most-P1D-and-stale-on-profile-change-v1', compatibility: 'observed-active-at-exact-version-on-exact-platform-v1' });
});

test('a drifted vendored schema fails every native validation closed', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-native-drift-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const lib = new URL('../lib/', import.meta.url);
  await fs.mkdir(path.join(directory, 'contracts'));
  for (const file of ['elma365-native-contracts.mjs', 'native-materialization-e1.mjs']) await fs.copyFile(new URL(file, lib), path.join(directory, file));
  for (const file of await fs.readdir(new URL('contracts/', lib))) await fs.copyFile(new URL('contracts/' + file, lib), path.join(directory, 'contracts', file));
  const schema = path.join(directory, 'contracts', 'elma365-dependency-receipt-1.schema.json');
  await fs.writeFile(schema, (await fs.readFile(schema, 'utf8')).replace('"maxLength": 2048', '"maxLength": 4096'));
  const drifted = await import(pathToFileURL(path.join(directory, 'elma365-native-contracts.mjs')).href);
  assert.equal(drifted.RECEIPT_SCHEMA_INTACT, false); assert.equal(drifted.COVERAGE_SCHEMA_INTACT, true);
  const report = observedReport({ installedSolutions: [installed('vendor_module')] });
  assert.deepEqual(errorsOf(drifted.validateTargetProfileReport(report)), ['contract-schema-drift']);
  assert.equal(drifted.wikiTargetProfile(report), null);
  assert.deepEqual(validateTargetProfileReport(report), { valid: true, errors: [] });
});

test('a valid widget declaration is native, but today\'s evidence still leaves the Target precondition and import receipts open', () => {
  const artifacts = [capture([WIDGET, VIEWER])];
  // Today: no observed Target profile report, so no precondition is declared.
  let result = adapt(artifacts, nativeDeclaration({ captures: artifacts, targetProfileDigest: PROFILE }));
  assert.equal(result.evidenceBasis, 'native');
  assert.ok(allReasons(result).includes('unknown-target-precondition'));
  assert.equal(result.wikiAccounting.planningComplete, false);
  // The Solution is installed on the observed Target: no preservation policy exists.
  const installedThere = observedReport({ targetProfileDigest: PROFILE, installedSolutions: [installed('synthetic_contracts', { namespaces: ['synthetic'] })] });
  result = adapt(artifacts, nativeDeclaration({ captures: artifacts, targetProfileDigest: PROFILE, targetReport: installedThere }));
  assert.ok(allReasons(result).includes('unproven-target-preservation'));
  // An empty Target plans, yet native import receipts and installation observation stay missing.
  result = adapt(artifacts, nativeDeclaration({ captures: artifacts, targetProfileDigest: PROFILE, targetReport: observedReport({ targetProfileDigest: PROFILE }) }));
  assert.equal(result.evidenceBasis, 'native');
  assert.deepEqual(result.adapterBlockers, []);
  assert.equal(result.wikiAccounting.planningComplete, true);
  assert.deepEqual(result.nativeEvidence.required, ['native-import-receipt', 'native-installation-observation']);
  assert.equal(result.nativeEvidence.complete, false);
  assert.equal(result.publicationReady, false); assert.equal(result.executionEnabled, false);
});

test('the adapter recomputes changesDigest from its own changes and rejects a declaration derived for others', () => {
  const artifacts = [capture([WIDGET, VIEWER])], report = observedReport({ targetProfileDigest: PROFILE });
  const replace = [change(WIDGET, 'replace')];
  const doc = nativeDeclaration({ captures: artifacts, changes: replace, targetProfileDigest: PROFILE, targetReport: report });
  assert.equal(doc.changesDigest, changesDigest(replace));
  assert.equal(adapt(artifacts, doc, { changes: replace }).evidenceBasis, 'native');
  assert.equal(adapt(artifacts, doc, { changes: replace }).changesDigest, changesDigest(replace));
  for (const changes of [[], [change(VIEWER, 'replace')], [...replace, change(VIEWER, 'replace')], [{ ...replace[0], digest: hex('0') }]]) {
    const result = adapt(artifacts, doc, { changes });
    assert.ok(blockerOf(result, 'invalid-native-coverage-declaration')?.errors.includes('stale-changes-binding'), JSON.stringify(changes));
    assert.equal(result.evidenceBasis, 'unknown');
  }
  // Omitting changes means "no changes", never "skip the check".
  assert.ok(blockerOf(adapt(artifacts, doc), 'invalid-native-coverage-declaration')?.errors.includes('stale-changes-binding'));
  // A forged digest is rejected even for the right changes.
  assert.ok(blockerOf(adapt(artifacts, { ...doc, changesDigest: hex('0') }, { changes: replace }), 'invalid-native-coverage-declaration')?.errors.includes('stale-changes-binding'));
});

test('synthetic-fixture evidence is synthetic, never native, and its basis cannot be upgraded', () => {
  const report = observedReport({ targetProfileDigest: PROFILE });
  // appViews collection preservation and widget add are proven on the synthetic fixture only.
  const cases = [[[capture([WIDGET, COLLECTION])], []], [[capture([WIDGET, VIEWER])], [change(VIEWER, 'add')]]];
  for (const [artifacts, changes] of cases) {
    const doc = nativeDeclaration({ captures: artifacts, changes, targetProfileDigest: PROFILE, targetReport: report });
    assert.equal(doc.evidenceBasis, 'synthetic-fixture');
    const result = adapt(artifacts, doc, { changes });
    assert.equal(result.evidenceBasis, 'synthetic');
    assert.ok(result.adapterBlockers.some(row => row.reason === 'synthetic-evidence-only' && row.evidenceBasis === 'synthetic-fixture'));
    assert.equal(result.wikiAccounting.planningComplete, false);
    // Relabelling the member, unit or declaration as a real export is rejected.
    const forged = structuredClone(doc);
    for (const unit of forged.units) { unit.evidenceBasis = 'native-real-export'; for (const member of unit.members) member.evidenceBasis = 'native-real-export'; }
    forged.evidenceBasis = 'native-real-export';
    const verdict = adapt(artifacts, forged, { changes });
    assert.ok(blockerOf(verdict, 'invalid-native-coverage-declaration')?.errors.includes('capability-mismatch'));
    assert.notEqual(verdict.evidenceBasis, 'native');
    const partly = structuredClone(doc); partly.evidenceBasis = 'native-real-export';
    assert.ok(blockerOf(adapt(artifacts, partly, { changes }), 'invalid-native-coverage-declaration')?.errors.includes('evidence-basis-mismatch'));
  }
});

test('over-claiming, self-inconsistent, stale or secret-bearing declarations are never admitted', () => {
  const artifacts = [capture([WIDGET, TEMPLATE])], report = observedReport({ targetProfileDigest: PROFILE });
  const edit = [change(TEMPLATE, 'replace')];
  const honest = nativeDeclaration({ captures: artifacts, changes: edit, targetProfileDigest: PROFILE, targetReport: report });
  assert.equal(honest.units[0].status, 'unsupported');
  assert.ok(allReasons(adapt(artifacts, honest, { changes: edit })).includes('unsupported-native-unit-member'));
  // Claiming the unsupported processor template edit as supported.
  const overclaim = structuredClone(honest), unit = overclaim.units[0];
  unit.members.push({ solution: 'synthetic_contracts', key: TEMPLATE.key, digest: TEMPLATE.digest, evidenceBasis: 'native-real-export' });
  unit.members.sort((a, b) => a.key < b.key ? -1 : 1); unit.unsupportedMembers = []; unit.status = 'supported';
  assert.deepEqual(blockerOf(adapt(artifacts, overclaim, { changes: edit }), 'invalid-native-coverage-declaration').errors, ['capability-mismatch']);
  const inconsistent = structuredClone(honest); inconsistent.units[0].status = 'supported';
  assert.ok(blockerOf(adapt(artifacts, inconsistent, { changes: edit }), 'invalid-native-coverage-declaration').errors.includes('unit-status-mismatch'));
  const stale = structuredClone(honest); stale.units[0].members[0].digest = hex('1');
  assert.ok(blockerOf(adapt(artifacts, stale, { changes: edit }), 'invalid-native-coverage-declaration').errors.includes('stale-member-digest'));
  const secret = structuredClone(honest); secret.evidenceRef = 'see C:\\exports\\private';
  assert.ok(blockerOf(adapt(artifacts, secret, { changes: edit }), 'invalid-native-coverage-declaration').errors.includes('host-path'));
  // Validator parity points: elma365 reason names.
  assert.deepEqual(errorsOf(validateNativeCoverageDeclaration(overclaim, { catalog: CAPABILITY_CATALOG, captures: artifacts, changes: edit })), ['capability-mismatch']);
  assert.deepEqual(changesFromRequest({ inputs: { solution: 's' }, operations: [{ key: 'k', service: 'widgets', op: 'remove', digest: null }] }),
    [{ solution: 's', key: 'k', service: 'widgets', op: 'remove', digest: null }]);
});

// P5: Target profile and receipts only through the bridge's read-only observation job.
const need = { service: 'widgets', namespace: 'vendor', code: 'ext', provider: { code: 'vendor_module', version: '2.1.0' } };
const plan = () => planReleaseScope({ request, importUnits: [{ id: 'A', status: 'supported', adapter: 'synthetic-v1', evidenceRef: 'synthetic-unit',
  targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target', targetProfileDigest: PROFILE },
  members: [{ solution: 'synthetic_contracts', key: WIDGET.key, digest: WIDGET.digest }] }],
  artifacts: [{ ...capture([WIDGET]), dependencies: { ...dependencyReport([]), rows: [{ category: 'dependencies', service: 'widgets', targetNamespace: 'vendor', targetCode: 'ext',
    source: { service: 'widgets', namespace: 'synthetic.app', code: 'form' }, status: 'paid-source-unavailable', candidates: [{ code: 'vendor_module', version: '2.1.0', paid: true }] }] } }] });
const binding = { name: 'VENDOR_API', kind: 'secret-reference', reference: 'secret-ref:synthetic/vendor-api', targetProfileDigest: PROFILE };
const NATIVE = { id: 'elma365-dependency-receipt', version: 1 };
const resolveNative = (extra = {}) => resolveDependencyEvidence({ plan: plan(), receiptContract: NATIVE, bindings: [binding], now: '2026-10-15T06:00:00.000Z', ...extra });

test('a verified receipt from an admitted bridge observation locks the dependency as native-receipt evidence', async () => {
  const { status, observation } = await observe({ installedSolutions: [installed('vendor_module')], requirements: [need] });
  assert.equal(status, 'observed');
  assert.equal(observation.source, 'operator-bridge');
  const result = resolveNative({ observation });
  assert.equal(result.evidenceBasis, 'native-receipt');
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.locks.map(row => [row.path, row.evidence, row.activation, row.targetProfileDigest]),
    [['licensed-preinstallation', 'native-receipt', 'verified-preinstalled', PROFILE]]);
  assert.deepEqual(result.targetProfile, { targetId: 'synthetic-target', environment: 'synthetic-target', digest: PROFILE });
  assert.equal(result.resolutionComplete, true);
  assert.equal(result.publicationReady, false); assert.equal(result.executionEnabled, false);
  // Expired after one day; an observation that is not verified stays assertion-only.
  assert.ok(resolveNative({ observation, now: '2026-10-16T00:00:01.000Z' }).rows[0].reasons.includes('expired-receipt'));
  const unverified = await observe({ installedSolutions: [installed('vendor_module', { entitlement: { status: 'unknown', evidenceRef: null } })], requirements: [need] });
  assert.ok(resolveNative({ observation: unverified.observation }).rows[0].reasons.includes('assertion-only-receipt'));
});

test('caller-supplied receipts, profiles or look-alike observations are never native evidence', async () => {
  const report = observedReport({ installedSolutions: [installed('vendor_module')], requirements: [need] });
  assert.deepEqual(validateTargetProfileReport(report), { valid: true, errors: [] });
  const profile = wikiTargetProfile(report);
  for (const extra of [{ targetProfile: profile, receipts: report.receipts }, { observation: { source: 'operator-bridge', report } },
    { observation: structuredClone((await observe({ installedSolutions: [installed('vendor_module')], requirements: [need] })).observation) }]) {
    const result = resolveNative(extra);
    assert.ok(reasons(result.blockers).includes('unobserved-target-profile'), JSON.stringify(Object.keys(extra)));
    assert.deepEqual(result.locks, []);
    assert.equal(result.resolutionComplete, false);
  }
  const { observation } = await observe({ installedSolutions: [installed('vendor_module')], requirements: [need] });
  const mixed = resolveNative({ observation, receipts: report.receipts });
  assert.ok(reasons(mixed.blockers).includes('unobserved-native-receipt'));
  assert.equal(observedTargetProfileReport({ ...observation }), null);
});

test('the observer admits only attested, valid, matching reports of an advertising worker', async () => {
  const base = { installedSolutions: [installed('vendor_module')], requirements: [need] };
  const cases = [
    [report => ({ ...report, observation: { ...report.observation, runId: 'replayed-run' } }), 'unattested-observation'],
    [report => ({ ...report, worker: { ...report.worker, nativeRevision: hex('e', 40) } }), 'native-worker-revision-mismatch'],
    [report => ({ ...report, targetId: 'other-target', receipts: [] }), 'target-mismatch'],
    [report => ({ ...report, observation: null }), 'unattested-observation'],
    [report => ({ ...report, inventoryDigest: hex('0') }), 'inventory-digest-mismatch'],
    // A self-inconsistent verified receipt: entitlement was not observed as verified.
    [report => ({ ...report, receipts: report.receipts.map(row => ({ ...row, entitlement: { status: 'unknown', evidenceRef: null } })) }), 'unproven-verified-receipt'],
    [report => ({ ...report, receipts: report.receipts.map(row => ({ ...row, provider: { ...row.provider, version: '9.9.9' } })) }), 'receipt-not-observed']
  ];
  for (const [patch, reason] of cases) {
    const result = await observe(base, { patch });
    assert.equal(result.status, 'invalid', reason); assert.equal(result.observation, null);
    assert.ok(result.errors.includes(reason), `${reason}: ${result.errors}`);
  }
  const silent = await bridgeWorker({ jobKinds: ['health', 'materialize'] });
  try {
    const quiet = configuredTargetProfileObserver({ env: silent.env, bridges: silent.store, log: assert.fail });
    assert.deepEqual(await quiet.observe({ targetId: 'synthetic-target', environment: 'synthetic-target' }),
      { status: 'unavailable', reason: 'target-profile-observation-not-advertised', observation: null });
    assert.equal(await silent.store.poll(silent.worker), null, 'no job was enqueued');
    await assert.rejects(configuredTargetProfileObserver({ env: { ...silent.env, WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'other-owner' }, bridges: silent.store, log: () => {} })
      .observe({ targetId: 'synthetic-target', environment: 'synthetic-target' }));
    await assert.rejects(quiet.observe({ targetId: 'https://host', environment: 'synthetic-target' }), /Configured Target/);
    // The configured Target id is sent as both targetId and environment; a caller cannot name another Target.
    await assert.rejects(quiet.observe({ targetId: 'other-target', environment: 'other-target' }), /Configured Target only/);
    await assert.rejects(quiet.observe({ environment: 'prod' }), /Configured Target only/);
  } finally { await silent.close(); }
  // The offline report is honestly unavailable and yields no observation.
  const unavailable = { contract: { ...NATIVE }, document: 'target-profile-report', worker: { ...WORKER }, status: 'unavailable', targetId: 'synthetic-target',
    environment: 'synthetic-target', targetProfileDigest: null, platformVersion: null, observedAt: '2026-10-15T00:00:00.000Z', changedAt: null, inventoryDigest: null,
    installedSolutions: [], receipts: [], observation: null, evidenceRef: null, publicationReady: false, executionEnabled: false,
    unavailable: { reason: 'live-target-access-unavailable', missing: ['target-profile-digest'], requiredOperation: 'read-only target-profile-observation job' } };
  const unavailableWorker = await bridgeWorker({ respond: () => ({ report: unavailable }) });
  try {
    const offline = configuredTargetProfileObserver({ env: unavailableWorker.env, bridges: unavailableWorker.store, log: assert.fail });
    const [outcome] = await Promise.all([offline.observe({ targetId: 'synthetic-target', environment: 'synthetic-target' }), unavailableWorker.serve()]);
    assert.equal(outcome.status, 'unavailable'); assert.equal(outcome.observation, null);
  } finally { await unavailableWorker.close(); }
  assert.equal(validateDependencyReceipt({}).valid, false);
});

test('the bridge store carries targetProfile as a read-only job: no artifact, no extra payload, report-only result', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-bridge-target-profile-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = bridgeStore(directory), { bridge, token } = await store.create('synthetic-owner', { name: 'Synthetic' });
  const worker = await store.authenticate(`Bearer ${token}`);
  await store.poll(worker, { capabilities: { jobKinds: ['targetProfile'] } });
  const payload = { contract: { ...NATIVE }, runId: 'run', targetId: 'synthetic-target', environment: 'synthetic-target', requirements: [] };
  assert.deepEqual([...TARGET_PROFILE_PAYLOAD_KEYS].sort(), Object.keys(payload).sort());
  await assert.rejects(store.enqueue(bridge.id, 'targetProfile', payload, { artifact: Buffer.from('candidate') }), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'targetProfile', { ...payload, code: 'synthetic_contracts' }), { statusCode: 422 });
  await assert.rejects(store.enqueue(bridge.id, 'targetProfile', payload, { inputs: [Buffer.from('x')] }), { statusCode: 422 });
  const report = observedReport({ runId: 'run' });
  const bad = store.enqueue(bridge.id, 'targetProfile', payload).then(value => ({ value }), error => ({ error }));
  let job = await store.poll(worker);
  assert.equal(job.kind, 'targetProfile'); assert.equal(job.hasArtifact, false);
  await store.complete(worker, job.id, { ok: true, result: { report, deploy: true } });
  assert.match((await bad).error.message, /target-profile-result-invalid/);
  const good = store.enqueue(bridge.id, 'targetProfile', payload);
  job = await store.poll(worker);
  await store.complete(worker, job.id, { ok: true, result: { report } });
  assert.deepEqual((await good).report, report);
  // End to end through the real store: the observer admits the worker's attested report.
  const observer = configuredTargetProfileObserver({ bridges: store, log: assert.fail, env: { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: bridge.id,
    WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'synthetic-owner', WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER.nativeRevision,
    WIKI_NATIVE_TARGET_PROFILE_TARGET: 'synthetic-target' } });
  const pending = observer.observe({ targetId: 'synthetic-target', environment: 'synthetic-target', requirements: [need] });
  // The observer reads the bridge before enqueueing; let it queue the job first.
  let queued = null;
  for (let attempt = 0; attempt < 50 && !queued; attempt++) queued = await store.poll(worker, { waitMs: 100 });
  assert.equal(queued.kind, 'targetProfile');
  assert.deepEqual([queued.payload.targetId, queued.payload.environment], ['synthetic-target', 'synthetic-target']);
  await store.complete(worker, queued.id, { ok: true, result: { report: observedReport({ runId: queued.payload.runId, installedSolutions: [installed('vendor_module')],
    requirements: queued.payload.requirements }) } });
  const outcome = await pending;
  assert.equal(outcome.status, 'observed');
  assert.equal(resolveNative({ observation: outcome.observation }).evidenceBasis, 'native-receipt');
});

test('stub stores, caller-chosen worker revisions and hand-built results are refused', async () => {
  // Only a store created by bridgeStore() is a bridge; the observer factory taking a revision is not exported.
  const stub = { get: async () => ({ capabilities: { jobKinds: ['targetProfile'] } }), enqueue: async () => ({ report: observedReport() }) };
  assert.equal(isBridgeStore(stub), false);
  const env = { WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: '00000000-0000-4000-8000-000000000001', WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: 'synthetic-owner',
    WIKI_NATIVE_MATERIALIZATION_REVISION: WORKER.nativeRevision, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'synthetic-target' };
  const logged = [];
  assert.equal(configuredTargetProfileObserver({ env, bridges: stub, log: message => logged.push(message) }), null);
  assert.match(logged[0], /no bridge store/);
  assert.equal(configuredTargetProfileObserver({ env: {}, bridges: stub, log: assert.fail }), null, 'unconfigured by default');
  assert.equal(configuredTargetProfileObserver({ env: { ...env, WIKI_NATIVE_MATERIALIZATION_REVISION: 'main' }, bridges: stub, log: () => {} }), null);
  // Without a configured Target id there is no observer.
  const unnamed = await bridgeWorker();
  try {
    const why = [];
    const { WIKI_NATIVE_TARGET_PROFILE_TARGET: ignored, ...withoutTarget } = unnamed.env;
    assert.equal(configuredTargetProfileObserver({ env: withoutTarget, bridges: unnamed.store, log: message => why.push(message) }), null);
    assert.match(why[0], /WIKI_NATIVE_TARGET_PROFILE_TARGET/);
    assert.equal(configuredTargetProfileObserver({ env: { ...unnamed.env, WIKI_NATIVE_TARGET_PROFILE_TARGET: 'https://host' }, bridges: unnamed.store, log: () => {} }), null);
  } finally { await unnamed.close(); }
  assert.equal('bridgeTargetProfileObserver' in bridgeModule, false);
  // The expected revision is the configured one: a caller argument is ignored, and a report from
  // the worker the caller names instead of the configured one is refused.
  const other = hex('e', 40);
  const named = await observe({ installedSolutions: [installed('vendor_module')], requirements: [need], worker: { ...WORKER, nativeRevision: other } });
  assert.equal(named.status, 'invalid'); assert.ok(named.errors.includes('native-worker-revision-mismatch'));
  const worker = await bridgeWorker({ respond: payload => ({ report: observedReport({ runId: payload.runId, worker: { ...WORKER, nativeRevision: other } }) }) });
  try {
    const observer = configuredTargetProfileObserver({ env: worker.env, bridges: worker.store, nativeRevision: other, log: assert.fail });
    assert.equal(observer.nativeRevision, WORKER.nativeRevision);
    const [outcome] = await Promise.all([observer.observe({ targetId: 'synthetic-target', environment: 'synthetic-target' }), worker.serve()]);
    assert.deepEqual(outcome.errors, ['native-worker-revision-mismatch']);
  } finally { await worker.close(); }
  // Results are branded by the producing module; copies are not.
  const artifacts = [capture([WIDGET])];
  const coverage = adapt(artifacts, nativeDeclaration({ captures: artifacts, targetProfileDigest: PROFILE }));
  assert.equal(isNativeCoverageResult(coverage), true);
  assert.equal(isNativeCoverageResult({ ...coverage }), false); assert.equal(isNativeCoverageResult(structuredClone(coverage)), false);
  const { observation } = await observe({ installedSolutions: [installed('vendor_module')], requirements: [need] });
  const resolution = resolveNative({ observation });
  assert.equal(isDependencyResolution(resolution), true);
  assert.equal(isDependencyResolution({ ...resolution, resolutionComplete: true }), false);
});

test('catalog kinds match the casing of real exports exactly: widget, never WIDGET', () => {
  // A real Contracts export manifest records kinds such as widget, template and permissionSettings,
  // exactly as the catalog keys them; matching is exact and nothing is case-normalized.
  assert.ok(CAPABILITY_CATALOG.capabilities.some(row => row.service === 'widgets' && row.kind === 'widget'));
  assert.ok(CAPABILITY_CATALOG.capabilities.some(row => row.service === 'processor' && row.kind === 'template'));
  const upper = { ...WIDGET, kind: 'WIDGET' }, artifacts = [capture([upper])];
  const doc = nativeDeclaration({ captures: artifacts, targetProfileDigest: PROFILE });
  assert.deepEqual(doc.units[0].unsupportedMembers.map(row => row.reason), ['unknown-capability']);
  assert.equal(nativeDeclaration({ captures: [capture([WIDGET])], targetProfileDigest: PROFILE }).units[0].status, 'supported');
});

test('a non-designated Target answers unavailable/target-not-designated and yields no observation', async () => {
  // As the elma365 #106 worker answers on a bridge whose configured Target is not designated.
  const report = { contract: { ...NATIVE }, document: 'target-profile-report', worker: { ...WORKER }, status: 'unavailable', targetId: 'synthetic-target',
    environment: 'synthetic-target', targetProfileDigest: null, platformVersion: null, observedAt: '2026-10-15T00:00:00.000Z', changedAt: null, inventoryDigest: null,
    installedSolutions: [], receipts: [], observation: null, evidenceRef: null, publicationReady: false, executionEnabled: false,
    unavailable: { reason: 'target-not-designated', missing: ['target-designation'], requiredOperation: 'designate this non-production Target for read-only observation' } };
  const worker = await bridgeWorker({ respond: payload => {
    assert.deepEqual([payload.targetId, payload.environment], ['synthetic-target', 'synthetic-target']);
    return { report };
  } });
  try {
    const observer = configuredTargetProfileObserver({ env: worker.env, bridges: worker.store, log: assert.fail });
    const [outcome] = await Promise.all([observer.observe({ requirements: [need] }), worker.serve()]);
    assert.deepEqual([outcome.status, outcome.reason, outcome.observation], ['unavailable', 'target-not-designated', null]);
    assert.ok(reasons(resolveNative({ observation: outcome.observation }).blockers).includes('unobserved-target-profile'));
  } finally { await worker.close(); }
});

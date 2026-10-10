import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managedWorkspaceStore } from '../lib/managed-workspace-store.mjs';
import { projectStore } from '../lib/projects.mjs';
import { readArchive } from '../lib/e365.mjs';
import { adaptNativeCoverage, SYNTHETIC_COVERAGE_CONTRACT } from '../lib/native-coverage-adapter.mjs';
import { resolveDependencyEvidence, SYNTHETIC_RECEIPT_CONTRACT } from '../lib/dependency-resolver.mjs';
import { dependencyReport } from '../lib/dependency-evidence.mjs';
import { prepareMaterializationRequest, materializeNative, materializationStatus, INSPECTED_NATIVE_MATERIALIZATION,
  NATIVE_MATERIALIZATION_CONTRACTS, SYNTHETIC_MATERIALIZATION_CONTRACT } from '../lib/native-materialization.mjs';
import { zip } from './fixture.mjs';

// Synthetic Contracts-shaped B/A/C archives. Every component carries a declared
// resource; `div` also carries coupled client source. The manifest keeps an
// unknown native field that materialization must not drop.
const owner = 'synthetic-owner';
const actor = { id: 'resolver', login: 'resolver@example.org', provider: 'local' };
const NOW = '2026-10-10T12:00:00.000Z';
const PROFILE = { targetId: 'synthetic-target', environment: 'isolated', digest: 'synthetic-profile', platformVersion: '2025.4', changedAt: '2026-10-01T00:00:00.000Z' };
const COMPILER = { contract: 'synthetic-compiler', profileDigest: 'c'.repeat(64), platformVersion: '2025.4', evidenceRef: 'synthetic-compiler-evidence', services: ['widgets'] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const record = (code, value) => ({ code, namespace: 'contracts', kind: 'WIDGET', path: code + '.json', nativeHistory: [{ v: 1 }],
  ...(value === 'no-resource' ? {} : { resources: [{ path: 'resources/' + code + '.po' }] }) });
const entries = rows => [
  ['package.json', { code: 'synthetic_contracts', type: 'SOLUTION' }],
  ['widgets/manifest.json', { nativeUnknown: { keep: true }, entities: rows.map(([code, value]) => record(code, value)) }],
  ...rows.flatMap(([code, value]) => [
    ['widgets/' + code + '.json', { descriptor: { clientScripts: `const value = ${JSON.stringify(value)};` }, unknownNativeField: code }],
    ...(value === 'no-resource' ? [] : [['widgets/resources/' + code + '.po', `msgid "${code}"\nmsgstr "${value}"\n`]]),
    ...(code === 'div' ? [['widgets/div.json.client.ts', `export const value = ${JSON.stringify(value)};\n`]] : [])])
];
const archive = rows => zip(entries(rows));

async function setup(t, rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-materialization-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projects = projectStore(directory), store = managedWorkspaceStore(directory, projects);
  const upload = async (rows, scope) => {
    const project = await projects.create(owner, await archive(rows));
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  const state = await store.create(owner, { name: 'Synthetic contracts', baselineOwner: 'Base', snapshot: await upload(rows, 'full') }, actor);
  const base = { artifactId: state.baselineId, revision: 0, confirmed: true };
  const key = code => state.current.find(row => row.code === code).key;
  const scope = codes => ({ name: 'Synthetic scope', members: codes.map(key), confirmed: true, deletions: [] });
  const prepare = async (rows, team, codes) => (await store.prepare(state.id, owner, { kind: 'change', snapshot: await upload(rows, 'partial'),
    expectedRevision: (await store.get(state.id, owner)).revision, team, taskRef: 'SYNTHETIC-' + team, sameSourceConfirmed: true, base, changeScope: scope(codes) }, actor));
  const accept = review => store.accept(state.id, owner, review.artifactId, { expectedRevision: review.revision,
    reviewedDigest: review.artifactDigest, reviewedBoundaryKeys: review.rows.filter(row => row.boundaryCrossing).map(row => row.key) }, actor);
  const resolve = async (change, decisions = {}) => {
    const current = await store.get(state.id, owner), merge = await store.merge(state.id, owner, change.artifactId);
    const saved = await store.resolveMerge(state.id, owner, change.artifactId, { expectedRevision: current.revision, planDigest: merge.plan.planDigest,
      expectedResolutionId: merge.head?.id ?? null, decisions: Object.fromEntries(Object.entries(decisions).map(([code, choice]) => [key(code), choice])),
      reason: 'Synthetic reviewed choice' }, actor);
    // The merge view adds a derived status; the stored revision excludes it.
    const { status, ...head } = saved.head;
    assert.equal(status, 'current'); return head;
  };
  // Every artifact contributing bytes, read back from private storage.
  const originals = async artifactIds => new Map(await Promise.all(artifactIds.map(async id => [id, await store.original(state.id, owner, id)])));
  return { store, state, key, prepare, accept, resolve, originals };
}

// P4 over the resolved revision (one unit per component) and P5 over that plan.
function evidence(resolution, { stale = [] } = {}) {
  const components = resolution.result.filter(row => row.digest).map(row => {
    const [service, namespace, code] = JSON.parse(row.key);
    return { key: row.key, service, namespace, code, digest: stale.includes(code) ? 'stale-' + row.digest : row.digest };
  });
  const capture = { solution: 'synthetic_contracts', scope: 'full', checksum: resolution.resultDigest, components, ambiguities: [], unclassifiedFiles: [], dependencies: dependencyReport([]) };
  const coverage = adaptNativeCoverage({ request: { kind: 'solution', solution: 'synthetic_contracts' }, artifacts: [capture], targetProfile: PROFILE,
    declarations: [{ contract: SYNTHETIC_COVERAGE_CONTRACT, nativeRevision: 'f'.repeat(40), adapter: 'synthetic-native-adapter', evidenceRef: 'synthetic-declaration',
      targetProfileDigest: PROFILE.digest, captures: [{ solution: capture.solution, artifactChecksum: capture.checksum }],
      units: components.map(row => ({ id: row.code, status: 'supported', evidenceRef: 'synthetic-unit', members: [{ solution: capture.solution, key: row.key, digest: row.digest }],
        targetPrecondition: { mode: 'empty-target', evidenceRef: 'synthetic-empty-target' } })) }] });
  const dependencies = resolveDependencyEvidence({ plan: coverage.plan, targetProfile: PROFILE, receiptContract: SYNTHETIC_RECEIPT_CONTRACT, now: NOW });
  return { coverage, dependencies };
}

// Test-only native assembler: start from the baseline bytes, apply whole-component
// operations and regenerate changed manifests from the source manifests. Entry
// order is reversed so container bytes differ while defined content is equal.
const identity = row => JSON.stringify([row.namespace, row.code, row.kind]);
function syntheticAdapter({ tamper = files => files, validation = (sha256, request) => ({ status: 'passed', validator: 'synthetic-validator', evidenceRef: 'synthetic-validation',
  artifactSha256: sha256, contract: SYNTHETIC_MATERIALIZATION_CONTRACT, targetProfileDigest: request.inputs.targetProfile.digest, compilerProfileDigest: request.inputs.compiler.profileDigest }),
  echo = request => request.inputsDigest, fail = false, nest = false } = {}) {
  const calls = [];
  return { calls, id: 'synthetic-assembler', contract: SYNTHETIC_MATERIALIZATION_CONTRACT, nativeRevision: 'e'.repeat(40),
    async materialize({ request, originals }) {
      calls.push(request.inputsDigest);
      if (fail) throw Error('native failure with private detail');
      const read = new Map(await Promise.all([...originals].map(async ([id, bytes]) => [id, await readArchive(bytes)])));
      const files = new Map(read.get(request.inputs.base.artifactId));
      for (const op of request.operations) for (const file of op.files) {
        if (op.op === 'remove') files.delete(file.path); else files.set(file.path, read.get(op.sourceArtifactId).get(file.path));
      }
      // Files an old component version declared but its replacement does not.
      for (const file of request.expected.files) if (file.action === 'remove') files.delete(file.path);
      for (const service of new Set(request.operations.map(op => op.service))) {
        const manifestPath = service + '/manifest.json', manifest = JSON.parse(files.get(manifestPath));
        const recordFor = (artifactId, key) => JSON.parse(read.get(artifactId).get(manifestPath)).entities.find(row => identity(row) === identity({ namespace: JSON.parse(key)[1], code: JSON.parse(key)[2], kind: 'WIDGET' }));
        for (const op of request.operations.filter(op => op.service === service)) {
          const at = manifest.entities.findIndex(row => identity(row) === identity(recordFor(request.inputs.base.artifactId, op.key) ?? {}));
          if (op.op === 'remove') manifest.entities.splice(at, 1);
          else if (at >= 0) manifest.entities[at] = recordFor(op.sourceArtifactId, op.key);
          else manifest.entities.push(recordFor(op.sourceArtifactId, op.key));
        }
        files.set(manifestPath, Buffer.from(JSON.stringify(manifest)));
      }
      let output = [...tamper(files)].reverse();
      // Same unpacked paths, different native container layout.
      if (nest) output = [...output.filter(([name]) => !name.startsWith('widgets/')),
        ['widgets.zip', await zip(output.filter(([name]) => name.startsWith('widgets/')).map(([name, value]) => [name.slice('widgets/'.length), value]))]];
      const bytes = await zip(output);
      return { inputsDigest: echo(request), artifacts: [{ solution: request.inputs.solution, bytes }], validation: validation(sha(bytes), request) };
    } };
}
const reasons = rows => rows.map(row => row.reason);
const prepareFor = async (env, change, resolution, extra = {}) => {
  const state = await env.store.get(env.state.id, owner), artifact = await env.store.artifact(env.state.id, owner, change.artifactId);
  const ids = [...new Set([state.baselineId, change.artifactId, ...state.artifacts.map(row => row.id)])];
  return prepareMaterializationRequest({ state, artifact, resolution, ...evidence(resolution), compiler: COMPILER, targetProfile: PROFILE,
    originals: await env.originals(ids), ...extra });
};

test('no native materialization contract is pinned; real adapters fail closed as unavailable', async t => {
  assert.deepEqual(NATIVE_MATERIALIZATION_CONTRACTS, []);
  assert.equal(INSPECTED_NATIVE_MATERIALIZATION.status, 'unavailable');
  const env = await setup(t, [['div', 0], ['outside', 0]]);
  const c = await env.prepare([['div', 2]], 'C', ['div']);
  const resolution = await env.resolve(c);
  const request = await prepareFor(env, c, resolution);
  assert.equal(request.status, 'ready', JSON.stringify(request.blockers)); assert.equal(request.evidenceBasis, 'synthetic');
  const originals = await env.originals(request.inputs.originals.map(row => row.artifactId));
  for (const adapter of [null, { ...syntheticAdapter(), contract: { id: 'elma365-native-materialization', version: 1 } }]) {
    const { manifest, artifacts } = await materializeNative({ request, originals, adapter, now: NOW });
    assert.equal(manifest.status, 'unavailable'); assert.deepEqual(artifacts, []);
    assert.ok(reasons(manifest.blockers).includes('native-materialization-contract-unavailable'));
    assert.equal(manifest.releaseEligible, false); assert.equal(manifest.evidenceBasis, 'unknown');
    if (adapter) assert.deepEqual(adapter.calls, [], 'an unpinned contract is never invoked');
  }
});

test('no-edit round trip preserves every baseline byte, resource, manifest and layout', async t => {
  const env = await setup(t, [['div', 0], ['outside', 0]]);
  const c = await env.prepare([['div', 0]], 'C', ['div']);
  const resolution = await env.resolve(c);
  const request = await prepareFor(env, c, resolution);
  assert.equal(request.status, 'ready'); assert.deepEqual(request.operations, []);
  assert.ok(request.expected.files.every(row => row.action === 'preserve'));
  assert.ok(request.expected.files.some(row => row.path === 'widgets/resources/div.po'));
  const adapter = syntheticAdapter();
  const { manifest, artifacts } = await materializeNative({ request, originals: await env.originals(request.inputs.originals.map(row => row.artifactId)), adapter, now: NOW });
  assert.equal(manifest.status, 'materialized'); assert.equal(manifest.fileActions.preserve, request.expected.files.length);
  assert.notEqual(manifest.artifacts[0].sha256, request.inputs.base.checksum, 'container bytes are recorded, not compared');
  assert.equal(artifacts[0].sha256, manifest.artifacts[0].sha256);
  // Synthetic adapters test accounting only: never native evidence or eligible.
  assert.deepEqual(reasons(manifest.blockers), ['synthetic-evidence-only']);
  assert.equal(manifest.evidenceBasis, 'synthetic'); assert.equal(manifest.releaseEligible, false);
  assert.equal(manifest.publicationReady, false); assert.equal(manifest.executionEnabled, false);
  assert.equal(materializationStatus(manifest, request), 'current');
  assert.ok(Object.isFrozen(manifest) && Object.isFrozen(request));
});

test('one edit replaces only the whole component and keeps unknown manifest fields', async t => {
  const env = await setup(t, [['div', 0], ['conly', 0], ['outside', 0]]);
  const c = await env.prepare([['conly', 2]], 'C', ['conly']);
  const resolution = await env.resolve(c);
  const request = await prepareFor(env, c, resolution);
  assert.equal(request.status, 'ready');
  assert.deepEqual(request.operations.map(row => [JSON.parse(row.key).at(-1), row.op, row.sourceArtifactId]), [['conly', 'replace', c.artifactId]]);
  const actions = Object.fromEntries(request.expected.files.map(row => [row.path, row.action]));
  assert.equal(actions['widgets/conly.json'], 'replace'); assert.equal(actions['widgets/resources/conly.po'], 'replace');
  assert.equal(actions['widgets/manifest.json'], 'native-manifest'); assert.equal(actions['widgets/outside.json'], 'preserve');
  assert.equal(actions['package.json'], 'preserve');
  const { manifest } = await materializeNative({ request, originals: await env.originals(request.inputs.originals.map(row => row.artifactId)), adapter: syntheticAdapter(), now: NOW });
  assert.equal(manifest.status, 'materialized'); assert.deepEqual(manifest.fileActions, { preserve: 6, replace: 2, remove: 0, 'native-manifest': 1 });

  // A new version that no longer declares its resource removes the old file.
  const dropped = await env.prepare([['conly', 'no-resource']], 'D', ['conly']);
  const next = await prepareFor(env, dropped, await env.resolve(dropped));
  assert.equal(next.expected.files.find(row => row.path === 'widgets/resources/conly.po').action, 'remove');
  const result = await materializeNative({ request: next, originals: await env.originals(next.inputs.originals.map(row => row.artifactId)), adapter: syntheticAdapter(), now: NOW });
  assert.equal(result.manifest.status, 'materialized');
  assert.equal((await readArchive(result.artifacts[0].bytes)).has('widgets/resources/conly.po'), false);
  // Keeping the stale resource is a defect, not a tolerated difference.
  const kept = await materializeNative({ request: next, originals: await env.originals(next.inputs.originals.map(row => row.artifactId)),
    adapter: syntheticAdapter({ tamper: files => files.set('widgets/resources/conly.po', Buffer.from('stale')) }), now: NOW });
  assert.ok(reasons(kept.manifest.blockers).includes('removed-path-present'));
});

test('two same-base changes and a resolved conflict materialize together with coupled source/runtime', async t => {
  const env = await setup(t, [['div', 0], ['aonly', 0], ['conly', 0], ['outside', 0]]);
  const a = await env.prepare([['div', 1], ['aonly', 1]], 'A', ['div', 'aonly']);
  const c = await env.prepare([['div', 2], ['conly', 2]], 'C', ['div', 'conly']);
  await env.accept(a);
  const resolution = await env.resolve(c, { div: 'take-incoming' });
  const request = await prepareFor(env, c, resolution);
  assert.equal(request.status, 'ready');
  assert.deepEqual(Object.fromEntries(request.operations.map(row => [JSON.parse(row.key).at(-1), [row.op, row.sourceArtifactId, row.coupled]])),
    { aonly: ['replace', a.artifactId, false], conly: ['replace', c.artifactId, false], div: ['replace', c.artifactId, true] });
  const originals = await env.originals(request.inputs.originals.map(row => row.artifactId));
  assert.deepEqual(request.inputs.originals.map(row => row.artifactId).sort(), [env.state.baselineId, a.artifactId, c.artifactId].sort());
  const currentSource = (await readArchive(originals.get(a.artifactId))).get('widgets/div.json.client.ts');
  const { manifest, artifacts } = await materializeNative({ request, originals, adapter: syntheticAdapter(), now: NOW });
  assert.equal(manifest.status, 'materialized');
  const files = await readArchive(artifacts[0].bytes);
  assert.match(files.get('widgets/aonly.json').toString(), /value = 1/); assert.match(files.get('widgets/conly.json').toString(), /value = 2/);
  assert.match(files.get('widgets/div.json.client.ts').toString(), /value = 2/); assert.match(files.get('widgets/outside.json').toString(), /value = 0/);
  assert.deepEqual(JSON.parse(files.get('widgets/manifest.json')).nativeUnknown, { keep: true });

  // Each defect in the native output fails closed against the exact expected outcome.
  const cases = [
    [{ tamper: files => { const m = JSON.parse(files.get('widgets/manifest.json')); delete m.nativeUnknown; files.set('widgets/manifest.json', Buffer.from(JSON.stringify(m))); return files; } }, 'manifest-fields-changed'],
    [{ tamper: files => files.set('widgets/resources/outside.po', Buffer.from('changed')) }, 'preserved-bytes-changed'],
    [{ tamper: files => files.set('widgets/extra.bin', Buffer.from('new')) }, 'unexpected-output-path'],
    [{ tamper: files => { files.delete('widgets/resources/aonly.po'); return files; } }, 'missing-output-path'],
    // Mixed coupled source: incoming descriptor with the current runtime source.
    [{ tamper: files => files.set('widgets/div.json.client.ts', currentSource) }, 'replaced-bytes-mismatch'],
    [{ nest: true }, 'native-layout-changed'],
    [{ validation: () => null }, 'native-validation-missing'],
    [{ validation: (sha256, request) => ({ status: 'passed', validator: 'synthetic-validator', evidenceRef: 'synthetic-validation', artifactSha256: '0'.repeat(64),
      contract: SYNTHETIC_MATERIALIZATION_CONTRACT, targetProfileDigest: request.inputs.targetProfile.digest, compilerProfileDigest: request.inputs.compiler.profileDigest }) }, 'native-validation-mismatch'],
    [{ echo: () => 'stale' }, 'stale-native-output'],
    [{ fail: true }, 'native-materialization-failed']
  ];
  for (const [options, reason] of cases) {
    const result = await materializeNative({ request, originals, adapter: syntheticAdapter(options), now: NOW });
    assert.ok(reasons(result.manifest.blockers).includes(reason), reason + ' -> ' + JSON.stringify(result.manifest.blockers));
    assert.equal(result.manifest.releaseEligible, false);
    if (!reason.startsWith('native-validation')) { assert.notEqual(result.manifest.status, 'materialized'); assert.deepEqual(result.artifacts, []); }
    assert.doesNotMatch(JSON.stringify(result.manifest), /private detail/);
  }
});

test('changed or missing inputs block before the adapter and stale the build manifest', async t => {
  const env = await setup(t, [['div', 0], ['later', 0], ['outside', 0]]);
  const a = await env.prepare([['div', 1]], 'A', ['div']);
  const c = await env.prepare([['div', 2]], 'C', ['div']);
  await env.accept(a);
  const resolution = await env.resolve(c, { div: 'take-incoming' });
  const request = await prepareFor(env, c, resolution);
  const originals = await env.originals(request.inputs.originals.map(row => row.artifactId));
  const { manifest } = await materializeNative({ request, originals, adapter: syntheticAdapter(), now: NOW });
  assert.equal(manifest.status, 'materialized');

  const state = await env.store.get(env.state.id, owner), artifact = await env.store.artifact(env.state.id, owner, c.artifactId);
  const all = await env.originals([...new Set([...state.artifacts.map(row => row.id), c.artifactId])]);
  const base = { state, artifact, resolution, ...evidence(resolution), compiler: COMPILER, targetProfile: PROFILE, originals: all };
  const blocked = async (overrides, reason) => {
    const next = await prepareMaterializationRequest({ ...base, ...overrides });
    assert.equal(next.status, 'blocked', reason); assert.ok(reasons(next.blockers).includes(reason), reason + ' -> ' + JSON.stringify(next.blockers));
    const adapter = syntheticAdapter(), result = await materializeNative({ request: next, originals: all, adapter, now: NOW });
    assert.equal(result.manifest.status, 'blocked'); assert.deepEqual(adapter.calls, []);
    return next;
  };
  const without = new Map(all); without.delete(c.artifactId);
  await blocked({ originals: without }, 'missing-original');
  const wrong = new Map(all); wrong.set(c.artifactId, await archive([['div', 9]]));
  await blocked({ originals: wrong }, 'original-checksum-mismatch');
  await blocked({ compiler: null }, 'missing-compiler-profile');
  await blocked({ compiler: { ...COMPILER, services: [] } }, 'unsupported-compiler-scope');
  await blocked({ compiler: { ...COMPILER, platformVersion: '2024.1' } }, 'compiler-platform-mismatch');
  await blocked({ coverage: null }, 'missing-native-coverage');
  await blocked(evidence(resolution, { stale: ['div'] }), 'stale-native-unit-member');
  await blocked({ dependencies: evidence(resolution, { stale: ['outside'] }).dependencies }, 'stale-dependency-resolution');
  await blocked({ targetProfile: { ...PROFILE, digest: 'other-profile' } }, 'stale-dependency-profile');
  await blocked({ resolution: { ...resolution, resultDigest: 'forged' } }, 'corrupt-resolution');

  // A changed compiler lock changes the exact inputs and stales the manifest.
  const relocked = await prepareMaterializationRequest({ ...base, compiler: { ...COMPILER, profileDigest: 'd'.repeat(64) } });
  assert.equal(relocked.status, 'ready'); assert.notEqual(relocked.inputsDigest, request.inputsDigest);
  assert.equal(materializationStatus(manifest, relocked), 'stale');
  assert.equal(materializationStatus({ ...manifest, status: 'materialized', releaseEligible: true }, request), 'corrupt');

  // A later accepted change moves the current state: the resolution is stale.
  const d = await env.prepare([['later', 3]], 'D', ['later']);
  await env.accept(d);
  const moved = await env.store.get(env.state.id, owner);
  const stale = await prepareMaterializationRequest({ ...base, state: moved, originals: await env.originals([...new Set([...moved.artifacts.map(row => row.id), c.artifactId])]) });
  assert.ok(reasons(stale.blockers).includes('stale-resolution'));
});

import { INSPECTED_NATIVE_MATERIALIZATION, NATIVE_MATERIALIZATION_CONTRACTS, prepareMaterializationRequest, materializeNative,
  materializationStatus, isMaterializationManifest } from './native-materialization.mjs';
import { isConfiguredMaterializationAdapter, observedTargetProfileReport } from './native-materialization-bridge.mjs';
import { composedBuildEligibility } from './composed-build-eligibility.mjs';
import { wikiTargetProfile } from './elma365-native-contracts.mjs';

// Opt-in native build of a resolved Solution change (#94 MR-03, PLAN-01 C2). It binds the
// C1-eligible units, dependency locks and observed Target profile into one E1 request
// (elma365-native-materialization@1), sends it through the configured operator bridge and
// accepts only a validated receipt bound to that exact request and output. A build never
// freezes, imports, delivers or publishes; `freezeComposedBuild` (PLAN-01 B1) freezes only the
// held validated build, and delivery stays with the single #11 coordinator.

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
// Coverage facts only a native import of the built package can produce. They cannot exist before
// the build, so they do not block it; materializeNative keeps them as
// `native-installation-evidence-incomplete`, so such a build is never release-eligible.
export const POST_BUILD_FACTS = Object.freeze(['native-import-receipt', 'native-installation-observation']);

/** The composer's build capability: available only with a configured materialization adapter
 * (WIKI_NATIVE_MATERIALIZATION_*) whose bridge is healthy. `detail` names why it is not. */
export async function composedBuildCapability(adapter) {
  const known = { reference: `${INSPECTED_NATIVE_MATERIALIZATION.repository}#${INSPECTED_NATIVE_MATERIALIZATION.issue}`,
    contracts: NATIVE_MATERIALIZATION_CONTRACTS.map(row => `${row.id}@${row.version}`), missing: [...INSPECTED_NATIVE_MATERIALIZATION.missing] };
  const unavailable = detail => ({ available: false, reason: 'native-materialization-unavailable', detail, ...known });
  if (!isConfiguredMaterializationAdapter(adapter)) return unavailable('native-materialization-unconfigured');
  const health = await adapter.health();
  return health?.healthy === true ? { available: true, reason: null, detail: null, ...known } : unavailable(health?.reason || 'materialization-bridge-unknown');
}

/** Eligibility gates that still block a build: every reason except the post-build facts above. */
export function buildBlockingGates(eligibility) {
  return (eligibility?.gates ?? []).map(gate => ({ ...gate, reasons: gate.reasons.filter(row => !(gate.id === 'coverage'
    && row.reason === 'missing-native-evidence' && POST_BUILD_FACTS.includes(row.fact))) }))
    .filter(gate => gate.status !== 'verified' && gate.reasons.length);
}

// Outcome of an executed build, from the manifest materializeNative returned.
const RECEIPT_FAULTS = new Set(['native-receipt-invalid', 'native-worker-revision-mismatch', 'stale-native-output', 'unexpected-native-artifacts']);
function outcomeOf(manifest) {
  if (manifest.status === 'materialized') return 'validated';
  if (manifest.status !== 'failed') return manifest.status;
  const reasons = manifest.blockers.map(row => row.reason);
  if (reasons.includes('native-materialization-failed') || reasons.includes('native-outcome-unknown')) return 'tool-fault';
  if (reasons.includes('native-validation-failed')) return 'failed';
  if (reasons.some(reason => RECEIPT_FAULTS.has(reason))) return 'unbound-receipt';
  return 'output-rejected';
}

/** One native build for a resolved pending change. Trusted server code: the request body names
 * only the change and the Solution revision it was read at; every input is re-derived here.
 * `evidence` is the server's source of native coverage, dependency resolution, Target profile
 * observation and compiler lock; each is accepted only with its in-process provenance mark.
 * Returns `{statusCode, body, build}`; only `validated` carries a build manifest, and `build`
 * (manifest, output bytes and the exact evidence it was bound to) exists only then. */
export async function runComposedBuild({ solutionId, input, managed, catalog, adapter, evidence = null, now = () => new Date().toISOString() }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['artifactId', 'expectedRevision'].includes(key))
    || typeof input.artifactId !== 'string' || !Number.isInteger(input.expectedRevision)) fail('Invalid build request');
  const capability = await composedBuildCapability(adapter);
  if (!capability.available) return { statusCode: 409, body: { outcome: 'unavailable', reason: capability.detail, composedBuild: capability, manifest: null } };

  const loaded = await managed.withResolvedInputs(solutionId, catalog, { artifactId: input.artifactId }, current => current);
  if (loaded.state.revision !== input.expectedRevision) fail('The Solution changed; refresh before building', 409);
  const ids = [...new Set([loaded.state.baselineId, input.artifactId, ...loaded.state.artifacts.map(row => row.id)])];
  const originals = new Map(await Promise.all(ids.map(async id => [id, await managed.original(solutionId, catalog, id)])));
  const supplied = evidence ? await evidence({ solutionId, state: loaded.state, artifact: loaded.artifact, resolution: loaded.resolution, originals }) : {};
  const { coverage = null, dependencies = null, observation = null, compiler = null } = supplied ?? {};
  // The Target profile is the admitted observation's, never a supplied value.
  const targetProfile = wikiTargetProfile(observedTargetProfileReport(observation) ?? {});

  const eligibility = composedBuildEligibility({ coverage, dependencies, observation, materialization: capability, now: now() });
  const blocking = buildBlockingGates(eligibility);
  if (blocking.length) return { statusCode: 409, body: { outcome: 'blocked', gates: blocking, eligibility, manifest: null } };

  const prepare = (state, artifact, resolution) => prepareMaterializationRequest({ state, artifact, resolution, coverage, dependencies, compiler, targetProfile, originals });
  const request = await prepare(loaded.state, loaded.artifact, loaded.resolution);
  if (request.status !== 'ready') return { statusCode: 409, body: { outcome: 'blocked', blockers: request.blockers, eligibility, manifest: null } };
  // The request carries exactly the units, locks and profile eligibility verified.
  if (request.inputs.coverage?.planDigest !== eligibility.planDigest || request.inputs.dependencies?.planDigest !== eligibility.planDigest
    || request.inputs.targetProfile.digest !== eligibility.targetProfile?.digest)
    return { statusCode: 409, body: { outcome: 'blocked', blockers: [{ reason: 'stale-build-eligibility' }], eligibility, manifest: null } };

  const result = await materializeNative({ request, originals, adapter, now: now(), coverage });
  const outcome = outcomeOf(result.manifest);
  const receipt = result.manifest.receipt ? { status: result.manifest.receipt.status, worker: result.manifest.receipt.worker } : null;
  if (outcome !== 'validated') return { statusCode: 422, body: { outcome, reasons: result.manifest.blockers, receipt, manifest: null } };

  // Any input that moved while the worker ran invalidates the build: the Solution binding, the
  // review events, and the request re-derived from current state must all be unchanged.
  const binding = { artifactId: input.artifactId, revision: loaded.state.revision, resolutionId: loaded.resolution.id, revisionDigest: loaded.resolution.revisionDigest,
    resultDigest: loaded.resolution.resultDigest, planDigest: loaded.resolution.planDigest, reviewDigest: loaded.reviewDigest };
  let current;
  try { current = await managed.withResolvedInputs(solutionId, catalog, binding, row => row); }
  catch (error) { if (error.statusCode !== 409) throw error; }
  if (!current || materializationStatus(result.manifest, await prepare(current.state, current.artifact, current.resolution)) !== 'current')
    return { statusCode: 409, body: { outcome: 'stale', reasons: [{ reason: 'stale-build-input' }], receipt, manifest: null } };

  // A native build keeps `native-installation-evidence-incomplete` until P8 observes the import, so
  // it is never release-eligible here; freezing re-derives every input again (B1).
  return { statusCode: 201, body: { outcome, receipt, manifest: result.manifest },
    build: { solutionId, artifactId: input.artifactId, revision: loaded.state.revision, binding, adapter: { id: adapter.id, nativeRevision: adapter.nativeRevision },
      result, coverage, dependencies, compiler, targetProfile } };
}

/** Freezes the Solution's held validated build into a composed candidate (#94 MR-06, PLAN-01 B1).
 * The body only confirms which build: `{artifactId, expectedRevision, manifestDigest}` must equal the
 * held build. Manifest, bytes, units, locks, Target profile and compiler come from the held build and
 * are re-derived from current Solution state by `composed.freeze`; nothing in the body is bound.
 * Returns `{statusCode, body, frozen}`; `frozen` is true only when a candidate was created. */
export async function freezeComposedBuild({ solutionId, input, held, adapter, composed, actor }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['artifactId', 'expectedRevision', 'manifestDigest'].includes(key))
    || typeof input.artifactId !== 'string' || !Number.isInteger(input.expectedRevision) || typeof input.manifestDigest !== 'string') fail('Invalid freeze request');
  const refused = (reason, statusCode = 409, detail = null) => ({ statusCode, body: { outcome: 'refused', reason, ...(detail ? { detail } : {}), candidate: null } });
  // Only a build this process validated: C2 holds nothing for a failed, tool-fault, unbound or stale build.
  const manifest = held?.result?.manifest;
  if (!held || !isMaterializationManifest(manifest) || manifest.status !== 'materialized') return refused('no-validated-build');
  // Built for another Solution, change, revision, manifest or by an adapter other than the configured one.
  if (held.solutionId !== solutionId || held.artifactId !== input.artifactId || manifest.manifestDigest !== input.manifestDigest
    || !isConfiguredMaterializationAdapter(adapter) || held.adapter?.id !== adapter.id || held.adapter?.nativeRevision !== adapter.nativeRevision
    || manifest.adapter?.id !== adapter.id || manifest.adapter?.nativeRevision !== adapter.nativeRevision || manifest.evidenceBasis !== 'native')
    return refused('foreign-build');
  if (held.revision !== input.expectedRevision) return refused('stale-build', 409, 'expected-revision');
  try {
    const candidate = await composed.freeze(solutionId, { artifactId: held.artifactId, build: held.result, coverage: held.coverage,
      dependencies: held.dependencies, compiler: held.compiler, targetProfile: held.targetProfile, inputs: held.binding }, actor);
    return { statusCode: 201, body: { outcome: 'frozen', candidate }, frozen: true };
  } catch (error) {
    // The store re-derives every input; a moved revision, resolution, review event or lock is stale.
    if (error.statusCode === 409) return refused('stale-build', 409, error.message);
    throw error;
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { actorIdentity } from './actors.mjs';
import { planDigest } from './dependency-resolver.mjs';
import { prepareMaterializationRequest, materializationStatus, isMaterializationManifest } from './native-materialization.mjs';
import { POST_BUILD_FACTS } from './composed-build.mjs';

// Frozen composed candidates (PLAN-01 P7, #94 MR-06). A candidate binds one
// exact P6 build manifest and its output bytes to the P3 resolution, P4 units
// and order, P5 dependency/profile locks and the Solution review events. It is
// delivered only through the single #11 deliveryStore; this store never
// dispatches, materializes or infers native idempotency.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const SYNTHETIC = 'synthetic-evidence-only';
// A validated native build still lacks the facts only its native import can produce (PLAN-01 B1).
// That blocker is frozen with the candidate and keeps it non-release-eligible; any other blocks.
const POST_BUILD = 'native-installation-evidence-incomplete';
const postBuildOnly = row => row.reason === POST_BUILD && Array.isArray(row.missing) && row.missing.length > 0
  && row.missing.every(fact => POST_BUILD_FACTS.includes(fact));
const text = (value, label) => { if (typeof value !== 'string' || !value.trim() || value.length > 4000) fail(`${label} is required (1â€“4000 characters)`); return value.trim(); };

export function composedCandidateStore(directory, managed, { catalog, now = () => new Date().toISOString() } = {}) {
  const root = path.resolve(directory, 'composed-candidates');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (typeof id !== 'string' || !uuid.test(id)) fail('Composed candidate not found', 404); return path.join(root, id); };
  const read = async (solutionId, id) => {
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(location(id), 'candidate.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('Composed candidate not found', 404); throw error; }
    // A candidate belongs to exactly one Solution; another root never resolves it.
    if (record.schemaVersion !== 1 || record.id !== id || record.solutionId !== solutionId) fail('Composed candidate not found', 404);
    return record;
  };
  const write = async record => {
    const temp = path.join(location(record.id), crypto.randomUUID() + '.tmp');
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temp, path.join(location(record.id), 'candidate.json'));
  };
  const checkedBytes = async record => {
    const bytes = await fs.readFile(path.join(location(record.id), 'candidate.e365'));
    if (hash(bytes) !== record.candidate.sha256) fail('Composed candidate bytes changed', 409);
    return bytes;
  };
  const authorize = async (solutionId, id) => { await managed.authorize(solutionId, catalog); return read(solutionId, id); };
  // Solution -> candidate lock order; the binding is rechecked under the Solution queue.
  const guarded = async (solutionId, id, operation) => {
    const record = await authorize(solutionId, id);
    return managed.withAcceptedMerge(solutionId, catalog, record.binding, () => serial(operation));
  };
  const view = (record, inputsStatus) => structuredClone({ ...record, inputsStatus,
    deliverable: inputsStatus === 'current' && record.approval?.revision === record.revision });

  return {
    authorize: async (solutionId, id) => { await authorize(solutionId, id); },
    async list(solutionId) {
      await managed.authorize(solutionId, catalog);
      let names = [];
      try { names = await fs.readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const rows = [];
      for (const name of names.filter(name => uuid.test(name))) {
        try { rows.push(await this.get(solutionId, name)); } catch (error) { if (error.statusCode !== 404) throw error; }
      }
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async get(solutionId, id) {
      const record = await authorize(solutionId, id);
      let status = 'current';
      try { await guarded(solutionId, id, async () => { await checkedBytes(await read(solutionId, id)); }); }
      catch (error) { if (![404, 409].includes(error.statusCode)) throw error; status = 'stale'; }
      return view(record, status);
    },
    // Trusted server code only: HTTP never supplies build bytes or evidence.
    // The request is re-derived from current Solution state and stored originals,
    // so a manifest for any other inputs is refused as stale.
    // `inputs`, when given, is the Solution binding the build validated against (PLAN-01 B1): any
    // revision, resolution or review event since then makes the build stale even with an equal request.
    async freeze(solutionId, { artifactId, build, coverage, dependencies, compiler, targetProfile, inputs = null } = {}, performedBy) {
      const actor = actorIdentity(performedBy);
      const manifest = build?.manifest, outputs = build?.artifacts ?? [];
      if (manifest?.status !== 'materialized' || outputs.length !== 1) fail('A verified materialized build is required', 409);
      const blockers = (manifest.blockers ?? []).filter(row => row.reason !== SYNTHETIC && !(manifest.evidenceBasis === 'native' && postBuildOnly(row)));
      if (blockers.length) fail('The build manifest has unresolved blockers', 409);
      const pendingNativeEvidence = [...new Set((manifest.blockers ?? []).filter(postBuildOnly).flatMap(row => row.missing))].sort();
      const bytes = Buffer.from(outputs[0].bytes ?? []);
      if (manifest.artifacts?.length !== 1 || hash(bytes) !== manifest.artifacts[0].sha256 || outputs[0].sha256 !== manifest.artifacts[0].sha256)
        fail('Build output bytes do not match the manifest', 409);
      const loaded = await managed.withAcceptedMerge(solutionId, catalog, { artifactId }, current => current);
      const ids = [...new Set([loaded.state.baselineId, artifactId, ...loaded.state.artifacts.map(row => row.id)])];
      const originals = new Map(await Promise.all(ids.map(async id => [id, await managed.original(solutionId, catalog, id)])));
      const request = await prepareMaterializationRequest({ state: loaded.state, artifact: loaded.artifact, resolution: loaded.resolution,
        coverage, dependencies, compiler, targetProfile, originals });
      if (request.status !== 'ready') fail('Current Solution inputs do not produce a ready materialization request', 409);
      if (materializationStatus(manifest, request) !== 'current') fail('The build manifest is stale for the current Solution inputs', 409);
      if (dependencies.targetProfile?.digest !== targetProfile.digest) fail('Dependency evidence belongs to another Target profile', 409);
      const selected = new Set(request.inputs.coverage.units.map(unit => unit.id));
      const order = request.inputs.coverage.importOrder;
      if (!Array.isArray(order) || !request.inputs.coverage.units.length) fail('A native import order is required', 409);
      const units = order.filter(id => selected.has(id)).map(id => { const unit = request.inputs.coverage.units.find(row => row.id === id); return { id, adapter: unit.adapter, members: unit.members }; });
      if (units.length !== selected.size) fail('Every selected native unit needs an import position', 409);
      const binding = { solutionId, revision: loaded.revision, artifactId, resolutionId: loaded.resolution.id,
        revisionDigest: loaded.resolution.revisionDigest, resultDigest: loaded.resolution.resultDigest, planDigest: loaded.resolution.planDigest,
        reviewDigest: loaded.reviewDigest, requestDigest: manifest.requestDigest, inputsDigest: manifest.inputsDigest, manifestDigest: manifest.manifestDigest,
        coveragePlanDigest: planDigest(coverage.plan), dependencyPlanDigest: dependencies.planDigest, targetProfileDigest: targetProfile.digest };
      if (inputs && Object.keys(inputs).some(key => !Object.hasOwn(binding, key) || inputs[key] !== binding[key]))
        fail('The Solution changed after the build validated; rebuild before freezing', 409);
      const byId = new Map([...loaded.state.artifacts, loaded.artifact].map(row => [row.id, row]));
      return managed.withAcceptedMerge(solutionId, catalog, binding, () => serial(async () => {
        const id = crypto.randomUUID(), at = now(), staging = path.join(root, '.pending-' + id);
        const record = { schemaVersion: 1, id, solutionId, code: request.inputs.solution, revision: 1, createdAt: at,
          candidate: { id: crypto.randomUUID(), sha256: hash(bytes), size: bytes.length, provenance: 'composed-native-materialization', createdAt: at },
          binding, units, targetProfile: { digest: targetProfile.digest, platformVersion: targetProfile.platformVersion },
          compiler: { contract: request.inputs.compiler.contract, profileDigest: request.inputs.compiler.profileDigest },
          // Eligibility only from a manifest materializeNative produced, never a hand-built one.
          adapter: manifest.adapter, evidenceBasis: manifest.evidenceBasis, validation: structuredClone(manifest.validation ?? null),
          releaseEligible: isMaterializationManifest(manifest) && manifest.releaseEligible === true && !pendingNativeEvidence.length, pendingNativeEvidence,
          // Content provenance (who uploaded/resolved the inputs) stays separate
          // from the actor who froze or later executes a delivery.
          provenance: { originals: request.inputs.originals.map(row => ({ artifactId: row.artifactId, checksum: row.checksum,
            uploadedBy: byId.get(row.artifactId)?.uploadedBy ?? null })), resolution: { id: loaded.resolution.id, actor: loaded.resolution.actor } },
          frozenBy: actor, approval: null, history: [{ action: 'freeze', actor, at, revision: 1 }] };
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        await fs.mkdir(staging, { mode: 0o700 });
        try {
          await fs.writeFile(path.join(staging, 'candidate.e365'), bytes, { mode: 0o600, flag: 'wx' });
          await fs.writeFile(path.join(staging, 'candidate.json'), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
          await fs.rename(staging, location(id));
        } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
        return view(record, 'current');
      }));
    },
    // Review acceptance of the exact frozen bytes. It is not a deployment permission.
    change(solutionId, id, input, performedBy) {
      const actor = actorIdentity(performedBy);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'revision', 'reason'].includes(key)))
        fail('Invalid composed candidate request');
      if (!['approve', 'revoke'].includes(input.action)) fail('Unknown composed candidate action');
      return guarded(solutionId, id, async () => {
        const record = await read(solutionId, id); await checkedBytes(record);
        if (!Number.isInteger(input.revision) || input.revision !== record.revision) fail('Composed candidate changed; refresh before deciding', 409);
        const reason = text(input.reason, 'Reason'), at = now();
        if (input.action === 'approve' && record.approval?.revision === record.revision) fail('The candidate is already approved', 409);
        record.revision++;
        record.approval = input.action === 'approve' ? { actor, at, revision: record.revision, candidateId: record.candidate.id, sha256: record.candidate.sha256,
          reason, scope: 'composed-candidate-review' } : null;
        record.history.push({ action: input.action, actor, at, revision: record.revision, reason });
        await write(record);
        return view(record, 'current');
      });
    },
    // Trusted delivery consumer: Solution -> candidate guards are held through
    // the callback. It must not re-enter these stores or a delivery queue.
    withCandidate(solutionId, id, operation) {
      if (typeof operation !== 'function') fail('A trusted candidate operation is required');
      return guarded(solutionId, id, async () => {
        const record = await read(solutionId, id), bytes = await checkedBytes(record);
        if (record.approval?.revision !== record.revision || record.approval.candidateId !== record.candidate.id || record.approval.sha256 !== record.candidate.sha256)
          fail('A current approved composed candidate is required', 409);
        return operation({ id, revision: record.revision, approval: structuredClone(record.approval), candidate: structuredClone(record.candidate),
          code: record.code, bytes, sourceAssociation: structuredClone(record.binding),
          composed: structuredClone({ units: record.units, targetProfile: record.targetProfile, evidenceBasis: record.evidenceBasis, releaseEligible: record.releaseEligible }) });
      });
    }
  };
}

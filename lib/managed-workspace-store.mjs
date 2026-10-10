import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { canonicalInventory, inventoryHash } from './delivery-verification.mjs';
import { actorIdentity } from './actors.mjs';
import { changeDiscussion, appendChangeReview } from './change-reviews.mjs';
import { sourceAnchorIndex, SOURCE_ANCHOR_VERSION } from './solution-visual.mjs';
import { explanationContext, explanationView } from './solution-explanations.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewManagedChange, acceptManagedChange,
  previewReconciliation, acceptReconciliation, setManagedWorkspaceArchived, declareManagedChangeScope,
  planManagedComponentMerge, resolveManagedMerge, managedResolutionStatus, MERGE_RESOLUTION_CHOICES } from './managed-workspace.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const fields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid managed workspace request');
  return structuredClone(value);
};
const actor = owner => { if (typeof owner !== 'string' || !owner.trim()) fail('An authenticated owner is required', 401); };
const label = value => typeof value === 'string' && value.trim() && value.length <= 160;
const revision = (record, expected) => {
  if (!Number.isInteger(expected) || record.state.revision !== expected) fail('Workspace revision changed; refresh before accepting', 409);
};

// ponytail: one store instance per private directory in one service process.
// A multi-process service needs a shared transactional lock, not another instance.
export function managedWorkspaceStore(directory, projects, { sharedAccess = false, dependencyContext = async () => ({}) } = {}) {
  const root = path.resolve(directory, 'managed-workspaces');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (typeof id !== 'string' || !uuid.test(id)) fail('Workspace not found', 404); return path.join(root, id); };
  const read = async (id, owner) => {
    actor(owner);
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(location(id), 'workspace.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('Workspace not found', 404); throw error; }
    if (!sharedAccess && record.owner !== owner) fail('Workspace not found', 404);
    if (record.schema !== 1 || record.state.id !== id) fail('Unsupported or corrupt workspace record', 409);
    return record;
  };
  const artifacts = record => [...record.state.artifacts, ...record.pending.map(row => row.artifact)];
  const baseEvidence = artifact => structuredClone(artifact.baseDeclaration ?? {
    schemaVersion: 1, status: 'unknown', method: 'not-recorded', ancestryVerified: false
  });
  const scopeEvidence = artifact => structuredClone(artifact.changeScopeDeclaration ?? { schemaVersion: 1, status: 'unknown', method: 'not-recorded' });
  const declareBase = (record, value, declaredBy) => {
    const declaration = { schemaVersion: 1, status: 'unknown', method: 'not-declared',
      ancestryVerified: false, declaredBy, declaredAt: new Date().toISOString() };
    if (value === undefined) return declaration;
    const input = fields(value, ['artifactId', 'revision', 'confirmed']);
    if (!uuid.test(input.artifactId) || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.confirmed !== true)
      fail('Declare an accepted full base artifact and its revision explicitly');
    // Membership is resolved only in this lifecycle root. Pending artifacts and
    // the current virtual component state cannot establish a full original base.
    const artifact = record.state.artifacts.find(row => row.id === input.artifactId);
    if (!artifact || artifact.scope !== 'full' || artifact.scopeDeclaration?.scope !== 'full' ||
        artifact.snapshot?.checksum !== artifact.checksum) fail('Base must be an accepted full artifact in this Solution', 409);
    const acceptedRevision = record.state.history.find(row => row.type === 'created' && row.baselineId === artifact.id) ? 0
      : record.state.history.find(row => row.type === 'baseline-accepted' && row.id === artifact.id)?.revision;
    if (acceptedRevision !== input.revision) fail('Base acceptance revision does not match the captured full artifact', 409);
    return { ...declaration, status: 'declared', method: 'explicit-assertion', artifactId: artifact.id,
      revision: acceptedRevision, checksum: artifact.checksum, scope: artifact.scope,
      snapshot: structuredClone(artifact.snapshot), scopeDeclaration: structuredClone(artifact.scopeDeclaration) };
  };
  const bytesFor = async (id, artifact) => {
    if (!uuid.test(artifact.id)) fail('Invalid stored artifact identity', 409);
    let bytes;
    try { bytes = await fs.readFile(path.join(location(id), artifact.id + '.e365')); }
    catch (error) { if (error.code === 'ENOENT') fail('Managed artifact is missing', 409); throw error; }
    if (hash(bytes) !== artifact.checksum) fail('Managed artifact checksum mismatch', 409);
    return bytes;
  };
  const checked = async (id, owner) => {
    const record = await read(id, owner);
    for (const artifact of artifacts(record)) await bytesFor(id, artifact);
    return record;
  };
  const save = async record => {
    const dest = location(record.state.id), temp = path.join(dest, 'workspace-' + crypto.randomUUID() + '.tmp');
    try {
      await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, path.join(dest, 'workspace.json'));
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };
  const audit = (record, action, performedBy, artifactId) => {
    if (!performedBy) return;
    record.audit ??= [];
    record.audit.push({ action, actor: actorIdentity(performedBy), at: record.updatedAt,
      revision: record.state.revision, ...(artifactId ? { artifactId } : {}) });
  };
  const capture = async (owner, value, requiredScope, performedBy) => {
    const ref = fields(value, ['projectId', 'snapshotId', 'scope', 'scopeConfirmed']);
    if (typeof ref.projectId !== 'string' || !uuid.test(ref.projectId) ||
        typeof ref.snapshotId !== 'string' || !uuid.test(ref.snapshotId)) fail('Select an explicit project and snapshot');
    if (ref.scope !== requiredScope || ref.scopeConfirmed !== true) fail(`Confirm the ${requiredScope} export scope explicitly`);
    // Use the existing serialized, owner-scoped snapshot capture; never fall back
    // to a project's current selection and never accept caller-supplied Source data.
    if (!await projects.get(ref.projectId, owner)) fail('Snapshot not found', 404);
    const captured = await projects.snapshot(ref.projectId, owner, ref.snapshotId);
    const row = captured.metadata.snapshots?.find(item => item.id === ref.snapshotId);
    const bytes = Buffer.from(captured.bytes);
    if (!row || row.projectId !== ref.projectId || captured.metadata.activeRevision !== row.parserRevision ||
        hash(bytes) !== row.checksum) fail('Snapshot association or checksum changed', 409);
    const context = await dependencyContext({ projectId: ref.projectId, snapshotId: row.id, checksum: row.checksum });
    const parsed = await parseManagedArtifact(bytes, { scope: requiredScope, dependencyContext: context });
    const artifact = { ...parsed, snapshot: { projectId: ref.projectId, snapshotId: row.id,
      checksum: row.checksum, parserRevision: row.parserRevision, parserVersion: row.parserVersion,
      createdAt: row.createdAt, source: structuredClone(row.source ?? null) },
    scopeDeclaration: { scope: requiredScope, declaredBy: performedBy?.id || owner, declaredAt: new Date().toISOString(), method: 'explicit-assertion' },
    ...(row.uploadedBy ? { uploadedBy: row.uploadedBy } : {}) };
    return { artifact, bytes };
  };
  const preview = (record, pending) => {
    if (pending.supersededBy) fail('Change was replaced; open the current review', 409);
    revision(record, pending.revision);
    if (record.state.status !== 'active') fail('Reopen the workspace before changing it', 409);
    return pending.kind === 'change' ? previewManagedChange(record.state, pending.artifact, pending.options)
      : previewReconciliation(record.state, pending.artifact);
  };
  const pendingFor = (record, artifactId) => {
    const pending = record.pending.find(row => row.artifact.id === artifactId);
    if (!pending) fail('Prepared artifact not found', 404);
    return pending;
  };
  const reviewFor = (record, artifactId) => {
    const pending = record.pending.find(row => row.artifact.id === artifactId);
    if (pending) return pending;
    const completed = record.completedReviews?.find(row => row.artifactId === artifactId);
    if (!completed) fail('Change review not found', 404);
    return { ...completed, artifact: record.state.artifacts.find(row => row.id === artifactId) };
  };
  // Resolutions are append-only side records bound to an exact B/A/C plan. They
  // never advance the workspace revision, accept the result or create bytes.
  const resolutionsFor = (record, artifactId) => (record.mergeResolutions || []).filter(row => row.inputs.incoming.artifactId === artifactId);
  const mergeView = (record, artifactId) => {
    const history = resolutionsFor(record, artifactId), pending = record.pending.find(row => row.artifact.id === artifactId);
    let plan = null, reason = null, message = null;
    if (!pending) reason = 'completed';
    else if (pending.kind !== 'change') reason = 'not-a-change';
    else if (pending.supersededBy) reason = 'superseded';
    else if (record.state.status !== 'active') reason = 'archived';
    else try { plan = planManagedComponentMerge(record.state, pending.artifact); }
    catch (error) { if (!error.statusCode) throw error; reason = 'plan-unavailable'; message = error.message; }
    const head = history.at(-1) ?? null;
    const status = row => managedResolutionStatus(row, row === head ? plan : null) === 'corrupt' ? 'corrupt'
      : row === head ? managedResolutionStatus(row, plan) : 'superseded';
    return structuredClone({ artifactId, available: !!plan, reason, message, plan, choices: MERGE_RESOLUTION_CHOICES,
      head: head && { ...head, status: status(head) }, history: history.map(row => ({ ...row, status: status(row) })) });
  };
  const baselineAcceptedAt = record => record.baselineAcceptedAt ?? (record.state.reconciliations.length ? null : record.createdAt);
  const openFindings = record => {
    const groups = new Map();
    for (const row of record.completedReviews || []) groups.set(row.changeId, { ...row, artifact: record.state.artifacts.find(artifact => artifact.id === row.artifactId) });
    for (const row of record.pending.filter(row => !row.supersededBy)) groups.set(row.changeId || row.artifact.id, row);
    return [...groups.values()].flatMap(row => changeDiscussion(record, row).findings.filter(finding => finding.type === 'reject' && finding.status === 'open')
      .map(finding => ({ id: finding.id, text: finding.text, actor: finding.actor, artifactId: row.artifact.id, anchorStatus: finding.anchorStatus })));
  };
  const view = record => structuredClone({ ...record.state, createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(record.audit ? { audit: record.audit, createdBy: record.audit[0].actor } : {}),
    baselineAcceptedAt: baselineAcceptedAt(record),
    openFindings: openFindings(record),
    reviewedChanges: (record.completedReviews || []).map(row => ({ artifactId: row.artifactId, changeId: row.changeId,
      kind: row.kind, options: row.options, acceptedAt: row.acceptedAt,
      baseDeclaration: baseEvidence(record.state.artifacts.find(artifact => artifact.id === row.artifactId) ?? {}),
      changeScopeDeclaration: scopeEvidence(record.state.artifacts.find(artifact => artifact.id === row.artifactId) ?? {}) })),
    pending: record.pending.filter(row => !row.supersededBy).map(row => ({ artifactId: row.artifact.id, kind: row.kind, revision: row.revision,
      stale: row.revision !== record.state.revision || record.state.status !== 'active', options: row.options,
      snapshot: row.artifact.snapshot, scopeDeclaration: row.artifact.scopeDeclaration,
      sourceDeclaration: row.artifact.sourceDeclaration, baseDeclaration: baseEvidence(row.artifact), changeScopeDeclaration: scopeEvidence(row.artifact), attention: row.attention, changeId: row.changeId,
      decision: changeDiscussion(record, row).blocking ? 'needs-changes' : null })) });
  return {
    // HTTP authorization precedes method/body validation without exposing state.
    async authorize(id, owner) { await read(id, owner); },
    explanation(id, owner, input, performedBy) { return serial(async () => {
      const options = fields(input, ['scope', 'artifactId', 'source', 'nodeId', 'text', 'expectedRevision', 'expectedVersion', 'expectedFingerprint']);
      const { text, expectedRevision, expectedVersion, expectedFingerprint, ...target } = options;
      const record = await checked(id, owner);
      const context = await explanationContext(record, target, artifact => bytesFor(id, artifact));
      let result = explanationView(context, record.explanations);
      if (performedBy === undefined) {
        if (text !== undefined || expectedRevision !== undefined || expectedVersion !== undefined || expectedFingerprint !== undefined) fail('Invalid explanation read');
        return result;
      }
      const identity = actorIdentity(performedBy);
      revision(record, expectedRevision);
      if (!context.writable) fail(context.reason, 409);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== result.version || expectedFingerprint !== context.fingerprint)
        fail('Объяснение или источник изменились. Обновите состояние; введённый текст сохранён.', 409);
      if (typeof text !== 'string' || !text.trim() || text.length > 16000) fail('Объяснение должно содержать от 1 до 16000 символов');
      record.explanations ??= [];
      if (record.explanations.length >= 1000) fail('Достигнут предел истории объяснений', 422);
      record.updatedAt = new Date().toISOString();
      record.explanations.push({ id: crypto.randomUUID(), key: context.key, target, fingerprint: context.fingerprint,
        title: context.title, text: text.trim(), sources: context.draft.sources, engine: context.draft.engine,
        actor: identity, at: record.updatedAt, revision: record.state.revision });
      audit(record, 'explanation-saved', identity, target.artifactId);
      await save(record);
      return explanationView(context, record.explanations);
    }); },
    withActive(id, owner, operation) { return serial(async () => {
      const record = await read(id, owner);
      if (record.state.status !== 'active') fail('Reopen the Solution before changing code', 409);
      return operation();
    }); },
    async create(owner, input, performedBy) {
      actor(owner);
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['name', 'baselineOwner', 'snapshot']);
      return serial(async () => {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        let count = 0;
        for (const id of await fs.readdir(root)) {
          if (!uuid.test(id)) continue;
          try { await read(id, owner); count++; } catch (error) { if (error.statusCode !== 404) throw error; }
        }
        if (count >= 50) fail('Maximum 50 managed workspaces per owner');
        const { artifact, bytes } = await capture(owner, options.snapshot, 'full', performedBy);
        const state = createManagedWorkspace(artifact, options), now = new Date().toISOString();
        const record = { schema: 1, owner, state, createdAt: now, updatedAt: now, baselineAcceptedAt: now, pending: [] };
        audit(record, 'created', performedBy, artifact.id);
        const staging = path.join(root, '.pending-' + state.id);
        await fs.mkdir(staging, { mode: 0o700 });
        try {
          await fs.writeFile(path.join(staging, artifact.id + '.e365'), bytes, { mode: 0o600, flag: 'wx' });
          await fs.writeFile(path.join(staging, 'workspace.json'), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
          await fs.rename(staging, location(state.id));
        } catch (error) {
          await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
        return view(record);
      });
    },
    get(id, owner) { return serial(async () => view(await checked(id, owner))); },
    // Read-only physical association for the existing release capability. This
    // never composes a package or grants permission to deliver it.
    acceptedExport(id, owner, expectedRevision) { return this.withAcceptedExport(id, owner, expectedRevision, result => result); },
    withAcceptedExport(id, owner, expectedRevision, operation) { return serial(async () => {
      const record = await checked(id, owner); revision(record, expectedRevision);
      const state = record.state;
      if (state.status !== 'active') fail('Reopen the Solution before preparing an accepted export', 409);
      if (record.pending.some(row => !row.supersededBy) || openFindings(record).length)
        fail('Complete pending reviews and resolve open findings before preparing an accepted export', 409);
      const baselineIndex = state.artifacts.findIndex(row => row.id === state.baselineId);
      const artifact = state.artifacts[baselineIndex];
      if (!artifact || artifact.scope !== 'full' || artifact.scopeDeclaration?.scope !== 'full' || artifact.snapshot?.checksum !== artifact.checksum)
        fail('An explicitly accepted full export is required', 409);
      // A component no-op cannot prove unchanged package/dependency metadata.
      // A later accepted full export must establish that evidence again.
      if (state.artifacts.slice(baselineIndex + 1).length)
        fail('Accepted changes require a later reviewed full export; virtual state is not a physical package', 409);
      const bytes = await bytesFor(id, artifact);
      const parsed = await parseManagedArtifact(bytes, { id: artifact.id, scope: 'full' });
      const sameComponents = components => {
        if (!Array.isArray(components) || components.length !== parsed.components.length) return false;
        const indexed = new Map(components.map(row => [row.key, row.digest]));
        return indexed.size === components.length && parsed.components.every(row => indexed.get(row.key) === row.digest);
      };
      if (parsed.ambiguities.length || parsed.solution !== state.solution ||
          !sameComponents(artifact.components) || !sameComponents(state.current))
        fail('Accepted state differs from the full export; retained or ambiguous changes need a matching full export', 409);
      const inventory = canonicalInventory((await parseProject(bytes)).inventory);
      if (!inventory.length) fail('The accepted export inventory is empty', 409);
      return operation({ bytes, evidence: {
        policy: 'accepted-full-export-v1', solutionId: id, solution: state.solution,
        revision: state.revision, artifactId: artifact.id, sha256: hash(bytes),
        reviewDigest: hash(JSON.stringify(record.reviewEvents || [])),
        snapshot: structuredClone(artifact.snapshot), inventory, inventoryHash: inventoryHash(inventory),
        scopeDeclaration: structuredClone(artifact.scopeDeclaration), acceptedAt: baselineAcceptedAt(record),
        acceptedBy: structuredClone(record.audit?.findLast(row => row.artifactId === artifact.id && ['created', 'baseline-accepted'].includes(row.action))?.actor ?? null),
        provenance: 'unchanged-accepted-full-export', deploymentAuthorized: false, verified: false,
        checks: { artifactIntegrity: 'pass', acceptedStateAssociation: 'pass',
          compiler: 'not-run', dependencies: 'not-run', target: 'not-run', readBack: 'not-run', businessFlow: 'not-run' }
      } });
    }); },
    async list(owner, { archived = false } = {}) {
      actor(owner);
      if (typeof archived !== 'boolean') fail('Select active or archived workspaces explicitly');
      return serial(async () => {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        const rows = [];
        for (const id of await fs.readdir(root)) {
          if (!uuid.test(id)) continue;
          let record;
          try { record = await read(id, owner); } catch (error) { if (error.statusCode === 404) continue; throw error; }
          if ((record.state.status === 'archived') !== archived) continue;
          const state = record.state, baseline = state.artifacts.find(row => row.id === state.baselineId);
          rows.push({ id, name: state.name, status: state.status, revision: state.revision, solution: state.solution,
            baselineId: state.baselineId, baselineSnapshot: baseline.snapshot, baselineOwner: state.baselineOwner,
            sourceReference: state.artifacts.find(row => row.snapshot.source)?.snapshot.source ?? null,
            baselineAcceptedAt: baselineAcceptedAt(record), changedComponents: state.current.filter(row => row.interventionId).length,
            pendingCount: record.pending.filter(row => !row.supersededBy).length,
            createdAt: record.createdAt, updatedAt: record.updatedAt });
          if (record.audit) rows.at(-1).createdBy = record.audit[0].actor;
        }
        return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    },
    async prepare(id, owner, input, performedBy) {
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['kind', 'snapshot', 'expectedRevision', 'team', 'taskRef', 'baselineOwner', 'sameSourceConfirmed', 'supersedesArtifactId', 'base', 'changeScope']);
      return serial(async () => {
        const record = await checked(id, owner); revision(record, options.expectedRevision);
        if (record.state.status !== 'active') fail('Reopen the workspace before changing it', 409);
        if (options.sameSourceConfirmed !== true) fail('Confirm this snapshot belongs to the workspace Source');
        const { kind } = options;
        const previous = options.supersedesArtifactId ? reviewFor(record, options.supersedesArtifactId) : null;
        if (previous && (previous.kind !== kind || previous.supersededBy)) fail('Select the current change of the same kind to replace', 409);
        if (previous && record.pending.some(row => !row.supersededBy && (row.changeId || row.artifact.id) === (previous.changeId || previous.artifact.id) && row.artifact.id !== previous.artifact.id))
          fail('A newer review already exists for this change', 409);
        if (!['change', 'reconciliation'].includes(kind)) fail('Select change or reconciliation');
        if (kind === 'change' ? !label(options.team) || !label(options.taskRef) || options.baselineOwner !== undefined
          : !label(options.baselineOwner) || options.team !== undefined || options.taskRef !== undefined) fail('Provide the attribution for this operation');
        if (artifacts(record).length >= 100) fail('Maximum 100 captured artifacts per managed workspace');
        const baseDeclaration = declareBase(record, options.base, performedBy?.id || owner);
        const captured = await capture(owner, options.snapshot, kind === 'change' ? 'partial' : 'full', performedBy);
        const baselineSource = record.state.artifacts.find(row => row.snapshot.source)?.snapshot.source;
        const incomingSource = captured.artifact.snapshot.source;
        if (baselineSource && incomingSource && (baselineSource.connectionId !== incomingSource.connectionId ||
            baselineSource.solutionRef !== incomingSource.solutionRef)) fail('Snapshot Source differs from the accepted baseline', 409);
        captured.artifact.sourceDeclaration = { baselineId: record.state.baselineId, declaredBy: performedBy?.id || owner,
          declaredAt: new Date().toISOString(), method: 'explicit-assertion' };
        captured.artifact.baseDeclaration = baseDeclaration;
        if (kind !== 'change' && options.changeScope !== undefined) fail('Change scope belongs only to a partial change');
        if (kind === 'change') captured.artifact.changeScopeDeclaration = declareManagedChangeScope(record.state,
          captured.artifact, options.changeScope, performedBy?.id || owner);
        const pending = { artifact: captured.artifact, kind, revision: record.state.revision,
          options: kind === 'change' ? { team: options.team.trim(), taskRef: options.taskRef.trim() }
            : { baselineOwner: options.baselineOwner.trim() } };
        pending.changeId = previous?.changeId || previous?.artifact.id || pending.artifact.id;
        const result = preview(record, pending), dest = path.join(location(id), pending.artifact.id + '.e365');
        pending.review = result;
        pending.sourceAnchors = await sourceAnchorIndex(captured.bytes, pending.artifact.id);
        pending.contexts = result.rows.map(row => {
          const before = record.state.current.find(component => component.key === row.key);
          const artifact = [...record.state.artifacts].reverse().find(artifact => artifact.components.some(component => component.key === row.key && component.digest === before?.digest));
          return { key: row.key, objectRef: hash(row.key), beforeArtifactId: artifact?.id || null,
            afterArtifactId: pending.artifact.components.some(component => component.key === row.key) ? pending.artifact.id : null };
        });
        pending.attention = { conflicts: result.rows.filter(row => row.conflict || row.classification === 'conflict').length,
          unknown: result.ambiguities.length };
        await fs.writeFile(dest, captured.bytes, { mode: 0o600, flag: 'wx' });
        record.pending.push(pending); record.updatedAt = new Date().toISOString();
        if (previous) {
          const stored = record.pending.find(row => row.artifact.id === previous.artifact.id)
            || record.completedReviews.find(row => row.artifactId === previous.artifact.id);
          stored.supersededBy = pending.artifact.id;
        }
        audit(record, 'prepared', performedBy, pending.artifact.id);
        try { await save(record); } catch (error) { await fs.rm(dest, { force: true }); throw error; }
        return { ...result, kind, options: pending.options, snapshot: pending.artifact.snapshot,
          sourceDeclaration: pending.artifact.sourceDeclaration, baseDeclaration: baseEvidence(pending.artifact) };
      });
    },
    preview(id, owner, artifactId) { return serial(async () => {
      const record = await checked(id, owner), pending = pendingFor(record, artifactId);
      return { ...preview(record, pending), kind: pending.kind, options: structuredClone(pending.options),
        snapshot: structuredClone(pending.artifact.snapshot), sourceDeclaration: structuredClone(pending.artifact.sourceDeclaration),
        baseDeclaration: baseEvidence(pending.artifact) };
    }); },
    review(id, owner, artifactId) { return serial(async () => {
      const record = await checked(id, owner), pending = reviewFor(record, artifactId);
      const stale = !!pending.supersededBy || !pending.acceptedAt && (pending.revision !== record.state.revision || record.state.status !== 'active');
      const evidence = pending.review || (!stale ? preview(record, pending) : { revision: pending.revision, artifactId,
        artifactDigest: null, rows: [], ambiguities: [{ reason: 'historical-comparison-unavailable' }] });
      return structuredClone({ ...evidence, kind: pending.kind, options: pending.options,
        snapshot: pending.artifact.snapshot, sourceDeclaration: pending.artifact.sourceDeclaration, baseDeclaration: baseEvidence(pending.artifact), changeScopeDeclaration: scopeEvidence(pending.artifact),
        uploadedBy: pending.artifact.uploadedBy, discussion: changeDiscussion(record, pending), contexts: pending.contexts || [],
        ...(pending.kind === 'change' ? { merge: mergeView(record, artifactId) } : {}),
        stale, acceptedAt: pending.acceptedAt || null, acceptedDecision: pending.acceptedDecision || null, supersededBy: pending.supersededBy || null });
    }); },
    merge(id, owner, artifactId) { return serial(async () => {
      const record = await checked(id, owner); reviewFor(record, artifactId);
      return mergeView(record, artifactId);
    }); },
    async resolveMerge(id, owner, artifactId, input, performedBy) {
      const identity = actorIdentity(performedBy);
      const options = fields(input, ['expectedRevision', 'planDigest', 'expectedResolutionId', 'decisions', 'reason']);
      if (options.expectedResolutionId !== null && (typeof options.expectedResolutionId !== 'string' || !uuid.test(options.expectedResolutionId)))
        fail('State the resolution you reviewed explicitly (null for the first resolution)');
      return serial(async () => {
        const record = await checked(id, owner), pending = pendingFor(record, artifactId);
        revision(record, options.expectedRevision);
        if (record.state.status !== 'active') fail('Reopen the workspace before changing it', 409);
        if (pending.kind !== 'change') fail('Only a partial change has a three-way merge plan', 409);
        if (pending.supersededBy) fail('Change was replaced; open the current review', 409);
        const history = resolutionsFor(record, artifactId), head = history.at(-1) ?? null;
        if (options.expectedResolutionId !== (head?.id ?? null)) fail('Another resolution was saved; refresh before resolving', 409);
        if (head && managedResolutionStatus(head, null) === 'corrupt') fail('Stored resolution evidence is corrupt', 409);
        if (history.length >= 50) fail('Maximum 50 resolution revisions per change', 422);
        const plan = planManagedComponentMerge(record.state, pending.artifact);
        if (options.planDigest !== plan.planDigest) fail('Merge plan changed; review the current plan before resolving', 409);
        record.updatedAt = new Date().toISOString();
        const resolution = resolveManagedMerge(plan, { decisions: options.decisions, reason: options.reason, actor: identity, parent: head, at: record.updatedAt });
        record.mergeResolutions ??= []; record.mergeResolutions.push(structuredClone(resolution));
        audit(record, 'merge-resolved', identity, artifactId);
        await save(record); return mergeView(record, artifactId);
      });
    },
    comment(id, owner, artifactId, input, performedBy) { return serial(async () => {
      const options = fields(input, ['expectedRevision', 'expectedDiscussionRevision', 'type', 'text', 'componentKey', 'parentId', 'sourceAnchor', 'operationId']);
      const record = await checked(id, owner), pending = reviewFor(record, artifactId);
      const operationHash = hash(JSON.stringify(['expectedRevision', 'expectedDiscussionRevision', 'type', 'text', 'componentKey', 'parentId', 'sourceAnchor'].map(key => [key, options[key] ?? null])));
      const actor = actorIdentity(performedBy);
      if (options.operationId !== undefined) {
        if (!uuid.test(options.operationId)) fail('Invalid review operation ID');
        const previous = record.reviewEvents?.find(event => event.operationId === options.operationId);
        if (previous) {
          if (previous.operationHash !== operationHash || previous.actor.id !== actor.id || previous.artifactId !== artifactId) fail('Review operation already used', 409);
          return changeDiscussion(record, pending);
        }
      }
      revision(record, options.expectedRevision);
      if (pending.supersededBy || record.state.status !== 'active' || !pending.acceptedAt && pending.revision !== record.state.revision)
        fail('Change review is stale; refresh before commenting', 409);
      pending.review ||= preview(record, pending);
      if (pending.sourceAnchors?.version !== SOURCE_ANCHOR_VERSION)
        pending.sourceAnchors = await sourceAnchorIndex(await bytesFor(id, pending.artifact), pending.artifact.id);
      record.updatedAt = new Date().toISOString();
      const result = appendChangeReview(record, pending, options, performedBy);
      if (options.operationId) Object.assign(record.reviewEvents.at(-1), { operationId: options.operationId, operationHash });
      audit(record, 'review-' + options.type, performedBy, artifactId);
      await save(record); return result;
    }); },
    async accept(id, owner, artifactId, input, performedBy) {
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['expectedRevision', 'reviewedDigest', 'reviewedBoundaryKeys', 'resolutions', 'expectedDiscussionRevision']);
      return serial(async () => {
        const record = await checked(id, owner), pending = pendingFor(record, artifactId);
        revision(record, options.expectedRevision); preview(record, pending);
        pending.review ||= preview(record, pending);
        if (options.reviewedBoundaryKeys !== undefined && (!Array.isArray(options.reviewedBoundaryKeys) ||
            options.reviewedBoundaryKeys.some(key => typeof key !== 'string'))) fail('Boundary decisions must be a list of component keys');
        if (options.resolutions !== undefined && (!options.resolutions || typeof options.resolutions !== 'object' ||
            Array.isArray(options.resolutions) || Object.values(options.resolutions).some(value => typeof value !== 'string')))
          fail('Conflict decisions must map component keys to resolutions');
        if (pending.kind === 'change' && options.resolutions !== undefined || pending.kind === 'reconciliation' && options.reviewedBoundaryKeys !== undefined)
          fail('Decisions do not match the prepared operation');
        const accepted = { ...pending.options, ...options };
        record.updatedAt = new Date().toISOString();
        if (performedBy) appendChangeReview(record, pending, { type: 'approve', text: 'Изменение принято',
          expectedDiscussionRevision: options.expectedDiscussionRevision ?? (changeDiscussion(record, pending).version === 0 ? 0 : undefined) }, performedBy, { acceptance: true });
        record.state = pending.kind === 'change' ? acceptManagedChange(record.state, pending.artifact, accepted)
          : acceptReconciliation(record.state, pending.artifact, accepted);
        record.pending = record.pending.filter(row => row !== pending); record.updatedAt = new Date().toISOString();
        record.completedReviews ??= [];
        const { artifact, ...metadata } = pending;
        record.completedReviews.push({ ...metadata, artifactId, acceptedAt: record.updatedAt,
          acceptedDecision: { actor: performedBy || null, resolutions: options.resolutions || null, boundaryKeys: options.reviewedBoundaryKeys || [] } });
        if (pending.kind === 'reconciliation') record.baselineAcceptedAt = record.updatedAt;
        audit(record, pending.kind === 'change' ? 'change-accepted' : 'baseline-accepted', performedBy, artifactId);
        await save(record); return view(record);
      });
    },
    async setArchived(id, owner, input, performedBy) {
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['archived', 'expectedRevision']);
      return serial(async () => {
        const record = await checked(id, owner);
        record.state = setManagedWorkspaceArchived(record.state, options.archived, options.expectedRevision);
        record.updatedAt = new Date().toISOString(); audit(record, options.archived ? 'archived' : 'reopened', performedBy);
        await save(record); return view(record);
      });
    },
    original(id, owner, artifactId) { return serial(async () => {
      const record = await read(id, owner), artifact = artifacts(record).find(row => row.id === artifactId);
      if (!artifact) fail('Artifact not found', 404);
      return bytesFor(id, artifact);
    }); },
    artifact(id, owner, artifactId) { return serial(async () => {
      const record = await read(id, owner), artifact = artifacts(record).find(row => row.id === artifactId);
      if (!artifact) fail('Artifact not found', 404);
      await bytesFor(id, artifact); return structuredClone(artifact);
    }); }
  };
}

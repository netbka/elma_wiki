import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { actorIdentity } from './actors.mjs';
import { parseManagedArtifact, createManagedWorkspace, previewManagedChange, acceptManagedChange,
  previewReconciliation, acceptReconciliation, setManagedWorkspaceArchived } from './managed-workspace.mjs';

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
export function managedWorkspaceStore(directory, projects) {
  const root = path.resolve(directory, 'managed-workspaces');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (typeof id !== 'string' || !uuid.test(id)) fail('Workspace not found', 404); return path.join(root, id); };
  const read = async (id, owner) => {
    actor(owner);
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(location(id), 'workspace.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('Workspace not found', 404); throw error; }
    if (record.owner !== owner) fail('Workspace not found', 404);
    if (record.schema !== 1 || record.state.id !== id) fail('Unsupported or corrupt workspace record', 409);
    return record;
  };
  const artifacts = record => [...record.state.artifacts, ...record.pending.map(row => row.artifact)];
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
    const parsed = await parseManagedArtifact(bytes, { scope: requiredScope });
    const artifact = { ...parsed, snapshot: { projectId: ref.projectId, snapshotId: row.id,
      checksum: row.checksum, parserRevision: row.parserRevision, parserVersion: row.parserVersion,
      createdAt: row.createdAt, source: structuredClone(row.source ?? null) },
    scopeDeclaration: { scope: requiredScope, declaredBy: performedBy?.id || owner, declaredAt: new Date().toISOString(), method: 'explicit-assertion' },
    ...(row.uploadedBy ? { uploadedBy: row.uploadedBy } : {}) };
    return { artifact, bytes };
  };
  const preview = (record, pending) => {
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
  const baselineAcceptedAt = record => record.baselineAcceptedAt ?? (record.state.reconciliations.length ? null : record.createdAt);
  const view = record => structuredClone({ ...record.state, createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(record.audit ? { audit: record.audit, createdBy: record.audit[0].actor } : {}),
    baselineAcceptedAt: baselineAcceptedAt(record),
    pending: record.pending.map(row => ({ artifactId: row.artifact.id, kind: row.kind, revision: row.revision,
      stale: row.revision !== record.state.revision || record.state.status !== 'active', options: row.options,
      snapshot: row.artifact.snapshot, scopeDeclaration: row.artifact.scopeDeclaration,
      sourceDeclaration: row.artifact.sourceDeclaration })) });
  return {
    // HTTP authorization precedes method/body validation without exposing state.
    async authorize(id, owner) { await read(id, owner); },
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
            pendingCount: record.pending.length,
            createdAt: record.createdAt, updatedAt: record.updatedAt });
          if (record.audit) rows.at(-1).createdBy = record.audit[0].actor;
        }
        return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    },
    async prepare(id, owner, input, performedBy) {
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['kind', 'snapshot', 'expectedRevision', 'team', 'taskRef', 'baselineOwner', 'sameSourceConfirmed']);
      return serial(async () => {
        const record = await checked(id, owner); revision(record, options.expectedRevision);
        if (record.state.status !== 'active') fail('Reopen the workspace before changing it', 409);
        if (options.sameSourceConfirmed !== true) fail('Confirm this snapshot belongs to the workspace Source');
        const { kind } = options;
        if (!['change', 'reconciliation'].includes(kind)) fail('Select change or reconciliation');
        if (kind === 'change' ? !label(options.team) || !label(options.taskRef) || options.baselineOwner !== undefined
          : !label(options.baselineOwner) || options.team !== undefined || options.taskRef !== undefined) fail('Provide the attribution for this operation');
        if (artifacts(record).length >= 100) fail('Maximum 100 captured artifacts per managed workspace');
        const captured = await capture(owner, options.snapshot, kind === 'change' ? 'partial' : 'full', performedBy);
        const baselineSource = record.state.artifacts.find(row => row.snapshot.source)?.snapshot.source;
        const incomingSource = captured.artifact.snapshot.source;
        if (baselineSource && incomingSource && (baselineSource.connectionId !== incomingSource.connectionId ||
            baselineSource.solutionRef !== incomingSource.solutionRef)) fail('Snapshot Source differs from the accepted baseline', 409);
        captured.artifact.sourceDeclaration = { baselineId: record.state.baselineId, declaredBy: performedBy?.id || owner,
          declaredAt: new Date().toISOString(), method: 'explicit-assertion' };
        const pending = { artifact: captured.artifact, kind, revision: record.state.revision,
          options: kind === 'change' ? { team: options.team.trim(), taskRef: options.taskRef.trim() }
            : { baselineOwner: options.baselineOwner.trim() } };
        const result = preview(record, pending), dest = path.join(location(id), pending.artifact.id + '.e365');
        await fs.writeFile(dest, captured.bytes, { mode: 0o600, flag: 'wx' });
        record.pending.push(pending); record.updatedAt = new Date().toISOString();
        audit(record, 'prepared', performedBy, pending.artifact.id);
        try { await save(record); } catch (error) { await fs.rm(dest, { force: true }); throw error; }
        return { ...result, kind, options: pending.options, snapshot: pending.artifact.snapshot,
          sourceDeclaration: pending.artifact.sourceDeclaration };
      });
    },
    preview(id, owner, artifactId) { return serial(async () => {
      const record = await checked(id, owner), pending = pendingFor(record, artifactId);
      return { ...preview(record, pending), kind: pending.kind, options: structuredClone(pending.options),
        snapshot: structuredClone(pending.artifact.snapshot), sourceDeclaration: structuredClone(pending.artifact.sourceDeclaration) };
    }); },
    async accept(id, owner, artifactId, input, performedBy) {
      if (performedBy) performedBy = actorIdentity(performedBy);
      const options = fields(input, ['expectedRevision', 'reviewedDigest', 'reviewedBoundaryKeys', 'resolutions']);
      return serial(async () => {
        const record = await checked(id, owner), pending = pendingFor(record, artifactId);
        revision(record, options.expectedRevision); preview(record, pending);
        if (options.reviewedBoundaryKeys !== undefined && (!Array.isArray(options.reviewedBoundaryKeys) ||
            options.reviewedBoundaryKeys.some(key => typeof key !== 'string'))) fail('Boundary decisions must be a list of component keys');
        if (options.resolutions !== undefined && (!options.resolutions || typeof options.resolutions !== 'object' ||
            Array.isArray(options.resolutions) || Object.values(options.resolutions).some(value => typeof value !== 'string')))
          fail('Conflict decisions must map component keys to resolutions');
        if (pending.kind === 'change' && options.resolutions !== undefined || pending.kind === 'reconciliation' && options.reviewedBoundaryKeys !== undefined)
          fail('Decisions do not match the prepared operation');
        const accepted = { ...pending.options, ...options };
        record.state = pending.kind === 'change' ? acceptManagedChange(record.state, pending.artifact, accepted)
          : acceptReconciliation(record.state, pending.artifact, accepted);
        record.pending = record.pending.filter(row => row !== pending); record.updatedAt = new Date().toISOString();
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
    }); }
  };
}

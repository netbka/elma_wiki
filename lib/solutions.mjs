import path from 'node:path';
import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { projectStore } from './projects.mjs';
import { managedWorkspaceStore } from './managed-workspace-store.mjs';
import { releaseStore } from './releases.mjs';
import { actorIdentity } from './actors.mjs';
import { configDependencyContext } from './config-dependency-context.mjs';

// A separate root is the admission boundary. Legacy private records are never
// looked up here, and this server-only principal is never selected by clients.
export const SOLUTION_CATALOG = 'shared-solution-catalog-v1';
export function solutionStore(directory) {
  const root = path.resolve(directory, 'shared-solutions');
  // Match the existing 50 Solutions x 100 captured artifacts lifecycle limit.
  const uploads = projectStore(root, { maxProjects: 5000 });
  const managed = managedWorkspaceStore(root, uploads, { dependencyContext: configDependencyContext(directory) });
  const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
  const fields = (input, allowed) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
      fail('Invalid Solution handoff request');
  };
  const associationKeys = ['policy', 'solutionId', 'revision', 'artifactId', 'sha256', 'inventoryHash', 'reviewDigest'];
  const releases = releaseStore(root, null, { withAssociation: (association, operation) =>
    managed.withAcceptedExport(association.solutionId, SOLUTION_CATALOG, association.revision, current => {
      if (associationKeys.some(key => association[key] !== current.evidence[key])) fail('Solution review changed; prepare a new handoff', 409);
      return operation();
    }) });
  const authorizeHandoff = async (id, releaseId) => {
    await managed.authorize(id, SOLUTION_CATALOG);
    const association = await releases.authorize(releaseId, SOLUTION_CATALOG);
    if (association?.solutionId !== id) fail('Solution handoff not found', 404);
  };
  const handoffs = {
    authorize: authorizeHandoff,
    async list(id) {
      await managed.authorize(id, SOLUTION_CATALOG);
      const rows = (await releases.list(SOLUTION_CATALOG)).filter(row => row.sourceAssociation?.solutionId === id);
      return Promise.all(rows.map(async row => { const value = await releases.get(row.id, SOLUTION_CATALOG);
        return { ...row, state: value.state, associationStatus: value.associationStatus }; }));
    },
    async create(id, input, user) {
      const actor = actorIdentity(user);
      fields(input, ['expectedRevision', 'title', 'intent', 'targetIntent']);
      const { bytes, evidence } = await managed.acceptedExport(id, SOLUTION_CATALOG, input.expectedRevision);
      const parsed = await parseProject(bytes);
      const source = { ...parsed, bytes, metadata: { id: evidence.snapshot.projectId, currentSnapshotId: evidence.snapshot.snapshotId,
        checksum: evidence.sha256, filename: 'accepted-solution.e365', activeRevision: evidence.snapshot.parserRevision,
        parserVersion: parsed.report.parserVersion,
        snapshots: [{ id: evidence.snapshot.snapshotId, createdAt: evidence.snapshot.createdAt, source: evidence.snapshot.source }] } };
      const association = Object.fromEntries(associationKeys.map(key => [key, evidence[key]]));
      return releases.createCaptured(SOLUTION_CATALOG, input, { source, association }, actor);
    },
    async get(id, releaseId) { await authorizeHandoff(id, releaseId); return releases.get(releaseId, SOLUTION_CATALOG); },
    async withCandidate(id, releaseId, operation) {
      await authorizeHandoff(id, releaseId);
      return releases.withCandidate(releaseId, SOLUTION_CATALOG, operation);
    },
    async change(id, releaseId, input, user) {
      await authorizeHandoff(id, releaseId);
      fields(input, ['revision', 'action', 'path', 'decision', 'reason', 'title', 'intent', 'targetIntent', 'limitations', 'notes']);
      return releases.change(releaseId, SOLUTION_CATALOG, input, actorIdentity(user));
    },
    async bundle(id, releaseId, input, user) {
      await authorizeHandoff(id, releaseId); fields(input, ['revision']);
      return releases.bundle(releaseId, SOLUTION_CATALOG, input.revision, actorIdentity(user));
    },
    async preview(id, releaseId, archivePath, side) { await authorizeHandoff(id, releaseId); return releases.preview(releaseId, SOLUTION_CATALOG, archivePath, side); }
  };
  return { uploads, managed, handoffs,
    async context(id, artifactId, objectRef) {
      const artifact = await managed.artifact(id, SOLUTION_CATALOG, artifactId);
      const component = artifact.components.find(row => crypto.createHash('sha256').update(row.key).digest('hex') === objectRef);
      if (!component) throw Object.assign(Error('Объект не найден'), { statusCode: 404 });
      const parsed = await parseProject(await managed.original(id, SOLUTION_CATALOG, artifactId));
      const entities = parsed.data.entities.filter(row => row.service === component.service && row.namespace === component.namespace && row.code === component.code && (!component.kind || row.kind === component.kind));
      if (entities.length !== 1) throw Object.assign(Error('Связь объекта с исходным файлом неоднозначна'), { statusCode: 422 });
      const entity = entities[0], bytes = parsed.files.get(entity.archivePath);
      let content = null, raw = null;
      try {
        if (bytes && bytes.length <= 256 * 1024) {
          content = new TextDecoder('utf8', { fatal: true }).decode(bytes);
          raw = JSON.parse(content.replace(/^\uFEFF/, ''));
        }
      } catch { content = null; }
      const metadata = await uploads.get(artifact.snapshot.projectId, SOLUTION_CATALOG);
      const stored = metadata && await uploads.read(metadata.id, SOLUTION_CATALOG);
      const match = stored?.entities.filter(row => row.service === component.service && row.namespace === component.namespace && row.code === component.code);
      const scripts = [];
      let supportedScripts = !!raw?.descriptor && !Array.isArray(raw.descriptor);
      for (const side of ['client', 'server']) {
        const sidecar = parsed.files.get(entity.archivePath + '.' + side + '.ts'), inline = raw?.descriptor?.[side + 'Scripts'];
        try {
          if (sidecar) scripts.push(new TextDecoder('utf8', { fatal: true }).decode(sidecar));
          else if (typeof inline === 'string') scripts.push(inline);
          else if (inline != null) supportedScripts = false;
        } catch { supportedScripts = false; }
      }
      supportedScripts &&= scripts.length > 0 && scripts.every(source => Buffer.byteLength(source) <= 256 * 1024);
      const editable = entity.service === 'widgets' && String(entity.kind).toUpperCase() === 'WIDGET' && entity.coverage === 'structural'
        && metadata?.checksum === artifact.checksum && match?.length === 1 && !!supportedScripts;
      return { key: component.key, code: entity.code, name: entity.name, service: entity.service, source: entity.archivePath,
        content, checksum: artifact.checksum, editable, projectId: editable ? metadata.id : null, objectId: editable ? match[0].id : null,
        editorUrl: editable ? `/solutions/${id}/code/${artifactId}/${objectRef}` : null,
        limitation: 'Исходные данные экспорта. Код не выполняется; рабочая копия редактора не входит в принятое состояние.' };
    }
  };
}

import path from 'node:path';
import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { projectStore } from './projects.mjs';
import { managedWorkspaceStore } from './managed-workspace-store.mjs';

// A separate root is the admission boundary. Legacy private records are never
// looked up here, and this server-only principal is never selected by clients.
export const SOLUTION_CATALOG = 'shared-solution-catalog-v1';
export function solutionStore(directory) {
  const root = path.resolve(directory, 'shared-solutions');
  // Match the existing 50 Solutions x 100 captured artifacts lifecycle limit.
  const uploads = projectStore(root, { maxProjects: 5000 });
  const managed = managedWorkspaceStore(root, uploads);
  return { uploads, managed,
    async context(id, artifactId, objectRef) {
      const artifact = await managed.artifact(id, SOLUTION_CATALOG, artifactId);
      const component = artifact.components.find(row => crypto.createHash('sha256').update(row.key).digest('hex') === objectRef);
      if (!component) throw Object.assign(Error('Объект не найден'), { statusCode: 404 });
      const parsed = await parseProject(await managed.original(id, SOLUTION_CATALOG, artifactId));
      const entities = parsed.data.entities.filter(row => row.service === component.service && row.namespace === component.namespace && row.code === component.code);
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

import fs from 'node:fs/promises';
import path from 'node:path';
import { readDependencyCatalog } from './dependency-evidence.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Only the private acquisition association supplies context. Uploaded metadata
// cannot select a server or attach evidence to a different snapshot.
export function configDependencyContext(directory) {
  const root = path.resolve(directory, 'config-acquisitions');
  return async ({ projectId, snapshotId, checksum }) => {
    let ids;
    try { ids = await fs.readdir(root); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    for (const id of ids.filter(value => uuid.test(value))) {
      const record = JSON.parse(await fs.readFile(path.join(root, id, 'record.json'), 'utf8'));
      if (record.state !== 'ready' || !record.solutions?.some(member => member.project?.id === projectId && member.project.currentSnapshotId === snapshotId && member.project.checksum === checksum)) continue;
      return { catalog: readDependencyCatalog({ schemaVersion: 1, catalog: record.dependencyCatalog ?? [] }), provenance: record.server ? 'configured-source-capture' : 'manual-upload' };
    }
    return {};
  };
}

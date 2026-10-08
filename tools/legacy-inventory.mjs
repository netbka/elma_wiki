import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const reference = source => source && ['connectionId', 'solutionRef'].every(k =>
  typeof source[k] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(source[k]))
  ? { connectionId: source.connectionId, solutionRef: source.solutionRef } : null;

// Read-only historical metadata inventory. It performs no runtime change.
export async function inventoryLegacyRecords(directory) {
  const root = path.resolve(directory), stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Select an existing, non-symlink private storage directory.');
  const records = [], unreadableRecords = [];
  const read = async file => {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024) throw Error('Unsupported metadata file.');
    const bytes = await fs.readFile(file);
    return { data: JSON.parse(bytes.toString('utf8')), metadataSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  };
  const record = (kind, id, ownerId, metadataSha256, snapshots = [], uploadedBy = null) => {
    if (!uuid.test(id) || typeof ownerId !== 'string' || !ownerId) throw Error('Invalid legacy identity.');
    records.push({ kind, id, ownerId, metadataSha256,
      uploadedBy: uploadedBy && typeof uploadedBy.id === 'string' ? { id: uploadedBy.id, provider: uploadedBy.provider || 'unknown' } : null,
      snapshots: snapshots.map(s => ({ id: s.id, checksum: s.checksum || null, source: reference(s.source),
        sourceStatus: reference(s.source) ? 'reference' : s.source ? 'unknown' : 'unavailable' })),
      lifecycleAssociation: { intendedSolution: null, copied: false } });
  };
  for (const [folder, filename, kind] of [['projects', 'project.json', 'project'], ['managed-workspaces', 'workspace.json', 'managed-workspace']]) {
    const target = path.join(root, folder);
    let entries;
    try { const s = await fs.lstat(target); if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsupported legacy storage directory.');
      entries = await fs.readdir(target, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const entry of entries) {
      if (!uuid.test(entry.name)) continue;
      try {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('Unsupported record directory.');
        const { data, metadataSha256 } = await read(path.join(target, entry.name, filename));
        const id = kind === 'project' ? data.id : data.state?.id;
        if (id !== entry.name) throw Error('Legacy identity differs from directory.');
        record(kind, id, data.owner, metadataSha256, kind === 'project' ? data.snapshots || [{ id, checksum: data.checksum, source: data.source }] :
          (data.state.artifacts || []).map(a => ({ id: a.id, checksum: a.checksum, source: a.snapshot?.source })), data.uploadedBy || data.createdBy || null);
      } catch { unreadableRecords.push({ kind, id: entry.name, reason: 'Metadata unavailable or invalid; inspect locally before use.' }); }
    }
  }
  try {
    const { data, metadataSha256 } = await read(path.join(root, 'portals.json'));
    if (!Array.isArray(data)) throw Error('Invalid legacy portal registry.');
    for (const row of data) {
      try { record('portal', row.id, row.owner, metadataSha256); }
      catch { unreadableRecords.push({ kind: 'portal', id: uuid.test(row?.id) ? row.id : null, reason: 'Invalid portal identity; inspect locally before use.' }); }
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  records.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
  return { schema: 2, inventoriedAt: new Date().toISOString(), storageRoot: root, scope: 'selected-local-directory-only', contentAccessPolicy: 'shared-authenticated',
    deployedStorageVerified: false, migrationExecuted: false, records, unreadableRecords,
    nextStep: 'Verify shared authenticated access on the intended service after an authorized rollout. Preserve original bytes, IDs and provenance; do not infer full Solution scope.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/legacy-inventory.mjs <private-storage-directory>');
  const result = await inventoryLegacyRecords(process.argv[2]);
  await fs.mkdir('.local', { recursive: true, mode: 0o700 });
  const output = path.resolve('.local', 'legacy-inventory-' + crypto.randomUUID() + '.local.json');
  await fs.writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`${result.records.length} legacy records; ${result.unreadableRecords.length} require local inspection. No runtime changes performed.`);
  console.log('Local inventory: ' + output);
}

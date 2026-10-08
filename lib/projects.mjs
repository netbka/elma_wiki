import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { actorIdentity } from './actors.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const sourceReference = source => {
  if (!source || Object.keys(source).some(key => !['connectionId', 'solutionRef'].includes(key)) ||
      typeof source.connectionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(source.connectionId) ||
      typeof source.solutionRef !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(source.solutionRef))
    fail('Требуется явная ссылка Source и код решения без URL или credentials');
  return { connectionId: source.connectionId, solutionRef: source.solutionRef };
};
const initialSnapshot = p => ({ id: p.id, projectId: p.id, createdAt: p.createdAt, checksum: p.checksum,
  parserRevision: p.activeRevision, parserVersion: p.parserVersion, coverage: p.coverage, entities: p.entities,
  source: p.source || null, provenance: null, original: true, ...(p.uploadedBy ? { uploadedBy: p.uploadedBy } : {}) });
const snapshotRows = p => p.snapshots || [initialSnapshot(p)];
const currentSnapshot = p => p.currentSnapshotId || p.id;
export function projectStore(directory, { maxProjects = 50, sharedAccess = false } = {}) {
  const root = path.resolve(directory,'projects');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (!uuid.test(id)) throw Error('Проект не найден'); return path.join(root,id); };
  const json = async file => JSON.parse(await fs.readFile(file,'utf8'));
  const write = (file, value) => fs.writeFile(file,JSON.stringify(value),{mode:0o600});
  const remove = async target => {
    const absolute = path.resolve(target);
    if (!absolute.startsWith(root + path.sep) || absolute === root) throw Error('Недопустимый путь удаления');
    await fs.rm(absolute,{recursive:true,force:true});
  };
  const get = async (id, owner) => {
    if (!uuid.test(id)) return null;
    if (typeof owner !== 'string' || !owner.trim()) return null;
    try { const metadata = await json(path.join(location(id),'project.json')); return sharedAccess || metadata.owner === owner ? metadata : null; }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const requireOwner = async (id, owner) => { const p = await get(id,owner); if (!p) throw Error('Проект не найден'); return p; };
  const publicMetadata = ({owner,activeRevision,snapshots,...p}) => p;
  const findSnapshot = (p, snapshotId) => {
    const row = snapshotRows(p).find(row => row.id === snapshotId);
    if (!row) fail('Снимок не найден', 404);
    return row;
  };
  const artifact = (p, row) => row.original ? path.join(location(p.id), 'original.e365') : path.join(location(p.id), 'revisions', row.parserRevision, 'original.e365');
  const snapshotBytes = async (p, row) => {
    const bytes = await fs.readFile(artifact(p, row));
    if (digest(bytes) !== row.checksum) fail('Контрольная сумма снимка не совпадает', 409);
    return bytes;
  };
  const replaceMetadata = async p => {
    const temp = path.join(location(p.id), 'project-' + crypto.randomUUID() + '.tmp');
    await write(temp, p); await fs.rename(temp, path.join(location(p.id), 'project.json'));
  };
  const revision = async (directory, parsed) => {
    const id = crypto.randomUUID(), dest = path.join(directory,'revisions',id);
    await fs.mkdir(dest,{recursive:true,mode:0o700});
    try {
      await fs.mkdir(path.join(directory,'objects'),{recursive:true,mode:0o700});
      for (const row of parsed.inventory) await fs.writeFile(path.join(directory,'objects',row.sha256),parsed.files.get(row.path),{mode:0o600,flag:'w'});
      await write(path.join(dest,'data.json'),parsed.data);
      await write(path.join(dest,'report.json'),parsed.report);
      await write(path.join(dest,'inventory.json'),parsed.inventory);
      return id;
    } catch (error) { await remove(dest); throw error; }
  };
  const createProject = async (owner, bytes, filename, source = null, uploadedBy) => {
    if (typeof owner !== 'string' || !owner) throw Error('Требуется владелец');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    let count = 0;
    for (const id of await fs.readdir(root)) if (await get(id, owner)) count++;
    if (count >= maxProjects) throw Error(`Максимум ${maxProjects} проектов`);
    const parsed = await parseProject(bytes), id = crypto.randomUUID(), staging = path.join(root, '.pending-' + id);
    if (source && parsed.data.solution?.code !== source.solutionRef) fail('Код экспортированного решения не соответствует Source');
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(path.join(staging, 'original.e365'), bytes, { mode: 0o600 });
      const activeRevision = await revision(staging, parsed);
      const p = { id, owner, filename: String(filename).split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, '').slice(0,160) || 'configuration.e365', checksum: digest(bytes), createdAt: new Date().toISOString(), activeRevision,
        parserVersion: parsed.report.parserVersion, coverage: parsed.report.status, entities: parsed.data.entities.length,
        ...(source ? { source } : {}), ...(uploadedBy ? { uploadedBy: actorIdentity(uploadedBy) } : {}) };
      p.snapshots = [{ ...initialSnapshot(p), provenance: parsed.data.provenance }]; p.currentSnapshotId = id;
      await write(path.join(staging, 'project.json'), p);
      await fs.rename(staging, location(id));
      return publicMetadata(p);
    } catch (error) { await remove(staging); throw error; }
  };
  return {
    get,
    snapshot(id, owner, snapshotId) { return serial(async () => {
      const metadata = await requireOwner(id, owner);
      if (snapshotId !== undefined) {
        const row = findSnapshot(metadata, snapshotId), dest = path.join(location(id), 'revisions', row.parserRevision);
        const [bytes, data, report, inventory] = await Promise.all([snapshotBytes(metadata, row), json(path.join(dest, 'data.json')), json(path.join(dest, 'report.json')), json(path.join(dest, 'inventory.json'))]);
        return { metadata: { ...metadata, snapshots: snapshotRows(metadata), currentSnapshotId: row.id, checksum: row.checksum, activeRevision: row.parserRevision, parserVersion: row.parserVersion, coverage: row.coverage }, bytes, data, report, inventory };
      }
      return { metadata, bytes: await this.original(id, owner), data: await this.read(id, owner), report: await this.read(id, owner, 'report'), inventory: await this.read(id, owner, 'inventory') };
    }); },
    workspaceTransaction(id, owner, operation) { return serial(async () => { const p = await requireOwner(id, owner); return operation(location(id), p); }); },
    async list(owner) {
      await fs.mkdir(root,{recursive:true,mode:0o700});
      const rows = [];
      for (const id of await fs.readdir(root)) { const p = await get(id,owner); if (p) rows.push(publicMetadata(p)); }
      return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    },
    create(owner, bytes, filename='configuration.e365', uploadedBy) { return serial(() => createProject(owner, bytes, filename, null, uploadedBy)); },
    // Trusted adapter entry points only. HTTP uploads cannot assert Source provenance.
    createSource(owner, bytes, source, filename='configuration.e365', uploadedBy) { return serial(() => createProject(owner, bytes, filename, sourceReference(source), uploadedBy)); },
    appendSource(id, owner, bytes, source, expectedSnapshotId) { return serial(async () => {
      const p = await requireOwner(id, owner), reference = sourceReference(source);
      if (!p.source || p.source.connectionId !== reference.connectionId || p.source.solutionRef !== reference.solutionRef)
        fail('Source или решение не соответствует проекту', 409);
      if (expectedSnapshotId !== currentSnapshot(p)) fail('Текущий снимок изменился. Обновите проект.', 409);
      if (snapshotRows(p).length >= 100) fail('Максимум 100 снимков проекта');
      const parsed = await parseProject(bytes);
      if (parsed.data.solution?.code !== reference.solutionRef) fail('Код экспортированного решения не соответствует Source');
      const parserRevision = await revision(location(id), parsed);
      try {
        await fs.writeFile(path.join(location(id), 'revisions', parserRevision, 'original.e365'), bytes, { mode: 0o600, flag: 'wx' });
        const row = { id: crypto.randomUUID(), projectId: id, createdAt: new Date().toISOString(), checksum: digest(bytes), parserRevision,
          parserVersion: parsed.report.parserVersion, coverage: parsed.report.status, entities: parsed.data.entities.length, source: reference, provenance: parsed.data.provenance, original: false };
        const next = { ...p, snapshots: [...snapshotRows(p), row], currentSnapshotId: row.id, activeRevision: parserRevision,
          checksum: row.checksum, parserVersion: row.parserVersion, coverage: row.coverage, entities: row.entities };
        await replaceMetadata(next);
        return row;
      } catch (error) { await remove(path.join(location(id), 'revisions', parserRevision)); throw error; }
    }); },
    async listSnapshots(id, owner) { const p = await requireOwner(id, owner); return { currentSnapshotId: currentSnapshot(p), snapshots: snapshotRows(p) }; },
    async readSnapshot(id, owner, snapshotId, kind='data') {
      const p = await requireOwner(id, owner), row = findSnapshot(p, snapshotId);
      if (!['data', 'report', 'inventory'].includes(kind)) fail('Недопустимый документ');
      return json(path.join(location(id), 'revisions', row.parserRevision, kind + '.json'));
    },
    async snapshotOriginal(id, owner, snapshotId) { const p = await requireOwner(id, owner); return snapshotBytes(p, findSnapshot(p, snapshotId)); },
    selectSnapshot(id, owner, snapshotId, expectedSnapshotId, performedBy) { return serial(async () => {
      const p = await requireOwner(id, owner), row = findSnapshot(p, snapshotId);
      if (expectedSnapshotId !== currentSnapshot(p)) fail('Текущий снимок изменился. Обновите проект.', 409);
      await snapshotBytes(p, row);
      // Freeze legacy metadata before switching or reparsing it.
      const next = { ...p, snapshots: snapshotRows(p), currentSnapshotId: row.id, activeRevision: row.parserRevision,
        checksum: row.checksum, parserVersion: row.parserVersion, coverage: row.coverage, entities: row.entities,
        ...(performedBy ? {selectedBy:actorIdentity(performedBy)} : {}) };
      await replaceMetadata(next); return publicMetadata(next);
    }); },
    async read(id,owner,kind='data') { const p = await requireOwner(id,owner); if (!['data','report','inventory'].includes(kind)) throw Error('Недопустимый документ'); return json(path.join(location(id),'revisions',p.activeRevision,kind+'.json')); },
    async original(id,owner) { const p = await requireOwner(id,owner); return snapshotBytes(p, findSnapshot(p, currentSnapshot(p))); },
    async preview(id,owner,archivePath) {
      const inventory = await this.read(id,owner,'inventory'), row = inventory.find(f => f.path === archivePath);
      if (!row) throw Error('Файл не найден');
      const handle = await fs.open(path.join(location(id),'objects',row.sha256),'r');
      try {
        const buffer = Buffer.alloc(Math.min(row.size,256*1024)); await handle.read(buffer,0,buffer.length,0);
        const text = buffer.includes(0) ? null : new TextDecoder('utf8',{fatal:true}).decode(buffer);
        return {path:row.path,size:row.size,text,truncated:row.size > buffer.length};
      } catch (e) { if (e instanceof TypeError) return {path:row.path,size:row.size,text:null}; throw e; } finally { await handle.close(); }
    },
    reparse(id,owner,performedBy) { return serial(async () => {
      const p = await requireOwner(id,owner), parsed = await parseProject(await this.original(id,owner));
      const activeRevision = await revision(location(id),parsed);
      const next = {...p,snapshots:snapshotRows(p),currentSnapshotId:currentSnapshot(p),activeRevision,parserVersion:parsed.report.parserVersion,coverage:parsed.report.status,entities:parsed.data.entities.length,reparsedAt:new Date().toISOString(),...(performedBy ? {reparsedBy:actorIdentity(performedBy)} : {})};
      await replaceMetadata(next);
      return publicMetadata(next);
    }); },
    delete(id,owner) { return serial(async () => { await requireOwner(id,owner); const trash = path.join(root,'.trash-'+id); await fs.rename(location(id),trash); await remove(trash); }); }
  };
}

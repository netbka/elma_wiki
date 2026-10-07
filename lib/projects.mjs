import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function projectStore(directory) {
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
    try { const metadata = await json(path.join(location(id),'project.json')); return metadata.owner === owner ? metadata : null; }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const requireOwner = async (id, owner) => { const p = await get(id,owner); if (!p) throw Error('Проект не найден'); return p; };
  const publicMetadata = ({owner,activeRevision,...p}) => p;
  const revision = async (directory, parsed) => {
    const id = crypto.randomUUID(), dest = path.join(directory,'revisions',id);
    await fs.mkdir(dest,{recursive:true,mode:0o700});
    await fs.mkdir(path.join(directory,'objects'),{recursive:true,mode:0o700});
    for (const row of parsed.inventory) await fs.writeFile(path.join(directory,'objects',row.sha256),parsed.files.get(row.path),{mode:0o600,flag:'w'});
    await write(path.join(dest,'data.json'),parsed.data);
    await write(path.join(dest,'report.json'),parsed.report);
    await write(path.join(dest,'inventory.json'),parsed.inventory);
    return id;
  };
  return {
    get,
    workspaceTransaction(id, owner, operation) { return serial(async () => { const p = await requireOwner(id, owner); return operation(location(id), p); }); },
    async list(owner) {
      await fs.mkdir(root,{recursive:true,mode:0o700});
      const rows = [];
      for (const id of await fs.readdir(root)) { const p = await get(id,owner); if (p) rows.push(publicMetadata(p)); }
      return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    },
    create(owner, bytes, filename='configuration.e365') { return serial(async () => {
      if (typeof owner !== 'string' || !owner) throw Error('Требуется владелец');
      if ((await this.list(owner)).length >= 50) throw Error('Максимум 50 проектов');
      const parsed = await parseProject(bytes), id = crypto.randomUUID(), staging = path.join(root,'.pending-'+id);
      await fs.mkdir(staging,{recursive:true,mode:0o700});
      try {
        await fs.writeFile(path.join(staging,'original.e365'),bytes,{mode:0o600});
        const activeRevision = await revision(staging,parsed);
        const p = {id,owner,filename:String(filename).split(/[\\/]/).pop().replace(/[\x00-\x1f]/g,'').slice(0,160) || 'configuration.e365',checksum:digest(bytes),createdAt:new Date().toISOString(),activeRevision,parserVersion:parsed.report.parserVersion,coverage:parsed.report.status,entities:parsed.data.entities.length};
        await write(path.join(staging,'project.json'),p);
        await fs.rename(staging,location(id));
        return publicMetadata(p);
      } catch (e) { await remove(staging); throw e; }
    }); },
    async read(id,owner,kind='data') { const p = await requireOwner(id,owner); if (!['data','report','inventory'].includes(kind)) throw Error('Недопустимый документ'); return json(path.join(location(id),'revisions',p.activeRevision,kind+'.json')); },
    async original(id,owner) { const p = await requireOwner(id,owner), bytes = await fs.readFile(path.join(location(id),'original.e365')); if (digest(bytes) !== p.checksum) throw Error('Контрольная сумма оригинала не совпадает'); return bytes; },
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
    reparse(id,owner) { return serial(async () => {
      const p = await requireOwner(id,owner), parsed = await parseProject(await this.original(id,owner));
      const activeRevision = await revision(location(id),parsed);
      const next = {...p,activeRevision,parserVersion:parsed.report.parserVersion,coverage:parsed.report.status,entities:parsed.data.entities.length,reparsedAt:new Date().toISOString()};
      const temp = path.join(location(id),'project-'+crypto.randomUUID()+'.tmp');
      await write(temp,next); await fs.rename(temp,path.join(location(id),'project.json'));
      return publicMetadata(next);
    }); },
    delete(id,owner) { return serial(async () => { await requireOwner(id,owner); const trash = path.join(root,'.trash-'+id); await fs.rename(location(id),trash); await remove(trash); }); }
  };
}

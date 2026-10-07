import fs from 'node:fs/promises';
import path from 'node:path';
export function portalStore(directory) {
  const registry = path.join(directory, 'portals.json');
  const read = async () => { try { return JSON.parse(await fs.readFile(registry, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw Error('Хранилище порталов недоступно'); } };
  return {
    async list(owner) { return (await read()).filter(p => p.owner === owner).map(({ owner: unused, ...p }) => p); },
    async get(id, owner) { if (!/^[0-9a-f-]{36}$/.test(id)) return null; return (await read()).find(p => p.id === id && p.owner === owner); },
    dataFile(id) { if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Некорректный ID'); return path.join(directory, 'portals', id, 'data.json'); }
  };
}

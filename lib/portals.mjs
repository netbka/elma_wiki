import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export function portalStore(directory) {
  const registry = path.join(directory, 'portals.json');
  const read = async () => { try { return JSON.parse(await fs.readFile(registry, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw Error('Хранилище порталов недоступно'); } };
  let queue = Promise.resolve();
  return {
    async list(owner) { return (await read()).filter(p => p.owner === owner).map(({ owner: unused, ...p }) => p); },
    async get(id, owner) { if (!/^[0-9a-f-]{36}$/.test(id)) return null; return (await read()).find(p => p.id === id && p.owner === owner); },
    dataFile(id) { if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Некорректный ID'); return path.join(directory, 'portals', id, 'data.json'); },
    create(owner, name) {
      const operation = queue.then(async () => {
        const title = typeof name === 'string' ? name.trim().slice(0, 80) : '';
        if (!title) throw Error('Введите название портала');
        const rows = await read();
        if (rows.filter(p => p.owner === owner).length >= 50) throw Error('Максимум 50 порталов на пользователя');
        const portal = { id: crypto.randomUUID(), name: title, owner, createdAt: new Date().toISOString() };
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(registry + '.tmp', JSON.stringify([...rows, portal]), { mode: 0o600 });
        await fs.rename(registry + '.tmp', registry);
        const { owner: unused, ...result } = portal; return result;
      });
      queue = operation.catch(() => {}); return operation;
    }
  };
}

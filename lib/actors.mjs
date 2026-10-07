import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Only trusted authentication code supplies this value, never a request body.
export function actorIdentity(user) {
  if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 160 ||
      typeof user.login !== 'string' || !user.login || user.login.length > 254 ||
      !['vk-teams', 'email', 'local'].includes(user.provider))
    throw Object.assign(Error('An authenticated actor is required'), { statusCode: 401 });
  return { id: user.id, login: user.login, provider: user.provider };
}

export function actorStore(directory) {
  const root = path.resolve(directory, 'actors');
  let queue = Promise.resolve();
  return {
    resolve(user) {
      const identity = actorIdentity(user);
      const operation = queue.then(async () => {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        const file = path.join(root, crypto.createHash('sha256').update(identity.id).digest('hex') + '.json');
        try {
          const existing = JSON.parse(await fs.readFile(file, 'utf8'));
          if (existing.id !== identity.id || existing.provider !== identity.provider)
            throw Error('Stored actor identity does not match authentication');
          return existing;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const record = { ...identity, firstSeenAt: new Date().toISOString() };
        const temp = file + '.' + crypto.randomUUID() + '.tmp';
        try {
          await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
          await fs.rename(temp, file);
        } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
        return record;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}

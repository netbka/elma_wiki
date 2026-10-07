import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { flowReviewStore } from '../lib/flow-reviews.mjs';
export async function reviewRevision(root) {
  const hash = crypto.createHash('sha256');
  // Include the actual renderer, behavior, story entry points and governance.
  for (const directory of ['web/flows', 'storybook/stories', 'docs/workflows']) {
    for (const name of (await fs.readdir(path.join(root, directory))).sort()) {
      const file = path.join(root, directory, name);
      if ((await fs.stat(file)).isFile()) { hash.update(directory + '/' + name); hash.update(await fs.readFile(file)); }
    }
  }
  hash.update(await fs.readFile(path.join(root, 'docs/STORYBOOK.md')));
  hash.update(await fs.readFile(path.join(root, 'docs/EXPERIENCE_REVIEW.md')));
  hash.update(await fs.readFile(path.join(root, 'lib/flow-reviews.mjs')));
  hash.update(await fs.readFile(path.join(root, 'storybook/review-api.mjs')));
  return hash.digest('hex');
}
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
export function reviewApiPlugin(root, options = {}) {
  // Node's normal import cache otherwise keeps old states after Vite hot reload.
  const getFlow = async id => {
    const file = path.join(root, 'web/flows/catalog.js');
    const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const catalog = await import(pathToFileURL(file).href + '?catalog=' + hash);
    return catalog.flowById(id);
  };
  const store = options.store || flowReviewStore(path.join(root, '.local/storybook/reviews.json'), { revision: () => reviewRevision(root), getFlow });
  return { name: 'elma-local-reviews', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.split('?')[0].startsWith('/__elma/reviews')) return next();
      const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
      try {
        const base = `http://${req.headers.host}`, url = new URL(req.url, base);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !loopback(req.socket.remoteAddress)) return send(403, { error: 'Рецензии доступны только на этой машине' });
        if (req.headers.origin && req.headers.origin !== base) return send(403, { error: 'Недопустимый источник запроса' });
        if (url.pathname !== '/__elma/reviews') return send(404, { error: 'API не найден' });
        if (req.method === 'GET') return send(200, await store.get(url.searchParams.get('flowId')));
        if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
        if (req.headers['x-elma-review'] !== '1' || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(403, { error: 'Отсутствует заголовок рецензии' });
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 16384) throw Error('Комментарий слишком большой'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Некорректный запрос');
        if (input.flowId !== url.searchParams.get('flowId')) throw Error('Сценарий запроса не совпадает');
        return send(201, await store.append(input));
      } catch (error) { return send(error.statusCode || 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.code ? 'Хранилище рецензий недоступно' : error.message }); }
    });
  } };
}

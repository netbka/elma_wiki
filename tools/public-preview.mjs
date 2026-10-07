// Local static preview only. This tool is never included in the Vercel output.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicSite } from './build-public.mjs';
const directory = fileURLToPath(new URL('../.public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
export function createStaticPreview() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let target = path.resolve(directory, '.' + pathname);
      if (!target.startsWith(path.resolve(directory) + path.sep) && target !== path.resolve(directory)) throw Error();
      if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html');
      const content = await fs.readFile(target);
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : await fs.readFile(path.join(directory, '404.html')));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPublicSite();
  const port = Number(process.env.PUBLIC_PREVIEW_PORT || 43172);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Некорректный порт предпросмотра');
  createStaticPreview().listen(port, '127.0.0.1', () => console.log(`Публичный сайт: http://127.0.0.1:${port}`));
}

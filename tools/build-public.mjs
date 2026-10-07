import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articles } from '../dist/articles.js';
import { demoData } from '../lib/demo.mjs';
import { renderPublicFiles } from '../lib/public-site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildPublicSite() {
  const files = renderPublicFiles({ landing: await fs.readFile(path.join(root, 'web/index.html'), 'utf8'), articles, example: demoData().servers.showcase });
  for (const [source, target] of [['web/project.css', 'project.css'], ['web/public.js', 'public.js']]) files.set(target, await fs.readFile(path.join(root, source), 'utf8'));
  files.set('project.css', files.get('project.css') + '\n' + await fs.readFile(path.join(root, 'web/public.css'), 'utf8'));
  const directory = path.resolve(root, '.public');
  if (path.dirname(directory) !== path.resolve(root) || path.basename(directory) !== '.public') throw Error('Недопустимый каталог публичной сборки');
  // Remove only this generated output, so stale or manually copied files cannot be published.
  await fs.rm(directory, { recursive: true, force: true });
  for (const [name, content] of files) {
    const target = path.resolve(directory, name);
    if (!target.startsWith(directory + path.sep)) throw Error('Недопустимый путь публичной страницы');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return { directory, files: [...files.keys()] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPublicSite();
  console.log(`Публичная сборка: ${result.files.length} статических файлов в .public`);
}

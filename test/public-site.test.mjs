import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { articles } from '../dist/articles.js';
import { buildPublicSite } from '../tools/build-public.mjs';

test('public build publishes only static explanations and synthetic examples; every local link resolves', async () => {
  await fs.mkdir(new URL('../.public/', import.meta.url), { recursive: true });
  await fs.writeFile(new URL('../.public/stale-private.txt', import.meta.url), 'SYNTHETIC_PRIVATE_SENTINEL');
  const result = await buildPublicSite(), names = new Set(result.files);
  assert.ok(!names.has('stale-private.txt'));
  await assert.rejects(fs.access(new URL('../.public/stale-private.txt', import.meta.url)));
  assert.deepEqual(result.files.filter(f => !f.endsWith('.html')).sort(), ['project.css', 'public.js']);
  assert.equal(result.files.filter(f => /^articles\/[^/]+\/index.html$/.test(f)).length, articles.length);
  assert.equal(result.files.filter(f => /^examples\/[^/]+\/index.html$/.test(f)).length, 6);
  const content = new Map(await Promise.all(result.files.map(async name => [name, await fs.readFile(new URL('../.public/' + name, import.meta.url), 'utf8')])));
  for (const [name, html] of content) {
    if (!name.endsWith('.html')) continue;
    assert.ok(!/<form\b|<iframe\b|contenteditable=/i.test(html), name);
    assert.ok(!/href="\/(?:api|auth|login|dashboard|p)\b|src="[^"\n]*(?:service|app)\.js/i.test(html), name);
    assert.ok(!html.includes('SYNTHETIC_PRIVATE_SENTINEL'));
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = new URL(href.replaceAll('&amp;', '&'), 'https://wiki.example.org/' + name);
      if (target.origin !== 'https://wiki.example.org') continue;
      const filename = target.pathname.slice(1) + (target.pathname.endsWith('/') ? 'index.html' : '');
      assert.ok(names.has(filename), `${name} -> ${href}`);
      if (target.hash) assert.ok(content.get(filename).includes(`id="${decodeURIComponent(target.hash.slice(1))}"`), `${name} -> ${href}`);
    }
  }
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(content.get('public.js')));
  const vercel = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.framework, null); assert.equal(vercel.outputDirectory, '.public');
  assert.equal(vercel.buildCommand, 'npm run build:public');
  assert.equal(vercel.functions, undefined); assert.equal(vercel.rewrites, undefined);
  assert.match(vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value, /connect-src 'none'/);
  const home = content.get('index.html'); assert.ok(home.includes('Читать руководства')); assert.ok(!home.includes('Загрузить E365'));
});

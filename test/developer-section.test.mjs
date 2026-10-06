import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import yauzl from 'yauzl';
import { articles } from '../dist/articles.js';
import { developerArticles } from '../dist/developer-articles.js';
import { createServer } from '../server.mjs';

test('developer guides declare status and link only to existing articles', () => {
  const ids = new Set(articles.map(a => a.id));
  assert.equal(developerArticles.length, 7);
  for (const article of developerArticles) {
    assert.ok(article.status); assert.ok(article.sources.length);
    assert.equal(new Set(article.sections.map(s => s.id)).size, article.sections.length);
    for (const section of article.sections) for (const match of section.body.matchAll(/href="#\/article\/([^"?]+)"/g)) assert.ok(ids.has(match[1]), match[1]);
  }
  assert.ok(developerArticles.find(a => a.id === 'field-form-recipe').status.includes('не испытан'));
});
test('homepage and public showcase expose developer guides without login', async t => {
  const server = createServer({ allowLocal: false, clientId: '', clientSecret: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await (await fetch(base)).text();
  assert.ok(home.includes('id="developers"'));
  for (const id of ['file-development', 'field-form-recipe', 'workbench']) assert.ok(home.includes(`#/article/${id}`));
  const response = await fetch(base + '/p/showcase/developer-articles.js'); assert.equal(response.status, 200);
  const source = await response.text(); assert.ok(source.includes('compatibility-lab'));
  const app = await (await fetch(base + '/p/showcase/app.js')).text(); assert.ok(app.includes('developer-entry')); assert.ok(app.includes('esc(a.status'));
});
test('VSIX includes only extension implementation and a matching install manifest', async () => {
  await promisify(execFile)(process.execPath, ['tools/package-workbench.mjs']);
  const buffer = await fs.readFile(new URL('../.local/e365-workbench-0.1.0.vsix', import.meta.url));
  const entries = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const result = new Map(); zip.on('error', reject); zip.on('end', () => resolve(result));
      zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = []; stream.on('data', c => chunks.push(c)); stream.on('error', reject);
        stream.on('end', () => { result.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
      })); zip.readEntry();
    });
  });
  assert.deepEqual([...entries.keys()].sort(), ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/README.md', 'extension/core.mjs', 'extension/extension.cjs', 'extension/package.json'].sort());
  const pkg = JSON.parse(entries.get('extension/package.json'));
  assert.equal(pkg.main, './extension.cjs'); assert.equal(pkg.capabilities.untrustedWorkspaces.supported, false);
  assert.ok(entries.get('extension.vsixmanifest').includes(`Version="${pkg.version}"`));
});

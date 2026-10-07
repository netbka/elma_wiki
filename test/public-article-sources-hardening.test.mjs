import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifySource, createArticleSourcesModel, renderArticleSources } from '../web/public-article-sources.mjs';
import { renderPublicFiles } from '../lib/public-site.mjs';
import { articles } from '../dist/articles.js';

const render = sources => renderArticleSources(createArticleSourcesModel(sources));
const help = 'https://elma365.com/ru/help/platform/export-import-elma365.html';
const repo = 'https://github.com/netbka/elma_wiki/blob/main/';
const sentinel = 'SYNTHETIC_PRIVATE_VALUE';

test('rejected references do not retain or publish credentials, private paths or object values', () => {
  const sources = [`.local/${sentinel}`, `https://user:${sentinel}@elma365.com/ru/help/platform/a.html`, { token: sentinel }, `<img src=x onerror="${sentinel}">`];
  const model = createArticleSourcesModel(sources);
  assert.equal(model.state, 'invalid');
  assert.ok(!JSON.stringify(model).includes(sentinel), 'even the view model must not retain rejected values');
  assert.ok(!render(sources).includes(sentinel));
  assert.doesNotMatch(render(sources), /<a\b|<img|onerror/);
  assert.ok(model.items.every(item => item.label === undefined && item.href === undefined));
});

test('unserializable metadata and sparse lists cannot crash or claim usable sources', () => {
  const cycle = {}; cycle.self = cycle;
  const hostile = { toString() { throw Error('unexpected conversion'); }, toJSON() { throw Error('unexpected serialization'); } };
  for (const sources of [[cycle, hostile, 1n, Symbol('private'), null, false], new Array(2), {}, 'README.md']) {
    assert.equal(createArticleSourcesModel(sources).state, 'invalid');
    assert.doesNotThrow(() => render(sources));
    assert.doesNotMatch(render(sources), /<a\b/);
  }
  for (const sources of [undefined, null, []]) assert.equal(createArticleSourcesModel(sources).state, 'empty');
});

test('directory names and an allowed hostname do not authorize arbitrary source destinations', () => {
  const values = [
    'docs/private-data.json', 'tools/credentials.env', 'lib/private-key.pem',
    repo + '.env', repo + 'docs/private-data.json', repo + 'README.md?token=' + sentinel,
    'https://github.com/netbka/elma_wiki/issues/27',
    help + '?token=' + sentinel, help + '?', help.replace('.com/', '.com:444/'),
    help.replace('/ru/help/', '/private/'), help.replace('/platform/', '/platform/../'),
    help.replace('/platform/', '/platform/%2e%2e/'), help.replace('/platform/', '/%70latform/'),
    'https://elma365.com/%ZZ', 'https://elma365.com/%FF',
    help + '#<img>', help + '#' + sentinel + '%20private',
    help.replace('.com/', '.com.evil.example/'), help.replace('.com/', '.com./'),
    'https://localhost/ru/help/platform/a.html', 'https://127.0.0.1/ru/help/platform/a.html',
    '//elma365.com/ru/help/platform/a.html', 'README.md\u0000'
  ];
  for (const value of values) {
    assert.equal(classifySource(value).kind, 'invalid', value);
    assert.doesNotMatch(render([value]), /<a\b/, value);
    assert.ok(!render([value]).includes(sentinel));
  }
  assert.equal(classifySource(help + '#usage').kind, 'external');
  assert.equal(classifySource(repo + 'README.md').kind, 'external');
});

test('mixed metadata preserves useful links, article status and caller input', () => {
  const sources = ['README.md', help, '.local/' + sentinel];
  const before = structuredClone(sources), status = 'Unverified < & >';
  const model = createArticleSourcesModel(sources, { status }), html = renderArticleSources(model);
  assert.deepEqual(sources, before);
  assert.equal(model.status, status);
  assert.equal(model.state, 'invalid');
  assert.equal([...html.matchAll(/<a\b/g)].length, 2);
  assert.equal([...html.matchAll(/class="badge"/g)].length, 1);
  assert.ok(html.includes('Unverified &lt; &amp; &gt;'));
  assert.ok(!html.includes(sentinel));
});

test('private source values stay hidden through the actual public article generator', async () => {
  const landing = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const entries = [{ ...articles[0], sources: ['README.md', '.local/' + sentinel, { secret: sentinel }] }, ...articles.slice(1)];
  const files = renderPublicFiles({ landing, articles: entries, example: { entities: [] } });
  const html = files.get(`articles/${entries[0].id}/index.html`);
  const expected = renderArticleSources(createArticleSourcesModel(entries[0].sources, { status: entries[0].status }));
  assert.ok(html.includes(expected));
  assert.match(html, /data-sources-state="invalid"/);
  assert.ok(!html.includes(sentinel));
  assert.ok(html.includes(repo + 'README.md'));
  assert.doesNotMatch(html, /href="\/(?:api|auth|login|dashboard)\b/);
});

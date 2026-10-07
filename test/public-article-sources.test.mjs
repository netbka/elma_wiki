import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, createArticleSourcesModel, renderArticleSources, SOURCES_SECTION_ID, SOURCES_TITLE } from '../web/public-article-sources.mjs';

const repository = 'https://github.com/netbka/elma_wiki/blob/main/';
const help = 'https://elma365.com/ru/help/platform/lowcode-devops-pm.html';

test('declared public references retain their destinations without claiming verification', () => {
  const input = ['README.md', help], before = structuredClone(input);
  const model = createArticleSourcesModel(input), html = renderArticleSources(input);
  assert.equal(model.state, 'listed');
  assert.deepEqual(model.items.map(item => item.kind), ['repository', 'external']);
  assert.deepEqual(model.items.map(item => item.href), [repository + 'README.md', help]);
  assert.deepEqual(input, before);
  assert.ok(html.includes(`id="${SOURCES_SECTION_ID}"`));
  assert.ok(html.includes(SOURCES_TITLE));
  assert.match(html, /ELMA365/);
  assert.doesNotMatch(html, /class="badge"|data-verified|<script|<iframe|<form/);
  assert.equal(classifySource(repository + 'README.md').href, repository + 'README.md');
  assert.equal(classifySource(help + '#usage').href, help + '#usage');
});

test('absent sources have an empty fallback, malformed containers are not treated as absent', () => {
  for (const input of [undefined, null, []]) {
    assert.equal(createArticleSourcesModel(input).state, 'empty');
    assert.match(renderArticleSources(input), /data-sources-state="empty"/);
    assert.doesNotMatch(renderArticleSources(input), /<a\b/);
  }
  for (const input of ['README.md', {}, 4, false]) {
    assert.equal(createArticleSourcesModel(input).state, 'invalid');
    assert.doesNotMatch(renderArticleSources(input), /<a\b/);
  }
});

const rejected = [
  '', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///private/value',
  '/etc/passwd', 'C:\\Users\\private\\config', '\\\\server\\private', '.env.production', '.local/projects/x',
  'qa/result.png', 'node_modules/module/index.js', 'docs/private-data.json', 'tools/credentials.env',
  '../README.md', 'docs/../README.md', 'docs//E365_FILE_PROJECTS.md', 'docs/./E365_FILE_PROJECTS.md',
  'docs/%2e%2e/README.md', 'docs/E365_FILE_PROJECTS.md?token=SYNTHETIC_SECRET',
  'https://github.com/netbka/elma365/blob/main/README.md',
  repository + '.env', repository + '../main/README.md', repository + 'README.md?token=SYNTHETIC_SECRET',
  'http://elma365.com/ru/help/platform/a.html', '//elma365.com/ru/help/platform/a.html',
  'https://user:SYNTHETIC_SECRET@elma365.com/ru/help/platform/a.html',
  'https://elma365.com:444/ru/help/platform/a.html',
  'https://elma365.com.evil.example/ru/help/platform/a.html',
  'https://elma365.com./ru/help/platform/a.html',
  'https://localhost/ru/help/platform/a.html', 'https://127.0.0.1/ru/help/platform/a.html',
  'https://elma365.com/ru/help/platform/a.html?redirect=https://evil.example',
  'https://elma365.com/ru/help/platform/%', 'https://elma365.com/ru/help/platform/%E0%A4%A',
  'https://elma365.com/ru/help/platform/%2e%2e/a.html',
  'https://elma365.com/ru/help/platform/../a.html', 'https://elma365.com/ru/help//a.html',
  'https://elma365.com/ru/help/platform/a.html#<img>',
  'https://elma365.com/ru/help/platform/a.html\nSYNTHETIC_SECRET',
  'README.md\u0000', '<img src=x onerror="alert(1)">', 'x'.repeat(1025)
];

test('unsafe, private, normalized and encoded references fail closed without public value echoes', () => {
  for (const input of rejected) {
    assert.deepEqual(classifySource(input), { kind: 'invalid' }, input);
    const html = renderArticleSources([input]);
    assert.match(html, /data-sources-state="invalid"/);
    assert.doesNotMatch(html, /<a\b|<img|onerror|SYNTHETIC_SECRET/);
    if (input.length > 3) assert.ok(!html.includes(input), input);
  }
});

test('unserializable malformed metadata cannot crash rendering or invoke object conversion', () => {
  const cycle = {}; cycle.self = cycle;
  const hostile = { toString() { throw Error('unexpected conversion'); }, toJSON() { throw Error('unexpected serialization'); } };
  const input = [cycle, hostile, 1n, Symbol('private'), null, false, ['README.md']];
  assert.equal(createArticleSourcesModel(input).state, 'invalid');
  assert.doesNotThrow(() => renderArticleSources(input));
  assert.doesNotMatch(renderArticleSources(input), /<a\b/);
  assert.equal(createArticleSourcesModel(new Array(2)).state, 'invalid');
});

test('mixed references preserve usable sources and hide rejected credentials', () => {
  const html = renderArticleSources(['README.md', help, '.local/SYNTHETIC_SECRET', { secret: 'SYNTHETIC_SECRET' }]);
  assert.match(html, /data-sources-state="invalid"/);
  assert.equal([...html.matchAll(/<a\b/g)].length, 2);
  assert.ok(html.includes(repository + 'README.md'));
  assert.doesNotMatch(html, /SYNTHETIC_SECRET|\.local/);
});

test('source policy does not fetch URLs or inspect private files', () => {
  const beforeFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('No network in source rendering'); };
  try { assert.equal(createArticleSourcesModel([help]).state, 'listed'); renderArticleSources([help]); }
  finally { globalThis.fetch = beforeFetch; }
});

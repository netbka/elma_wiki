import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { articles } from '../dist/articles.js';
import { demoData } from '../lib/demo.mjs';
import { renderPublicFiles } from '../lib/public-site.mjs';
import {
  REPOSITORY_URL, SOURCES_SECTION_ID, classifySource, createArticleSourcesModel, renderArticleSources
} from '../web/public-article-sources.mjs';

const root = new URL('../', import.meta.url);

test('repository paths and allow-listed https documentation become links; nothing else does', () => {
  assert.deepEqual(classifySource('lib/e365.mjs'), {
    kind: 'repository', path: 'lib/e365.mjs', href: REPOSITORY_URL + '/blob/main/lib/e365.mjs', label: 'lib/e365.mjs'
  });
  assert.equal(classifySource('README.md').kind, 'repository');
  assert.equal(classifySource('docs/E365_FILE_PROJECTS.md').href, REPOSITORY_URL + '/blob/main/docs/E365_FILE_PROJECTS.md');
  const external = classifySource('https://elma365.com/ru/help/platform/export-import-elma365.html');
  assert.equal(external.kind, 'external');
  assert.equal(external.label, 'elma365.com/ru/help/platform/export-import-elma365.html');
  assert.equal(classifySource('https://github.com/netbka/elma_wiki/blob/main/README.md').kind, 'external');
  const rejected = {
    'javascript:alert(1)': 'https',
    'data:text/html,<b>x</b>': 'недопустимые символы',
    'http://elma365.com/ru/help/': 'https',
    'https://user:secret@elma365.com/ru/help/': 'учётные данные',
    'https://evil.example/elma365.com/': 'вне списка',
    'https://elma365.com/%ZZ': 'некорректное кодирование',
    'https://elma365.com/%FF': 'некорректное кодирование',
    'https://github.com/someone-else/repo': 'вне репозитория',
    '../../.env': 'скрытый или недопустимый сегмент',
    'docs/../.env': 'скрытый или недопустимый сегмент',
    '.local/delivery/connections.json': 'скрытый или недопустимый сегмент',
    '.env': 'скрытый или недопустимый сегмент',
    '/etc/passwd': 'абсолютный путь',
    'C:/Users/private/.env': 'абсолютный путь',
    'lib\\e365.mjs': 'недопустимые символы',
    'qa/public-landing-1440.png': 'вне публичной части',
    'node_modules/playwright/package.json': 'вне публичной части',
    'uploads/customer.e365': 'вне публичной части',
    docs: 'путь к файлу',
    'lib/e365.mjs" onmouseover="alert(1)': 'недопустимые символы',
    '': 'пустое значение',
    '   ': 'пустое значение'
  };
  for (const [value, reason] of Object.entries(rejected)) {
    const item = classifySource(value);
    assert.equal(item.kind, 'invalid', value);
    assert.match(item.reason, new RegExp(reason), value);
    assert.equal(item.href, undefined, value);
  }
  for (const value of [undefined, null, 42, {}, ['lib/e365.mjs'], { href: 'https://elma365.com/' }]) {
    assert.equal(classifySource(value).kind, 'invalid');
  }
  assert.equal(classifySource('lib/' + 'a'.repeat(300) + '.mjs').reason, 'слишком длинное значение');
});

test('model states: listed, empty and invalid; status wording is preserved, never upgraded', () => {
  const listed = createArticleSourcesModel(['README.md', 'https://elma365.com/ru/help/platform/lowcode-devops-pm.html'], { status: 'Экспериментально · импорт не испытан' });
  assert.equal(listed.state, 'listed');
  assert.equal(listed.status, 'Экспериментально · импорт не испытан');
  for (const sources of [[], undefined, null, 'README.md', {}]) {
    const model = createArticleSourcesModel(sources, { status: undefined });
    assert.equal(model.state, 'empty'); assert.deepEqual(model.items, []); assert.equal(model.status, 'Руководство');
  }
  const invalid = createArticleSourcesModel(['README.md', 'javascript:alert(1)', 7], { status: 'Структура формата' });
  assert.equal(invalid.state, 'invalid');
  assert.deepEqual(invalid.items.map(item => item.kind), ['repository', 'invalid', 'invalid']);
});

test('renderer escapes labels, links only verified references and keeps the reference/verification distinction', () => {
  const html = renderArticleSources(createArticleSourcesModel(
    ['lib/e365.mjs', 'https://elma365.com/ru/help/platform/export-import-elma365.html', '<img src=x onerror=alert(1)>', 'javascript:alert(1)'],
    { status: '<b>Проверено</b> · 1 января 2099' }
  ));
  assert.equal((html.match(/<a /g) || []).length, 2, 'only the two valid references are links');
  assert.ok(html.includes(`href="${REPOSITORY_URL}/blob/main/lib/e365.mjs" rel="noreferrer noopener"`));
  assert.ok(html.includes('href="https://elma365.com/ru/help/platform/export-import-elma365.html"'));
  assert.ok(!html.includes('<img'), 'label is escaped');
  assert.ok(!/href="javascript:/.test(html));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;b&gt;Проверено&lt;/b&gt; · 1 января 2099'), 'status is shown verbatim and escaped');
  assert.ok(html.includes('data-sources-state="invalid"'));
  assert.ok(html.includes('не означает, что описанное поведение проверено на ELMA365'));
  assert.ok(html.includes('ссылка не публикуется'));
  assert.ok(html.includes(`id="${SOURCES_SECTION_ID}"`));
  assert.deepEqual(html.match(/<span class="badge">[^<]*<\/span>/g), ['<span class="badge">&lt;b&gt;Проверено&lt;/b&gt; · 1 января 2099</span>'], 'the only badge is the article status itself');

  const empty = renderArticleSources(createArticleSourcesModel([], {}));
  assert.ok(empty.includes('data-sources-state="empty"'));
  assert.ok(empty.includes('источники не указаны'));
  assert.equal((empty.match(/<a /g) || []).length, 0);
  assert.ok(empty.includes('<span class="badge">Руководство</span>'));
});

test('every published article renders its declared sources; declared repository paths exist and only safe links are emitted', async () => {
  // The real public generator with the real article data; rendered in memory so this
  // test does not race test/public-site.test.mjs for the shared .public directory.
  const files = renderPublicFiles({ landing: await fs.readFile(new URL('web/index.html', root), 'utf8'), articles, example: demoData().servers.showcase });
  for (const article of articles) {
    const html = files.get(`articles/${article.id}/index.html`);
    assert.ok(html, article.id);
    const section = html.match(/<section class="sources"[\s\S]*?<\/section>/)?.[0];
    assert.ok(section, article.id);
    assert.ok(section.includes('data-sources-state="listed"'), `${article.id}: all declared sources must be valid, got ${section.match(/data-sources-state="([^"]+)"/)[1]}`);
    assert.ok(html.includes(`<a href="#${SOURCES_SECTION_ID}">Источники</a>`), `${article.id}: contents link`);
    const links = [...section.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    assert.equal(links.length, article.sources.length, article.id);
    for (const href of links) assert.match(href, /^https:\/\/(github\.com\/netbka\/elma_wiki\/blob\/main\/|(?:www\.)?elma365\.com\/)/, `${article.id} -> ${href}`);
    for (const source of article.sources) {
      if (/^https:/.test(source)) continue;
      await fs.access(new URL(source, root)).catch(() => assert.fail(`${article.id}: declared source ${source} is not in the repository`));
    }
    assert.ok(section.includes(`<span class="badge">${escape(article.status || 'Руководство')}</span>`), `${article.id}: status is repeated verbatim`);
  }
});

test('Storybook registers the same renderer and all three source states', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('storybook/review-manifest.json', root), 'utf8'));
  const stories = await import('../storybook/stories/PublicArticleSources.stories.js');
  const entry = manifest.capabilities['public-article-sources'];
  assert.equal(entry.kind, 'implemented');
  assert.deepEqual(entry.renderer, ['web/public-article-sources.mjs']);
  assert.deepEqual(entry.requiredVisibleStates, ['listed', 'empty', 'invalid']);
  assert.deepEqual(entry.storyIds, ['Listed', 'Empty', 'Invalid'].map(name => `${stories.default.id}--${name.toLowerCase()}`));
  for (const name of ['Listed', 'Empty', 'Invalid']) assert.equal(typeof stories[name].render, 'function');
  for (const source of entry.sources) await fs.access(new URL(source, root));
});

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

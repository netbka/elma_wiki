import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { articles } from '../dist/articles.js';
import { renderPublicFiles, escapeHtml } from '../lib/public-site.mjs';
import { classifySource, createArticleSourcesModel, renderArticleSources, SOURCES_SECTION_ID } from '../web/public-article-sources.mjs';

const landing = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const render = entries => renderPublicFiles({ landing, articles: entries, example: { entities: [] } });

test('all actual public articles render their declared sources, existing status and source navigation', async () => {
  const files = render(articles);
  for (const article of articles) {
    const html = files.get(`articles/${article.id}/index.html`);
    assert.equal(createArticleSourcesModel(article.sources).state, 'listed', article.id);
    assert.ok(html.includes(renderArticleSources(article.sources)), article.id);
    assert.ok(html.includes(`href="#${SOURCES_SECTION_ID}"`));
    assert.equal([...html.matchAll(/id="article-sources"/g)].length, 1);
    if (article.status) assert.ok(html.includes(`<span class="badge">${escapeHtml(article.status)}</span>`));
    // A link allowlist is not proof of existence: check the real checkout too.
    for (const value of article.sources) {
      const source = classifySource(value);
      if (source.kind === 'repository') {
        const stat = await lstat(new URL('../' + source.label, import.meta.url));
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), source.label);
      }
    }
  }
});

test('actual generator preserves good links but never echoes malformed or private source values', () => {
  for (const sources of [undefined, {}, ['README.md', '.local/SYNTHETIC_SECRET', { token: 'SYNTHETIC_SECRET' }]]) {
    const article = { ...articles[0], sources, status: '<unverified & illustrative>' };
    const files = render([article, ...articles.slice(1)]);
    const html = files.get(`articles/${article.id}/index.html`);
    assert.ok(html.includes(renderArticleSources(sources)));
    assert.ok(html.includes('&lt;unverified &amp; illustrative&gt;'));
    assert.doesNotMatch(html, /SYNTHETIC_SECRET/);
    assert.equal([...html.matchAll(/class="badge"/g)].length, 1, 'Sources must not add a status badge');
    assert.doesNotMatch(html, /href="\/(?:api|auth|login|dashboard)\b/);
  }
});

test('article-source stories and manifest use the production renderer with all fallback states', async () => {
  const stories = await import('../storybook/stories/ArticleSources.stories.js');
  const manifest = JSON.parse(await readFile(new URL('../storybook/review-manifest.json', import.meta.url), 'utf8'));
  const entry = manifest.capabilities['public-article-sources'];
  assert.deepEqual(entry.renderer, ['web/public-article-sources.mjs']);
  assert.deepEqual(entry.requiredVisibleStates, ['listed', 'empty', 'invalid']);
  assert.deepEqual(entry.storyIds, ['Listed', 'Empty', 'Invalid'].map(name => `${stories.default.id}--${name.toLowerCase()}`));
  for (const name of ['Listed', 'Empty', 'Invalid']) assert.equal(typeof stories[name].render, 'function');
});

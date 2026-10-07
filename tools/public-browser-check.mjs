import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { FIELD_GUIDE_PATH, FIELD_GUIDE_TITLE } from '../web/public-field-guide.mjs';
import { SOURCES_TITLE } from '../web/public-article-sources.mjs';
import { articles } from '../dist/articles.js';
import { buildPublicSite } from './build-public.mjs';
import { createStaticPreview } from './public-preview.mjs';
await buildPublicSite();
const server = createStaticPreview();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), errors = [], failed = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push(request.url()));
  page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
  await fs.mkdir('qa', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/');
    await page.getByRole('link', { name: 'Читать руководства', exact: true }).waitFor();
    assert.equal(await page.locator('a[href="/dashboard"],a[href="/login"],input[type=file]').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `qa/public-landing-${width}.png`, fullPage: true });
    const lookup = page.locator('a.task').filter({ has: page.getByRole('heading', { name: 'Найти поле', exact: true }) });
    assert.equal(await lookup.getAttribute('href'), FIELD_GUIDE_PATH);
    await lookup.click();
    await page.getByRole('heading', { name: FIELD_GUIDE_TITLE, exact: true }).waitFor();
    assert.equal(await page.locator('[data-field-guide-result="ready"]').count(), 1);
    for (const name of ['Посмотреть JSON выбранного поля', 'Проверить ответ']) {
      const summary = page.locator('summary').filter({ hasText: name });
      await summary.focus(); await summary.press('Enter');
      assert.ok(await summary.locator('..').getAttribute('open') !== null);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `qa/public-field-guide-${width}.png`, fullPage: true });
    await page.goto(base + '/');
    await page.getByRole('link', { name: 'Пройти учебный пример', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, FIELD_GUIDE_PATH);
    await page.goto(base + '/articles/field-form-recipe/');
    await page.getByRole('link', { name: SOURCES_TITLE, exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#article-sources');
    const sources = page.locator('.article-sources');
    assert.equal(await sources.getAttribute('data-sources-state'), 'listed');
    assert.equal(await sources.locator('.badge').count(), 0);
    assert.equal(await sources.getByRole('link').count(), 4);
    await sources.getByRole('link').first().focus();
    assert.ok(await sources.getByRole('link').first().evaluate(node => node === document.activeElement));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await sources.screenshot({ path: `qa/public-article-sources-${width}.png` });
  }
  for (const article of articles) {
    await page.goto(base + '/articles/' + article.id + '/');
    await page.getByRole('heading', { name: article.title, exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), article.id);
    assert.equal(await page.locator('.article-sources[data-sources-state="listed"]').count(), 1, article.id);
    assert.equal(await page.locator('.article-sources a').count(), article.sources.length, article.id);
  }
  await page.goto(base + '/articles/field-form-recipe/');
  await page.screenshot({ path: 'qa/public-article-mobile.png', fullPage: true });
  const copy = page.locator('.copy').first();
  await copy.click(); await page.getByRole('button', { name: 'Скопировано', exact: true }).waitFor();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).length > 0);
  await page.goto(base + '/examples/');
  assert.equal(await page.locator('.card').count(), 6);
  const links = await page.locator('.card').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  for (const href of links) {
    await page.goto(base + href);
    await page.getByRole('heading', { name: 'Поля и контекст' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.goto(base + '/guide/'); await page.getByRole('heading', { name: 'От конфигурации к понятной карте' }).waitFor();
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  assert.ok(requests.every(r => r.url.startsWith(base) && !['fetch', 'xhr', 'websocket'].includes(r.type)), 'Static site must not call a backend');
  for (const route of ['/api/session', '/auth/github', '/login', '/dashboard', '/server.mjs', '/.env', '/extensions/e365-workbench/']) assert.equal((await fetch(base + route)).status, 404, route);
  console.log(`Public: landing, field-lookup journey, guide, ${articles.length} articles with sources, 6 examples, mobile, clipboard and keyboard passed; no backend requests.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

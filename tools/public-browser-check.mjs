import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  }
  for (const article of articles) {
    await page.goto(base + '/articles/' + article.id + '/');
    await page.getByRole('heading', { name: article.title, exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), article.id);
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
  console.log(`Public: landing, guide, ${articles.length} articles, 6 examples, mobile, clipboard and keyboard passed; no backend requests.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

// Inspect the built Storybook renderer, not copied markup or a live ELMA host.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FIELD_GUIDE_PATH, FIELD_GUIDE_TITLE } from '../web/public-field-guide.mjs';

const root = path.resolve(fileURLToPath(new URL('../storybook/storybook-static/', import.meta.url)));
await readFile(path.join(root, 'iframe.html')); // Fail early when build:storybook was not run.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep) && filename !== path.join(root, 'index.html')) {
      res.writeHead(403).end(); return;
    }
    const bytes = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], failed = [], external = [], evidence = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push(request.url()));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await mkdir('qa', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const state of ['ready', 'unavailable', 'ambiguous']) {
      await page.goto(`${base}/iframe.html?id=public-field-guide--${state}&viewMode=story`);
      await page.locator(`[data-field-guide="${state}"]`).waitFor();
      await page.getByRole('heading', { name: FIELD_GUIDE_TITLE, exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('[data-field-guide-result="ready"]').count(), state === 'ready' ? 1 : 0);
      if (state !== 'ready') {
        assert.equal(await page.locator('#field-unavailable a').getAttribute('href'), FIELD_GUIDE_PATH);
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= width, `Horizontal overflow: ${state}/${width}`);
      const screenshot = `qa/public-field-guide-story-${state}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      if (state === 'ready') {
        for (const summary of await page.locator('.field-guide summary').all()) {
          await summary.focus(); await summary.press('Enter');
          assert.notEqual(await summary.locator('..').getAttribute('open'), null);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      evidence.push({ state, width, scrollWidth, screenshot });
    }
    // Declared article sources share the public article shell; same built renderer as lib/public-site.mjs.
    for (const state of ['listed', 'empty', 'invalid']) {
      await page.goto(`${base}/iframe.html?id=public-article-sources--${state}&viewMode=story`);
      const section = page.locator(`[data-sources-state="${state}"]`);
      await section.waitFor();
      await page.getByRole('heading', { name: 'Источники', exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const links = await section.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.equal(links.length, { listed: 3, empty: 0, invalid: 1 }[state], `${state}: only valid references are links`);
      for (const href of links) assert.match(href, /^https:\/\/(github\.com\/netbka\/elma_wiki\/blob\/main\/|(?:www\.)?elma365\.com\/)/);
      assert.equal(await section.locator('.badge').count(), 1, 'the only badge is the article status');
      assert.equal(await section.locator('.source-invalid').count(), state === 'invalid' ? 3 : 0);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= width, `Horizontal overflow: sources/${state}/${width}`);
      const screenshot = `qa/public-article-sources-story-${state}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      evidence.push({ state: 'sources-' + state, width, scrollWidth, screenshot });
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
  await writeFile('qa/public-field-guide-visual-evidence.json', JSON.stringify({
    commit: process.env.GITHUB_SHA || null, browser: browser.version(),
    scope: 'Built synthetic Storybook states; not live ELMA or accessibility conformance',
    evidence
  }, null, 2) + '\n');
  console.log('Public field guide and article sources: all 6 built Storybook states passed at 1440/390; screenshots saved.');
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

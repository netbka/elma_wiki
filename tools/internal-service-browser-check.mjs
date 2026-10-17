import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-internal-browser-'));
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir('qa', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    assert.equal(await page.locator('main a').count(), 1);
    assert.equal(await page.locator('main a').getAttribute('href'), '/login');
    assert.equal(await page.locator('#developers').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `qa/internal-home-${width}.png`, fullPage: true });
  }
  for (const route of ['/guide', '/guide.html', '/flows', '/flows.html']) {
    await page.goto(base + route);
    assert.equal(page.url(), base + '/login');
    await page.getByRole('heading', { name: 'Вход в E365 Wiki', exact: true }).waitFor();
  }
  assert.equal((await page.request.get(base + '/p/showcase/data.json')).status(), 404);
  assert.equal((await page.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.goto(base); assert.equal(page.url(), base + '/solutions');
  for (const route of ['/guide', '/flows', '/p/showcase/']) {
    assert.equal((await page.goto(base + route)).status(), 200);
    await page.locator('main').waitFor();
  }
  assert.deepEqual(errors, []);
  console.log('Internal entry: login-only home, anonymous refusals, authenticated guides/flows/showcase, 390px reflow passed.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('wiki-internal-browser-'));
  await fs.rm(directory, { recursive: true, force: true });
}

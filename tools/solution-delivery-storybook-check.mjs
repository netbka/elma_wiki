import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve('storybook/storybook-static');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    const bytes = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const modes = ['unavailable', 'ready', 'connection-unavailable', 'prepared', 'deploying', 'unverified', 'verified', 'mismatch', 'verification-error', 'unknown', 'failed', 'blocked', 'cancelled', 'stale', 'load-error', 'lost-response', 'journey'];
  const panel = () => page.getByRole('region', { name: 'Доставка и проверка результата', exact: true });
  const button = name => panel().getByRole('button', { name, exact: true });
  const open = async mode => {
    await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=solution-handoff--delivery-${mode}&viewMode=story`);
    await panel().getByRole('heading', { name: 'Доставка и проверка результата', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.release-delivery')?.textContent.includes('Загружаем состояние доставки'));
  };
  for (const mode of modes) {
    await open(mode);
    assert.equal(await page.locator('.managed-shell').count(), 1);
    if (['deploying', 'unknown'].includes(mode)) {
      assert.equal(await button('Подтвердить учебную операцию').count(), 0);
      assert.equal(await button('Подготовить учебную доставку').isDisabled(), true);
    }
    if (mode === 'stale') {
      assert.match(await page.locator('.release-checks').textContent(), /Учебный стенд.*Устарело/);
      assert.equal(await button('Прочитать и проверить результат').count(), 0);
    }
    if (mode === 'connection-unavailable') assert.equal(await button('Подготовить учебную доставку').isDisabled(), true);
    if (mode === 'verified') assert.match(await page.locator('.release-checks').textContent(), /Учебный стенд.*Пройдено/);
    if (mode === 'verification-error') assert.match(await panel().textContent(), /Не удалось подтвердить read-back/);
    if (mode === 'load-error') assert.equal(await button('Повторить загрузку доставки').isEnabled(), true);
  }
  await open('journey');
  await page.getByLabel('Примечания для оператора', { exact: true }).fill('Учебный черновик');
  await panel().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption('synthetic-target');
  await button('Подготовить учебную доставку').click();
  await panel().getByLabel('Подтверждение учебной операции', { exact: true }).fill('DEPLOY synthetic_solution aaaaaaaaaaaa');
  await button('Подтвердить учебную операцию').focus(); await page.keyboard.press('Enter');
  await button('Прочитать и проверить результат').click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Проверено чтением результата', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Примечания для оператора', { exact: true }).inputValue(), 'Учебный черновик');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await fs.mkdir('qa', { recursive: true }); await page.screenshot({ path: 'qa/solution-delivery-storybook-journey.png', fullPage: true });
  await open('lost-response');
  await panel().getByLabel('Подтверждение учебной операции', { exact: true }).fill('DEPLOY synthetic_solution aaaaaaaaaaaa');
  await button('Подтвердить учебную операцию').click();
  await page.getByRole('alert').filter({ hasText: /Ответ не получен/ }).waitFor();
  assert.equal(await button('Подтвердить учебную операцию').isDisabled(), true);
  await button('Обновить состояние доставки').click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Подготовлена', exact: true }).waitFor();
  assert.equal(await button('Подтвердить учебную операцию').isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('Solution delivery Storybook: 17 contextual states, interactive prepare/typed-confirm/read-back, lost-response refresh, drafts/keyboard/narrow/zoom passed (synthetic).');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

// MR-08 delivery states in the production release renderer (storybook/stories/Delivery.stories.js, static build):
// read-back reconciliation, promotion with drift refusal, retry and forward recovery, PROD only refused. Synthetic only.
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
  const panel = () => page.getByRole('region', { name: 'Доставка и проверка результата', exact: true });
  const promotion = () => panel().getByRole('region', { name: 'Продвижение проверенного кандидата', exact: true });
  const button = name => panel().getByRole('button', { name, exact: true });
  const open = async story => {
    await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=delivery--${story}&viewMode=story`);
    await panel().getByRole('heading', { name: 'Доставка и проверка результата', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.release-delivery')?.textContent.includes('Загружаем состояние доставки'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('sb-show-errordisplay')), false, story);
  };
  const prodRefused = async () => {
    await promotion().getByText(/PROD: продвижение из интерфейса невозможно/).waitFor();
    assert.equal(await promotion().locator('option[value="synthetic-prod"]').isDisabled(), true);
  };

  await open('applied');
  await panel().getByText('Сверка read-back: изменения применены, Target совпал с кандидатом.', { exact: true }).waitFor();
  await prodRefused();
  assert.equal(await button('Подготовить продвижение на Target назначения').isDisabled(), true);
  await promotion().getByLabel('Target назначения для продвижения', { exact: true }).selectOption('synthetic-connection-2');
  assert.equal(await button('Подготовить продвижение на Target назначения').isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fs.mkdir('qa', { recursive: true }); await page.screenshot({ path: 'qa/delivery-storybook-applied.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // The story's play selects TEST 2 and promotes; the coordinator fixture refuses the drifted destination.
  await open('promotion-drift');
  await page.getByRole('alert').filter({ hasText: /\(drift\)\. Продвижение заблокировано/ }).waitFor();
  await panel().getByRole('heading', { name: 'Последняя попытка: Проверено чтением результата', exact: true }).waitFor();

  await open('prod-refused');
  await prodRefused();
  await promotion().getByText(/Нет другого проверенного Target с той же версией платформы/).waitFor();
  assert.equal(await button('Подготовить продвижение на Target назначения').isDisabled(), true);

  await open('promoted');
  await panel().getByText(/Продвижение кандидата, проверенного на Target «Учебный TEST» \(test\.example\.invalid\)/).waitFor();
  await panel().getByLabel('Подтверждение учебной операции', { exact: true }).waitFor();
  assert.equal(await promotion().count(), 1, 'PROD stays visible as refused while the promotion is prepared');

  await open('not-applied');
  await panel().getByText('Сверка read-back: изменения не применены, Target в прежнем состоянии.', { exact: true }).waitFor();
  assert.equal(await button('Подготовить повтор после сверки').isEnabled(), true);
  assert.equal(await button('Подготовить восстановление повторным импортом').count(), 0);

  await open('partial-install');
  await panel().getByText(/Сверка read-back: частичная установка/).waitFor();
  await panel().getByText(/восстановление из интерфейса недоступно/).waitFor();
  assert.equal(await button('Подготовить восстановление повторным импортом').count(), 0);
  assert.equal(await button('Подготовить повтор после сверки').count(), 0);
  assert.equal(await button('Подготовить учебную доставку').isDisabled(), true);

  await open('forward-recovery');
  assert.equal(await button('Подготовить восстановление повторным импортом').isEnabled(), true);
  assert.equal(await button('Подготовить повтор после сверки').count(), 0);

  // Unreconciled outcomes read back first; no retry, recovery or promotion.
  for (const story of ['partial-outcome', 'failed', 'unknown', 'stale-unresolved']) {
    await open(story);
    for (const name of ['Подготовить повтор после сверки', 'Подготовить восстановление повторным импортом', 'Подготовить продвижение на Target назначения']) assert.equal(await button(name).count(), 0, story + ': ' + name);
  }
  assert.deepEqual(errors, []);
  console.log('Delivery Storybook MR-08: applied, not-applied, diverged (refused and forward recovery), partial, promotion drift, promoted lineage, PROD refused and narrow layout passed (synthetic).');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

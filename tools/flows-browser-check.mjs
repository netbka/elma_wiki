import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';
const base = process.env.STORYBOOK_URL || 'http://127.0.0.1:6006';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
let wiki, directory;
try {
  const index = await (await fetch(base + '/index.json')).json();
  for (const entry of Object.values(index.entries).filter(entry => entry.type === 'story')) {
    await page.goto(`${base}/iframe.html?id=${entry.id}&viewMode=story`);
    if (entry.id.startsWith('release--')) { await page.locator('.release-shell h1').waitFor(); continue; }
    await page.locator('.flow-stage h2').waitFor();
    await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  }
  await page.goto(base + '/iframe.html?id=elma--approval&viewMode=story');
  for (const action of ['submit', 'approve', 'change', 'resubmit']) await page.locator(`[data-action="${action}"]`).click();
  assert.equal(await page.locator('.flow-stage h2').evaluate(node => node === document.activeElement), true, 'Workflow transitions retain keyboard focus on the new step');
  assert.match(await page.locator('.flow-stage').textContent(), /Версия документа: 2. Согласована версия: нет/);
  for (const action of ['approve', 'skip']) await page.locator(`[data-action="${action}"]`).click();
  assert.match(await page.locator('.flow-stage h2').textContent(), /Остальные участники/);
  await page.goto(base + '/iframe.html?id=elma--correspondence&viewMode=story');
  await page.locator('[data-action="enable"]').click();
  assert.match(await page.locator('.flow-stage').textContent(), /Поле входящего: Проверка обращения/);
  await page.locator('[data-action="unlink"]').click(); assert.match(await page.locator('.flow-stage').textContent(), /Поле входящего: пусто/);
  await page.goto(base + '/iframe.html?id=review--journey&viewMode=story');
  await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  const author = `Browser check ${Date.now()}`;
  await page.getByLabel('Ваше имя', { exact: true }).fill(author);
  await page.getByLabel('Цель, наблюдение, ожидаемый результат и причина').fill('<script>globalThis.reviewXss=true</script> Неясен результат учебной ветки');
  await page.getByRole('button', { name: 'Отклонить с причиной', exact: true }).click();
  const finding = page.locator('.review-findings article').filter({ hasText: author });
  await finding.waitFor(); assert.equal(await page.getByRole('button', { name: 'Принять сценарий', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.reviewXss), undefined);
  await page.reload(); await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  await page.getByLabel('Ваше имя', { exact: true }).fill(author);
  await page.getByLabel('Цель, наблюдение, ожидаемый результат и причина').fill('Добавлено объяснение результата');
  await page.locator('.review-findings article').filter({ hasText: author }).getByRole('button', { name: 'Ответить', exact: true }).click();
  await page.locator('.review-findings article').filter({ hasText: author }).locator('.review-reply').waitFor();
  await page.getByLabel('Цель, наблюдение, ожидаемый результат и причина').fill('Синтетическая проверка завершена; комментарий закрыт');
  await page.locator('.review-findings article').filter({ hasText: author }).getByRole('button', { name: 'Закрыть с объяснением', exact: true }).click();
  await page.locator('.review-findings article').filter({ hasText: author }).getByText(/Решение: Синтетическая/).waitFor();
  // Do not approve a real team's scenario as a side effect of a browser check.
  // Updating comments must never attach a new revision to old displayed markup.
  await page.route('**/__elma/reviews?flowId=feature-review', async route => {
    const response = await route.fetch(); const summary = await response.json();
    await route.fulfill({ response, json: { ...summary, revision: 'synthetic-new-revision' } });
  });
  await page.getByRole('button', { name: 'Обновить рецензии', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Версия сценария изменилась/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Оставить комментарий', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Перезагрузить сценарий', exact: true }).isDisabled(), false);
  await page.unroute('**/__elma/reviews?flowId=feature-review');
  await page.reload(); await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  await fs.mkdir('qa', { recursive: true }); await page.screenshot({ path: 'qa/workflow-review-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base + '/iframe.html?id=system--whole-system&viewMode=story');
  await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  await page.locator('[data-flow="investigation"]').click();
  await page.locator('[data-action="observe"]').click();
  const retainedStep = await page.locator('.flow-stage h2').textContent();
  await page.getByLabel('Цель, наблюдение, ожидаемый результат и причина').fill('Несохранённый вопрос исследования');
  await page.locator('[data-flow="upload"]').click();
  await page.locator('[data-flow="investigation"]').click();
  assert.equal(await page.locator('.flow-stage h2').textContent(), retainedStep);
  assert.equal(await page.getByLabel('Цель, наблюдение, ожидаемый результат и причина').inputValue(), 'Несохранённый вопрос исследования');
  await page.locator('.flow-stage h2').waitFor(); await page.screenshot({ path: 'qa/workflow-system-desktop.png', fullPage: true });
  await page.route('**/__elma/reviews?flowId=upload', route => route.fulfill({ status: 503, json: { error: 'Синтетическая недоступность хранилища' } }));
  await page.goto(base + '/iframe.html?id=system--upload&viewMode=story');
  await page.getByRole('alert').filter({ hasText: /Синтетическая недоступность/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Оставить комментарий', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Обновить рецензии', exact: true }).isDisabled(), false);
  await page.unroute('**/__elma/reviews?flowId=upload');
  await page.getByRole('button', { name: 'Обновить рецензии', exact: true }).click();
  await page.locator('.review-status').filter({ hasText: /версия/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Оставить комментарий', exact: true }).isDisabled(), false);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-flow-browser-'));
  wiki = createServer({ directory, allowLocal: true, sendEmail: undefined });
  await new Promise(resolve => wiki.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${wiki.address().port}/flows`);
  await page.getByRole('heading', { name: 'Как работает система', exact: true }).waitFor();
  await page.locator('[data-flow="investigation"]').click();
  await page.locator('[data-action="observe"]').click();
  await page.locator('[data-action="unknown"]').click();
  assert.match(await page.locator('.flow-stage h2').textContent(), /Открытый вопрос/);
  assert.equal(await page.locator('.review-form').count(), 0, 'Production map never exposes local review writes');
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(`Storybook browser: ${Object.keys(index.entries).length} stories, business transitions, durable rejection/reply/resolution, XSS text, mobile and keyboard passed.`);
} finally {
  await browser.close();
  if (wiki) await new Promise(resolve => wiki.close(resolve));
  if (directory) { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('elma-flow-browser-')); await fs.rm(directory, { recursive: true, force: true }); }
}

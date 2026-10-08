import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bug-report-browser-'));
let calls = 0, recoverCalls = 0, lastPublished;
const github = { repository: 'example/synthetic', upload: async () => 'https://github.com/user-attachments/assets/' + crypto.randomUUID(), publish: async report => {
  calls++; lastPublished = report;
  return { number: 85, url: 'https://github.com/example/synthetic/issues/85' };
}, recover: async () => { recoverCalls++; return null; } };
const wiki = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined, requests: null, bugPublisher: github });
await new Promise(resolve => wiki.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + wiki.address().port;
let browser;
const evidence = { synthetic: true, nativeCapturePickerObserved: false, realGitHubObserved: false, checks: [] };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__captureMode = 'cancel'; window.__stopped = false;
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (window.__captureMode === 'cancel') throw new DOMException('synthetic cancellation', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef2ff'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#172033'; ctx.font = '40px sans-serif'; ctx.fillText('Synthetic captured window', 50, 100);
      const stream = canvas.captureStream(30);
      for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.__stopped = true; stop(); }; }
      return stream;
    };
  });
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.goto(base + '/solutions');
  await page.getByRole('button', { name: 'Сообщить об ошибке', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Кратко об ошибке').fill('Synthetic viewport bug');
  await page.getByLabel('Что произошло и что ожидалось').fill('<img src=x onerror=alert(1)> Synthetic page has overlapping text.');
  await page.getByRole('button', { name: /Снимок окна/ }).click();
  await page.getByRole('status').filter({ hasText: 'Снимок отменён' }).waitFor();
  assert.equal(await page.getByLabel('Кратко об ошибке').inputValue(), 'Synthetic viewport bug');
  await page.evaluate(() => window.__captureMode = 'success');
  await page.getByRole('button', { name: /Снимок окна/ }).click();
  await page.getByRole('img').waitFor();
  assert.deepEqual(await page.getByRole('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [1280, 720]);
  assert.equal(await page.evaluate(() => window.__stopped), true);
  const original = await page.getByRole('img').getAttribute('src');
  await page.getByRole('button', { name: /^Карандаш:/ }).click();
  const canvas = page.getByLabel('Снимок для отметок'); await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 80, { steps: 10 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Сохранить отметки' }).click();
  await page.getByRole('button', { name: /^Карандаш: annotated/ }).waitFor();
  const annotated = await page.getByRole('img').getAttribute('src'); assert.notEqual(crypto.createHash('sha256').update(annotated).digest('hex'), crypto.createHash('sha256').update(original).digest('hex'));
  const png = Buffer.from(annotated.split(',')[1], 'base64');
  const upload = page.locator('input[type=file]');
  await upload.setInputFiles(Array.from({ length: 4 }, (_, i) => ({ name: `synthetic-${i}.png`, mimeType: 'image/png', buffer: png })));
  await page.getByRole('heading', { name: 'Вложения · 5/5' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Снимок окна/ }).isDisabled(), true);
  assert.equal(await upload.isDisabled(), true);
  // An oversize selection is rejected as a whole and leaves the existing attachments.
  await page.getByRole('button', { name: 'Удалить: synthetic-0.png', exact: true }).click();
  await upload.setInputFiles([{ name: 'six-a.png', mimeType: 'image/png', buffer: png }, { name: 'six-b.png', mimeType: 'image/png', buffer: png }]);
  await page.getByRole('status').filter({ hasText: 'не более пяти' }).waitFor();
  await page.getByRole('heading', { name: 'Вложения · 4/5' }).waitFor();
  await upload.setInputFiles({ name: 'last.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('heading', { name: 'Вложения · 5/5' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth));
  await fs.mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/bug-reports-attachments-narrow.png' });
  await page.getByLabel(/Опубликовать заголовок/).check();
  let lost = false;
  await page.route('**/api/bug-reports', async route => {
    if (!lost && route.request().method() === 'POST') { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: 'Отправить отчёт', exact: true }).click();
  await page.getByRole('button', { name: 'Повторить сохранение' }).waitFor();
  assert.equal(await page.getByLabel('Кратко об ошибке').isDisabled(), true);
  await page.getByRole('button', { name: 'Повторить сохранение' }).click();
  await page.getByRole('heading', { name: 'Отчёт отправлен в GitHub' }).waitFor();
  assert.equal(calls, 1); assert.equal(lastPublished.attachments.length, 5); assert.equal(lastPublished.actor.id, 'local');
  const screenshot = lastPublished.attachments.find(item => item.name === 'annotated-screenshot.png');
  assert.equal(screenshot.sha256, crypto.createHash('sha256').update(Buffer.from(annotated.split(',')[1], 'base64')).digest('hex'));
  const download = await context.request.get(base + `/api/bug-reports/${lastPublished.id}/attachments/${screenshot.id}`);
  assert.deepEqual(await download.body(), Buffer.from(annotated.split(',')[1], 'base64'));
  await page.getByRole('link', { name: 'Отчёт и вложения в Wiki' }).click();
  await page.getByRole('heading', { name: 'Synthetic viewport bug' }).waitFor();
  assert.equal(await page.locator('img').count(), 0, 'report description is inert text');
  assert.equal(await page.getByRole('link', { name: 'annotated-screenshot.png' }).count(), 1);
  evidence.checks.push('authenticated-side-button-and-keyboard', 'capture-cancel-retains-draft', 'full-resolution-frame-and-stopped-tracks', 'pencil-saves-exact-attachment', 'five-file-limit-and-remove', 'lost-response-retry-without-duplicate', 'private-download-and-inert-report', '390px-reflow');
  // Real DOM from the production renderer, with synthetic fixture ViewModels.
  for (const mode of ['ready', 'attachments', 'limit', 'capture-error', 'published', 'unknown', 'failed', 'unconfigured', 'reject', 'rejected', 'blocked', 'attachment-failed']) {
    await page.evaluate(async mode => {
      document.querySelector('.bug-reporter')?.remove();
      const { mountBugReporter } = await import('/feedback/render.js'), { bugFixture } = await import('/feedback/fixtures.js');
      document.body.append(mountBugReporter(bugFixture(mode), { context: () => ({ route: '/solutions', viewport: { width: 1280, height: 720, devicePixelRatio: 1 }, ...bugFixture(mode).context }), retry: async id => ({ id, status: 'unknown' }) }));
    }, mode);
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(80);
    assert.ok(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth), mode);
    if (mode === 'reject') {
      assert.equal(await page.getByLabel('Тип отчёта').inputValue(), 'reject');
      assert.ok(await page.getByText(/Принятие заблокировано/).isVisible());
    }
    if (mode === 'rejected') assert.ok(await page.getByRole('link', { name: 'Открыть изменение с замечанием' }).isVisible());
    if (mode === 'unknown') { await page.getByRole('button', { name: 'Проверить результат' }).click(); assert.equal(calls, 1); }
  }
  assert.deepEqual(errors, []);
  evidence.checks.push('twelve-shared-renderer-states');
  await fs.writeFile('qa/bug-reports-browser-evidence.json', JSON.stringify(evidence, null, 2));
  console.log('Bug reporting browser: side icon, capture contract, pencil, five attachments, private download, deduplication, keyboard and narrow states passed. Native picker and live GitHub were not exercised.');
} finally {
  await browser?.close(); wiki.closeAllConnections(); await new Promise(resolve => wiki.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';
import { solutionStore, SOLUTION_CATALOG } from '../lib/solutions.mjs';
import { readArchive } from '../lib/e365.mjs';
import { zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-handoff-browser-'));
const store = solutionStore(directory), actor = { id: 'local', login: 'local', provider: 'local' };
const bytes = await zip([['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'synthetic', kind: 'WIDGET', path: 'form.json' }] }],
  ['widgets/form.json', { descriptor: { clientScripts: 'const title = "synthetic";' } }]]);
const upload = await store.uploads.create(SOLUTION_CATALOG, bytes, 'full.e365', actor);
const state = await store.managed.create(SOLUTION_CATALOG, { name: 'Учебное согласование', baselineOwner: 'Vendor',
  snapshot: { projectId: upload.id, snapshotId: upload.currentSnapshotId, scope: 'full', scopeConfirmed: true } }, actor);
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.goto(base + '/solutions?id=' + state.id);
  await page.getByRole('link', { name: 'Передача', exact: true }).click();
  await page.getByLabel('Название передачи', { exact: true }).fill('Проверка принятого экспорта');
  await page.getByLabel('Деловая цель', { exact: true }).fill('Передать точный полный пакет оператору');
  await page.getByLabel('Кому или для чего передать пакет', { exact: true }).fill('Учебный оператор');
  await page.getByRole('button', { name: 'Начать проверку состава', exact: true }).click();
  await page.getByRole('heading', { name: 'Проверка принятого экспорта', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Подготовить неизменяемый кандидат', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: 'Исходный проект', exact: true }).count(), 0);
  assert.equal(await page.locator('.release-delivery').count(), 1);
  await page.getByLabel('Ограничения: неполное покрытие, отсутствие базы, неизвестное влияние', { exact: true }).fill('Нет предыдущего пакета; ELMA и доставка не проверены.');
  await page.getByRole('button', { name: 'Сохранить условия (снимает принятие кандидата)', exact: true }).click();
  // The save redraws the page; typing a reason before it lands can lose the text and leave the required field empty.
  await page.getByText(/ · Условия передачи изменены · /).waitFor({ state: 'attached' });
  for (const filename of ['package.json', 'widgets/manifest.json', 'widgets/form.json']) {
    await page.getByLabel('Причина решения — ' + filename, { exact: true }).fill('Точный состав рассмотрен');
    const card = page.locator('.release-change').filter({ has: page.getByLabel('Причина решения — ' + filename, { exact: true }) });
    await card.getByRole('button', { name: 'Принять изменение', exact: true }).click();
    await card.getByText('Принято: Точный состав рассмотрен', { exact: true }).waitFor();
  }
  const staleUrl = page.url(), older = await context.newPage(); await older.goto(staleUrl);
  await older.getByRole('heading', { name: 'Проверка принятого экспорта', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Подготовить неизменяемый кандидат', exact: true }).click();
  await page.getByLabel('Объяснение принятия кандидата', { exact: true }).fill('Только локальная передача');
  const mutations = '**/api/solutions/*/handoffs/*';
  await page.route(mutations, async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'approve') { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Принять кандидат для передачи', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Ответ не получен/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Скачать приватный пакет передачи', exact: true }).isDisabled(), true);
  await page.unroute(mutations);
  await page.getByRole('button', { name: 'Обновить передачу (запишите черновик перед обновлением)', exact: true }).click();
  await page.getByText('Принял Локальный пользователь: Только локальная передача', { exact: true }).waitFor();
  await older.getByLabel('Примечания для оператора', { exact: true }).fill('Черновик старой вкладки');
  await older.getByRole('button', { name: 'Сохранить условия (снимает принятие кандидата)', exact: true }).click();
  await older.getByRole('alert').filter({ hasText: /другой вкладке/ }).waitFor();
  assert.equal(await older.getByLabel('Примечания для оператора', { exact: true }).inputValue(), 'Черновик старой вкладки');
  await older.close();
  await fs.mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/solution-handoff-prepared-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px reflow');
  await page.screenshot({ path: 'qa/solution-handoff-prepared-narrow.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '200% zoom reflow');
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать приватный пакет передачи', exact: true }).focus();
  await page.keyboard.press('Enter');
  const download = await pendingDownload, destination = path.join(directory, 'handoff.zip'); await download.saveAs(destination);
  assert.deepEqual((await readArchive(await fs.readFile(destination))).get('candidate.e365'), bytes);
  await page.getByRole('button', { name: 'Сохранённые передачи решения', exact: true }).waitFor();
  const current = await store.managed.get(state.id, SOLUTION_CATALOG);
  await store.managed.setArchived(state.id, SOLUTION_CATALOG, { archived: true, expectedRevision: current.revision }, actor);
  await page.reload();
  await page.getByText('Решение или его рассмотрение изменилось: подготовьте передачу актуальной принятой версии', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Скачать приватный пакет передачи', exact: true }).isDisabled(), true);
  await page.screenshot({ path: 'qa/solution-handoff-stale-narrow.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Solution handoff browser: exact package, actor, revision/lost-response recovery, archive invalidation, keyboard, narrow and zoom passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }

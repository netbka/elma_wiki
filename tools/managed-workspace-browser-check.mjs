import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-browser-'));
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
let browser, stories;
const evidence = { synthetic: true, viewports: [], states: [], lifecycle: false, keyboard: false, stale: false, recovery: false };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir('qa', { recursive: true });
  const auth = await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } }); assert.equal(auth.status(), 200);
  await page.goto(base + '/workspaces');
  await page.getByRole('heading', { name: 'Пока нет активных пространств' }).waitFor();
  await page.getByRole('link', { name: 'Создать из полного снимка' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Создать рабочее пространство', exact: true }).waitFor();
  await page.getByLabel('Название пространства', { exact: true }).fill('Учебные договоры');
  await page.getByLabel('Ответственный за базу', { exact: true }).fill('Поставщик');
  const baseBytes = await archive([['contract', 'base'], ['untouched', 'base']]);
  const upload = async (bytes, full = false) => {
    await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'synthetic.e365', mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByLabel(full ? 'Подтверждаю: это полный снимок решения' : 'Подтверждаю: это частичный пакет изменений', { exact: true }).check();
  };
  await upload(baseBytes, true);
  await page.getByRole('button', { name: 'Создать пространство', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  const workspaceUrl = page.url(), id = new URL(workspaceUrl).searchParams.get('id'); assert.ok(id);
  const prepareChange = async bytes => {
    await page.goto(workspaceUrl); await page.getByRole('link', { name: 'Загрузить изменение', exact: true }).click();
    await page.getByLabel('Команда изменения', { exact: true }).fill('Внутренняя команда');
    await page.getByLabel('Задача или ссылка на задачу', { exact: true }).fill('SYNTHETIC-1');
    await upload(bytes);
    await page.getByLabel('Подтверждаю: снимок относится к тому же источнику и решению, что и пространство', { exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить и сравнить', exact: true }).click();
    await page.getByRole('heading', { name: 'Рассмотреть частичное изменение', exact: true }).waitFor();
  };
  await prepareChange(await archive([['contract', 'ours'], ['added', 'ours']]));
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true);
  await page.getByLabel('Проверено изменение объекта исходной базы', { exact: true }).focus(); await page.keyboard.press('Space');
  await page.getByLabel('Подтверждаю принятие рассмотренного изменения', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять изменение', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Рабочее состояние · 3 объектов', exact: true }).waitFor(); evidence.keyboard = true;
  await page.getByRole('link', { name: 'Обновить полный снимок', exact: true }).click();
  await upload(await archive([['contract', 'vendor'], ['untouched', 'base'], ['added', 'ours']]), true);
  await page.getByLabel('Подтверждаю: снимок относится к тому же источнику и решению, что и пространство', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить и сравнить', exact: true }).click();
  await page.getByRole('heading', { name: 'Рассмотреть новый полный снимок', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять новую базу', exact: true }).isDisabled(), true);
  await page.screenshot({ path: 'qa/managed-conflict-desktop.png', fullPage: true });
  await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
  await page.getByLabel('Подтверждаю новую базу и выбранные решения; это не установка в ELMA', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять новую базу', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  let state = await (await context.request.get(`${base}/api/managed-workspaces/${id}`)).json();
  assert.equal(state.reconciliations.length, 1); assert.equal(state.current.find(row => row.code === 'untouched').team, 'Поставщик');
  assert.equal(state.current.find(row => row.code === 'contract').team, 'Внутренняя команда');
  assert.equal(state.current.find(row => row.code === 'added').team, 'Поставщик');
  for (const size of [{ width: 1920, height: 1080 }, { width: 800, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow at ' + size.width);
    await page.screenshot({ path: `qa/managed-overview-${size.width}.png`, fullPage: true }); evidence.viewports.push(size);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Убрать из активных; сохранить снимки, изменения и историю', { exact: true }).check();
  await page.getByRole('button', { name: 'В архив', exact: true }).click();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Активные', exact: true }).click();
  await page.getByRole('heading', { name: 'Пока нет активных пространств' }).waitFor();
  await page.getByRole('link', { name: 'Архив', exact: true }).click(); await page.getByRole('link', { name: 'Открыть архив', exact: true }).click();
  await page.getByLabel('Возобновить работу с сохранённой базой и историей', { exact: true }).check();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).click();
  await page.getByRole('link', { name: 'Загрузить изменение', exact: true }).waitFor(); evidence.lifecycle = true;
  await prepareChange(await archive([['second', 'pending']]));
  const staleUrl = page.url(), originalState = await (await context.request.get(`${base}/api/managed-workspaces/${id}`)).json();
  await context.request.post(`${base}/api/managed-workspaces/${id}/archive`, { headers: { 'X-Elma-Wiki-Request': '1' }, data: { archived: true, expectedRevision: originalState.revision } });
  await page.getByLabel('Подтверждаю принятие рассмотренного изменения', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true); evidence.stale = true;
  await page.goto(staleUrl); await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  await page.route('**/api/managed-workspaces', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Учебный сбой загрузки' }) }));
  await page.goto(base + '/workspaces'); await page.getByRole('link', { name: 'Повторить загрузку', exact: true }).waitFor();
  await page.unroute('**/api/managed-workspaces'); await page.getByRole('link', { name: 'Повторить загрузку', exact: true }).click();
  await page.getByRole('heading', { name: 'Пока нет активных пространств' }).waitFor(); evidence.recovery = true;

  const storyRoot = path.resolve('storybook/storybook-static'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  stories = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname, file = path.resolve(storyRoot, '.' + pathname);
      if (!file.startsWith(storyRoot + path.sep)) { res.writeHead(404); res.end(); return; }
      const bytes = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => stories.listen(0, '127.0.0.1', resolve));
  for (const mode of ['empty','list','create','overview','pending','change','review','conflict','overlap','ambiguous','stale','archived','loading','load-error']) {
    await page.goto(`http://127.0.0.1:${stories.address().port}/iframe.html?id=managed-workspace--${mode}&viewMode=story`);
    await page.locator('.managed-shell h1').waitFor();
    if (['review','conflict','overlap','ambiguous'].includes(mode)) assert.equal(await page.locator('button[type=submit]').isDisabled(), true, mode);
    if (mode === 'conflict') { await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working'); assert.equal(await page.getByRole('button', { name: 'Принять новую базу', exact: true }).isDisabled(), false); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode);
    await page.screenshot({ path: `qa/managed-story-${mode}.png`, fullPage: true }); evidence.states.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log('Managed workspace: synthetic browser lifecycle, boundary/conflict decisions, archive/reopen, keyboard, responsive, stale/retry and all 14 shared Storybook states passed.');
} finally {
  await fs.mkdir('qa', { recursive: true }); await fs.writeFile('qa/managed-browser-evidence.json', JSON.stringify(evidence, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  if (stories) await new Promise(resolve => stories.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

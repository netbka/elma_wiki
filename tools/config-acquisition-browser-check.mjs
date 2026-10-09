import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { fixture, zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'config-browser-'));
const native = await fixture({ code: 'synthetic_solution', target: 'external' }), hash = crypto.createHash('sha256').update(native).digest('hex');
const bytes = await zip([['config-bundle.json', { format: 'elma-config-bundle', schemaVersion: 1, deployable: false,
  dependencyEvidence: { schemaVersion: 1, catalog: [{ code: 'provider', paid: true, version: '1.0', namespaces: ['example_module'], observedAt: '2026-10-09T00:00:00Z' }] },
  solutions: [{ code: 'synthetic_solution', status: 'exported', path: 'solutions/synthetic_solution.e365', sha256: hash, bytes: native.length }, { code: 'paid', status: 'excluded-paid' }] }],
  ['solutions/synthetic_solution.e365', native]]);
let sourceServer, poll = 0;
const configSource = { catalog: async server => ({ solutions: [{ code: 'synthetic_solution', name: 'Учебное решение' }, { code: 'paid', paid: true }] }),
  start: async input => { sourceServer = input.server; return { id: crypto.randomUUID() }; },
  status: async () => ++poll < 2 ? { state: 'running', progress: { completed: 0, total: 1 } } : { state: 'ready', result: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } },
  artifact: async () => bytes };
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined, configSource });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  await page.goto(base + '/solutions?view=create');
  await page.getByText('Загрузить из ELMA / выбрать решение из конфигурации', { exact: true }).click();
  await page.getByLabel('Источник ELMA', { exact: true }).selectOption('dev2');
  await page.getByRole('button', { name: 'Показать решения сервера' }).click();
  await page.getByLabel('Что загрузить').selectOption('synthetic_solution');
  assert.equal(await page.getByLabel('Что загрузить').locator('option[value=paid]').isDisabled(), true);
  await page.getByRole('button', { name: 'Загрузить из ELMA', exact: true }).click();
  await page.waitForURL(/acquisition=/); const resume = page.url(); await page.reload();
  await page.getByRole('button', { name: 'Выбрать synthetic_solution' }).waitFor();
  assert.ok(await page.getByText(/Платная зависимость: исходник недоступен/).isVisible());
  assert.equal(sourceServer, 'dev2');
  await page.getByRole('button', { name: 'Выбрать synthetic_solution' }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Название решения', { exact: true }).fill('Учебная загрузка');
  await page.getByLabel('Кто отвечает за исходную версию', { exact: true }).fill('Учебная команда');
  await page.getByLabel('Это полный экспорт решения', { exact: true }).check();
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByRole('heading', { name: 'Учебная загрузка', exact: true }).waitFor();
  await page.getByText('Зависимости исходного файла 1', { exact: true }).click();
  assert.ok(await page.getByText(/Платная зависимость: исходник недоступен/).isVisible());
  const other = await fixture({ code: 'other_solution' });
  const multiple = await zip([['config-bundle.json', { format: 'elma-config-bundle', schemaVersion: 1, deployable: false,
    solutions: [['synthetic_solution', native], ['other_solution', other]].map(([code, bytes]) => ({ code, status: 'exported', path: 'solutions/' + code + '.e365',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })) }],
    ['solutions/synthetic_solution.e365', native], ['solutions/other_solution.e365', other]]);
  await page.goto(base + '/solutions?view=create');
  await page.getByLabel('Название решения', { exact: true }).fill('Прямая загрузка конфигурации');
  await page.getByLabel('Кто отвечает за исходную версию', { exact: true }).fill('Учебная команда');
  await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'configuration.e365', mimeType: 'application/octet-stream', buffer: multiple });
  await page.getByLabel('Это полный экспорт решения', { exact: true }).check();
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать other_solution' }).waitFor();
  await page.getByRole('button', { name: 'Выбрать other_solution' }).click();
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByRole('heading', { name: 'Прямая загрузка конфигурации', exact: true }).waitFor();
  await page.goto(base + '/solutions?view=create');
  await page.getByText('Загрузить из ELMA / выбрать решение из конфигурации', { exact: true }).click();
  await page.getByLabel('Архив конфигурации или файлы решений .e365').setInputFiles({ name: 'all.e365', mimeType: 'application/octet-stream', buffer: bytes });
  await page.getByRole('button', { name: 'Прочитать архив' }).click();
  await page.getByRole('button', { name: 'Выбрать synthetic_solution' }).waitFor();
  assert.ok(await page.getByText(/Недоступные решения: paid/).isVisible());
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Скачать исходную конфигурацию' }).click()]);
  const downloaded = await fs.readFile(await download[0].path()); assert.deepEqual(downloaded, bytes);
  await page.getByLabel('Архив конфигурации или файлы решений .e365').setInputFiles([
    { name: 'first.e365', mimeType: 'application/octet-stream', buffer: native }, { name: 'second.e365', mimeType: 'application/octet-stream', buffer: native }]);
  await page.getByRole('button', { name: 'Прочитать архив' }).click();
  await page.getByRole('link', { name: 'Открыть first.e365' }).waitFor();
  assert.ok(await page.getByRole('link', { name: 'Открыть second.e365' }).isVisible());
  await page.getByLabel('Архив конфигурации или файлы решений .e365').setInputFiles({ name: 'bad.e365', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
  await page.getByRole('button', { name: 'Прочитать архив' }).click();
  await page.locator('.config-acquisition [role=alert]').filter({ hasText: /ZIP|архив|Файл/i }).waitFor();
  await page.goto(base + '/solutions?view=create');
  await page.getByLabel('Название решения', { exact: true }).fill('Зашифрованный файл');
  await page.getByLabel('Кто отвечает за исходную версию', { exact: true }).fill('Учебная команда');
  const opaque = await zip([['package.json', { code: 'global', type: 'CONFIGURATION', paidPackage: true }], ['data', Buffer.from([0, 255])]]);
  await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'global.e365', mimeType: 'application/octet-stream', buffer: opaque });
  await page.getByLabel('Это полный экспорт решения', { exact: true }).check();
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByText(/global: конфигурация сохранена, но содержимое непрозрачно или зашифровано/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Выбрать global', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Зашифрованный файл', exact: true }).count(), 0);
  const opaqueDownload = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Скачать исходную конфигурацию' }).click()]);
  assert.deepEqual(await fs.readFile(await opaqueDownload[0].path()), opaque);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await fs.mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/config-acquisition-mobile.png', fullPage: true });
  const nativeComponents = await zip([['package.json',{code:'native_components',type:'SOLUTION'}],
    ['babysitter/manifest.json',{Service:'babysitter',entities:[]}],
    ['permissionsSettings/manifest.json',{entities:['permissionSettings','pagePermissions'].map(kind=>({code:'records',namespace:'synthetic',kind,path:kind+'.json',resources:null}))}],
    ['permissionsSettings/permissionSettings.json',{Code:'records',settings:{}}],['permissionsSettings/pagePermissions.json',{Code:'records',permissions:{}}],
    ['localizer/manifest.json',{entities:[{code:'',namespace:'synthetic',kind:'localization',path:'translations.json',resources:[{path:'ru.po'}]}]}],
    ['localizer/translations.json','null'],['localizer/ru.po','msgid "synthetic"\nmsgstr "пример"']]);
  await page.goto(base + '/solutions?view=create');
  await page.getByLabel('Название решения',{exact:true}).fill('Native components');
  await page.getByLabel('Кто отвечает за исходную версию',{exact:true}).fill('Synthetic owner');
  await page.getByLabel('Файл .e365',{exact:true}).setInputFiles({name:'native.e365',mimeType:'application/octet-stream',buffer:nativeComponents});
  await page.getByLabel('Это полный экспорт решения',{exact:true}).check();
  await page.getByRole('button',{name:'Добавить решение',exact:true}).click();
  await page.getByRole('heading',{name:'Native components',exact:true}).waitFor();
  await page.getByRole('link',{name:'Решение',exact:true}).click();
  for(const label of ['synthetic · records · permissionSettings','synthetic · records · pagePermissions','synthetic · localization']) await page.getByText(label,{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'qa/native-components-mobile.png',fullPage:true});
  assert.deepEqual(errors, []);
  await fs.writeFile('qa/config-acquisition-browser.json', JSON.stringify({ synthetic: true, source: 'dev2', resume: true, bundle: true, multipleFiles: true, failedUpload: true, paidDependencies: true, encryptedAcceptanceBlocked: true, encryptedOriginalPreserved: true, nativeComponentKinds: true, nativeLocalization: true, keyboard: true, reflow: [1440, 390] }));
  console.log('Synthetic browser passed: acquisition/reload, paid dependency persistence, encrypted acceptance blocked, exact downloads, failure, keyboard and reflow.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true });
}

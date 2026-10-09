import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { projectStore } from '../lib/projects.mjs';
import { zip } from '../test/fixture.mjs';
import { readArchive } from '../lib/e365.mjs';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-release-browser-'));
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
let browser;
try {
  const fixture = (required, extra = []) => zip([
    ['package.json', { code: 'synthetic_release', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
    ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }],
    ['note.txt', '<script>globalThis.releaseXss=true</script>'], ...extra
  ]);
  const projects = projectStore(directory), baseline = await projects.create('local', await fixture(false), 'previous.e365'), bytes = await fixture(true);
  const sourceRef = { connectionId: 'synthetic-dev', solutionRef: 'synthetic_release' };
  const source = await projects.createSource('local', bytes, sourceRef, 'new.e365');
  const newer = await projects.appendSource(source.id, 'local', await fixture(false), sourceRef, source.id);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const login = await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } });
  assert.equal(login.status(), 200, 'Explicitly enabled loopback fixture login must succeed');
  await page.goto(base + '/releases');
  await page.getByLabel('Название релиза', { exact: true }).fill('Рецензия учебного договора');
  await page.getByLabel('Деловая цель', { exact: true }).fill('Проверить обязательность заголовка');
  await page.getByLabel('Новый пакет DEV', { exact: true }).selectOption(source.id);
  const sourceSnapshot = page.getByLabel('Снимок — Новый пакет DEV', { exact: true });
  await sourceSnapshot.locator(`option[value="${source.id}"]`).waitFor({ state: 'attached' });
  await sourceSnapshot.selectOption(source.id);
  await page.route(`**/api/projects/${baseline.id}/snapshots`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Учебная ошибка загрузки' }) }));
  await page.getByLabel('Предыдущий пакет DEV — базовая версия', { exact: true }).selectOption(baseline.id);
  await page.getByText(/Снимки не получены: Учебная ошибка загрузки/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Начать рецензию', exact: true }).isDisabled(), true);
  await page.unroute(`**/api/projects/${baseline.id}/snapshots`);
  await page.getByRole('button', { name: 'Повторить загрузку снимков — Предыдущий пакет DEV — базовая версия', exact: true }).click();
  await page.getByLabel('Снимок — Предыдущий пакет DEV — базовая версия', { exact: true }).locator(`option[value="${baseline.id}"]`).waitFor({ state: 'attached' });
  const newest = await projects.appendSource(source.id, 'local', await fixture(false), sourceRef, newer.id);
  await page.getByLabel('Назначение передачи (непроверенная компания или ответственный)', { exact: true }).fill('Учебный оператор TEST');
  await page.getByRole('button', { name: 'Начать рецензию', exact: true }).click();
  await page.getByRole('heading', { name: 'Рецензия учебного договора', exact: true }).waitFor();
  assert.equal((await projects.get(source.id, 'local')).currentSnapshotId, newest.id);
  await page.getByText(new RegExp('Снимок: ' + source.id)).waitFor();
  // Without the synthetic adapter only the operator bridge is offered: no training stand, no token issued yet.
  const unavailableDelivery = page.getByRole('region', { name: 'Доставка и проверка результата', exact: true });
  await unavailableDelivery.getByText('Сначала завершите рецензию и примите неизменяемый кандидат.', { exact: true }).waitFor();
  await unavailableDelivery.getByRole('heading', { name: 'Мосты оператора: 0', exact: true }).waitFor();
  assert.equal(await unavailableDelivery.getByRole('button', { name: 'Добавить учебный стенд', exact: true }).count(), 0);
  assert.equal(await unavailableDelivery.getByRole('button', { name: 'Добавить подключение Target', exact: true }).isDisabled(), true);
  assert.equal(await unavailableDelivery.getByRole('button', { name: 'Подготовить доставку на Target', exact: true }).isDisabled(), true);
  // Bridge registration from the UI: the token is shown once, a Target connection can reference the bridge,
  // and without a running worker the probe is honest about it.
  await unavailableDelivery.getByLabel('Название моста', { exact: true }).fill('Оператор');
  await unavailableDelivery.getByRole('button', { name: 'Выдать токен моста', exact: true }).click();
  await unavailableDelivery.getByRole('heading', { name: 'Мосты оператора: 1', exact: true }).waitFor();
  assert.match(await unavailableDelivery.locator('.release-token code').textContent(), /^wb_[A-Za-z0-9_-]{20,}$/);
  await unavailableDelivery.getByLabel('Название подключения Target', { exact: true }).fill('TEST через мост');
  await unavailableDelivery.getByRole('button', { name: 'Добавить подключение Target', exact: true }).click();
  await unavailableDelivery.getByRole('heading', { name: 'TEST через мост', exact: true }).waitFor();
  assert.equal(await unavailableDelivery.locator('.release-token').count(), 0, 'the token is not shown again after the next action');
  await unavailableDelivery.getByRole('button', { name: 'Проверить подключение — TEST через мост', exact: true }).click();
  await unavailableDelivery.getByText(/TEST · bridge \(Оператор\) · Личность не проверена/).waitFor();
  await unavailableDelivery.getByLabel('Подключение Target для доставки', { exact: true }).selectOption({ label: 'TEST через мост — требуется проверка доступности' });
  await unavailableDelivery.getByText(/Target ещё не проверен/).waitFor();
  assert.equal(await unavailableDelivery.getByRole('button', { name: 'Подготовить доставку на Target', exact: true }).isDisabled(), true, 'no accepted candidate yet');
  await unavailableDelivery.getByRole('button', { name: 'Удалить мост — Оператор', exact: true }).click();
  await unavailableDelivery.getByRole('heading', { name: 'Мосты оператора: 0', exact: true }).waitFor();
  await unavailableDelivery.getByText(/TEST · bridge \(мост удалён\)/).waitFor();
  await unavailableDelivery.getByRole('button', { name: 'Удалить подключение — TEST через мост', exact: true }).click();
  await unavailableDelivery.getByRole('heading', { name: 'TEST через мост', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: 'Подготовить неизменяемый кандидат', exact: true }).isDisabled(), true);
  assert.match(await page.locator('.release-shell').textContent(), /Обязательность поля/);
  const staleTab = await page.context().newPage(); await staleTab.goto(page.url());
  await staleTab.getByRole('heading', { name: 'Рецензия учебного договора', exact: true }).waitFor();
  const card = page.locator('article').filter({ hasText: 'widgets/form.json' });
  await page.getByLabel('Примечания для оператора', { exact: true }).fill('Черновик примечания сохраняется при решении по файлу');
  await card.getByLabel('Причина решения — widgets/form.json', { exact: true }).fill('Проверено назначение обязательного поля');
  await card.getByRole('button', { name: 'Отклонить изменение', exact: true }).click();
  await page.getByText('Отклонено: Проверено назначение обязательного поля', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Примечания для оператора', { exact: true }).inputValue(), 'Черновик примечания сохраняется при решении по файлу');
  await page.reload(); await page.getByText('Отклонено: Проверено назначение обязательного поля', { exact: true }).waitFor();
  await staleTab.getByLabel('Причина решения — widgets/form.json', { exact: true }).fill('Черновик в старой вкладке');
  await staleTab.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await staleTab.getByRole('alert').filter({ hasText: /другой вкладке/ }).waitFor();
  assert.equal(await staleTab.getByLabel('Причина решения — widgets/form.json', { exact: true }).inputValue(), 'Черновик в старой вкладке');
  await staleTab.close();
  await card.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByText('Принято: Проверено назначение обязательного поля', { exact: true }).waitFor();
  await page.getByLabel('Ограничения: неполное покрытие, отсутствие базы, неизвестное влияние', { exact: true }).fill('note.txt сохранён; изменение обязательности проверено. Target не проверен.');
  await page.getByRole('button', { name: 'Сохранить условия (снимает принятие кандидата)', exact: true }).click();
  await page.getByRole('heading', { name: 'Блокирующие замечания: 0', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Подготовить неизменяемый кандидат', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Кандидат подготовлен' }).waitFor();
  await page.getByLabel('Объяснение принятия кандидата', { exact: true }).fill('Принимаю неизменённый пакет только для передачи');
  await page.getByRole('button', { name: 'Принять кандидат для передачи', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Принят для локальной передачи' }).waitFor();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать приватный пакет передачи', exact: true }).click();
  const download = await downloadPromise, bundle = await readArchive(await fs.readFile(await download.path()));
  assert.deepEqual(bundle.get('candidate.e365'), bytes);
  const manifest = JSON.parse(bundle.get('manifest.json')); assert.equal(manifest.artifact.sha256, crypto.createHash('sha256').update(bytes).digest('hex')); assert.equal(manifest.verified, false);
  await page.getByRole('status').filter({ hasText: 'Пакет передачи выдан' }).waitFor();
  await page.getByLabel('Назначение передачи (непроверенная компания или ответственный)', { exact: true }).fill('Другой учебный оператор');
  await page.getByRole('button', { name: 'Сохранить условия (снимает принятие кандидата)', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Рецензия/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Скачать приватный пакет передачи', exact: true }).isDisabled(), true);
  const preview = page.locator('article').filter({ hasText: 'widgets/form.json' }); await preview.locator('summary').click(); await preview.getByRole('button', { name: 'Показать После', exact: true }).click();
  await preview.locator('pre').filter({ hasText: /required/ }).waitFor();
  const large = await projects.create('local', await fixture(false, Array.from({ length: 25 }, (_, n) => [`extra/${String(n).padStart(2, '0')}.txt`, '<script>globalThis.releaseXss=true</script>'])), 'many-files.e365');
  const largeRelease = await page.evaluate(async input => {
    const response = await fetch('/api/releases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(input) });
    if (!response.ok) throw Error('Large fixture creation failed'); return response.json();
  }, { title: 'Много изменений', intent: 'Проверить полную область рецензии', targetIntent: 'Учебный оператор', sourceProjectId: large.id, baselineProjectId: baseline.id });
  await page.goto(base + '/releases?id=' + largeRelease.id); await page.locator('article').first().waitFor();
  assert.equal(await page.locator('article').count(), 20);
  await page.getByLabel('Причина решения — extra/00.txt', { exact: true }).fill('Несохранённая заметка первой страницы');
  await page.getByRole('button', { name: 'Показать следующие 20 изменений', exact: true }).click();
  await page.getByText('Показано 25 из 25. Все файлы остаются в области рецензии.', { exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 25);
  assert.equal(await page.getByLabel('Причина решения — extra/00.txt', { exact: true }).inputValue(), 'Несохранённая заметка первой страницы');
  const malicious = page.locator('article').filter({ hasText: 'extra/00.txt' }); await malicious.locator('summary').click(); await malicious.getByRole('button', { name: 'Показать После', exact: true }).click();
  await malicious.locator('pre').filter({ hasText: '<script>globalThis.releaseXss=true</script>' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.releaseXss), undefined);
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');

  const impactFixture = (fields, role) => zip([
    ['package.json', { code: 'synthetic_release', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
    ['widgets/form.json', { descriptor: { fields } }],
    ['permissionsSettings/manifest.json', { entities: [{ code: 'roles', namespace: 'example.records', path: 'roles.json' }] }],
    ['permissionsSettings/roles.json', { roles: [role] }]
  ]);
  const impactBaseline = await projects.create('local', await impactFixture([], 'reader'));
  const impactSource = await projects.create('local', await impactFixture([{ code: 'note', type: 'STRING', required: false }], 'writer'));
  const impactRelease = await page.evaluate(async input => {
    const response = await fetch('/api/releases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(input) });
    if (!response.ok) throw Error('Impact fixture creation failed'); return response.json();
  }, { title: 'Поле и права', intent: 'Проверить классификацию изменений', targetIntent: 'Учебный оператор', sourceProjectId: impactSource.id, baselineProjectId: impactBaseline.id });
  await page.goto(base + '/releases?id=' + impactRelease.id);
  const optionalCard = page.locator('article').filter({ hasText: 'widgets/form.json' });
  await optionalCard.getByText('widgets/form.json · Структура объекта', { exact: true }).waitFor();
  await page.locator('article').filter({ hasText: 'permissionsSettings/roles.json' }).getByText('permissionsSettings/roles.json · Права доступа', { exact: true }).waitFor();
  assert.ok((await optionalCard.textContent()).includes('Поле note'));
  assert.equal(await optionalCard.getByText('Обязательность поля', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Подготовить неизменяемый кандидат', exact: true }).isDisabled(), true);
  assert.match(await page.locator('.release-shell').textContent(), /permissionsSettings\/manifest\.json — Неизвестный вид объекта сервиса permissionsSettings/);
  await page.goto(base + '/releases');
  let releaseOld;
  const oldResponse = new Promise(resolve => { releaseOld = resolve; });
  await page.route(`**/api/projects/${source.id}/snapshots`, async route => { const response = await route.fetch(); await oldResponse; await route.fulfill({ response }); });
  await page.getByLabel('Новый пакет DEV', { exact: true }).selectOption(source.id);
  await page.getByLabel('Новый пакет DEV', { exact: true }).selectOption(baseline.id);
  const picker = page.getByLabel('Снимок — Новый пакет DEV', { exact: true });
  await picker.locator(`option[value="${baseline.id}"]`).waitFor({ state: 'attached' });
  const lateResponse = page.waitForResponse(r => r.url().endsWith(`/api/projects/${source.id}/snapshots`));
  releaseOld(); await (await lateResponse).finished();
  await page.unroute(`**/api/projects/${source.id}/snapshots`);
  assert.equal(await picker.inputValue(), baseline.id);
  assert.equal(await picker.locator(`option[value="${source.id}"]`).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Analyst release browser: baseline, required/optional-field and native-permission review, parser blocker, reject/resume, stale draft, candidate, exact private bundle, bridge token/connection panel, invalidation, preview and mobile passed.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('elma-release-browser-'));
  await fs.rm(directory, { recursive: true, force: true });
}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';
import { projectStore } from '../lib/projects.mjs';
import { releaseStore } from '../lib/releases.mjs';
import { zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elma-delivery-browser-'));
const server = createServer({ directory, allowLocal: true, syntheticDelivery: true, protectedTargetHosts: ['prod.example.invalid'], sendEmail: undefined, sendVk: undefined });
let browser;
try {
  const fixture = required => zip([
    ['package.json', { code: 'synthetic_release', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'form', namespace: 'example.records', kind: 'WIDGET', path: 'form.json' }] }],
    ['widgets/form.json', { descriptor: { fields: [{ code: 'title', type: 'STRING', required }] } }]
  ]);
  const projects = projectStore(directory), releases = releaseStore(directory, projects);
  const baseline = await projects.create('local', await fixture(false)), source = await projects.create('local', await fixture(true));
  const approved = async title => {
    let release = await releases.create('local', { title, intent: 'Проверить результат учебной операции', targetIntent: 'Учебный TEST', sourceProjectId: source.id, baselineProjectId: baseline.id });
    for (const change of release.changes) release = await releases.change(release.id, 'local', { revision: release.revision, action: 'review', path: change.path, decision: 'accepted', reason: 'Учебное изменение проверено' });
    release = await releases.change(release.id, 'local', { revision: release.revision, action: 'freeze' });
    return releases.change(release.id, 'local', { revision: release.revision, action: 'approve', reason: 'Только учебная проверка' });
  };
  const positive = await approved('Учебная доставка'), cancelled = await approved('Отмена подготовки'), unapplied = await approved('Успех без изменений'), lost = await approved('Потерянный ответ');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await (await browser.newContext()).newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const login = await page.context().request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } });
  assert.equal(login.status(), 200, 'Explicitly enabled loopback fixture login must succeed');
  const api = (route, input) => page.evaluate(async ({ route, input }) => {
    const response = await fetch(route, input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(input) } : {});
    if (!response.ok) throw Error('Fixture API failed: ' + response.status); return response.json();
  }, { route, input });
  const panel = () => page.getByRole('region', { name: 'Доставка и проверка результата', exact: true });
  const open = async release => { await page.goto(base + '/releases?id=' + release.id); await panel().getByText(/Учебный режим:/).waitFor(); };
  const prepare = async (release, connection) => {
    await panel().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption(connection.id);
    await panel().getByRole('button', { name: 'Проверить учебный стенд', exact: true }).click();
    await panel().getByText(/Проверенный учебный стенд:.*доступен/).waitFor();
    const response = page.waitForResponse(r => r.url().endsWith(`/api/releases/${release.id}/delivery`) && r.request().method() === 'POST');
    await panel().getByRole('button', { name: 'Подготовить учебную доставку', exact: true }).click();
    const attempt = await (await response).json(); await panel().getByRole('heading', { name: 'Последняя попытка: Подготовлена', exact: true }).waitFor(); return attempt;
  };
  const confirm = async attempt => {
    const input = panel().getByLabel('Подтверждение учебной операции', { exact: true });
    await input.fill(`DEPLOY ${attempt.solutionCode} ${attempt.sha256.slice(0, 12)}`);
    await panel().getByRole('button', { name: 'Подтвердить учебную операцию', exact: true }).click();
  };
  await open(positive);
  await panel().getByLabel('Название учебного стенда', { exact: true }).fill('Учебный TEST');
  const created = page.waitForResponse(r => r.url().endsWith('/api/connections') && r.request().method() === 'POST');
  await panel().getByRole('button', { name: 'Добавить учебный стенд', exact: true }).click();
  const connection = await (await created).json();
  await panel().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption(connection.id);
  await panel().getByRole('button', { name: 'Проверить учебный стенд', exact: true }).click();
  await panel().getByText(/Проверенный учебный стенд: test.example.invalid/).waitFor();
  const attempt = await prepare(positive, connection);
  await open(cancelled);
  await panel().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption(connection.id);
  const reservedResponse = page.waitForResponse(r => r.url().endsWith(`/api/releases/${cancelled.id}/delivery`) && r.request().method() === 'POST');
  await panel().getByRole('button', { name: 'Подготовить учебную доставку', exact: true }).click();
  assert.equal((await reservedResponse).status(), 409);
  await page.getByRole('alert').filter({ hasText: /На этом Target уже есть незавершённая доставка/ }).waitFor();
  assert.equal((await api(`/api/releases/${cancelled.id}/delivery`)).length, 0);
  assert.equal(await panel().getByRole('button', { name: 'Подготовить учебную доставку', exact: true }).isEnabled(), true);
  await open(positive);
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await panel().getByRole('button', { name: 'Подтвердить учебную операцию', exact: true }).isDisabled(), true);
  await panel().getByLabel('Подтверждение учебной операции', { exact: true }).fill('DEPLOY wrong');
  assert.equal(await panel().getByRole('button', { name: 'Подтвердить учебную операцию', exact: true }).isDisabled(), true);
  await confirm(attempt);
  await panel().getByRole('heading', { name: 'Последняя попытка: Операция завершена, результат не проверен', exact: true }).waitFor();
  assert.match(await page.locator('.release-checks').textContent(), /Не выполнялось/);
  assert.equal((await api(`/api/releases/${positive.id}`)).checks.find(c => c.id === 'target').result, 'not-run');
  await panel().getByRole('button', { name: 'Прочитать и проверить результат', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Проверено чтением результата', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Доставка и проверка результата');
  assert.match(await panel().getByRole('status').textContent(), /не доказательство доставки в ELMA/);
  assert.equal((await api(`/api/releases/${positive.id}`)).checks.find(c => c.id === 'target').result, 'pass');
  await panel().getByText(/Политика проверки: exact-solution-inventory-v1/).waitFor();
  await page.getByLabel('Примечания для оператора', { exact: true }).fill('Условия изменились после проверки');
  await page.getByRole('button', { name: 'Сохранить условия (снимает принятие кандидата)', exact: true }).click();
  await page.locator('.release-checks').getByText(/Устарело/).waitFor();
  await panel().getByText(/Устаревшая попытка:/).waitFor();

  await open(cancelled); await prepare(cancelled, connection);
  await panel().getByRole('button', { name: 'Отменить подготовку', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Подготовка отменена', exact: true }).waitFor();
  assert.equal((await api(`/api/releases/${cancelled.id}/delivery`))[0].evidence.operation, null);
  await panel().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption(connection.id);
  assert.equal(await panel().getByRole('button', { name: 'Подготовить учебную доставку', exact: true }).isEnabled(), true);

  const skipped = await api('/api/connections', { name: 'Учебный стенд без изменений', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { scenario: 'unapplied' } });
  await open(unapplied); const noOp = await prepare(unapplied, skipped); await confirm(noOp);
  await panel().getByRole('button', { name: 'Прочитать и проверить результат', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Результат проверки не совпал', exact: true }).waitFor();
  assert.match(await panel().textContent(), /Отсутствуют:.*widgets\/form.json/);
  assert.equal((await api(`/api/releases/${unapplied.id}`)).checks.find(c => c.id === 'target').result, 'fail');

  await open(lost); const uncertain = await prepare(lost, connection);
  let dispatches = 0;
  await page.route(`**/api/releases/${lost.id}/delivery`, async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'confirm') { dispatches++; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await confirm(uncertain);
  await page.getByRole('alert').filter({ hasText: /Нет подтверждённого ответа/ }).waitFor();
  assert.equal(await panel().getByRole('button', { name: 'Подтвердить учебную операцию', exact: true }).isDisabled(), true);
  await page.unroute(`**/api/releases/${lost.id}/delivery`);
  await page.getByRole('button', { name: 'Обновить релиз (запишите черновик перед обновлением)', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Операция завершена, результат не проверен', exact: true }).waitFor();
  await panel().getByRole('button', { name: 'Прочитать и проверить результат', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Проверено чтением результата', exact: true }).waitFor();
  assert.equal(dispatches, 1);

  await page.route(`**/api/releases/${lost.id}/delivery`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Учебная ошибка загрузки' }) }));
  await page.reload(); await panel().getByText('Состояние доставки не получено. Действия заблокированы до успешного обновления.', { exact: true }).waitFor();
  assert.equal(await panel().getByRole('button', { name: 'Подготовить учебную доставку', exact: true }).count(), 0);
  await page.unroute(`**/api/releases/${lost.id}/delivery`);
  await panel().getByRole('button', { name: 'Повторить загрузку доставки', exact: true }).click();
  await panel().getByRole('heading', { name: 'Последняя попытка: Проверено чтением результата', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel().getByRole('button', { name: 'Обновить состояние доставки', exact: true }).focus(); await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  const disposable = await api('/api/connections', { name: 'Временный учебный стенд', role: 'target', environment: 'test', adapter: 'synthetic' });
  const protectedConnection = await api('/api/connections', { name: 'Защищённый учебный узел', role: 'target', environment: 'test', adapter: 'synthetic', adapterOptions: { identity: { host: 'prod.example.invalid', version: 'synthetic' } } });
  await api(`/api/connections/${protectedConnection.id}/probe`, {});
  await page.reload();
  await panel().getByText(/Фактический узел входит в защищённый список/).waitFor();
  assert.equal(await panel().locator(`option[value="${protectedConnection.id}"]`).isDisabled(), true);
  await panel().getByRole('button', { name: 'Удалить подключение — Временный учебный стенд', exact: true }).click();
  await panel().getByRole('heading', { name: 'Временный учебный стенд', exact: true }).waitFor({ state: 'detached' });
  assert.equal((await api('/api/connections')).some(c => c.id === disposable.id), false);

  // Isolated persisted evidence fixtures test the renderer; delivery.test.mjs covers comparator rejection.
  const evidenceFile = path.join(directory, 'delivery', 'attempts', lost.id, uncertain.id + '.json');
  const mismatch = JSON.parse(await fs.readFile(evidenceFile, 'utf8'));
  mismatch.state = 'verification-failed';
  mismatch.evidence.comparison = { ...mismatch.evidence.comparison, match: false, unexpected: ['permissionsSettings/extra.json'] };
  mismatch.history.push({ at: new Date().toISOString(), state: mismatch.state, note: 'Synthetic unexpected-file evidence fixture' });
  await fs.writeFile(evidenceFile, JSON.stringify(mismatch));
  await page.reload();
  await panel().getByText('Лишние файлы: permissionsSettings/extra.json', { exact: true }).waitFor();
  assert.equal((await api(`/api/releases/${lost.id}`)).checks.find(c => c.id === 'target').result, 'fail');
  mismatch.evidence.comparison = null;
  mismatch.evidence.verificationError = { policy: 'exact-solution-inventory-v1', statusCode: 502 };
  await fs.writeFile(evidenceFile, JSON.stringify(mismatch));
  await page.reload(); await panel().getByText(/Проверка результата не подтверждена/).waitFor();
  assert.equal(await panel().getByRole('button', { name: 'Подтвердить учебную операцию', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Delivery UI: strict policy, extra files, invalid evidence, identity, confirmation, read-back, stale evidence, cancellation, lost-response recovery, protected Target, connection removal and mobile passed.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  const absolute = path.resolve(directory);
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert.ok(path.basename(absolute).startsWith('elma-delivery-browser-'));
  await fs.rm(absolute, { recursive: true, force: true });
}

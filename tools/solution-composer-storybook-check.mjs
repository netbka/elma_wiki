// MR-06 composer renderer evidence: the built solution-composer--* stories use the
// production Solution renderer with synthetic candidates. No ELMA, no native package.
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
  const composer = () => page.getByRole('region', { name: 'Сборка конфигурации', exact: true });
  const delivery = () => page.getByRole('region', { name: 'Доставка и проверка результата', exact: true });
  const open = async id => {
    await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=solution-composer--${id}&viewMode=story`);
    await page.locator('.managed-shell').waitFor();
    await page.waitForFunction(() => !document.querySelector('.release-delivery')?.textContent.includes('Загружаем состояние доставки'));
  };
  const text = async locator => (await locator.textContent()).replace(/\s+/g, ' ');

  for (const id of ['build-blocked', 'build-gates', 'eligibility-load-error', 'list', 'awaiting-approval', 'approved', 'native-pending', 'test-install', 'unknown-evidence', 'stale', 'missing', 'load-error', 'delivery-prepared', 'partial-outcome', 'unknown-outcome', 'verified', 'verification-failed', 'failed', 'delivery-load-error', 'lost-response']) {
    await open(id);
    assert.equal(await page.locator('.managed-shell').count(), 1, id);
    assert.equal(await page.getByRole('link', { name: 'Сборка', exact: true }).getAttribute('aria-current'), 'page', 'composer stays a Solution tab: ' + id);
    if (id === 'load-error') { await composer().getByRole('link', { name: 'Повторить загрузку сборок' }).waitFor(); continue; }
    // Build is never offered as working while native materialization is unavailable.
    const build = composer().getByRole('button', { name: 'Собрать конфигурацию', exact: true });
    assert.equal(await build.isDisabled(), true, id);
    assert.match(await text(composer()), /elma365#60/);
    if (id === 'build-blocked') {
      const missing = await composer().getByRole('list', { name: 'Чего не хватает для нативной сборки' }).locator('li').allTextContents();
      assert.equal(missing.length, 4); assert.match(missing[0], /нативный исполнитель/);
      assert.match(await text(composer()), /elma365-native-materialization@1 закреплён/); assert.doesNotMatch(await text(composer()), /не опубликован/);
    }
    // Build eligibility: every gate with its status and each blocking reason, read from the server shape.
    const gates = composer().getByRole('list', { name: 'Условия сборки конфигурации' });
    if (id === 'eligibility-load-error') {
      assert.equal(await gates.count(), 0);
      assert.match(await text(composer()), /Проверка состава, покрытия, зависимостей и профиля Target не получена/);
    } else {
      const rows = await gates.locator(':scope > li').allTextContents();
      assert.deepEqual(rows.map(row => row.split(':')[0]), ['Состав выпуска', 'Нативное покрытие', 'Зависимости и лицензии', 'Профиль Target', 'Нативная сборка'], id);
      assert.match(await text(gates), /профиль Target не прочитан с сервера|профиль Target прочитан больше суток назад/);
    }
    if (id === 'build-gates') {
      assert.match(await text(gates.getByRole('list', { name: 'Состав выпуска' })), /объекты зависят друг от друга по кругу · contract → approval/);
      assert.match(await text(gates.getByRole('list', { name: 'Нативное покрытие' })), /вид объекта не поддерживается нативной сборкой/);
      assert.match(await text(gates.getByRole('list', { name: 'Зависимости и лицензии' })), /платный модуль: лицензия на Target не подтверждена · модуль vendor\.signature/);
      assert.match(await text(gates.getByRole('list', { name: 'Профиль Target' })), /зависимости проверены для другого профиля Target/);
    }
    if (id === 'list') assert.equal(await composer().getByRole('link', { name: 'Открыть сборку' }).count(), 2);
    if (id === 'missing') assert.match(await text(composer()), /Выбранная сборка не найдена/);
    if (id === 'awaiting-approval') {
      const accept = composer().getByRole('button', { name: 'Принять сборку' });
      assert.equal(await accept.isDisabled(), true, 'reason required');
      await composer().getByLabel('Причина принятия точных байтов').fill('Сверено');
      assert.equal(await accept.isDisabled(), false);
      assert.equal(await delivery().count(), 0, 'no delivery before exact-byte approval');
      await accept.click();
      await composer().getByText('Учебный пример').waitFor();
      assert.equal(await composer().getByLabel('Причина принятия точных байтов').inputValue(), 'Сверено', 'draft kept after failure');
    }
    if (id === 'stale') {
      assert.equal(await composer().getByRole('button', { name: /Принять сборку|Отозвать принятие/ }).count(), 0);
      assert.equal(await delivery().getByRole('button', { name: 'Подготовить учебную доставку' }).isDisabled(), true);
    }
    if (id === 'approved') {
      assert.equal(await composer().getByRole('button', { name: 'Отозвать принятие' }).count(), 1);
      assert.match(await text(composer()), /не нативный пакет ELMA, к выпуску не допускается/);
    }
    if (id === 'native-pending' || id === 'unknown-evidence') {
      const selected = composer().getByRole('region', { name: 'Выбранная сборка', exact: true });
      const label = await text(selected);
      assert.match(label, id === 'native-pending' ? /Нативная сборка: подтверждение установки/ : /Происхождение сборки не подтверждено/);
      assert.doesNotMatch(label, /Учебная сборка \(синтетический сборщик\)/);
      assert.match(label, /к выпуску не допускается/);
    }
    if (id === 'test-install') {
      // A verified designated DEV2 test install is never shown as a release or offered for promotion.
      const panel = await text(delivery());
      assert.match(panel, /Тестовая установка на назначенный владельцем DEV2/);
      assert.match(panel, /Это не выпуск/);
      assert.doesNotMatch(panel, /Read-back с Target совпал с кандидатом по политике проверки/);
      assert.equal(await delivery().getByRole('region', { name: /Продвижение/ }).count(), 0);
      assert.equal(await delivery().getByRole('button', { name: /Продвинуть|продвижение/i }).count(), 0);
    }
    if (id === 'partial-outcome') {
      const units = await delivery().getByRole('list', { name: 'Единицы установки' }).locator('li').allTextContents();
      assert.deepEqual(units.map(row => row.split(':')[0]), ['contract-fields', 'contract-approval', 'contract-forms'], 'receipts in import order');
      assert.match(await text(delivery()), /повтор операции запрещён/);
      assert.equal(await delivery().getByRole('button', { name: 'Прочитать и проверить результат' }).isEnabled(), true);
      assert.equal(await delivery().getByRole('button', { name: 'Подготовить учебную доставку' }).isDisabled(), true);
    }
    if (id === 'unknown-outcome') assert.match(await text(delivery()), /Результат неизвестен/);
    if (id === 'delivery-load-error') assert.equal(await delivery().getByRole('button', { name: 'Повторить загрузку доставки' }).isEnabled(), true);
    if (id === 'lost-response') {
      await delivery().getByLabel('Учебный стенд для доставки', { exact: true }).selectOption('synthetic-target');
      await delivery().getByRole('button', { name: 'Подготовить учебную доставку' }).click();
      await composer().getByText('Ответ не получен').waitFor();
      await composer().getByRole('link', { name: 'Обновить состояние' }).waitFor();
      assert.equal(await delivery().getByRole('button', { name: 'Подготовить учебную доставку' }).isDisabled(), true, 'no replay after a lost response');
    }
  }
  // Operator Target profile refresh: offered only to the operator, every result and stale input
  // stated in the same renderer; an observed profile alone never enables the build.
  const profile = () => composer().getByRole('group', { name: 'Профиль Target', exact: true });
  const profileButton = () => profile().getByRole('button', { name: 'Прочитать профиль Target DEV2', exact: true });
  for (const [id, expected] of [['profile-unconfigured', /не настроено/], ['profile-not-operator', /только оператор моста/], ['profile-ready', /ещё не прочитан/],
    ['profile-progress', /уже читается/], ['profile-observed', /прочитан для текущей версии.*DEV2 · платформа synthetic-2026\.10/], ['profile-stale', /прежней версии решения/],
    ['profile-unavailable', /профиль недоступен.*нет доступа к Target/], ['profile-invalid', /не прошёл проверку.*не подтверждает это задание/],
    ['profile-unknown', /Результат чтения неизвестен.*время ожидания истекло/], ['profile-moved', /ещё не прочитан/], ['profile-lost', /ещё не прочитан/],
    ['profile-evidence', /Сведения о сборке получены для текущей версии.*только: виджеты.*не подтверждают: .*лицензии платных модулей.*компиляцию процессов/],
    ['profile-evidence-unavailable', /Сведения о сборке не получены.*профиль исполнителя не определён/], ['profile-evidence-invalid', /не прошли проверку.*ответ на чужое задание/]]) {
    await open(id);
    assert.match(await text(profile()), expected, id);
    assert.equal(await composer().getByRole('button', { name: 'Собрать конфигурацию', exact: true }).isDisabled(), true, 'no build from a profile alone: ' + id);
    const offered = !['profile-unconfigured', 'profile-not-operator'].includes(id);
    assert.equal(await profileButton().count(), offered ? 1 : 0, id);
    if (!offered) continue;
    assert.equal(await profileButton().isDisabled(), id === 'profile-progress', id);
    if (id === 'profile-observed') assert.match(await text(composer().getByRole('list', { name: 'Профиль Target' })), /состав выпуска не привязан к профилю Target/);
    // Admitted build evidence leaves the licence, installation and builder gates named; the build stays disabled.
    if (id === 'profile-evidence') assert.match(await text(composer().getByRole('list', { name: 'Зависимости и лицензии' })), /лиценз/);
    if (!['profile-ready', 'profile-invalid', 'profile-moved', 'profile-lost'].includes(id)) continue;
    await profileButton().click();
    if (id === 'profile-ready') { await page.getByText(/Учебная навигация: профиль прочитан/).waitFor(); continue; }
    const alert = profile().locator('[role=alert]');
    await alert.waitFor();
    assert.match(await text(alert), { 'profile-invalid': /не принят.*исполнитель другой версии/, 'profile-moved': /Решение изменилось.*версия решения изменилась/, 'profile-lost': /не повторяется автоматически/ }[id], id);
    // Only a rejected report may be retried as is; a moved Solution or lost response needs a fresh read.
    assert.equal(await profileButton().isDisabled(), id !== 'profile-invalid', 'no replay: ' + id);
    assert.equal(await profile().getByRole('link', { name: 'Обновить состояние' }).count(), id === 'profile-invalid' ? 0 : 1, id);
  }
  // Build then freeze of the accepted merged revision, with every refusal and the lost response.
  for (const id of ['build-ready', 'build-no-merge', 'build-refused', 'build-failed', 'build-stale', 'build-not-accepted', 'build-lost', 'build-malformed', 'freeze-stale', 'freeze-lost']) {
    await open(id);
    const build = composer().getByRole('button', { name: 'Собрать конфигурацию', exact: true });
    if (id === 'build-no-merge') {
      assert.equal(await build.isDisabled(), true); assert.match(await text(composer()), /прошедшую сравнение трёх версий/); continue;
    }
    assert.equal(await build.isEnabled(), true, id);
    assert.equal(await composer().getByRole('button', { name: 'Зафиксировать сборку' }).count(), 0, 'nothing to freeze before a build: ' + id);
    await build.click();
    const card = composer().locator('[aria-label="Новая сборка"]');
    const retry = composer().getByRole('button', { name: 'Собрать заново', exact: true });
    if (id === 'build-ready' || id === 'freeze-stale' || id === 'freeze-lost') {
      await card.getByText('Сборка проверена').waitFor();
      assert.match(await text(card), /Манифест сборки: dddddddddddd · файлов сборки: 2/);
      await card.getByRole('button', { name: 'Зафиксировать сборку' }).click();
      if (id === 'build-ready') { await page.getByText(/Сборка зафиксирована/).first().waitFor(); continue; }
      await card.getByText(id === 'freeze-stale' ? 'Принятая версия изменилась после сборки' : /Ответ сервера не получен/).waitFor();
      assert.equal(await retry.isDisabled(), true, 'a stale freeze needs a fresh read');
      await card.getByRole('link', { name: 'Обновить состояние' }).waitFor(); continue;
    }
    const expected = { 'build-refused': /Сборка заблокирована.*зависимость не закреплена/, 'build-failed': /не подтвердил сборку.*нативная проверка пакета не пройдена/,
      'build-stale': /изменились.*входные данные изменились во время сборки/, 'build-not-accepted': /изменилась или не готова к сборке/, 'build-lost': /Ответ сервера не получен/,
      'build-malformed': /Ответ сервера не подтверждает проверенную сборку/ }[id];
    await card.locator('[role=alert]').waitFor();
    assert.match(await text(card.locator('[role=alert]')), expected, id);
    const refresh = ['build-stale', 'build-not-accepted', 'build-lost', 'build-malformed'].includes(id);
    assert.equal(await retry.isDisabled(), refresh, 'retry only without moved inputs: ' + id);
    assert.equal(await card.getByRole('link', { name: 'Обновить состояние' }).count(), refresh ? 1 : 0, id);
  }
  for (const [id, label] of [['next-compare', 'Сравнить изменения'], ['next-resolve', 'Разрешить конфликт'], ['next-unknown-base', 'Указать базу изменения'], ['next-build-blocked', 'Открыть сборку'], ['next-review-build', 'Рассмотреть сборку'], ['next-verify', 'Проверить конфигурацию']]) {
    await open(id);
    const primary = page.locator('.managed-actions a.button').first();
    assert.equal(await primary.textContent(), label, id);
    if (['next-build-blocked', 'next-review-build', 'next-verify'].includes(id)) assert.match(await primary.getAttribute('href'), /view=compose/);
    if (['next-review-build', 'next-verify'].includes(id)) assert.match(await primary.getAttribute('href'), /candidate=/);
  }
  for (const width of [1280, 390]) for (const id of ['partial-outcome', 'build-gates', 'profile-observed', 'profile-invalid', 'native-pending', 'test-install', 'unknown-evidence', 'build-ready', 'freeze-lost']) {
    await page.setViewportSize({ width, height: 900 }); await open(id);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal scroll at ${width}: ${id}`);
  }
  assert.deepEqual(errors, []);
  console.log('Solution composer stories: build blocked with eligibility gates and reasons, operator Target profile refresh states, build then freeze with refusals and lost response, candidate review, stale, delivery outcomes, failure/retry and next actions verified.');
} finally {
  await browser?.close();
  server.close();
}

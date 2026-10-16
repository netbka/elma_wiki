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

  for (const id of ['build-blocked', 'build-gates', 'eligibility-load-error', 'list', 'awaiting-approval', 'approved', 'stale', 'missing', 'load-error', 'delivery-prepared', 'partial-outcome', 'unknown-outcome', 'verified', 'verification-failed', 'failed', 'delivery-load-error', 'lost-response']) {
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
  for (const [id, label] of [['next-compare', 'Сравнить изменения'], ['next-resolve', 'Разрешить конфликт'], ['next-unknown-base', 'Указать базу изменения'], ['next-build-blocked', 'Открыть сборку'], ['next-review-build', 'Рассмотреть сборку'], ['next-verify', 'Проверить конфигурацию']]) {
    await open(id);
    const primary = page.locator('.managed-actions a.button').first();
    assert.equal(await primary.textContent(), label, id);
    if (['next-build-blocked', 'next-review-build', 'next-verify'].includes(id)) assert.match(await primary.getAttribute('href'), /view=compose/);
    if (['next-review-build', 'next-verify'].includes(id)) assert.match(await primary.getAttribute('href'), /candidate=/);
  }
  for (const width of [1280, 390]) for (const id of ['partial-outcome', 'build-gates']) {
    await page.setViewportSize({ width, height: 900 }); await open(id);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal scroll at ${width}: ${id}`);
  }
  assert.deepEqual(errors, []);
  console.log('Solution composer stories: build blocked with eligibility gates and reasons, candidate review, stale, delivery outcomes, failure/retry and next actions verified.');
} finally {
  await browser?.close();
  server.close();
}

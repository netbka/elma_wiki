// MR-01 UI evidence: explicit accepted full base and named component scope in
// the existing Solution Change preparation, through the authenticated API and
// the single production/Storybook renderer. Synthetic archives only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { zip } from '../test/fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'change-base-browser-'));
const server = createServer({ directory, allowLocal: true, sendEmail: undefined, sendVk: undefined });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const archive = entries => zip([
  ['package.json', { code: 'synthetic_solution', type: 'SOLUTION' }],
  ['widgets/manifest.json', { entities: entries.map(([code]) => ({ code, namespace: 'synthetic.records', kind: 'WIDGET', path: code + '.json' })) }],
  ...entries.map(([code, value]) => ['widgets/' + code + '.json', { descriptor: { fields: [], clientScripts: `const value = ${JSON.stringify(value)};` } }])
]);
const key = code => JSON.stringify(['widgets', 'synthetic.records', code]);
const evidence = { synthetic: true, historicalBase: false, unknownBase: false, duplicateMember: false, foreignMember: false,
  absentNotDeleted: false, staleSubmit: false, uncertainResponse: false, draftRetention: false, storybook: [] };
let browser, stories;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir('qa', { recursive: true });
  assert.equal((await context.request.post(base + '/auth/local', { headers: { 'X-Elma-Wiki-Request': '1' } })).status(), 200);
  const json = async (route, data) => {
    const response = await context.request.post(base + route, { headers: { 'X-Elma-Wiki-Request': '1' }, data });
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const snapshot = async (entries, scope) => {
    const response = await context.request.post(base + '/api/solutions/uploads?sharedConfirmed=true', { headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, data: await archive(entries) });
    assert.equal(response.status(), 201); const project = await response.json();
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  // B0 initial full export, then an accepted full update B1 makes B0 historical.
  let state = await json('/api/solutions', { name: 'Учебные договоры', baselineOwner: 'Поставщик', snapshot: await snapshot([['contract', 'b0'], ['untouched', 'b0']], 'full'), sharedConfirmed: true });
  const id = state.id, route = '/api/solutions/' + id, initial = state.baselineId;
  const update = await json(route + '/prepare', { kind: 'reconciliation', snapshot: await snapshot([['contract', 'b1'], ['untouched', 'b0']], 'full'), expectedRevision: state.revision, sameSourceConfirmed: true, baselineOwner: 'Поставщик' });
  state = await json(`${route}/artifacts/${update.artifactId}/accept`, { expectedRevision: update.revision, reviewedDigest: update.artifactDigest, resolutions: {} });
  const current = state.baselineId; assert.notEqual(current, initial);
  const read = async () => (await context.request.get(base + route)).json();
  const changeUrl = `${base}/solutions?id=${id}&view=change`;
  const requests = { upload: 0, prepare: 0 };
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (request.url().includes('/api/config-source/uploads')) requests.upload++;
    if (request.url().endsWith('/prepare')) requests.prepare++;
  });
  const fillChange = async (entries, task) => {
    await page.goto(changeUrl); await page.getByRole('heading', { name: 'Добавить изменение', exact: true }).waitFor();
    await page.getByLabel('Ответственная команда', { exact: true }).fill('Внутренняя команда');
    await page.getByLabel('Что изменили', { exact: true }).fill(task);
    await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'synthetic.e365', mimeType: 'application/octet-stream', buffer: await archive(entries) });
    await page.getByLabel('Это частичный экспорт изменений', { exact: true }).check();
    await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  };
  const baseSelect = () => page.getByLabel('Исходная версия (база)', { exact: true });
  const confirmBase = () => page.getByLabel(/Подтверждаю: экспорт подготовлен от выбранной версии/);
  const scopeToggle = () => page.getByLabel(/Указать именованный состав изменения/);
  const extra = () => page.getByLabel('Новые объекты: точные ключи, по одному в строке', { exact: true });
  const member = code => page.locator(`.managed-members input[value='${key(code)}']`);
  const submit = () => page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
  const declareScope = async (members, extraKeys) => {
    await scopeToggle().check(); await page.getByLabel('Название состава', { exact: true }).fill('Категория договора');
    for (const code of members) await member(code).check();
    await extra().fill(extraKeys.join('\n'));
  };

  // Choices show exact revisions/checksums; the default stays an unknown base.
  await fillChange([['contract', 'ours'], ['category', 'new']], 'SYNTHETIC-1');
  const options = await baseSelect().locator('option').allTextContents();
  assert.equal(options.length, 3); assert.match(options[0], /не указывать/i);
  assert.match(options[1], /Ревизия 1 .* текущая · SHA-256 [0-9a-f]{12}…/); assert.match(options[2], /Ревизия 0 .* прежняя/);
  await page.getByText(/База неизвестна/).waitFor();
  assert.equal(await scopeToggle().isVisible(), false, 'scope requires an explicit base');
  await baseSelect().selectOption(initial);
  await page.getByText(new RegExp(`прежняя версия: ревизия 0, SHA-256 ${state.artifacts.find(row => row.id === initial).checksum}`)).waitFor();
  assert.equal(await page.getByRole('button', { name: /удал/i }).count(), 0, 'no deletion control is offered');
  await confirmBase().check();
  // Duplicate member is rejected locally without any request.
  await declareScope(['contract', 'untouched'], [key('category'), key('contract')]);
  await submit(); await page.getByText(/указан дважды/).waitFor();
  assert.deepEqual(requests, { upload: 0, prepare: 0 }); evidence.duplicateMember = true;
  // A foreign member is rejected by the server; the draft and saved upload remain.
  await extra().fill([key('category'), key('foreign')].join('\n'));
  await submit(); await page.locator('.managed-error').filter({ hasText: /Scope member is not proven/ }).waitFor();
  assert.deepEqual(requests, { upload: 1, prepare: 1 });
  assert.equal(await page.getByLabel('Название состава', { exact: true }).inputValue(), 'Категория договора');
  assert.equal(await member('untouched').isChecked(), true);
  assert.equal((await read()).pending.length, 0); evidence.foreignMember = true;
  await page.screenshot({ path: 'qa/change-base-foreign-member.png', fullPage: true });
  await extra().fill(key('category'));
  await submit(); await page.getByRole('heading', { name: 'Рассмотреть изменение', exact: true }).waitFor();
  assert.equal(requests.upload, 1, 'retry reuses the saved upload');
  const provenance = page.locator('.managed-provenance');
  await provenance.getByText('Происхождение: заявлено, не проверено', { exact: true }).waitFor();
  await provenance.getByText(/База заявлена: ревизия 0/).waitFor();
  await provenance.getByText(/untouched · нет в экспорте — остаётся без изменений/).waitFor();
  await provenance.getByText(/category · есть в экспорте · новый относительно базы/).waitFor();
  assert.equal(await page.getByText('Удаление заявлено явно').count(), 0);
  await page.screenshot({ path: 'qa/change-base-review-declared.png', fullPage: true });
  state = await read();
  const pending = state.pending[0];
  assert.deepEqual([pending.baseDeclaration.status, pending.baseDeclaration.artifactId, pending.baseDeclaration.revision, pending.baseDeclaration.ancestryVerified], ['declared', initial, 0, false]);
  assert.deepEqual(pending.changeScopeDeclaration.members.map(row => row.key), [key('category'), key('contract'), key('untouched')]);
  assert.deepEqual([pending.changeScopeDeclaration.deletions, pending.changeScopeDeclaration.automaticMergeEnabled, pending.changeScopeDeclaration.buildEnabled], [[], false, false]);
  evidence.historicalBase = true;
  // Accepting keeps the absent scoped member: absence is not deletion.
  for (const box of await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).all()) await box.check();
  await page.getByLabel('Принимаю рассмотренное изменение', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor();
  state = await read();
  assert.ok(state.current.some(row => row.key === key('untouched'))); assert.ok(state.current.some(row => row.key === key('category')));
  evidence.absentNotDeleted = true;

  // Omitting the base records an unknown base, shown as unknown in review.
  await fillChange([['contract', 'second']], 'SYNTHETIC-2');
  await submit(); await page.getByRole('heading', { name: 'Рассмотреть изменение', exact: true }).waitFor();
  await provenance.getByText('Происхождение: неизвестно', { exact: true }).waitFor();
  await provenance.getByText('База не указана — происхождение неизвестно', { exact: true }).waitFor();
  await provenance.getByText('Состав не указан', { exact: true }).waitFor();
  state = await read();
  assert.deepEqual([state.pending[0].baseDeclaration.status, state.pending[0].baseDeclaration.method], ['unknown', 'not-declared']);
  assert.equal(state.pending[0].changeScopeDeclaration.status, 'unknown'); evidence.unknownBase = true;
  // Leave this second pending change untouched; later submissions are separate changes.

  // A concurrent revision change rejects the submit; the draft survives refresh.
  await fillChange([['contract', 'third']], 'SYNTHETIC-3');
  await baseSelect().selectOption(current); await confirmBase().check();
  await declareScope(['contract'], []);
  state = await read();
  state = await json(route + '/archive', { archived: true, expectedRevision: state.revision });
  state = await json(route + '/archive', { archived: false, expectedRevision: state.revision });
  const prepareBefore = requests.prepare;
  await submit(); await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  assert.equal(requests.prepare, prepareBefore + 1);
  assert.equal(await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).isDisabled(), true, 'no replay after a stale rejection');
  assert.equal((await read()).pending.length, 1);
  await page.getByRole('link', { name: 'Обновить состояние', exact: true }).click();
  await page.getByText('Восстановлен черновик этой подготовки. Подтверждения нужно отметить заново.', { exact: true }).waitFor();
  await page.getByText(/решение уже изменилось/).waitFor();
  assert.equal(await page.getByLabel('Что изменили', { exact: true }).inputValue(), 'SYNTHETIC-3');
  assert.equal(await baseSelect().inputValue(), current);
  assert.equal(await page.getByLabel('Название состава', { exact: true }).inputValue(), 'Категория договора');
  assert.equal(await member('contract').isChecked(), true);
  assert.equal(await confirmBase().isChecked(), false, 'confirmations are not restored');
  assert.equal(await page.getByLabel('Файл .e365', { exact: true }).evaluate(input => input.required), false, 'saved upload restored');
  await page.screenshot({ path: 'qa/change-base-stale-draft.png', fullPage: true });
  evidence.staleSubmit = true;
  await page.getByLabel('Это частичный экспорт изменений', { exact: true }).check();
  await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  await confirmBase().check();
  await submit(); await page.getByRole('heading', { name: 'Рассмотреть изменение', exact: true }).waitFor();
  await provenance.getByText(/База заявлена: ревизия 1/).waitFor();
  await page.goto(changeUrl); await page.getByRole('heading', { name: 'Добавить изменение', exact: true }).waitFor();
  assert.equal(await page.getByText(/Восстановлен черновик/).count(), 0, 'successful preparation clears its draft');

  // A lost response is uncertain: block replay, keep the draft and point to Changes.
  await fillChange([['contract', 'fourth']], 'SYNTHETIC-4');
  await page.route('**/prepare', route => route.abort('connectionreset'));
  await submit(); await page.getByText(/Ответ не получен/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).isDisabled(), true);
  await page.unroute('**/prepare');
  await page.goto(changeUrl);
  await page.getByText(/Предыдущая отправка могла сохраниться/).waitFor();
  await page.getByRole('link', { name: 'Открыть изменения', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Что изменили', { exact: true }).inputValue(), 'SYNTHETIC-4');
  evidence.uncertainResponse = true;
  await page.getByRole('link', { name: 'Очистить черновик', exact: true }).click();
  await page.getByText(/Восстановлен черновик/).waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Добавить изменение', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Что изменили', { exact: true }).inputValue(), '');
  evidence.draftRetention = true;
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no overflow at ' + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  const storyRoot = path.resolve('storybook/storybook-static'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  stories = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname, file = path.resolve(storyRoot, '.' + pathname);
      if (!file.startsWith(storyRoot + path.sep)) { res.writeHead(404); res.end(); return; }
      const bytes = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => stories.listen(0, '127.0.0.1', resolve));
  for (const mode of ['change-base', 'change-draft', 'change-rejected', 'base-declared', 'base-unknown']) {
    await page.goto(`http://127.0.0.1:${stories.address().port}/iframe.html?id=managed-workspace--${mode}&viewMode=story`);
    await page.locator('.managed-shell h1').waitFor();
    if (mode.startsWith('change-')) {
      assert.equal(await baseSelect().locator('option').count(), 3, mode);
      if (mode !== 'change-base') {
        await page.getByText(/Восстановлен черновик/).waitFor();
        assert.equal(await member('contract').isChecked(), true, mode);
        assert.match(await extra().inputValue(), /category/);
      }
      if (mode === 'change-draft') await page.getByText(/Предыдущая отправка могла сохраниться/).waitFor();
      if (mode === 'change-rejected') await page.getByText(/Объект состава не найден/).waitFor();
    }
    if (mode === 'base-declared') await page.getByText('Происхождение: заявлено, не проверено', { exact: true }).waitFor();
    if (mode === 'base-unknown') await page.getByText('Происхождение: неизвестно', { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode + ' ' + width);
      await page.screenshot({ path: `qa/change-base-story-${mode}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    evidence.storybook.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log('Change base/scope: historical and unknown base, duplicate/foreign members, absent-not-deleted, stale submit, uncertain response, draft retention and 5 Storybook states passed.');
} finally {
  await fs.mkdir('qa', { recursive: true }); await fs.writeFile('qa/change-base-browser-evidence.json', JSON.stringify(evidence, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  if (stories) await new Promise(resolve => stories.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

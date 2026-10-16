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
  await page.goto(base + '/solutions');
  await page.getByRole('heading', { name: 'Решений пока нет' }).waitFor();
  assert.equal(await page.locator('.managed-content a.button').count(), 1);
  await page.getByRole('link', { name: 'Загрузить решение', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Загрузить решение', exact: true, level: 1 }).waitFor();
  // UX-01: the fixed entry is server + solution; this check exercises the legacy file path behind its one link.
  assert.equal(await page.getByLabel('Это полный экспорт решения', { exact: true }).count(), 0, 'no scope question on the fixed entry');
  await page.getByRole('link', { name: 'Загрузить файл .e365 вручную', exact: true }).click();
  await page.getByRole('heading', { name: 'Загрузить .e365', exact: true }).waitFor();
  await page.getByLabel('Название решения', { exact: true }).fill('Учебные договоры');
  await page.getByLabel('Кто отвечает за исходную версию', { exact: true }).fill('Поставщик');
  const baseBytes = await archive([['contract', 'base'], ['untouched', 'base']]);
  const upload = async (bytes, full = false) => {
    await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'synthetic.e365', mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByLabel(full ? 'Это полный экспорт решения' : 'Это частичный экспорт изменений', { exact: true }).check();
    assert.equal(await page.getByLabel('Файл доступен всем пользователям сервиса', { exact: true }).count(), 0);
  };
  await upload(baseBytes, true);
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  const workspaceUrl = page.url(), id = new URL(workspaceUrl).searchParams.get('id'); assert.ok(id);
  // UX-05: О решении opens with the purpose; the generated draft is edited and saved in place with its author.
  await page.getByRole('heading', { name: 'Для чего', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Написать', exact: true }).click();
  const purposeText = page.getByLabel('Описание решения', { exact: true }); await purposeText.waitFor();
  assert.match(await purposeText.inputValue(), /Работа в ELMA не наблюдалась/);
  await purposeText.fill('Учебное решение для согласования договоров.');
  await page.getByRole('button', { name: 'Сохранить описание', exact: true }).click();
  await page.getByText('Учебное решение для согласования договоров.', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Изменить', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Модули', exact: true }).waitFor();
  await page.reload();
  await page.getByText('Учебное решение для согласования договоров.', { exact: true }).first().waitFor();
  const activity = page.getByRole('list', { name: 'Последние события', exact: true });
  await activity.getByText('Описание сохранено', { exact: true }).waitFor(); await activity.getByText('Решение загружено', { exact: true }).waitFor();
  assert.equal((await (await context.request.get(`${base}/api/solutions/${id}`)).json()).revision, 0, 'saving the purpose does not advance the revision');
  // UX-03b: pulling the exact current content again is closed without a decision; nothing advances.
  await page.getByRole('link', { name: 'Обновить', exact: true }).click();
  await upload(baseBytes, true);
  await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
  await page.getByText('Эта версия не отличается от текущей', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).count(), 0, 'a no-change version offers no decision dialog');
  await page.getByRole('button', { name: 'Закрыть без изменений', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  const closedState = await (await context.request.get(`${base}/api/solutions/${id}`)).json();
  assert.equal(closedState.reconciliations.length, 0, 'closing advances nothing'); assert.equal(closedState.pending.length, 0);
  assert.equal(closedState.reviewedChanges.filter(row => row.closedAt).length, 1);
  await page.getByRole('link', { name: 'Изменения', exact: true }).click();
  await page.getByRole('link', { name: 'Обновление версии · Закрыто без изменений', exact: true }).waitFor(); evidence.closedNoChanges = true;
  const prepareChange = async bytes => {
    // Partial exports are legacy: reachable only from the technical details of the Changes tab.
    await page.goto(workspaceUrl + '&view=changes'); await page.getByText('Исходные файлы и технические данные', { exact: true }).click();
    await page.getByRole('link', { name: 'Загрузить частичный экспорт файлом', exact: true }).click();
    await page.getByLabel('Ответственная команда', { exact: true }).fill('Внутренняя команда');
    await page.getByLabel('Что изменили', { exact: true }).fill('SYNTHETIC-1');
    await upload(bytes);
    await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
    await page.getByRole('heading', { name: 'Рассмотреть изменение', exact: true }).waitFor();
  };
  // UX-03b: one "Решение по версии" button opens one dialog; the three choices live there.
  const dialog = () => page.getByRole('dialog', { name: 'Решение по версии' });
  const openDecision = async () => { await page.getByRole('button', { name: 'Решение по версии', exact: true }).click(); await dialog().waitFor(); return dialog(); };
  const decide = async (choice, submit, text) => {
    const d = await openDecision();
    if (choice) await d.getByRole('radio', { name: choice, exact: true }).check();
    if (text !== undefined) await d.getByLabel(/^Комментарий/).fill(text);
    await d.getByRole('button', { name: submit, exact: true }).click();
  };
  const acceptBlocked = async () => {
    const d = await openDecision();
    assert.equal(await d.getByRole('radio', { name: 'Принять', exact: true }).isDisabled(), true, 'acceptance stays disabled while the gate is closed');
    await d.getByRole('button', { name: 'Отмена', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  };
  await prepareChange(await archive([['contract', 'ours'], ['added', 'ours']]));
  const firstReviewUrl = page.url();
  const contract = page.locator('section.managed-card').filter({ has: page.getByRole('heading', { name: 'contract', exact: true }) });
  await contract.getByRole('button', { name: 'Было и стало', exact: true }).click();
  await contract.getByRole('link', { name: 'Открыть код объекта', exact: true }).waitFor();
  await contract.getByText('Стало', { exact: true }).waitFor();
  const editorUrl = await contract.getByRole('link', { name: 'Открыть код объекта', exact: true }).getAttribute('href');
  const editor = await context.newPage(); editor.on('pageerror', error => errors.push(error.message));
  await editor.goto(base + editorUrl); await editor.waitForFunction(() => window.__workspace);
  assert.equal(await editor.locator('#back').textContent(), '← Решение');
  await editor.evaluate(() => window.__workspace.setValue('client.ts', 'const reviewed: number = 1;'));
  await editor.evaluate(() => window.__workspace.save());
  assert.equal(await editor.evaluate(() => window.__workspace.getState().audit.at(-1).actor.provider), 'local');
  await editor.locator('#check').click(); await editor.waitForFunction(() => window.__workspace.getState().check?.typescript === 'passed');
  await editor.close();
  // Empty text cannot submit; uploaded strings stay inert in the production renderer.
  await decide('Запросить доработку', 'Запросить доработку', '');
  assert.equal(await page.getByRole('heading', { name: 'Запрошена доработка', exact: true }).count(), 0);
  await dialog().getByRole('button', { name: 'Отмена', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  // An object-anchored comment still comes from the discussion entry; the decision dialog speaks about the whole version.
  const anchorKey = JSON.stringify(['widgets', 'synthetic.records', 'contract']);
  await page.getByLabel('К чему относится комментарий').selectOption(anchorKey);
  await page.getByLabel('Комментарий к изменению', { exact: true }).fill('Замечание к объекту <img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Комментарий', exact: true }).click();
  await page.getByRole('heading', { name: 'Комментарий', exact: true }).waitFor();
  await decide('Запросить доработку', 'Запросить доработку', 'Нужна причина возврата <img src=x onerror=alert(1)>');
  await page.getByRole('heading', { name: 'Запрошена доработка', exact: true }).waitFor();
  const assertFollowupSeparation = async () => {
    const correction = await page.getByRole('link', { name: 'Добавить исправление', exact: true }).boundingBox();
    const another = await page.getByRole('link', { name: 'Загрузить другую версию', exact: true }).boundingBox();
    assert.ok(correction && another && (another.x >= correction.x + correction.width + 8 ||
      another.y >= correction.y + correction.height + 8), 'correction and another-version actions remain visually separate');
  };
  await assertFollowupSeparation();
  await page.setViewportSize({ width: 390, height: 844 }); await assertFollowupSeparation();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await acceptBlocked();
  assert.equal(await page.locator('.change-discussion img').count(), 0);
  await page.screenshot({ path: 'qa/managed-review-findings.png', fullPage: true });
  await page.getByRole('link', { name: 'Добавить исправление', exact: true }).click();
  await page.getByLabel('Ответственная команда', { exact: true }).fill('Внутренняя команда');
  await page.getByLabel('Что изменили', { exact: true }).fill('SYNTHETIC-1');
  await upload(await archive([['contract', 'corrected'], ['added', 'ours']]));
  await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
  await page.getByText(/Объект изменился; исходная ссылка сохранена/).waitFor();
  const correctedReviewUrl = page.url();
  await page.getByText('Ответить или изменить статус', { exact: true }).last().click();
  await page.getByLabel('Что исправлено или что ещё нужно изменить', { exact: true }).fill('Причина добавлена в исправленный экспорт.');
  await page.getByRole('button', { name: 'Замечание устранено', exact: true }).click();
  await page.getByRole('heading', { name: 'Замечание устранено', exact: true }).waitFor();
  await page.goto(firstReviewUrl);
  await page.getByRole('link', { name: 'Открыть актуальное изменение', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Комментарий к изменению', { exact: true }).count(), 0);
  await page.goto(correctedReviewUrl);
  await acceptBlocked();
  await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Решение по версии', exact: true }).focus(); await page.keyboard.press('Enter');
  await dialog().waitFor(); assert.equal(await dialog().getByRole('radio', { name: 'Принять', exact: true }).isChecked(), true, 'acceptance is the default once the gate opens');
  await dialog().getByRole('button', { name: 'Принять изменение', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor(); evidence.keyboard = true;
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1', 'focus returns to workspace context after acceptance');
  await page.goto(correctedReviewUrl); await page.locator('.managed-accepted').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).count(), 0);
  await page.screenshot({ path: 'qa/managed-review-accepted.png', fullPage: true });
  await page.goto(workspaceUrl);
  await page.getByRole('link', { name: 'Экраны и данные', exact: true }).click();
  await page.getByRole('heading', { name: 'Текущее состояние · 3 объектов', exact: true }).waitFor();
  // UX-06: search by name or code keeps the grouping and announces the count.
  await page.getByLabel('Поиск по названию или коду', { exact: true }).fill('contract');
  await page.getByText('1 объектов', { exact: true }).waitFor();
  assert.equal(await page.locator('.managed-screens .managed-card:not([hidden])').count(), 1, 'search narrows the screens');
  await page.getByLabel('Поиск по названию или коду', { exact: true }).fill('нет такого');
  await page.getByText('Ничего не найдено', { exact: true }).waitFor();
  await page.getByLabel('Поиск по названию или коду', { exact: true }).fill('');
  await page.getByRole('link', { name: 'Обновить', exact: true }).click();
  await upload(await archive([['contract', 'vendor'], ['untouched', 'base'], ['added', 'ours']]), true);
  await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
  await page.getByRole('heading', { name: 'Рассмотреть обновление версии', exact: true }).waitFor();
  await acceptBlocked();
  await page.screenshot({ path: 'qa/managed-conflict-desktop.png', fullPage: true });
  await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
  await decide(null, 'Принять версию', 'Оставлена наша версия договора');
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  let state = await (await context.request.get(`${base}/api/solutions/${id}`)).json();
  assert.equal(state.reconciliations.length, 1); assert.equal(state.current.find(row => row.code === 'untouched').team, 'Поставщик');
  assert.equal(state.current.find(row => row.code === 'contract').team, 'Внутренняя команда');
  assert.equal(state.current.find(row => row.code === 'added').team, 'Поставщик');
  for (const size of [{ width: 1920, height: 1080 }, { width: 800, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `qa/managed-overview-${size.width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(node => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width })));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow at ' + size.width + ': ' + JSON.stringify(overflow));
    evidence.viewports.push(size);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('summary', { hasText: 'В архив' }).click();
  await page.getByLabel('Убрать из активных; сохранить снимки, изменения и историю', { exact: true }).check();
  await page.getByRole('button', { name: 'В архив', exact: true }).click();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).waitFor();
  await page.locator('.managed-nav').getByRole('link', { name: 'Решения', exact: true }).click();
  await page.getByRole('heading', { name: 'Решений пока нет' }).waitFor();
  await page.getByRole('link', { name: 'Архив', exact: true }).click(); await page.getByRole('link', { name: 'Открыть архив', exact: true }).click();
  await page.getByLabel('Возобновить работу с сохранённой базой и историей', { exact: true }).check();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).click();
  await page.getByRole('link', { name: 'Обновить', exact: true }).waitFor(); evidence.lifecycle = true;
  await prepareChange(await archive([['second', 'pending']]));
  const staleUrl = page.url(), originalState = await (await context.request.get(`${base}/api/solutions/${id}`)).json();
  await context.request.post(`${base}/api/solutions/${id}/archive`, { headers: { 'X-Elma-Wiki-Request': '1' }, data: { archived: true, expectedRevision: originalState.revision } });
  await decide(null, 'Принять изменение');
  await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).isDisabled(), true, 'a refused decision locks the page until the state is refreshed'); evidence.stale = true;
  await page.goto(staleUrl); await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  await page.route('**/api/solutions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Учебный сбой загрузки' }) }));
  await page.goto(base + '/solutions'); await page.getByRole('link', { name: 'Повторить загрузку', exact: true }).waitFor();
  await page.unroute('**/api/solutions'); await page.getByRole('link', { name: 'Повторить загрузку', exact: true }).click();
  await page.getByRole('heading', { name: 'Решений пока нет' }).waitFor(); evidence.recovery = true;

  // The real captured process API and the production renderer, with an explicit
  // whole-file choice after identifying an exact cross-team element conflict.
  const processRaw = { process: { items: { y: { id: 'y', name: 'Проверить договор', condition: 'baseline' } }, transitions: {}, lanes: {} }, context: [] };
  const processArchive = raw => zip([['package.json', { code: 'synthetic_process', type: 'SOLUTION' }],
    ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic', kind: 'PROCESS', path: 'approval.json' }] }], ['processor/approval.json', raw]]);
  const jsonPost = async (route, data) => { const response = await context.request.post(base + route, { headers: { 'X-Elma-Wiki-Request': '1' }, data }); assert.ok(response.ok(), await response.text()); return response.json(); };
  const processSnapshot = async (raw, scope) => {
    const response = await context.request.post(base + '/api/solutions/uploads?sharedConfirmed=true', { headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, data: await processArchive(raw) });
    assert.equal(response.status(), 201); const project = await response.json();
    return { projectId: project.id, snapshotId: project.currentSnapshotId, scope, scopeConfirmed: true };
  };
  let processState = await jsonPost('/api/solutions', { name: 'Учебный процесс', baselineOwner: 'Korus', snapshot: await processSnapshot(processRaw, 'full'), sharedConfirmed: true });
  const processRoute = '/api/solutions/' + processState.id;
  const prepareProcess = async (raw, kind, team = 'Internal') => {
    const review = await jsonPost(processRoute + '/prepare', { kind, snapshot: await processSnapshot(raw, kind === 'change' ? 'partial' : 'full'), expectedRevision: processState.revision,
      sameSourceConfirmed: true, ...(kind === 'change' ? { team, taskRef: 'TASK-31' } : { baselineOwner: team }) });
    await page.goto(base + '/solutions?' + new URLSearchParams({ id: processState.id, view: 'review', artifact: review.artifactId }));
    await page.getByRole('heading', { name: 'Ответственность частей процесса', exact: true }).waitFor(); return review;
  };
  const additions = structuredClone(processRaw); additions.process.items.x = { id: 'x', name: 'Дополнительное согласование' };
  additions.context.push({ code: 'one', type: 'STRING' }, { code: 'two', type: 'BOOLEAN' });
  await prepareProcess(additions, 'change'); assert.equal(await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).count(), 0);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать отчёт об ответственности', exact: true }).click();
  const download = await downloadPromise, report = await fs.readFile(await download.path(), 'utf8'); assert.match(report, /Korus/); assert.match(report, /Internal/);
  assert.match(report, /авторы публикаций ELMA.*не установлены/);
  await decide(null, 'Принять изменение');
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor();
  processState = await (await context.request.get(base + processRoute)).json();
  assert.equal(processState.current[0].responsibility.elements.find(part => part.code === 'y').team, 'Korus');
  assert.equal(processState.current[0].responsibility.elements.find(part => part.code === 'x').team, 'Internal');
  // UX-06: processes live on Как работает with their responsibility and open the diagram there.
  await page.getByRole('link', { name: 'Как работает', exact: true }).click(); await page.getByText('Internal: 3 · Korus: 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Посмотреть процесс: / }).first().click();
  await page.getByRole('img', { name: 'Схема процесса из экспорта', exact: true }).waitFor();
  await page.getByText(/^Кто выполняет: /).first().waitFor();
  // UX-07: a request from the selected step is saved privately with its step anchor, published
  // without GitHub as `unconfigured`, listed on Запросы with its chip on the process card,
  // commented and moved to В работе.
  await page.locator('.visual-form').getByRole('button', { name: 'Запросить изменение', exact: true }).click();
  const requestDialog = page.locator('dialog.managed-request');
  await requestDialog.getByText(/^Шаг: .* · шаг назван в тексте запроса$/).waitFor();
  assert.match(await requestDialog.getByLabel('Что должно быть', { exact: true }).inputValue(), /^Шаг «.*»: $/);
  assert.equal(await requestDialog.getByRole('radio', { name: 'Процесс', exact: true }).isChecked(), true);
  await requestDialog.getByLabel('Кратко', { exact: true }).fill('Учебный запрос со шага');
  await requestDialog.getByLabel('Что должно быть', { exact: true }).fill('На этом шаге нужна подсказка о сроке.');
  await requestDialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await requestDialog.getByText('Запрос сохранён в Wiki', { exact: true }).waitFor();
  const requestList = await (await context.request.get(base + processRoute + '/change-requests')).json();
  assert.equal(requestList.requests.length, 1); assert.equal(requestList.requests[0].target.sourceAnchor, undefined, 'an unsupported step is named in the text, not anchored');
  assert.equal(requestList.requests[0].target.anchor.key, JSON.stringify(['processor', 'synthetic', 'approval'])); assert.equal(requestList.requests[0].anchorStatus, 'current');
  await requestDialog.getByRole('checkbox').check();
  await requestDialog.getByRole('button', { name: 'Отправить в GitHub', exact: true }).click();
  await requestDialog.getByText('Сохранён в Wiki. Отправка в GitHub не настроена', { exact: true }).waitFor();
  await requestDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload(); await page.locator('.managed-flows').getByText('Запрос · 1', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Запросы', exact: true }).click();
  await page.getByRole('link', { name: 'Учебный запрос со шага', exact: true }).click();
  await page.getByRole('heading', { name: 'Учебный запрос со шага', exact: true }).waitFor();
  await page.getByText('Сохранён в Wiki. Отправка в GitHub не настроена', { exact: true }).waitFor();
  await page.getByLabel('Комментарий', { exact: true }).fill('Учебный комментарий');
  await page.getByRole('button', { name: 'Добавить комментарий', exact: true }).click();
  await page.getByText(/Учебный комментарий$/).waitFor();
  await page.getByLabel('Изменить состояние', { exact: true }).selectOption('in-progress');
  await page.getByRole('button', { name: 'Сохранить состояние', exact: true }).click();
  await page.getByText(/Состояние изменено: В работе/).waitFor();
  assert.equal((await (await context.request.get(base + processRoute + '/change-requests')).json()).requests[0].version, 2);
  // UX-07 field anchor: a request from a uniquely declared field of a captured screen is
  // anchored to that field by the server and marks the field row with its chip.
  const screenArchive = zip([['package.json', { code: 'synthetic_screens', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'card', namespace: 'synthetic', kind: 'WIDGET', name: 'Учебная заявка', path: 'card.json' }] }],
    ['widgets/card.json', { descriptor: { fields: [{ code: 'amount', view: { name: 'Сумма' }, type: 'MONEY', required: true }, { code: 'note', name: 'Примечание', type: 'STRING' }] } }]]);
  const screenUpload = await context.request.post(base + '/api/solutions/uploads?sharedConfirmed=true', { headers: { 'X-Elma-Wiki-Request': '1', 'Content-Type': 'application/octet-stream' }, data: await screenArchive });
  assert.equal(screenUpload.status(), 201); const screenProject = await screenUpload.json();
  const screenState = await jsonPost('/api/solutions', { name: 'Учебные экраны', baselineOwner: 'Korus', sharedConfirmed: true,
    snapshot: { projectId: screenProject.id, snapshotId: screenProject.currentSnapshotId, scope: 'full', scopeConfirmed: true } });
  await page.goto(base + '/solutions?' + new URLSearchParams({ id: screenState.id, view: 'solution' }));
  await page.locator('summary', { hasText: 'Поля · 2' }).click();
  await page.getByRole('button', { name: 'Запросить изменение: Сумма', exact: true }).click();
  await requestDialog.getByText('Поле: Сумма · запрос привязан к полю', { exact: true }).waitFor();
  assert.equal(await requestDialog.getByLabel('Что должно быть', { exact: true }).inputValue(), '', 'an anchored field is not repeated in the text');
  await requestDialog.getByLabel('Кратко', { exact: true }).fill('Учебный запрос с поля');
  await requestDialog.getByLabel('Что должно быть', { exact: true }).fill('Сумма должна показываться с валютой.');
  await requestDialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await requestDialog.getByText('Запрос сохранён в Wiki', { exact: true }).waitFor();
  const fieldRequest = (await (await context.request.get(base + '/api/solutions/' + screenState.id + '/change-requests')).json()).requests[0];
  assert.equal(fieldRequest.target.fieldAnchor.code, 'amount'); assert.equal(fieldRequest.target.fieldAnchor.name, 'Сумма');
  assert.equal(fieldRequest.target.fieldAnchor.pointer, 'widgets/card.json#/descriptor/fields/0'); assert.equal(fieldRequest.anchorStatus, 'current');
  await requestDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload(); await page.locator('summary', { hasText: 'Поля · 2' }).click();
  assert.equal(await page.locator('.managed-screens table tr', { hasText: 'Сумма' }).getByText('Запрос · 1', { exact: true }).count(), 1, 'the field row carries its chip');
  assert.equal(await page.locator('.managed-screens table tr', { hasText: 'Примечание' }).getByText(/^Запрос · /).count(), 0);
  await page.getByRole('link', { name: 'Запросы', exact: true }).click();
  await page.locator('.managed-requests table tr', { hasText: 'Учебный запрос с поля' }).getByText(/Поле: Сумма · amount/).waitFor();
  await page.screenshot({ path: 'qa/managed-request-field.png', fullPage: true });
  await page.goto(base + '/solutions?' + new URLSearchParams({ id: processState.id, view: 'flows' }));
  const boundary = structuredClone(additions); boundary.process.items.y.condition = 'reviewed edit';
  await prepareProcess(boundary, 'change'); await acceptBlocked();
  await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).check();
  await decide(null, 'Принять изменение');
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor(); processState = await (await context.request.get(base + processRoute)).json();
  const overlap = structuredClone(boundary); overlap.process.items.x.name = 'Korus изменил шаг';
  await prepareProcess(overlap, 'change', 'Korus');
  await acceptBlocked(); await page.getByText(/конфликт команд/).waitFor();
  await page.screenshot({ path: 'qa/managed-elements-overlap.png', fullPage: true });
  await prepareProcess(overlap, 'reconciliation', 'Korus'); await acceptBlocked();
  await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
  await decide(null, 'Принять версию'); await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor();
  processState = await (await context.request.get(base + processRoute)).json(); assert.equal(processState.current[0].responsibility.elements.find(part => part.code === 'x').team, 'Internal');
  evidence.elementResponsibility = true;

  const storyRoot = path.resolve('storybook/storybook-static'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  stories = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname, file = path.resolve(storyRoot, '.' + pathname);
      if (!file.startsWith(storyRoot + path.sep)) { res.writeHead(404); res.end(); return; }
      const bytes = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => stories.listen(0, '127.0.0.1', resolve));
  const storyModes = ['empty','list','create','overview','pending','change','review','conflict','overlap','ambiguous','stale','archived','loading','load-error','changes','solution','no-source','needs-fixes','pending-conflict','review-comment','review-findings','review-resolved','review-accepted','review-stale-anchor','review-removed-anchor','review-ambiguous-anchor','elements-added','elements-boundary','elements-conflict','elements-unknown','create-legacy','pull-exporting','pull-ready','pull-failed','pull-unavailable','update','summary-mixed','summary-no-changes','summary-closed','decision','viewed-marked','viewed-changed','viewed-second-actor','lifecycle-build','lifecycle-verified','lifecycle-synthetic','about-empty','about-generated','about-saved','about-stale','about-error','flows','flows-error','flows-unknown','screens','requests','requests-empty','requests-object','requests-error','request-form','request-form-field','request-record','request-published'];
  for (const mode of storyModes) {
    await page.goto(`http://127.0.0.1:${stories.address().port}/iframe.html?id=managed-workspace--${mode}&viewMode=story`);
    await page.locator('.managed-shell h1').waitFor();
    if (['review','conflict','overlap','ambiguous'].includes(mode)) await acceptBlocked();
    if (mode === 'conflict') {
      await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
      const d = await openDecision(); assert.equal(await d.getByRole('radio', { name: 'Принять', exact: true }).isDisabled(), false);
      assert.equal(await d.getByRole('button', { name: 'Принять версию', exact: true }).isVisible(), true); await d.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
    if (mode === 'decision') { await dialog().waitFor(); assert.equal(await dialog().getByRole('radio', { name: 'Принять', exact: true }).isDisabled(), true); assert.equal(await dialog().getByRole('radio', { name: 'Запросить доработку', exact: true }).isChecked(), true); }
    // UX-08: header progress counts only the actor's current marks; a changed object loses its mark and says so.
    if (mode.startsWith('viewed-')) {
      const progress = page.locator('.managed-viewed-progress');
      assert.equal(await progress.textContent(), mode === 'viewed-marked' ? 'Просмотрено · 2 из 4' : 'Просмотрено · 1 из 4');
      assert.equal(await page.locator('.managed-viewed-changed:visible').count(), mode === 'viewed-changed' ? 1 : 0);
      const marks = page.getByRole('checkbox', { name: 'Просмотрено', exact: true });
      assert.equal(await marks.count(), 4);
      if (mode === 'viewed-changed') {
        await page.locator('.managed-card', { has: page.locator('.managed-viewed-changed:visible') }).getByRole('checkbox', { name: 'Просмотрено', exact: true }).check();
        await page.getByText('Просмотрено · 2 из 4', { exact: true }).waitFor(); assert.equal(await page.locator('.managed-viewed-changed:visible').count(), 0);
      }
      if (mode === 'viewed-marked') { await marks.first().uncheck(); await page.getByText('Просмотрено · 1 из 4', { exact: true }).waitFor(); await marks.first().check(); await page.getByText('Просмотрено · 2 из 4', { exact: true }).waitFor(); }
    }
    if (mode === 'summary-no-changes') { await page.getByRole('button', { name: 'Закрыть без изменений', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).count(), 0); }
    if (['lifecycle-build', 'lifecycle-verified', 'lifecycle-synthetic', 'overview', 'pending', 'archived'].includes(mode)) {
      // UX-04: six lifecycle steps, one current while active, unavailable steps carry a reason.
      const steps = page.getByRole('list', { name: 'Этапы решения', exact: true }).getByRole('listitem');
      assert.equal(await steps.count(), 6, 'six lifecycle steps: ' + mode);
      assert.equal(await page.locator('.managed-step[aria-current=step]').count(), mode === 'archived' ? 0 : 1, 'one current step: ' + mode);
      await page.getByText(/^Выпуск ещё не доступно$/).waitFor();
      if (mode === 'lifecycle-build') { await page.locator('.managed-step[aria-current=step]').getByText('Сборка', { exact: true }).waitFor(); await page.getByText('Принято', { exact: true }).first().waitFor(); }
      if (mode === 'overview') await page.locator('.managed-step[aria-disabled=true]').getByText('Сборка', { exact: true }).waitFor();
      if (mode === 'lifecycle-verified') assert.equal(await page.locator('.managed-step[data-state=done]').count(), 5);
      if (mode === 'lifecycle-synthetic') {
        // A training build: Сборка is done but named as such; Проверка is current with its next action.
        await page.locator('.managed-step[data-state=done]').filter({ hasText: 'Сборка' }).getByText('учебная сборка', { exact: true }).waitFor();
        await page.locator('.managed-step[aria-current=step]').getByText('Проверка', { exact: true }).waitFor();
        await page.getByRole('link', { name: 'Проверить конфигурацию', exact: true }).waitFor();
      }
      if (mode === 'pending') { await page.locator('.managed-step[aria-current=step]').getByText('Рассмотрение', { exact: true }).waitFor(); await page.getByText('Ожидает рассмотрения', { exact: true }).first().waitFor(); }
      if (mode === 'archived') await page.getByText('В архиве', { exact: true }).first().waitFor();
    }
    if (mode.startsWith('about-')) {
      // UX-05: empty, generated, saved, stale and failed purpose states; two distinct people in the activity list.
      await page.getByRole('heading', { name: 'Для чего', exact: true }).waitFor(); await page.getByRole('heading', { name: 'Модули', exact: true }).waitFor();
      const activity = page.getByRole('list', { name: 'Последние события', exact: true });
      await activity.getByText('Uploader', { exact: true }).waitFor(); assert.equal(await activity.getByText('Reviewer', { exact: true }).count(), 2);
      // A code-less module card is titled "Без модуля" and offers no Объяснить button; a real module does.
      const orphan = page.locator('.managed-about .managed-card').filter({ has: page.getByRole('heading', { name: 'Без модуля', exact: true }) });
      assert.equal(await orphan.count(), 1, 'one code-less module card: ' + mode); assert.equal(await orphan.getByRole('button', { name: 'Объяснить', exact: true }).count(), 0, 'no Explain for a code-less module');
      assert.equal(await page.locator('.managed-about .managed-card').filter({ has: page.getByRole('heading', { name: 'synthetic', exact: true }) }).getByRole('button', { name: 'Объяснить', exact: true }).count(), 1);
      if (mode === 'about-empty') { await page.getByText('Опишите, для чего это решение', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Написать', exact: true }).waitFor(); }
      if (mode === 'about-generated') { assert.match(await page.getByLabel('Описание решения', { exact: true }).inputValue(), /Решение объединяет модули/); assert.equal(await page.getByRole('button', { name: 'Сохранить описание', exact: true }).isDisabled(), false); }
      if (mode === 'about-saved') { await page.getByText(/^Командировки сотрудников/).first().waitFor(); await page.getByRole('button', { name: 'Изменить', exact: true }).waitFor(); assert.equal(await page.getByText('Состав решения изменился после сохранения. Проверьте описание.', { exact: true }).count(), 0); }
      if (mode === 'about-stale') await page.getByText('Состав решения изменился после сохранения. Проверьте описание.', { exact: true }).waitFor();
      if (mode === 'about-error') { await page.getByRole('alert').filter({ hasText: 'Описание не получено' }).waitFor(); await page.getByRole('button', { name: 'Написать', exact: true }).waitFor(); }
    }
    if (mode === 'flows') {
      await page.getByText(/^Задачи: /).waitFor();
      await page.getByLabel('Поиск по названию или коду', { exact: true }).fill('trip');
      assert.equal(await page.locator('.managed-flows .managed-card:not([hidden])').count(), 1);
      await page.getByLabel('Поиск по названию или коду', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Посмотреть процесс: trip_approval', exact: true }).click();
      await page.getByRole('img', { name: 'Схема процесса из экспорта', exact: true }).waitFor();
      await page.getByText('Кто выполняет: Согласующий', { exact: true }).first().waitFor();
      assert.equal(await page.locator('.visual-unsupported').count(), 0, 'a fully supported process has no unsupported list');
      await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'flows 390');
    }
    if (mode === 'flows-error') { await page.getByText(/^Схема не получена: /).first().waitFor(); }
    if (mode === 'flows') {
      // UX-07: the chip of the open request and the entry point on the captured process card.
      await page.locator('.managed-flows').getByText('Запрос · 1', { exact: true }).waitFor();
      assert.equal(await page.locator('.managed-flows .managed-card').getByRole('button', { name: 'Запросить изменение', exact: true }).count(), 1, 'one entry point per captured process card');
      assert.equal(await page.locator('.visual-form').getByRole('button', { name: 'Запросить изменение', exact: true }).count(), 1, 'and one on the selected step');
    }
    if (mode === 'screens') {
      // UX-07: a request from a field anchors to that field; the chips mark the screen and the field row.
      await page.locator('.managed-request-entry').getByText('Запрос · 1', { exact: true }).first().waitFor();
      await page.locator('summary', { hasText: 'Поля · 2' }).click();
      assert.equal(await page.locator('.managed-screens table tr', { hasText: 'Сумма' }).getByText('Запрос · 1', { exact: true }).count(), 1, 'field chip');
      assert.equal(await page.locator('.managed-screens table tr', { hasText: 'Номер' }).getByText(/^Запрос · /).count(), 0);
      await page.getByRole('button', { name: 'Запросить изменение: Сумма', exact: true }).click();
      const dialog = page.locator('dialog.managed-request');
      await dialog.getByText('Поле: Сумма · запрос привязан к полю', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('radio', { name: 'Экран', exact: true }).isChecked(), true);
      assert.equal(await dialog.getByLabel('Что должно быть', { exact: true }).inputValue(), '');
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      assert.equal(await dialog.evaluate(node => node.open), false);
      await page.locator('summary', { hasText: 'Поля · 2' }).click();
    }
    if (mode === 'requests') {
      await page.getByRole('heading', { name: 'Запросы', exact: true }).waitFor();
      assert.equal(await page.locator('.managed-requests tbody tr, .managed-requests table tr').count(), 5, 'header plus four requests');
      for (const text of ['Новый', 'В работе', 'Выполнен', 'Отклонён', 'Срочно', 'Объект изменился после запроса', 'Всё решение']) await page.getByText(text, { exact: true }).first().waitFor();
      assert.match(await page.locator('.managed-requests table tr', { hasText: 'Сумма обязательна' }).innerText(), /Поле: Сумма · amount/, 'a field request names its field under Где');
      assert.match(await page.locator('.managed-requests table tr').nth(1).innerText(), /^Показывать сумму до утверждения/, 'newest first');
      await page.getByRole('button', { name: 'Новый запрос', exact: true }).click();
      const dialog = page.locator('dialog.managed-request');
      await dialog.getByText('Что изменить', { exact: true }).waitFor();
      await dialog.getByLabel('Кратко', { exact: true }).fill('Учебный запрос');
      await dialog.getByLabel('Что должно быть', { exact: true }).fill('Учебное описание.');
      await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
      await dialog.getByText('Запрос сохранён в Wiki', { exact: true }).waitFor();
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Отправить в GitHub', exact: true }).click();
      await dialog.getByText('Сохранён в Wiki. Отправка в GitHub не настроена', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await page.getByRole('link', { name: 'Учебный запрос', exact: true }).waitFor();
    }
    if (mode === 'requests-empty') await page.getByText('Запросов пока нет', { exact: true }).waitFor();
    if (mode === 'requests-object') { await page.getByText(/^Запросы по объекту: Утверждение командировки/).waitFor(); assert.equal(await page.locator('.managed-requests table tr').count(), 2); }
    if (mode === 'requests-error') { await page.getByRole('alert').filter({ hasText: 'Запросы не получены' }).waitFor(); }
    if (mode === 'request-form') {
      const dialog = page.locator('dialog.managed-request');
      await dialog.getByText('Шаг: Проверить бюджет · шаг выбран на схеме', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('radio', { name: 'Процесс', exact: true }).isChecked(), true);
      assert.match(await dialog.getByLabel('Где', { exact: true }).inputValue(), /trip_approval/);
      // Choosing another object drops the step; choosing the object back restores it.
      await dialog.getByLabel('Где', { exact: true }).selectOption({ label: 'Заявка на командировку · contract' });
      assert.equal(await dialog.getByText(/^Шаг: /).count(), 0);
      await dialog.getByLabel('Где', { exact: true }).selectOption(JSON.stringify(['processor', 'travel_expenses.trips', 'template', 'trip_approval']));
      await dialog.getByText(/^Шаг: /).waitFor();
    }
    if (mode === 'request-form-field') {
      const dialog = page.locator('dialog.managed-request');
      await dialog.getByText('Поле: Сумма · запрос привязан к полю', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('radio', { name: 'Экран', exact: true }).isChecked(), true);
      assert.equal(await dialog.getByLabel('Что должно быть', { exact: true }).inputValue(), '');
      // Choosing another object drops the field; choosing the object back restores it.
      await dialog.getByLabel('Где', { exact: true }).selectOption(JSON.stringify(['processor', 'travel_expenses.trips', 'template', 'trip_approval']));
      assert.equal(await dialog.getByText(/^Поле: /).count(), 0);
      await dialog.getByLabel('Где', { exact: true }).selectOption(JSON.stringify(['widgets', 'synthetic.records', 'contract']));
      await dialog.getByText('Поле: Сумма · запрос привязан к полю', { exact: true }).waitFor();
      await dialog.getByLabel('Кратко', { exact: true }).fill('Учебный запрос с поля');
      await dialog.getByLabel('Что должно быть', { exact: true }).fill('Сумма с валютой.');
      await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
      await dialog.getByText('Запрос сохранён в Wiki', { exact: true }).waitFor();
    }
    if (mode === 'request-record') {
      await page.getByRole('heading', { name: 'Показывать сумму до утверждения', exact: true }).waitFor();
      for (const text of ['Срочно', 'История запроса', 'Записей пока нет', 'Добавить комментарий', 'Сохранить состояние', 'Отправить в GitHub']) await page.getByText(text, { exact: true }).first().waitFor();
      await page.getByText(/^Где: /).first().waitFor(); await page.getByText('review', { exact: true }).first().waitFor();
      assert.equal(await page.getByLabel('Версия, в которой выполнено', { exact: true }).isVisible(), false);
      await page.getByLabel('Изменить состояние', { exact: true }).selectOption('done');
      await page.getByLabel('Версия, в которой выполнено', { exact: true }).waitFor();
    }
    if (mode === 'request-published') { await page.getByText('Отправлен в GitHub', { exact: true }).waitFor(); await page.getByRole('link', { name: 'Открыть GitHub issue #85', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Отправить в GitHub', exact: true }).count(), 0); }
    if (mode === 'flows-unknown') {
      // An unsupported lane and node: who does it is unknown, and the unsupported items are one collapsed list with a count.
      await page.getByRole('button', { name: 'Посмотреть процесс: trip_approval', exact: true }).click();
      await page.getByRole('img', { name: 'Схема процесса из экспорта', exact: true }).waitFor();
      await page.getByText('Кто выполняет: дорожка не указана', { exact: true }).first().waitFor();
      const unsupported = page.locator('.visual-unsupported > summary'); await unsupported.waitFor();
      assert.match(await unsupported.innerText(), /^Не поддерживается · [1-9]\d*$/);
      assert.equal(await page.locator('.visual-unsupported[open]').count(), 0, 'the list is collapsed by default');
    }
    if (mode === 'screens') {
      await page.locator('summary', { hasText: 'Поля · 2' }).click();
      await page.getByRole('cell', { name: 'Сумма', exact: true }).waitFor();
      await page.getByText('Поля не восстановлены из экспорта', { exact: true }).first().waitFor();
      assert.equal(await page.getByRole('heading', { name: /^Объекты решения · \d+$/ }).innerText(), 'Объекты решения · 8', 'processes are not counted among screens and data');
      assert.equal(await page.locator('.managed-screens').getByRole('heading', { name: /^Процессы · / }).count(), 0, 'processes are not listed among screens');
      await page.getByRole('link', { name: /^Как работает · 1$/ }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'screens 390');
    }
    if (mode === 'summary-closed') { await page.getByText(/^Закрыто без изменений:/).waitFor(); assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).count(), 0); }
    if (!mode.startsWith('review-') && !mode.startsWith('elements-') && !['create','create-legacy','update','change','review','conflict','overlap','ambiguous','archived','loading','summary-mixed','summary-no-changes','summary-closed','decision'].includes(mode) && !mode.startsWith('pull-') && !mode.startsWith('viewed-')) assert.equal(await page.locator('.managed-content a.button').count(), 1, 'one primary action: ' + mode);
    if (mode === 'create') { assert.equal(await page.getByRole('button', { name: 'Загрузить', exact: true }).count(), 1, 'one button on the fixed entry'); assert.equal(await page.getByLabel('Это полный экспорт решения', { exact: true }).count(), 0); }
    if (mode === 'update') { await page.getByRole('button', { name: 'Обновить', exact: true }).waitFor(); assert.equal(await page.getByLabel('Сервер', { exact: true }).isDisabled(), true); }
    if (mode === 'pull-unavailable') assert.equal(await page.getByRole('button', { name: 'Загрузить', exact: true }).isDisabled(), true);
    if (mode.startsWith('elements-')) { await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('heading', { name: 'Ответственность частей процесса', exact: true }).waitFor(); }
    if (mode.startsWith('review-')) {
      await page.setViewportSize({ width: 390, height: 844 });
      if (mode === 'review-accepted') assert.equal(await page.getByRole('button', { name: 'Решение по версии', exact: true }).count(), 0);
      else if (!['review-comment','review-resolved'].includes(mode)) await acceptBlocked();
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode);
    await page.screenshot({ path: `qa/managed-story-${mode}.png`, fullPage: true }); evidence.states.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log(`Solution: synthetic Change discussion/correction/acceptance, contextual editor, element responsibility/report, boundary/conflict decisions, archive/reopen, keyboard, responsive, stale/retry and all ${storyModes.length} shared Storybook states passed.`);
} finally {
  await fs.mkdir('qa', { recursive: true }); await fs.writeFile('qa/managed-browser-evidence.json', JSON.stringify(evidence, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  if (stories) await new Promise(resolve => stories.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

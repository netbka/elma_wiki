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
  await page.getByRole('link', { name: 'Добавить решение', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Добавить решение', exact: true }).waitFor();
  await page.getByLabel('Название решения', { exact: true }).fill('Учебные договоры');
  await page.getByLabel('Кто отвечает за исходную версию', { exact: true }).fill('Поставщик');
  const baseBytes = await archive([['contract', 'base'], ['untouched', 'base']]);
  const upload = async (bytes, full = false) => {
    await page.getByLabel('Файл .e365', { exact: true }).setInputFiles({ name: 'synthetic.e365', mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByLabel(full ? 'Это полный экспорт решения' : 'Это частичный экспорт изменений', { exact: true }).check();
    await page.getByLabel('Файл доступен всем пользователям сервиса', { exact: true }).check();
  };
  await upload(baseBytes, true);
  await page.getByRole('button', { name: 'Добавить решение', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания' }).waitFor();
  const workspaceUrl = page.url(), id = new URL(workspaceUrl).searchParams.get('id'); assert.ok(id);
  const prepareChange = async bytes => {
    await page.goto(workspaceUrl); await page.getByRole('link', { name: 'Добавить изменение', exact: true }).click();
    await page.getByLabel('Ответственная команда', { exact: true }).fill('Внутренняя команда');
    await page.getByLabel('Что изменили', { exact: true }).fill('SYNTHETIC-1');
    await upload(bytes);
    await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
    await page.getByRole('heading', { name: 'Рассмотреть изменение', exact: true }).waitFor();
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
  await page.getByRole('button', { name: 'Нужны изменения', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Нужны изменения', exact: true }).count(), 0);
  const anchorKey = JSON.stringify(['widgets', 'synthetic.records', 'contract']);
  await page.getByLabel('К чему относится комментарий').selectOption(anchorKey);
  await page.getByLabel('Комментарий к изменению', { exact: true }).fill('Нужна причина возврата <img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Нужны изменения', exact: true }).click();
  await page.getByRole('heading', { name: 'Нужны изменения', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isVisible(), false);
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
  await page.getByText('Ответить или изменить статус', { exact: true }).click();
  await page.getByLabel('Что исправлено или что ещё нужно изменить', { exact: true }).fill('Причина добавлена в исправленный экспорт.');
  await page.getByRole('button', { name: 'Замечание устранено', exact: true }).click();
  await page.getByRole('heading', { name: 'Замечание устранено', exact: true }).waitFor();
  await page.goto(firstReviewUrl);
  await page.getByRole('link', { name: 'Открыть актуальное изменение', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Комментарий к изменению', { exact: true }).count(), 0);
  await page.goto(correctedReviewUrl);
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true);
  await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).focus(); await page.keyboard.press('Space');
  await page.getByLabel('Принимаю рассмотренное изменение', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять изменение', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor(); evidence.keyboard = true;
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1', 'focus returns to workspace context after acceptance');
  await page.goto(correctedReviewUrl); await page.locator('.managed-accepted').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).count(), 0);
  await page.screenshot({ path: 'qa/managed-review-accepted.png', fullPage: true });
  await page.goto(workspaceUrl);
  await page.getByRole('link', { name: 'Решение', exact: true }).click();
  await page.getByRole('heading', { name: 'Текущее состояние · 3 объектов', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Обновить версию', exact: true }).click();
  await upload(await archive([['contract', 'vendor'], ['untouched', 'base'], ['added', 'ours']]), true);
  await page.getByLabel('Экспорт относится к этому решению и тому же источнику ELMA', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить и рассмотреть', exact: true }).click();
  await page.getByRole('heading', { name: 'Рассмотреть обновление версии', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять версию', exact: true }).isDisabled(), true);
  await page.screenshot({ path: 'qa/managed-conflict-desktop.png', fullPage: true });
  await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
  await page.getByLabel('Принимаю версию и выбранные решения; установка в ELMA не выполняется', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять версию', exact: true }).click();
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
  await page.getByText('Архивировать решение', { exact: true }).click();
  await page.getByLabel('Убрать из активных; сохранить снимки, изменения и историю', { exact: true }).check();
  await page.getByRole('button', { name: 'В архив', exact: true }).click();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).waitFor();
  await page.locator('.managed-nav').getByRole('link', { name: 'Решения', exact: true }).click();
  await page.getByRole('heading', { name: 'Решений пока нет' }).waitFor();
  await page.getByRole('link', { name: 'Архив', exact: true }).click(); await page.getByRole('link', { name: 'Открыть архив', exact: true }).click();
  await page.getByLabel('Возобновить работу с сохранённой базой и историей', { exact: true }).check();
  await page.getByRole('button', { name: 'Возобновить работу', exact: true }).click();
  await page.getByRole('link', { name: 'Добавить изменение', exact: true }).waitFor(); evidence.lifecycle = true;
  await prepareChange(await archive([['second', 'pending']]));
  const staleUrl = page.url(), originalState = await (await context.request.get(`${base}/api/solutions/${id}`)).json();
  await context.request.post(`${base}/api/solutions/${id}/archive`, { headers: { 'X-Elma-Wiki-Request': '1' }, data: { archived: true, expectedRevision: originalState.revision } });
  await page.getByLabel('Принимаю рассмотренное изменение', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByRole('link', { name: 'Обновить состояние', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true); evidence.stale = true;
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
  await page.getByLabel('Принимаю рассмотренное изменение', { exact: true }).check(); await page.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor();
  processState = await (await context.request.get(base + processRoute)).json();
  assert.equal(processState.current[0].responsibility.elements.find(part => part.code === 'y').team, 'Korus');
  assert.equal(processState.current[0].responsibility.elements.find(part => part.code === 'x').team, 'Internal');
  await page.getByRole('link', { name: 'Решение', exact: true }).click(); await page.getByText('Internal: 3 · Korus: 1', { exact: true }).waitFor();
  const boundary = structuredClone(additions); boundary.process.items.y.condition = 'reviewed edit';
  await prepareProcess(boundary, 'change'); assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true);
  await page.getByLabel('Изменение принятого объекта проверено', { exact: true }).check();
  await page.getByLabel('Принимаю рассмотренное изменение', { exact: true }).check(); await page.getByRole('button', { name: 'Принять изменение', exact: true }).click();
  await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor(); processState = await (await context.request.get(base + processRoute)).json();
  const overlap = structuredClone(boundary); overlap.process.items.x.name = 'Korus изменил шаг';
  await prepareProcess(overlap, 'change', 'Korus');
  assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isDisabled(), true); await page.getByText(/конфликт команд/).waitFor();
  await page.screenshot({ path: 'qa/managed-elements-overlap.png', fullPage: true });
  await prepareProcess(overlap, 'reconciliation', 'Korus'); assert.equal(await page.getByRole('button', { name: 'Принять версию', exact: true }).isDisabled(), true);
  await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working');
  await page.getByLabel('Принимаю версию и выбранные решения; установка в ELMA не выполняется', { exact: true }).check();
  await page.getByRole('button', { name: 'Принять версию', exact: true }).click(); await page.getByRole('heading', { name: 'Что требует внимания', exact: true }).waitFor();
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
  for (const mode of ['empty','list','create','overview','pending','change','review','conflict','overlap','ambiguous','stale','archived','loading','load-error','changes','solution','no-source','needs-fixes','pending-conflict','review-comment','review-findings','review-resolved','review-accepted','review-stale-anchor','review-removed-anchor','review-ambiguous-anchor','elements-added','elements-boundary','elements-conflict','elements-unknown']) {
    await page.goto(`http://127.0.0.1:${stories.address().port}/iframe.html?id=managed-workspace--${mode}&viewMode=story`);
    await page.locator('.managed-shell h1').waitFor();
    if (['review','conflict','overlap','ambiguous'].includes(mode)) assert.equal(await page.getByRole('button', { name: mode === 'conflict' ? 'Принять версию' : 'Принять изменение', exact: true }).isDisabled(), true, mode);
    if (mode === 'conflict') { await page.getByLabel('Какую версию сохранить', { exact: true }).selectOption('keep-working'); assert.equal(await page.getByRole('button', { name: 'Принять версию', exact: true }).isDisabled(), false); }
    if (!mode.startsWith('review-') && !mode.startsWith('elements-') && !['create','change','review','conflict','overlap','ambiguous','archived','loading'].includes(mode)) assert.equal(await page.locator('.managed-content a.button').count(), 1, 'one primary action: ' + mode);
    if (mode.startsWith('elements-')) { await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('heading', { name: 'Ответственность частей процесса', exact: true }).waitFor(); }
    if (mode.startsWith('review-')) {
      await page.setViewportSize({ width: 390, height: 844 });
      if (!['review-comment','review-resolved'].includes(mode)) assert.equal(await page.getByRole('button', { name: 'Принять изменение', exact: true }).isVisible().catch(() => false), false);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode);
    await page.screenshot({ path: `qa/managed-story-${mode}.png`, fullPage: true }); evidence.states.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log('Solution: synthetic Change discussion/correction/acceptance, contextual editor, element responsibility/report, boundary/conflict decisions, archive/reopen, keyboard, responsive, stale/retry and all 30 shared Storybook states passed.');
} finally {
  await fs.mkdir('qa', { recursive: true }); await fs.writeFile('qa/managed-browser-evidence.json', JSON.stringify(evidence, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  if (stories) await new Promise(resolve => stories.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

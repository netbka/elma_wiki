const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
import { mountDependencies } from './dependencies.js';
import { actions as actionLabels, nouns, loading, pull } from './labels.js';
let sequence = 0;

// Named Source connections created by the acquisition API are `config-api-<server>`.
export const serverFromConnection = connectionId => typeof connectionId === 'string' && connectionId.startsWith('config-api-') ? connectionId.slice('config-api-'.length) : null;
export const PULL_SERVERS = [['dev', pull.serverNames.dev], ['dev2', pull.serverNames.dev2]];

// UX-01: the one fixed entry. Choose a server and a solution, pull the entire
// solution, continue with the captured full snapshot. No scope, Source, base or
// responsibility question: the server records them from the named connection.
// `source` fixes server and solution for an update of an existing Solution.
export function mountSolutionPull(actions = {}, model = {}, onReady = async () => {}) {
  const { source = null, synthetic = false, acquisition: initial = null } = model;
  const root = el('section'); root.className = 'solution-pull';
  const status = el('p'), error = el('p'); status.setAttribute('role', 'status'); error.setAttribute('role', 'alert'); error.className = 'managed-error';
  const form = el('form'); form.className = 'managed-form';
  const field = (caption, node) => { const wrap = el('div'); wrap.className = 'managed-field'; node.id = 'pull-' + ++sequence; const text = el('label', caption); text.htmlFor = node.id; wrap.append(text, node); form.append(wrap); return node; };
  const server = field(nouns.server, el('select')), solution = field(nouns.solution, el('select'));
  for (const [value, caption] of PULL_SERVERS) { const option = el('option', caption); option.value = value; server.append(option); }
  const placeholder = el('option', pull.chooseSolution); placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true; solution.append(placeholder);
  const submit = el('button', source ? actionLabels.refresh : actionLabels.load); submit.type = 'submit'; form.append(submit);
  const retry = el('button', actionLabels.retry); retry.type = 'button'; retry.className = 'secondary'; retry.hidden = true; form.append(retry);
  root.append(el('p', source ? pull.updateIntro : pull.intro), form, status, error);
  const fixedServer = source ? serverFromConnection(source.connectionId) : null;
  if (source) {
    server.value = fixedServer || ''; server.disabled = true;
    const option = el('option', source.solutionRef); option.value = source.solutionRef; option.selected = true; solution.append(option); solution.disabled = true;
  }
  let busy = false, names = new Map(), resumable = false;
  const lock = value => { busy = value; submit.disabled = value || (!solution.value && !resumable); if (!source) { server.disabled = value; solution.disabled = value || solution.options.length <= 1; } };
  const fail = message => { error.textContent = message; status.textContent = ''; retry.hidden = false; };
  const catalog = async () => {
    if (source || !actions.catalog) return;
    solution.replaceChildren(placeholder); names = new Map(); lock(true); error.textContent = ''; status.textContent = pull.loadingCatalog;
    try {
      const value = await actions.catalog(server.value);
      for (const row of value.solutions || []) {
        const option = el('option', (row.name || row.code) + (row.paid === true ? ' · ' + pull.paid : '')); option.value = row.code; option.disabled = row.paid === true; solution.append(option); names.set(row.code, row.name || row.code);
      }
      status.textContent = solution.options.length > 1 ? '' : pull.catalogFailed;
    } catch (e) { fail(e.message || pull.catalogFailed); }
    finally { lock(false); }
  };
  const show = record => {
    status.textContent = record.state === 'ready' ? loading.ready : record.state === 'failed' ? loading.failed : record.state === 'parsing' ? loading.parsing : loading.exporting;
    if (record.progress) status.textContent += ' · ' + pull.received + ': ' + record.progress.completed + ' / ' + record.progress.total;
    if (record.exclusions?.length) status.textContent += ' · ' + pull.unavailableSolutions + ': ' + record.exclusions.map(row => row.code).join(', ');
    if (record.error) error.textContent = record.error;
  };
  const finish = async record => {
    const row = record.solutions?.[0];
    if (!row || row.sourceAvailability === 'opaque') return fail(pull.opaque);
    status.textContent = pull.saved;
    await onReady({ project: row.project, code: row.code, name: names.get(row.code) || row.code });
  };
  // A reload resumes the saved export but never turns it into a Solution by
  // itself: the ready export waits for one Продолжить click (contract
  // config-source-api.md), so two tabs on the same acquisition cannot both create one.
  const resume = record => { resumable = true; status.textContent = pull.resume; submit.textContent = pull.continueLabel; submit.disabled = false; form.onsubmit = event => { event.preventDefault(); run(() => finish(record)); }; };
  const monitor = async (record, resumed = false) => {
    show(record); actions.remember?.(record.id);
    while (record.state === 'exporting' || record.state === 'parsing') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (!root.isConnected) return;
      record = await actions.get(record.id); show(record);
    }
    if (record.state !== 'ready') fail(record.error || pull.failed); else if (resumed) resume(record); else await finish(record);
  };
  const run = async operation => {
    if (busy) return; lock(true); error.textContent = ''; retry.hidden = true;
    try { await operation(); } catch (e) { fail(e.message || pull.failed); }
    finally { lock(false); }
  };
  form.onsubmit = event => { event.preventDefault(); if (!solution.value) return;
    run(async () => monitor(await actions.start({ server: server.value, solution: solution.value }))); };
  retry.onclick = () => { if (!source && solution.options.length <= 1) run(catalog); else form.requestSubmit(); };
  server.onchange = () => run(catalog);
  solution.onchange = () => { submit.disabled = busy || !solution.value; };
  if (model.error) fail(model.error);
  if (model.unavailable) { fail(pull.serverNotConfigured); server.disabled = true; solution.disabled = true; submit.disabled = true; }
  else if (initial) {
    show(initial);
    if (initial.state === 'ready') resume(initial);
    else if (initial.state === 'failed') fail(initial.error || pull.failed);
    else if (!synthetic) queueMicrotask(() => run(() => monitor(initial, true)));
    else submit.disabled = true;
  } else if (source) submit.disabled = !fixedServer;
  else { submit.disabled = true; if (!synthetic) queueMicrotask(() => run(catalog)); else if (model.catalog) { for (const row of model.catalog) { const option = el('option', row.name || row.code); option.value = row.code; option.disabled = row.paid === true; solution.append(option); names.set(row.code, row.name || row.code); } } }
  return root;
}
export function mountAcquisition(actions, selected, model = {}) {
  const root = el('section'); root.className = 'config-acquisition';
  root.append(el('h3', 'Загрузить из ELMA или из архива конфигурации'));
  const status = el('p'), error = el('p'); status.setAttribute('role', 'status'); error.setAttribute('role', 'alert');
  const controls = el('div'), results = el('div'); root.append(controls, status, error, results);
  let busy = false;
  const label = (caption, node) => { node.id = 'acquire-' + ++sequence; const text = el('label', caption); text.htmlFor = node.id; controls.append(text, node); return node; };
  const files = label('Архив конфигурации или файлы решений .e365', el('input')); files.type = 'file'; files.multiple = true; files.accept = '.e365';
  const server = label('Источник ELMA', el('select'));
  for (const [value, caption] of [['dev', 'DEV'], ['dev2', 'dev2']]) { const option = el('option', caption); option.value = value; server.append(option); }
  const solution = label('Что загрузить', el('select'));
  const all = el('option', 'Все доступные решения'); all.value = ''; solution.append(all);
  const button = (text, operation) => { const node = el('button', text); node.type = 'button'; node.className = 'secondary'; node.onclick = () => run(operation); controls.append(node); return node; };
  const lock = value => { busy = value; for (const node of controls.querySelectorAll('input,select,button')) node.disabled = value; };
  const run = async operation => {
    if (busy) return; lock(true); error.textContent = ''; status.textContent = 'Загружаем…';
    try { await operation(); } catch (e) { error.textContent = e.message; status.textContent = 'Загрузка не завершена.'; }
    finally { lock(false); }
  };
  const show = acquisition => {
    results.replaceChildren();
    status.textContent = acquisition.state === 'ready' ? acquisition.solutions?.every(row => row.sourceAvailability === 'opaque')
      ? 'Исходный файл сохранён. Для изменений нужен читаемый экспорт решения.' : 'Файлы сохранены. Выберите решение.'
      : acquisition.state === 'failed' ? 'Загрузка не завершена.' : 'Экспорт выполняется…';
    if (acquisition.error) error.textContent = acquisition.error;
    if (acquisition.progress) results.append(el('p', 'Получено решений: ' + acquisition.progress.completed + ' / ' + acquisition.progress.total));
    if (acquisition.exclusions?.length) results.append(el('p', 'Недоступные решения: ' + acquisition.exclusions.map(row => row.code + ' (' + row.status + ')').join(', ')));
    if (acquisition.state === 'ready') {
      const download = el('a', 'Скачать исходную конфигурацию'); download.href = '/api/config-source/acquisitions/' + acquisition.id + '/original'; results.append(download);
      for (const row of acquisition.solutions || []) {
        if (row.sourceAvailability === 'opaque') {
          results.append(el('p', row.code + ': конфигурация сохранена, но содержимое непрозрачно или зашифровано. Загрузите читаемые решения отдельно или через архив конфигурации.'));
          continue;
        }
        if (row.dependencies) results.append(mountDependencies(row.dependencies));
        const choose = el('button', 'Выбрать ' + row.code); choose.type = 'button'; choose.className = 'secondary';
        choose.onclick = () => { selected(row.project); results.querySelectorAll('button').forEach(node => { node.disabled = false; }); choose.disabled = true; status.textContent = 'Выбрано решение: ' + row.code; };
        results.append(choose);
      }
    }
  };
  const monitor = async acquisition => {
    show(acquisition);
    if (acquisition.state !== 'exporting') return;
    actions.remember?.(acquisition.id);
    while (acquisition.state === 'exporting') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (!root.isConnected) return;
      acquisition = await actions.get(acquisition.id); show(acquisition);
    }
  };
  button('Прочитать архив', async () => {
    if (!files.files.length || [...files.files].some(file => !file.name.toLowerCase().endsWith('.e365'))) throw Error('Выберите файлы .e365.');
    const loaded = [];
    for (const file of files.files) {
      const acquisition = await actions.upload(file); loaded.push([file.name, acquisition]);
      show(acquisition); actions.remember?.(acquisition.id);
    }
    if (loaded.length > 1) for (const [name, acquisition] of loaded) {
      const link = el('a', 'Открыть ' + name); link.href = actions.resumeUrl?.(acquisition.id) || '#'; results.append(link);
    }
  });
  button('Показать решения сервера', async () => {
    const value = await actions.catalog(server.value); solution.replaceChildren(all);
    for (const row of value.solutions) { const option = el('option', row.name || row.code); option.value = row.code; option.disabled = row.paid === true; solution.append(option); }
    status.textContent = 'Выберите одно решение или все доступные.';
  });
  button('Загрузить из ELMA', async () => monitor(await actions.start({ server: server.value, ...(solution.value ? { solution: solution.value } : {}) })));
  if (actions.list) button('Продолжить сохранённую загрузку', async () => {
    const rows = await actions.list(); results.replaceChildren();
    for (const row of rows) { const link = el('a', (row.server || 'Файл') + ' · ' + row.createdAt + ' · ' + row.state);
      link.href = actions.resumeUrl(row.id); results.append(link); }
    status.textContent = rows.length ? 'Выберите загрузку для продолжения.' : 'Сохранённых загрузок нет.';
  });
  server.onchange = () => { solution.replaceChildren(all); };
  if (model.error) error.textContent = model.error;
  if (model.acquisition) { show(model.acquisition); if (model.acquisition.state === 'exporting' && !model.synthetic) queueMicrotask(() => run(() => monitor(model.acquisition))); }
  return root;
}

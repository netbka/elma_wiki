const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let sequence = 0;
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
    status.textContent = acquisition.state === 'ready' ? 'Файлы сохранены. Выберите решение.' : acquisition.state === 'failed' ? 'Загрузка не завершена.' : 'Экспорт выполняется…';
    if (acquisition.error) error.textContent = acquisition.error;
    if (acquisition.progress) results.append(el('p', 'Получено решений: ' + acquisition.progress.completed + ' / ' + acquisition.progress.total));
    if (acquisition.exclusions?.length) results.append(el('p', 'Недоступные решения: ' + acquisition.exclusions.map(row => row.code + ' (' + row.status + ')').join(', ')));
    if (acquisition.state === 'ready') {
      const download = el('a', 'Скачать исходную конфигурацию'); download.href = '/api/config-source/acquisitions/' + acquisition.id + '/original'; results.append(download);
      for (const row of acquisition.solutions || []) {
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
  if (model.acquisition) { show(model.acquisition); if (model.acquisition.state === 'exporting') queueMicrotask(() => run(() => monitor(model.acquisition))); }
  return root;
}

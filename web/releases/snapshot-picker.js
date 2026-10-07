const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let sequence = 0;
// Selecting release input never changes the project's current snapshot or workspace.
export function mountSnapshotPicker({ label, projects, optional = false, load, onChange }) {
  const root = el('fieldset'), legend = el('legend', label);
  const field = caption => {
    const wrap = el('div'), text = el('label', caption), select = el('select');
    select.id = 'snapshot-field-' + ++sequence; text.htmlFor = select.id; wrap.append(text, select); root.append(wrap); return select;
  };
  const option = (select, value, text) => { const node = el('option', text); node.value = value; select.append(node); };
  root.append(legend);
  const project = field(label), snapshot = field('Снимок — ' + label), status = el('p'); status.setAttribute('role', 'status'); status.className = 'release-hash';
  const retry = el('button', 'Повторить загрузку снимков — ' + label); retry.type = 'button'; retry.hidden = true;
  option(project, '', optional ? 'Нет базовой версии (ограниченное сравнение)' : 'Выберите загруженный DEV пакет');
  for (const row of projects.filter(p => !p.legacy)) option(project, row.id, `${row.filename} · ${new Date(row.createdAt).toLocaleString('ru-RU')}`);
  project.required = !optional; snapshot.required = true; snapshot.disabled = true;
  root.append(status, retry);
  let request = 0, rows = [];
  const selected = () => {
    const row = rows.find(s => s.id === snapshot.value);
    onChange(row ? { projectId: project.value, snapshotId: row.id } : null);
    status.textContent = row ? `SHA-256: ${row.checksum} · ${row.coverage} · ${row.source ? 'Source: ' + row.source.connectionId : 'Ручная загрузка; Source не проверена'}` : '';
  };
  const update = async () => {
    const ticket = ++request, id = project.value;
    rows = []; snapshot.replaceChildren(); snapshot.disabled = true; retry.hidden = true; onChange(null);
    status.textContent = id ? 'Загружаем сохранённые снимки…' : optional ? 'Базовая версия не выбрана.' : 'Выберите проект и его сохранённый снимок.';
    if (!id) return;
    try {
      if (!load) throw Error('Загрузка снимков недоступна');
      const data = await load(id);
      if (ticket !== request) return;
      rows = data.snapshots;
      if (!rows?.length) throw Error('У проекта нет доступных снимков');
      for (const row of rows) option(snapshot, row.id, `${new Date(row.createdAt).toLocaleString('ru-RU')} · ${row.checksum.slice(0, 12)}${row.id === data.currentSnapshotId ? ' · текущий в проекте' : ''}`);
      snapshot.value = data.currentSnapshotId;
      if (!snapshot.value) snapshot.selectedIndex = 0;
      snapshot.disabled = false; selected();
    } catch (error) {
      if (ticket !== request) return;
      rows = []; snapshot.replaceChildren(); status.textContent = 'Снимки не получены: ' + error.message; retry.hidden = false;
    }
  };
  project.onchange = update; snapshot.onchange = selected; retry.onclick = update;
  return root;
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const text = value => typeof value === 'string' ? value : '';
const array = value => Array.isArray(value) ? value : [];
const token = part => JSON.stringify([part.kind, part.code, part.side || '', part.source || '']);
export function sourceMatches(entity) {
  return [
    ...array(entity.fields).filter(row => row && typeof row === 'object').map(field => ({ kind:'field', code:text(field.code), name:text(field.name), type:text(field.type), origin:text(field.origin), source:text(field.source) })),
    ...array(entity.functionSources).filter(row => row && typeof row === 'object').map(fn => ({ kind:'function', code:text(fn.name), side:text(fn.side), source:text(fn.path) }))
  ];
}
export function objectSearchModel(entities, query = '') {
  const q = String(query).trim().toLocaleLowerCase('ru-RU');
  const includes = value => String(value ?? '').toLocaleLowerCase('ru-RU').includes(q);
  return array(entities).filter(entity => entity && typeof entity === 'object').flatMap(entity => {
    const matches = q ? sourceMatches(entity).filter(part => [part.code,part.name,part.type,part.origin,part.side,part.source].some(includes)) : [];
    const metadata = [entity.name,entity.code,entity.namespace,entity.service,entity.archivePath,...array(entity.functions)].some(includes);
    return metadata || matches.length ? [{ entity, matches }] : [];
  });
}
export function resolveSourceMatch(entity, reference) {
  if (typeof reference !== 'string' || reference.length > 4096) return { state:'unknown' };
  const matches = sourceMatches(entity).filter(part => token(part) === reference);
  return matches.length === 1 ? { state:'selected', part:matches[0] } : { state:matches.length ? 'ambiguous' : 'unknown' };
}
export function renderSourceMatch(selection) {
  if (selection?.state !== 'selected') return '<section id="matched-source" tabindex="-1"><h2>Точное совпадение не установлено</h2><p>Обновите поиск и проверьте исходный файл. Повторяющиеся определения не выбираются автоматически.</p></section>';
  const p = selection.part;
  return `<section id="matched-source" tabindex="-1"><h2>${p.kind === 'field' ? 'Найденное поле' : 'Найденная функция'}: ${escape(p.code)}</h2><p>${escape(p.name || p.side || p.origin)} · ${escape(p.type || '')}</p><p>Источник: <code>${escape(p.source || 'Не установлен; проверьте оригинал и отчёт разбора')}</code></p><p>Найдено описание в индексе. Привязки, права и выполнение требуют отдельной проверки.</p></section>`;
}
export function renderObjectResults(rows, { href = (entity, part) => '#/object/' + encodeURIComponent(entity.id) + (part ? '?match=' + encodeURIComponent(token(part)) : '') } = {}) {
  return rows.map(({entity:e,matches}) => `<div class="entity-result"><a class="entity-row" href="${escape(href(e))}">${escape(e.name || e.code)}<small>${escape(e.service)} / ${escape(e.namespace)} / ${escape(e.code)}</small></a>${matches.length ? '<ul>' + matches.slice(0,40).map(p => `<li><a class="search-hit" data-entity="${escape(e.id)}" data-match="${escape(token(p))}" href="${escape(href(e,p))}">${p.kind === 'field' ? 'Поле' : 'Функция'}: ${escape(p.code)}${p.name ? ' · ' + escape(p.name) : ''}</a><small>${escape(p.origin || p.side)} · ${escape(p.source || 'Источник не установлен')}</small></li>`).join('') + '</ul>' : ''}${matches.length > 40 ? '<p>Показаны первые 40 совпадений. Уточните запрос.</p>' : ''}</div>`).join('') || '<p>Подходящих объектов нет. Уточните запрос; неполный индекс не доказывает отсутствие в ELMA.</p>';
}
export function inspectOnlyReason(entity, { privateProject = false, legacy = false } = {}) {
  if (!privateProject) return 'Учебный пример: доступно исследование описаний; редактор работает с разрешённым приватным экспортом.';
  if (legacy) return 'Оригинал прежнего проекта не сохранён. Для редактирования нужен новый разрешённый экспорт.';
  if (entity.service !== 'widgets' || String(entity.kind).toUpperCase() !== 'WIDGET') return 'Редактор поддерживает скрипты виджетов. Для этого объекта доступны исходный текст, оригинал и отчёт; изменение выполняйте поддержанным инструментом.';
  if (entity.coverage !== 'structural' || !(entity.archivePath || entity.provenance?.source)) return 'Структура или источник не установлены. Проверьте оригинал и отчёт; неизвестные части здесь не редактируются.';
  return null;
}
// Read-only browser exploration; callers supply only their authorized model.
export function mountObjectSearch(entities, { query = '', title = 'Поиск поля или функции' } = {}) {
  const root = document.createElement('section'); root.className = 'object-search';
  const label = document.createElement('label'), input = document.createElement('input');
  label.textContent = title; input.type = 'search'; input.setAttribute('aria-label', title); input.value = query; label.append(input);
  const count = document.createElement('p'); count.setAttribute('role','status');
  const results = document.createElement('div'), selected = document.createElement('div');
  const render = () => { const rows = objectSearchModel(entities,input.value); results.innerHTML = renderObjectResults(rows,{href:()=> '#matched-source'}); count.textContent = 'Найдено объектов: ' + rows.length; selected.replaceChildren(); };
  input.oninput = render;
  results.onclick = event => {
    const anchor = event.target.closest('a'); if (!anchor) return; event.preventDefault();
    if (!anchor.dataset.match) { selected.textContent = 'Выберите конкретное поле или функцию в результатах.'; return; }
    const owners = array(entities).filter(e => e.id === anchor.dataset.entity);
    const selection = owners.length === 1 ? resolveSourceMatch(owners[0],anchor.dataset.match) : {state:'ambiguous'};
    selected.innerHTML = renderSourceMatch(selection); selected.firstElementChild.focus();
  };
  root.append(label,count,results,selected); render(); return root;
}

export function hydrateObjectSearch(root) {
  for (const box of root.querySelectorAll('[data-object-search]')) {
    try { box.replaceChildren(mountObjectSearch(JSON.parse(box.dataset.entities),{query:box.dataset.query || ''})); }
    catch { box.textContent = 'Учебные данные недоступны. Продолжите по описанию ниже.'; }
  }
}

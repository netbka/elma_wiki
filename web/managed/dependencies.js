const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
export const dependencyLabels = {
  'component-source-present': 'Исходник компонента доступен',
  'paid-source-unavailable': 'Платная зависимость: исходник недоступен',
  'catalog-present-source-unavailable': 'Решение есть в каталоге; исходник компонента не подтверждён',
  'provider-not-observed': 'Зависимость не найдена в полученных данных',
  'unknown-identity': 'Компонент зависимости не определён',
  'ambiguous-provider': 'Несколько возможных поставщиков компонента'
};
export function mountDependencies(report) {
  const root = el('section'); root.className = 'dependency-evidence';
  root.append(el('h3', 'Зависимости решения'));
  root.append(el('p', 'Наличие исходника и возможность изменить наше решение не подтверждают готовность к установке. Версии, активация и работа на целевом сервере требуют проверки.'));
  if (!report?.rows) { root.append(el('p', 'Сведения о зависимостях для этой версии не сохранены.')); return root; }
  if (report.provenance === 'manual-upload') root.append(el('p', 'Сведения из загруженного файла; связь с сервером не подтверждена.'));
  if (!report.rows.length) root.append(el('p', 'В пакете нет объявленных зависимостей. Динамические ссылки в коде отдельно не проверены.'));
  const list = el('ul');
  for (const row of report.rows) {
    const item = el('li', `${row.required ? 'Обязательная' : 'Опциональная / системная'} · ${row.service || '?'} · ${row.targetNamespace || '?'}/${row.targetCode || '?'}: ${dependencyLabels[row.status] || 'Не установлено'}`);
    for (const candidate of row.candidates || []) item.append(el('p', `${candidate.code} · версия: ${candidate.version || 'не установлена'}`));
    list.append(item);
  }
  root.append(list); return root;
}

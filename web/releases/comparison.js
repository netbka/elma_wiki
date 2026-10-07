// The same full-package comparison is used by the server and synthetic stories.
export function compareSnapshots(source, baseline) {
  const before = new Map((baseline?.inventory || []).map(row => [row.path, row]));
  const after = new Map(source.inventory.map(row => [row.path, row]));
  const beforeEntities = new Map((baseline?.entities || []).map(entity => [entity.archivePath, entity]));
  const afterEntities = new Map(source.entities.map(entity => [entity.archivePath, entity]));
  const entityAt = (entities, path) => entities.get(path) || entities.get(path.replace(/\.(client|server)\.ts$/, ''));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => {
    const old = before.get(path), next = after.get(path);
    if (old?.sha256 === next?.sha256) return [];
    const previous = entityAt(beforeEntities, path), current = entityAt(afterEntities, path), entity = current || previous;
    const fields = [];
    const beforeFields = new Map((previous?.fields || []).map(field => [field.code, field])), afterFields = new Map((current?.fields || []).map(field => [field.code, field]));
    for (const code of new Set([...beforeFields.keys(), ...afterFields.keys()])) {
      const a = beforeFields.get(code), b = afterFields.get(code);
      if (JSON.stringify(a) !== JSON.stringify(b)) fields.push({ code, before: a || null, after: b || null });
    }
    const impact = path.startsWith('permissions/') ? 'rights' : path.startsWith('processor/') ? 'process' : fields.some(f => f.before?.required !== f.after?.required) ? 'required' : /\.(client|server)\.ts$/.test(path) ? 'script' : entity ? 'structure' : path === 'package.json' ? 'package' : 'unclassified';
    return [{ path, type: old ? next ? 'changed' : 'removed' : 'added', before: old || null, after: next || null, title: entity?.name || entity?.code || path, impact, fields }];
  });
}
export const impactLabels = { rights: 'Права доступа', process: 'Логика процесса', required: 'Обязательность поля', script: 'Скрипт', structure: 'Структура объекта', package: 'Состав и настройки пакета', unclassified: 'Влияние не классифицировано' };
export const changeLabels = { added: 'Добавлено', changed: 'Изменено', removed: 'Удалено' };

import { interpretFiles, updateEnvironment } from './e365.mjs';
export function demoData() {
  const files = new Map(), put = (path, value) => files.set(path, Buffer.from(JSON.stringify(value)));
  const field = (code, name, type) => ({ code, view: { name }, type });
  const entities = {
    appViews: [
      { code: 'requests', name: 'Обращения', namespace: 'example_module', path: 'requests.json' },
      { code: 'categories', name: 'Категории обращений', namespace: 'example_module', path: 'categories.json' }
    ],
    widgets: [
      { code: 'request_form', name: 'Форма обращения', namespace: 'example_module.requests', path: 'request_form.json' },
      { code: 'request_card', name: 'Карточка обращения', namespace: 'example_module.requests', path: 'request_card.json' }
    ],
    processor: [{ code: 'review', name: 'Рассмотрение обращения', namespace: 'example_module', path: 'review.json' }],
    settings: [{ code: 'settings', name: 'Параметры модуля', namespace: 'example_module', path: 'settings.json' }]
  };
  put('package.json', { code: 'example_solution', title: 'Учебная служба обращений', type: 'SOLUTION', internalDependencies: { appViews: [{ entity: { service: 'widgets', namespace: 'example_module.requests', code: 'request_form' }, dependsOn: { service: 'appViews', namespace: 'example_module', code: 'requests' } }] } });
  for (const [service, records] of Object.entries(entities)) put(`${service}/manifest.json`, { entities: records });
  put('appViews/requests.json', { fields: [field('title', 'Тема обращения', 'STRING'), { ...field('category', 'Категория', 'APPLICATION'), data: { namespace: 'example_module', code: 'categories' } }, field('description', 'Описание', 'TEXT'), field('status', 'Статус', 'STRING')] });
  put('appViews/categories.json', { fields: [field('title', 'Название категории', 'STRING'), field('enabled', 'Активна', 'BOOLEAN')] });
  put('widgets/request_form.json', { dataNamespace: 'example_module', dataCode: 'requests', descriptor: { fields: [field('ready', 'Готовность формы', 'BOOLEAN'), field('message', 'Сообщение', 'STRING')], clientScripts: 'async function onOpen() { ViewContext.data.ready = Boolean(Context.data.title); }\nasync function validateForm() { return Boolean(Context.data.title); }', serverScripts: 'async function checkCategory() { return Context.data.category; }', template: { values: { systemFunctions: { onInit: { name: 'onOpen', type: 'client' }, onValidate: { name: 'validateForm', type: 'client' } } } } } });
  put('widgets/request_card.json', { dataNamespace: 'example_module', dataCode: 'requests', descriptor: { fields: [field('expanded', 'Развёрнутая карточка', 'BOOLEAN')], clientScripts: 'function toggleDetails() { ViewContext.data.expanded = !ViewContext.data.expanded; }' } });
  put('processor/review.json', { context: [field('request', 'Обращение', 'APPLICATION'), field('approved', 'Результат', 'BOOLEAN')], scripts: 'async function evaluate() { Context.data.approved = Boolean(Context.data.request); }' });
  put('settings/settings.json', [field('notification_enabled', 'Уведомления включены', 'BOOLEAN')]);
  const empty = { readOnly: true, snapshot: 'Синтетический пример', servers: {} };
  return updateEnvironment(empty, 'showcase', interpretFiles(files, 'showcase'));
}

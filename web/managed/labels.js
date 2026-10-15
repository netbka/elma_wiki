// Shared product vocabulary (UX-00, docs/plans/intuitive-solution-ui-2026-10-15.md §7).
// Every user-facing word of the Solution UI lives here once. Renderers import
// from this module; tools/ui-strings.mjs fails the build when product text
// appears inline outside this map (legacy strings are tracked in
// test/fixtures/ui-strings-baseline.json and may only shrink).
// Rules: Russian, verb-first buttons, nouns for tabs and chips, no
// abbreviations, no parentheses, one word for one thing on every page.

// Objects and places
export const nouns = {
  solution: 'Решение', solutions: 'Решения', server: 'Сервер', version: 'Версия', module: 'Модуль',
  change: 'Изменение', changes: 'Изменения', request: 'Запрос на изменение', requests: 'Запросы',
  review: 'Рассмотрение', build: 'Сборка', verify: 'Проверка', release: 'Выпуск',
  archive: 'Архив', legacyUploads: 'Прежние загрузки', base: 'Основа', responsibility: 'Ответственность',
  systemObjects: 'Служебные объекты', unchangedObjects: 'Без изменений', dependencies: 'Зависимости',
  comments: 'Комментарии и замечания', activity: 'Последние события', attention: 'Что требует внимания',
  before: 'Было', after: 'Стало', purpose: 'Для чего', modules: 'Модули', versionsAndHistory: 'Версии и история'
};

// Solution tabs, in order
export const tabs = { about: 'О решении', flows: 'Как работает', screensAndData: 'Экраны и данные', changes: 'Изменения', requests: 'Запросы', build: 'Сборка' };

// Lifecycle stepper (product plan one-next-action map)
export const steps = { load: 'Загрузка', compare: 'Сравнение', review: 'Рассмотрение', build: 'Сборка', verify: 'Проверка', release: 'Выпуск' };
export const stepReasons = { noBuilder: 'нет сборщика', builderUnknown: 'сборщик не опрошен', noTarget: 'нет цели', notYet: 'ещё не доступно' };
export const stepStates = { done: 'готово', current: 'сейчас', next: 'далее' };

// Solution header (UX-04): status badge, version line, stepper and tab navigation names
export const header = { versionFrom: 'Версия от', status: 'Состояние', steps: 'Этапы решения', sections: 'Разделы решения', handoff: 'Передача' };

// Buttons: one primary per page, verb first
export const actions = {
  loadSolution: 'Загрузить решение', load: 'Загрузить', refresh: 'Обновить', refreshAgain: 'Обновить ещё раз',
  reviewChanges: 'Рассмотреть изменения', decide: 'Решение по версии', accept: 'Принять',
  requestFixes: 'Запросить доработку', commentOnly: 'Только комментарий', closeNoChanges: 'Закрыть без изменений',
  requestChange: 'Запросить изменение', newRequest: 'Новый запрос', send: 'Отправить',
  write: 'Написать', open: 'Открыть', openDiagram: 'Открыть схему', explain: 'Объяснить',
  explainSolution: 'Объяснить решение', explainProcess: 'Объяснить этот процесс', explainStep: 'Объяснить этот шаг',
  details: 'Подробнее', show: 'показать', hide: 'скрыть', downloadReport: 'Скачать отчёт', toArchive: 'В архив',
  retry: 'Повторить', cancel: 'Отмена', buildConfiguration: 'Собрать конфигурацию', chooseVersion: 'выберите версию'
};

// Status chips (Solution card and header)
export const statuses = { working: 'В работе', awaitingReview: 'Ожидает рассмотрения', conflict: 'Конфликт', accepted: 'Принято', archived: 'В архиве' };

// Change kinds: one word, parallel
export const changeKinds = { modified: 'Изменён', added: 'Добавлен', removed: 'Удалён', unchanged: 'Без изменений', conflict: 'Конфликт' };

// Status ribbon on the review page
export const ribbon = { modified: 'Изменено', added: 'Добавлено', removed: 'Удалено', conflicts: 'Конфликтов', all: 'Все', viewed: 'Просмотрено', unchanged: 'Без изменений' };

// Review summary (UX-03)
export const reviewSummary = {
  filter: 'Показать', filterLabel: 'Фильтр объектов', baseRevision: 'Основа: ревизия', noChangedObjects: 'Изменённых объектов нет',
  unknownParts: 'Нераспознанных частей', dependencyProblems: 'Зависимостей с вопросами', responsibility: 'Ответственность', uploaded: 'Загрузил'
};

// Facts shown as chips
export const facts = {
  baseVersion: 'Основа: версия от', baseUnknown: 'Основа: не указана', baseSequence: 'Основа записана Wiki по порядку загрузок с того же сервера. Происхождение экспорта в ELMA не проверено.', server: 'Сервер', loadedBy: 'Загрузил',
  diagramFromExport: 'Схема: из экспорта', behaviorNotChecked: 'Поведение в ELMA: не проверено',
  noDifference: 'Эта версия не отличается от текущей', viewed: 'Просмотрено', changedSinceViewed: 'Изменилось после просмотра'
};

// Object kinds. R1 (2026-10-15, ELMA365 help): ELMA's own Russian nouns are
// "Решение", "Раздел" (workspace), "Приложение", "Бизнес-процесс", "Страница",
// "Форма", "Справочник". The owner's word "Модуль" stays for the workspace
// level; "Экран" stays for forms and pages because users say it. Designer
// screenshots from the DEV server may still refine these.
export const objectKinds = { process: 'Процесс', processes: 'Процессы', form: 'Экран', forms: 'Экраны', application: 'Приложение', directory: 'Справочник', data: 'Данные', permissions: 'Права', other: 'Прочее', localization: 'Локализация' };
// Service -> kind group of the Solution tab, in display order.
export const kindGroups = { processes: 'Процессы', forms: 'Экраны', data: 'Данные', permissions: 'Права', localization: 'Локализация', other: 'Прочее' };
export const grouping = { module: 'Модуль', withoutModule: 'Без модуля', objects: 'объектов', showAll: 'показать все', code: 'код' };

// Change request form
export const requestForm = {
  what: 'Что изменить', where: 'Где', shouldBe: 'Что должно быть', why: 'Зачем', urgency: 'Срочность',
  kinds: { screen: 'Экран', flow: 'Процесс', data: 'Данные' }, urgencies: { normal: 'Обычная', urgent: 'Срочная' },
  statuses: { new: 'Новый', inProgress: 'В работе', done: 'Выполнен', rejected: 'Отклонён' }
};

// Pull-from-server dialog states
export const loading = { exporting: 'Выгружаем с сервера…', parsing: 'Разбираем…', ready: 'Готово', failed: 'Не удалось', serverUnavailable: 'Сервер недоступен', loadingSolution: 'Загружаем решение…' };

// The one fixed entry: choose a server and a solution, pull everything.
export const pull = {
  intro: 'Выберите сервер и решение. Wiki выгрузит полный экспорт и сохранит его как текущую версию.',
  updateIntro: 'Wiki выгрузит текущую версию этого решения с сервера и сравнит её с принятой.',
  chooseSolution: 'Выберите решение', loadingCatalog: 'Получаем список решений…', paid: 'недоступно',
  received: 'Получено решений', unavailableSolutions: 'Недоступные решения',
  opaque: 'Содержимое решения зашифровано или непрозрачно. Выберите другое решение.',
  failed: 'Загрузка не завершена. Повторите попытку.', serverNotConfigured: 'Сервер недоступен. Повторите позже или обратитесь к администратору.',
  catalogFailed: 'Список решений не получен.', saved: 'Экспорт сохранён. Открываем решение…', resume: 'Экспорт готов. Нажмите «Продолжить», чтобы открыть решение.',
  continueLabel: 'Продолжить', manualFile: 'Загрузить файл .e365 вручную', legacyChange: 'Загрузить частичный экспорт файлом',
  serverNames: { dev: 'DEV', dev2: 'dev2' }
};

// Next-action summaries changed by the fixed path
export const summaries = {
  ready: 'Текущая версия сохранена. Её можно обновить с сервера.',
  accepted: 'Изменения приняты. Ожидающих решений нет.'
};

// Gate reasons shown on a disabled decision button
export const gates = { chooseConflictVersions: 'Сначала выберите версию для конфликтов' };

// Decision dialog (UX-03b): one button opens one dialog with three choices.
export const decision = {
  question: 'Что вы решили',
  acceptVersion: 'Принять версию', acceptChange: 'Принять изменение', sendComment: 'Отправить комментарий',
  acceptVersionNote: 'Станет текущей версией. Установка в ELMA не выполняется.',
  acceptChangeNote: 'Войдёт в принятую историю решения. Установка в ELMA не выполняется.',
  requestFixesNote: 'Автор получит замечание. Принятие заблокировано, пока оно не устранено.',
  commentOnlyNote: 'Это не решение: запись останется в обсуждении.',
  comment: 'Комментарий', commentOptional: 'Комментарий, необязательно',
  requestedFixes: 'Запрошена доработка', fixesDone: 'Замечание устранено', closedNoChanges: 'Закрыто без изменений',
  closeNote: 'Версия будет закрыта без принятия. Текущая версия и история не изменятся.',
  accepted: 'Принято', reviewClosed: 'Решение по этой версии уже принято'
};

// Bug-report form: the reject path records the same finding as "Запросить доработку".
export const feedback = {
  rejectNote: 'Добавит блокирующее замечание «Запрошена доработка» и отправит ошибку в GitHub. Принятие заблокировано до разрешения замечания.',
  rejectApplied: 'Запрошена доработка: блокирующее замечание добавлено.'
};

// Changed steps on the process diagram (UX-03b "Открыть схему")
export const diagram = { changedSteps: 'Изменённые шаги выделены', changedStep: 'изменён', processNotFound: 'Схема этого процесса не найдена в экспорте' };

// "О решении" (UX-05): purpose paragraph, module cards, activity list
export const about = {
  purposeIntro: 'Решение объединяет модули', purposeLimits: 'Назначение описано по названиям объектов экспорта. Работа в ELMA не наблюдалась; проверьте и дополните описание.',
  noModules: 'Объекты решения не отнесены к модулям.', moduleNoNames: 'Названия объектов в экспорте не указаны.',
  processesList: 'Процессы', screensList: 'Экраны', dataList: 'Данные',
  draftNote: 'Черновик подготовлен по данным экспорта. Проверьте и дополните.', loading: 'Готовим описание…', savedBy: 'Сохранил', edit: 'Изменить', save: 'Сохранить описание',
  text: 'Описание решения', stale: 'Состав решения изменился после сохранения. Проверьте описание.', history: 'История описания',
  archivedReadOnly: 'Решение в архиве. Описание доступно для чтения.', loadFailed: 'Описание не получено', blocked: 'Сохранение заблокировано до обновления. Ваш текст остаётся на странице.',
  moduleCounts: { processes: 'процессов', forms: 'экранов', data: 'данных', other: 'прочих' }, noActivity: 'Событий пока нет'
};
export const activity = {
  events: { created: 'Решение загружено', prepared: 'Версия подготовлена', 'review-comment': 'Комментарий', 'review-reject': 'Запрошена доработка', 'review-resolve': 'Замечание устранено',
    'review-reply': 'Ответ в обсуждении', 'review-reopen': 'Замечание открыто снова', 'change-accepted': 'Изменение принято', 'baseline-accepted': 'Версия принята', 'closed-no-changes': 'Закрыто без изменений', 'merge-resolved': 'Решение по совмещению сохранено',
    'explanation-saved': 'Описание сохранено', archived: 'В архив', reopened: 'Работа возобновлена' },
  justNow: 'только что', minutesAgo: 'мин назад', hoursAgo: 'ч назад', yesterday: 'вчера'
};

// Empty states
export const empty = { purpose: 'Опишите, для чего это решение', solutions: 'Решений пока нет', requests: 'Запросов пока нет', comments: 'Комментариев пока нет' };

// Existing review classifications (moved from model.js unchanged; renderers and
// the responsibility report depend on these exact strings until UX-03 replaces
// the per-row wording with changeKinds).
export const classificationLabels = {
  unchanged: 'Без изменений', 'intervention-added': 'Добавлен объект', 'component-modified': 'Объект изменён',
  'known-change-retained': 'Наше изменение сохранится', 'known-change-incorporated': 'Наше изменение включено в снимок',
  'external-change': 'Изменение из полного снимка', 'component-deleted': 'Удаление заявлено явно', conflict: 'Нужен выбор версии', ambiguous: 'Недостаточно данных'
};
export const elementClassificationLabels = { ...classificationLabels, 'element-added': 'Добавлен', 'element-removed': 'Удалён', 'element-modified': 'Изменён' };
export const elementKindLabels = { node: 'Шаг', transition: 'Переход', variable: 'Переменная', lane: 'Дорожка' };

// A technical identifier must never be the only label of a row. Keys of this
// shape get the business name first and the key as muted secondary text.
const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function isTechnicalKey(text) {
  if (typeof text !== 'string' || !text.trim()) return true;
  return guid.test(text) || text.includes('__') || /^_sep_|^sep_|^form_|@/.test(text);
}

// Primary label for an object row: the business name when it exists, otherwise
// the key marked as technical so renderers can style it as such.
export function displayLabel({ name, key } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed) return { text: trimmed, secondary: key && key !== trimmed ? key : '', technical: false };
  return { text: key || '', secondary: '', technical: isTechnicalKey(key) };
}

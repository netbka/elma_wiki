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
export const stepReasons = { noBuilder: 'нет сборщика', builderUnknown: 'сборщик не опрошен', noTarget: 'нет цели', notYet: 'ещё не доступно', syntheticBuild: 'учебная сборка' };
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
export const ribbon = { modified: 'Изменено', added: 'Добавлено', removed: 'Удалено', conflicts: 'Конфликтов', all: 'Все', viewed: 'Просмотрено', viewedOf: 'из', unchanged: 'Без изменений' };

// Review summary (UX-03)
export const reviewSummary = {
  filter: 'Показать', filterLabel: 'Фильтр объектов', baseRevision: 'Основа: ревизия', noChangedObjects: 'Изменённых объектов нет',
  unknownParts: 'Нераспознанных частей', dependencyProblems: 'Зависимостей с вопросами', responsibility: 'Ответственность', uploaded: 'Загрузил'
};

// Facts shown as chips
export const facts = {
  baseVersion: 'Основа: версия от', baseUnknown: 'Основа: не указана', baseSequence: 'Основа записана Wiki по порядку загрузок с того же сервера. Происхождение экспорта в ELMA не проверено.', server: 'Сервер', loadedBy: 'Загрузил',
  diagramFromExport: 'Схема: из экспорта', behaviorNotChecked: 'Поведение в ELMA: не проверено',
  noDifference: 'Эта версия не отличается от текущей', viewed: 'Просмотрено', changedSinceViewed: 'Изменилось после просмотра', viewedFailed: 'Отметка не сохранена. Повторите.'
};

// Object kinds. R1 (2026-10-15, ELMA365 help): ELMA's own Russian nouns are
// "Решение", "Раздел" (workspace), "Приложение", "Бизнес-процесс", "Страница",
// "Форма", "Справочник". The owner's word "Модуль" stays for the workspace
// level; "Экран" stays for forms and pages because users say it. Designer
// screenshots from the DEV server may still refine these.
export const objectKinds = { process: 'Процесс', processes: 'Процессы', form: 'Экран', forms: 'Экраны', application: 'Приложение', directory: 'Справочник', data: 'Данные', permissions: 'Права', other: 'Прочее', localization: 'Локализация' };
// Service -> kind group of the Solution tab, in display order.
export const kindGroups = { processes: 'Процессы', forms: 'Экраны', data: 'Данные', permissions: 'Права', localization: 'Локализация', other: 'Прочее' };
export const grouping = { module: 'Модуль', withoutModule: 'Без модуля', objects: 'объектов', showAll: 'показать все', code: 'код', andMore: 'и ещё' };

// Change request form (UX-07). Keys follow the stored request: kinds and statuses
// are the server's enumerations, shown in the product vocabulary.
export const requestForm = {
  what: 'Что изменить', where: 'Где', shouldBe: 'Что должно быть', why: 'Зачем', whyOptional: 'Зачем, необязательно', urgency: 'Срочность',
  kinds: { screen: 'Экран', process: 'Процесс', data: 'Данные' }, urgencies: { normal: 'Обычная', urgent: 'Срочная' },
  statuses: { new: 'Новый', 'in-progress': 'В работе', done: 'Выполнен', rejected: 'Отклонён' }
};
// "Запросы" tab, record and publication (UX-07)
export const requests = {
  intro: 'Запрос описывает простыми словами, что должно измениться. Wiki хранит его в решении; в GitHub он уходит только после вашего подтверждения.',
  title: 'Кратко', wholeSolution: 'Всё решение', step: 'Шаг', field: 'Поле', stepNote: 'шаг выбран на схеме', stepTextNote: 'шаг назван в тексте запроса', fieldNote: 'поле названо в тексте запроса', fieldAnchorNote: 'запрос привязан к полю',
  chooseObject: 'Выберите объект из принятого состояния', saved: 'Запрос сохранён в Wiki', open: 'Открыть запрос', close: 'Закрыть', loading: 'Загружаем запрос…', notFound: 'Запрос не найден',
  author: 'Автор', created: 'Создан', status: 'Состояние', fulfilledIn: 'Выполнен в версии', fulfillingVersion: 'Версия, в которой выполнено',
  comment: 'Комментарий', commentOptional: 'Комментарий, необязательно', addComment: 'Добавить комментарий', changeStatus: 'Изменить состояние', saveStatus: 'Сохранить состояние',
  events: 'История запроса', noEvents: 'Записей пока нет', statusChanged: 'Состояние изменено', chip: 'Запрос', urgentChip: 'Срочно',
  publication: 'Публикация', publish: 'Отправить в GitHub', publishConsent: 'Опубликовать заголовок, описание, причину и вложения в GitHub', publishNote: 'Проверьте снимки перед отправкой.',
  notPublished: 'В GitHub не отправлялся', checkResult: 'Проверить результат', retryPublish: 'Повторить отправку', openIssue: 'Открыть GitHub issue', reportInWiki: 'Отчёт и вложения в Wiki',
  publicationStates: { published: 'Отправлен в GitHub', unconfigured: 'Сохранён в Wiki. Отправка в GitHub не настроена', failed: 'Не удалось отправить в GitHub', unknown: 'Результат отправки проверяется',
    'attachment-failed': 'Вложение не загружено в GitHub', uploading: 'Отправляется', publishing: 'Отправляется' },
  anchor: { current: 'Объект не менялся', stale: 'Объект изменился после запроса', removed: 'Объект удалён из решения', ambiguous: 'Объект определён неоднозначно', pending: 'Версия ещё рассматривается' },
  attachments: 'Вложения', capture: 'Снимок окна', attachFiles: 'Прикрепить файлы', remove: 'Удалить', pencil: 'Карандаш', attachmentsNote: 'PNG, JPEG или WebP · до 5 МБ каждый · до 5 файлов',
  tooManyFiles: 'Можно добавить не более пяти вложений', markError: 'Отметьте карандашом', undoStroke: 'Отменить штрих', clearMarks: 'Очистить отметки', saveMarks: 'Сохранить отметки',
  attachmentRemoved: 'Вложение удалено', finishMarks: 'Сохраните или отмените отметки перед отправкой',
  archived: 'Решение в архиве. Запросы доступны для чтения.', loadFailed: 'Запросы не получены', filteredBy: 'Запросы по объекту', showAll: 'показать все'
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
export const gates = { chooseConflictVersions: 'Сначала выберите версию для конфликтов',
  resolveConflict: 'Другая команда уже изменила этот объект. Разрешите конфликт выше: выберите версию для каждого объекта.',
  partMergeUnbuildable: 'Объединение по частям пока не создаёт файл конфигурации. Чтобы принять изменение, выберите версию объекта целиком.' };

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

// Composer build eligibility (#94 MR-04/MR-05): one row per gate, every blocking reason named.
export const buildEligibility = {
  heading: 'Условия сборки', listName: 'Условия сборки конфигурации', notLoaded: 'Проверка состава, покрытия, зависимостей и профиля Target не получена. Сборка недоступна.',
  blockedSummary: 'Изменения приняты. Сборка конфигурации заблокирована: состав, покрытие, зависимости или профиль Target не подтверждены.',
  unknownReason: 'не описанная причина:', unit: 'единица установки', object: 'объект', module: 'модуль', fact: 'не хватает:'
};
// Composer build and freeze of the accepted merged revision. A build is held by the
// server until it is frozen; only a frozen candidate can be reviewed or delivered.
export const composerBuild = {
  start: 'Собрать конфигурацию', retry: 'Собрать заново', freeze: 'Зафиксировать сборку', refresh: 'Обновить состояние',
  ready: 'Сервер соберёт принятую версию решения. Сборка не устанавливается и не выбирает Target.',
  running: 'Собираем конфигурацию. Это может занять несколько минут; не закрывайте страницу.',
  validated: 'Сборка проверена. Зафиксируйте её: неизменяемые байты появятся в списке для решения по ним.',
  manifest: 'Манифест сборки', artifacts: 'файлов сборки', reasons: 'Причины',
  freezing: 'Фиксируем сборку…', frozen: 'Сборка зафиксирована. Открываем её…',
  noMerge: 'Собрать можно только последнюю принятую версию, прошедшую сравнение трёх версий. Подготовьте изменение с указанной базой и примите его; после архивации примите изменение заново.',
  noMergeSummary: 'Изменения приняты, но последняя принятая версия не прошла сравнение трёх версий. Собрать её нельзя.',
  lost: 'Ответ сервера не получен. Обновите состояние перед повтором; сборка не повторяется автоматически.',
  outcomes: {
    unavailable: 'Нативная сборка стала недоступна. Повторите позже.',
    blocked: 'Сборка заблокирована: условия сборки не выполнены.',
    stale: 'Пока шла сборка, принятая версия или рецензия изменились. Обновите состояние и соберите заново.',
    failed: 'Нативный сборщик не подтвердил сборку.',
    'tool-fault': 'Нативный сборщик завершился с ошибкой или без результата.',
    'unbound-receipt': 'Квитанция сборщика не относится к этому запросу сборки.',
    'output-rejected': 'Результат сборки отклонён проверкой.',
    'in-progress': 'Сборка этого решения уже выполняется. Дождитесь её и обновите состояние.',
    'no-validated-build': 'Проверенной сборки для фиксации нет. Соберите конфигурацию заново.',
    'foreign-build': 'Проверенная сборка относится к другой версии или сборщику. Соберите конфигурацию заново.',
    'stale-build': 'Принятая версия изменилась после сборки. Обновите состояние и соберите заново.',
    'build-in-progress': 'Сборка этого решения ещё выполняется. Дождитесь её и обновите состояние.',
    changed: 'Принятая версия решения изменилась или не готова к сборке. Обновите состояние.',
    'invalid-response': 'Ответ сервера не подтверждает проверенную сборку. Обновите состояние.',
    unknown: 'Сервер отказал в сборке.'
  }
};
export const buildGateLabels = { scope: 'Состав выпуска', coverage: 'Нативное покрытие', dependencies: 'Зависимости и лицензии', 'target-profile': 'Профиль Target', materialization: 'Нативная сборка' };
export const buildGateStatuses = { verified: 'подтверждено', blocked: 'заблокировано', unknown: 'не подтверждено' };
export const buildBlockReasons = {
  'missing-native-coverage': 'покрытие не рассчитано', 'unverified-native-coverage': 'покрытие получено не от адаптера покрытия',
  'native-coverage-unavailable': 'нет заявления о нативном покрытии этого решения', 'invalid-native-coverage-declaration': 'заявление о покрытии не прошло проверку',
  'unknown-native-coverage-contract': 'заявление о покрытии по неизвестному контракту', 'unknown-native-coverage': 'источник покрытия не подтверждён',
  'unknown-native-import-unit': 'объект не входит ни в одну нативную единицу установки', 'ambiguous-native-import-unit': 'объект входит в несколько единиц установки',
  'unsupported-native-import-unit': 'единица установки не поддерживается', 'unsupported-native-unit-member': 'вид объекта не поддерживается нативной сборкой',
  'stale-native-unit-coverage': 'покрытие относится к другой версии объекта', 'native-import-unit-cycle': 'единицы установки зависят друг от друга по кругу',
  'missing-native-evidence': 'нет нативного подтверждения установки', 'synthetic-evidence-only': 'только учебные данные, это не нативное подтверждение',
  'duplicate-native-provider': 'одно и то же покрытие заявлено несколько раз', 'stale-native-capture-binding': 'заявление о покрытии относится к другому экспорту',
  'unpinned-native-declaration': 'заявление о покрытии без закреплённой версии', 'unbound-capture': 'экспорт без контрольной суммы',
  'dependency-cycle': 'объекты зависят друг от друга по кругу', 'missing-component': 'объект из состава не найден в экспорте',
  'ambiguous-component': 'объект найден в экспорте несколько раз', 'incomplete-capture': 'в экспорте есть нераспознанные файлы',
  'incomplete-solution-inventory': 'экспорт решения не полный', 'unknown-dependency-category': 'вид зависимости не распознан',
  'unknown-dependency-inventory': 'список зависимостей не распознан', 'empty-required-scope': 'состав выпуска пуст', 'unproven-component': 'объект без доказанной идентичности',
  'missing-reference': 'нужный модуль не найден в экспорте', 'ambiguous-reference': 'нужный модуль найден в нескольких решениях',
  'unverified-licensed-prerequisite': 'платный модуль: лицензия на Target не подтверждена', 'unknown-reference-identity': 'ссылка на зависимость не распознана',
  'unknown-reference-source': 'источник зависимости не распознан', 'unresolved-dependency': 'зависимость не закреплена',
  'missing-dependency-resolution': 'зависимости не проверены', 'unverified-dependency-resolution': 'проверка зависимостей получена не от проверяющего модуля',
  'stale-dependency-resolution': 'проверка зависимостей относится к другому составу', 'native-receipt-contract-unavailable': 'нет нативного контракта подтверждений',
  'unknown-dependency-evidence': 'источник подтверждений зависимостей неизвестен', 'unobserved-native-receipt': 'подтверждение не прочитано с Target',
  'unobserved-target-profile': 'профиль Target не прочитан с сервера', 'unknown-target-profile': 'профиль Target неизвестен',
  'unbound-plan-target-profile': 'состав выпуска не привязан к профилю Target', 'stale-target-profile': 'профиль Target изменился после планирования',
  'stale-target-profile-observation': 'профиль Target прочитан больше суток назад', 'stale-coverage-profile': 'покрытие рассчитано для другого профиля Target',
  'stale-dependency-profile': 'зависимости проверены для другого профиля Target', 'stale-native-profile': 'заявление о покрытии составлено для другого профиля Target',
  'unknown-target-precondition': 'неизвестно, пуст ли Target', 'unproven-target-preservation': 'не подтверждено сохранение остального содержимого Target',
  'stale-target-baseline': 'содержимое Target изменилось', 'inconsistent-target-profile': 'части выпуска рассчитаны для разных профилей Target',
  'unknown-observation-time': 'время чтения профиля неизвестно',
  'native-materialization-unavailable': 'нативный сборщик недоступен', 'native-materialization-unknown': 'сервис не сообщил о нативном сборщике',
  'missing-receipt': 'нет подтверждения с Target', 'assertion-only-receipt': 'подтверждение не проверено', 'unverified-entitlement': 'лицензия не подтверждена',
  'unverified-activation': 'активация не подтверждена', 'duplicate-provider': 'несколько поставщиков', 'unknown-required-provider': 'поставщик неизвестен',
  'ambiguous-provider': 'несколько возможных поставщиков', 'unknown-required-version': 'версия поставщика неизвестна', 'missing-binding': 'нет настройки подключения',
  'native-import-receipt': 'квитанция импорта', 'native-installation-observation': 'наблюдение установки', 'pinned-native-coverage-contract': 'закреплённый контракт покрытия',
  'global-domain-executable-handler': 'обработчик глобальных настроек', 'global-domain-verification': 'проверка глобальных настроек',
  'stale-build-input': 'входные данные изменились во время сборки', 'stale-build-eligibility': 'условия сборки изменились во время подготовки',
  'native-validation-failed': 'нативная проверка пакета не пройдена', 'native-materialization-failed': 'нативный сборщик завершился с ошибкой',
  'native-outcome-unknown': 'результат нативного сборщика неизвестен'
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

// "Как работает" and "Экраны и данные" (UX-06)
export const flows = {
  search: 'Поиск по названию или коду', nothingFound: 'Ничего не найдено', steps: 'шагов', tasks: 'Задачи', noTasks: 'Задач с участием людей в экспорте нет',
  whoDoes: 'Кто выполняет', laneUnknown: 'дорожка не указана', unsupported: 'Не поддерживается', fields: 'Поля', fieldsUnknown: 'Поля не восстановлены из экспорта',
  field: 'Поле', fieldCode: 'Код', fieldType: 'Тип', fieldRequired: 'Обязательное', yes: 'да', no: 'нет', noProcesses: 'Поддерживаемых процессов в принятом состоянии нет',
  processesElsewhere: 'Процессы показаны на вкладке', diagramUnavailable: 'Схема не получена', view: 'Посмотреть процесс',
  fieldsUnavailable: 'Поля не получены', diagramNotBuilt: 'Схема не построена', tooManyProcesses: 'Для обзора выберите меньший пакет: не более 50 процессов'
};

// Empty states
export const empty = { purpose: 'Опишите, для чего это решение', solutions: 'Решений пока нет', requests: 'Запросов пока нет', comments: 'Комментариев пока нет' };

// Existing review classifications (moved from model.js unchanged; renderers and
// the responsibility report depend on these exact strings until UX-03 replaces
// the per-row wording with changeKinds).
export const classificationLabels = {
  unchanged: 'Без изменений', 'intervention-added': 'Добавлен объект', 'component-modified': 'Объект изменён',
  'known-change-retained': 'Наше изменение сохранится', 'known-change-incorporated': 'Наше изменение включено в снимок',
  'external-change': 'Изменено в новой версии', 'component-deleted': 'Удаление заявлено явно', conflict: 'Нужен выбор версии', ambiguous: 'Недостаточно данных'
};
export const elementClassificationLabels = { ...classificationLabels, 'element-added': 'Добавлен', 'element-removed': 'Удалён', 'element-modified': 'Изменён' };
export const elementKindLabels = { node: 'Шаг', transition: 'Переход', variable: 'Переменная', lane: 'Дорожка' };

// Review answers "what changed" in plain sentences first; ownership tables,
// reports and comparison evidence stay one click away under "Подробнее".
export const reviewPlain = {
  versionIntro: 'Сравнение новой версии с текущей. Если принять, новая версия станет текущей.',
  changeIntro: 'Изменение от команды',
  whatChanged: 'Что изменилось',
  partsDetails: 'Подробнее: все части процесса и ответственность',
  responsibility: 'Ответственность',
  moreParts: count => `И ещё ${count}. Полный список — в «Подробнее».`,
  conflictSuffix: ' — конфликт с изменением другой команды',
  partVerbs: { 'element-added': ['добавлен', 'добавлена'], 'element-removed': ['удалён', 'удалена'], changed: ['изменён', 'изменена'] },
  feminine: new Set(['variable', 'lane'])
};

// MR-02 part-level merge inside «Совмещение с принятыми изменениями». The server
// plan is authoritative; part merge is offered, never applied by default.
export const partMerge = {
  intro: 'Сравнение исходной версии, принятой версии и этого изменения. Автоматического объединения нет: для каждого конфликта выберите версию объекта, а для процесса можно совместить его части.',
  choice: 'Совместить части процесса', parts: 'Части процесса', chooseVersion: 'Выберите версию',
  explain: 'Шаги, переходы, дорожки и переменные сравниваются по идентификаторам ELMA, не по названиям и не по порядку.',
  unavailable: 'Совместить части нельзя', findings: 'Что проверить после совмещения',
  chooseParts: 'Выберите версию для каждой части с конфликтом.',
  notMaterialized: 'Совмещённый процесс существует только как сохранённое решение: файл процесса не создан, сборка недоступна.',
  residual: 'Прочие настройки процесса', order: 'Порядок элементов'
};
export const partMergeBlockers = {
  'rename-uncertain': 'возможно, у части сменился идентификатор', 'duplicate-part-identity': 'несколько частей с одним идентификатором',
  'unproven-part-identity': 'не у всех частей есть идентификатор', 'unexplained-change': 'правка не относится ни к одной части',
  'dangling-transition': 'переход останется без своего шага'
};
export const partMergeFindings = {
  renamed: 'Название изменено, идентификатор прежний', 'behaviour-combined': 'Совмещены правки обеих сторон; работа процесса не проверена',
  'dependency-impact': 'Правка одной стороны может влиять на шаги и переходы другой'
};

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
export const candidateEvidence = {
  nativePending: 'Нативная сборка: подтверждение установки и проверка на Target не завершены; к выпуску не допускается. Установить её можно только тестовой установкой на назначенный владельцем DEV2',
  unknown: 'Происхождение сборки не подтверждено; к выпуску не допускается',
  nativeNext: 'Нативная конфигурация собрана и принята; подтверждение установки и проверка на Target ещё требуются. Это не завершённый выпуск.',
  unknownNext: 'Происхождение принятой сборки не подтверждено. Проверьте её доказательства перед доставкой.'
};

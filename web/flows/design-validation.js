// UX-09 design validation materials (docs/plans/intuitive-solution-ui-2026-10-15.md
// §5 R3, §7, §8 UX-09, §9). Owner decision 2026-10-15: design validation, not
// #59/#41 work, as long as it uses Storybook stories with synthetic fixtures, asks
// single comprehension questions and writes nothing into a #59 observation record.
// Answers go to the local Storybook review panel of the `design-validation` journey.
// Labels come from the product vocabulary, so a replaced label is retested as shown.
import { nouns, tabs, steps, actions, changeKinds, facts, header, requestForm } from '../managed/labels.js';

export const exposureSeconds = 5;
export const participantsPerItem = 3;
export const minimumCorrect = 2;

// R3: one question per static story, shown for five seconds and then hidden.
// `correct` is the reading that counts as understood; `ifWrong` is the plan §9 fallback.
export const fiveSecondTests = [
  { id: 'about', storyId: 'managed-workspace--about-saved', question: 'Для чего это решение и кто им пользуется?',
    correct: 'Командировки сотрудников: заявка, утверждение, аванс и отчёт о расходах; пользуются сотрудники и бухгалтерия.',
    hypothesis: 'Страница «О решении» отвечает, для чего решение, раньше любой таблицы.', ifWrong: 'Перенести «Для чего» выше и сократить остальные блоки страницы.' },
  { id: 'about-generated', storyId: 'managed-workspace--about-generated', question: 'Для чего это решение?',
    correct: 'Командировки: заявка и её утверждение; текст составлен автоматически по названиям и его нужно проверить.',
    hypothesis: 'Сгенерированного абзаца достаточно, чтобы начать описание.', ifWrong: 'Пустое состояние с кнопкой «Написать» становится основным, генерация — вторичной кнопкой.' },
  { id: 'review-summary', storyId: 'managed-workspace--summary-mixed', question: 'Что изменилось в этой версии и что нужно сделать дальше?',
    correct: 'Изменено 1 · Добавлено 1 · Удалено 1 · Конфликтов 1 · Без изменений 3; сначала выбрать версию для конфликта, затем принять решение по версии.',
    hypothesis: 'Свёрнутые объекты без изменений не скрывают ничего нужного рецензенту.', ifWrong: 'Раскрывать объекты без изменений в изменённых модулях.' },
  { id: 'review-no-changes', storyId: 'managed-workspace--summary-no-changes', question: 'Изменилось ли что-нибудь в этой версии?',
    correct: `Нет: «${facts.noDifference}»; можно «${actions.closeNoChanges}» или «${actions.refreshAgain}».`,
    hypothesis: 'Версия без изменений называет это одной фразой.', ifWrong: 'Показать фразу крупнее и убрать остальные блоки страницы.' },
  { id: 'decision', storyId: 'managed-workspace--decision', question: 'Какие решения здесь можно принять?',
    correct: `${actions.accept}, ${actions.requestFixes} или ${actions.commentOnly}; принятие сейчас недоступно, и причина указана.`,
    hypothesis: 'Диалог с тремя вариантами понятнее флажка и трёх кнопок.', ifWrong: 'Оставить диалог и добавить явную строку подтверждения.' },
  { id: 'stepper', storyId: 'managed-workspace--lifecycle-build', question: 'Что здесь можно сделать дальше?',
    correct: `Текущий этап «${steps.build}»: ${actions.buildConfiguration}; «${steps.release}» пока недоступен.`,
    hypothesis: 'Этапы с недоступными шагами не выглядят как поломка.', ifWrong: 'Скрывать этапы после первого недоступного.' }
];

// §7 label test: the word alone, without its screen. "What do you expect behind it?"
const card = (id, label, kind, correct) => ({ id, label, kind, correct });
export const labelGroups = [
  { id: 'labels-entry', title: 'Вход и версии', cards: [
    card('solution', nouns.solution, 'понятие', 'Решение ELMA целиком: приложения, процессы и формы.'),
    card('server', nouns.server, 'понятие', 'Сервер ELMA, с которого выгружается решение.'),
    card('load-solution', actions.loadSolution, 'кнопка', 'Выгрузить решение целиком с выбранного сервера.'),
    card('refresh', actions.refresh, 'ссылка', 'Выгрузить решение с того же сервера ещё раз и получить новую версию.'),
    card('version', `${header.versionFrom} 15 окт.`, 'метка', 'Состояние решения на дату выгрузки.'),
    card('module', nouns.module, 'понятие', 'Часть решения вроде «Командировок» с её приложениями и процессами.'),
    card('legacy-uploads', nouns.legacyUploads, 'раздел', 'Старые загрузки файлов вручную, не основной путь.')] },
  { id: 'labels-tabs', title: 'Вкладки решения', cards: [
    card('tab-about', tabs.about, 'вкладка', 'Для чего решение, его модули и последние события.'),
    card('tab-flows', tabs.flows, 'вкладка', 'Процессы решения: шаги, исполнители и переходы.'),
    card('tab-screens', tabs.screensAndData, 'вкладка', 'Формы и поля, приложения и справочники.'),
    card('tab-changes', tabs.changes, 'вкладка', 'Версии решения и что в них изменилось.'),
    card('tab-requests', tabs.requests, 'вкладка', 'Просьбы людей что-то изменить в решении.')] },
  { id: 'labels-review', title: 'Рассмотрение версии', cards: [
    card('review', nouns.review, 'этап', 'Люди смотрят изменения и решают, принимать ли их.'),
    card('accept', actions.accept, 'кнопка', 'Согласиться с версией; в ELMA при этом ничего не устанавливается.'),
    card('request-fixes', actions.requestFixes, 'кнопка', 'Вернуть автору с замечанием, что исправить.'),
    card('comment-only', actions.commentOnly, 'кнопка', 'Написать комментарий, не принимая решения.'),
    card('modified', changeKinds.modified, 'метка', 'Объект был и стал другим.'),
    card('added', changeKinds.added, 'метка', 'Объекта не было, он появился.'),
    card('removed', changeKinds.removed, 'метка', 'Объект был, его больше нет.'),
    card('unchanged', changeKinds.unchanged, 'метка', 'Объект такой же, как раньше.'),
    card('conflict', changeKinds.conflict, 'метка', 'Две правки одного объекта расходятся.'),
    card('conflict-choose', `${changeKinds.conflict} · ${actions.chooseVersion}`, 'метка', 'Две правки одного объекта расходятся; нужно выбрать одну.'),
    card('base', `${facts.baseVersion} 8 окт.`, 'метка', 'С какой прежней версией сравнивается эта.'),
    card('viewed', facts.viewed, 'отметка', 'Я уже посмотрел этот объект; это не проверка и не решение.'),
    card('before-after', `${nouns.before} / ${nouns.after}`, 'заголовки', 'Как было раньше и как стало теперь.'),
    card('details', actions.details, 'ссылка', 'Полное объяснение и технические сведения.'),
    card('system-objects', nouns.systemObjects, 'группа', 'Вспомогательные объекты, которые обычно не нужно смотреть.')] },
  { id: 'labels-requests', title: 'Запросы на изменение', cards: [
    card('request', nouns.request, 'понятие', 'Просьба простыми словами изменить экран, процесс или данные.'),
    card('request-kinds', Object.values(requestForm.kinds).join(' / '), 'выбор', 'Что менять: форму, ход процесса или структуру данных.')] },
  { id: 'labels-lifecycle', title: 'Этапы и пояснения', cards: [
    card('build', steps.build, 'этап', 'Собрать из принятой версии конфигурацию для установки.'),
    card('verify', steps.verify, 'этап', 'Убедиться, что собранное работает на сервере.'),
    card('release', steps.release, 'этап', 'Передать проверенную конфигурацию на следующий сервер.'),
    card('explain', actions.explain, 'кнопка', 'Получить объяснение простыми словами.')] }
];

// §9 "Модуль" hypothesis and the tab structure: closed card sort of plain-language
// tasks into the five tabs. A card placed elsewhere by the majority flags that tab label.
export const cardSortCategories = ['about', 'flows', 'screensAndData', 'changes', 'requests'].map(id => ({ id, label: tabs[id] }));
export const cardSortCards = [
  { id: 'purpose', text: 'Для чего нужно решение и кто им пользуется', category: 'about' },
  { id: 'modules', text: 'Какие модули входят в решение', category: 'about' },
  { id: 'last-events', text: 'Кто и когда последним загрузил решение', category: 'about' },
  { id: 'route', text: 'Маршрут утверждения командировки', category: 'flows' },
  { id: 'step-actor', text: 'Кто выполняет шаг «Проверка бюджета»', category: 'flows' },
  { id: 'form-fields', text: 'Поля формы заявки на аванс', category: 'screensAndData' },
  { id: 'directory', text: 'Справочник валют', category: 'screensAndData' },
  { id: 'what-changed', text: 'Что изменилось с прошлой версии', category: 'changes' },
  { id: 'accept-version', text: 'Принять новую версию', category: 'changes' },
  { id: 'ask-field', text: 'Попросить добавить поле в форму заявки', category: 'requests' },
  { id: 'my-request', text: 'Узнать, выполнена ли моя просьба', category: 'requests' }
];
export const moduleQuestion = 'Как вы называете в ELMA часть решения вроде «Командировки», где лежат её приложения и процессы?';

// Plan §8 UX-09 acceptance: an item with fewer than 2 of 3 correct readings is replaced.
// `readings` holds one boolean per participant; fewer than three is incomplete,
// more than three is a different protocol and is refused rather than rescored.
export function itemVerdict(readings) {
  if (!Array.isArray(readings) || readings.some(value => typeof value !== 'boolean')) throw Error('Ответы участников: только верно или неверно');
  if (readings.length > participantsPerItem) throw Error('Каждое название читают ровно три участника');
  if (readings.length < participantsPerItem) return 'incomplete';
  return readings.filter(Boolean).length >= minimumCorrect ? 'keep' : 'replace';
}

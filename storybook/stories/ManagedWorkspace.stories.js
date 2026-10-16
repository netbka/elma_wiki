import { mountManagedWorkspace } from '../../web/managed/render.js';
import { managedFixture } from '../../web/managed/fixtures.js';
function story(mode) {
  const explain = async () => { throw Error('Учебный пример: данные не сохраняются. Для следующего состояния выберите другую story.'); };
  const model = managedFixture(mode);
  let draft = model.draft ?? null;
  const root = mountManagedWorkspace(model, { draft: { read: () => draft, write: value => { draft = value; }, clear: () => { draft = null; } }, upload: explain, create: explain, prepare: explain, accept: explain, close: explain, archive: explain, comment: explain, resolveMerge: explain,
    acquisition: { servers: async () => ({ servers: [], configured: true }), catalog: explain, start: explain, get: explain, upload: explain },
    explanations: { read: explain, save: explain },
    // UX-07: synthetic request routes. Creation and events return the record as the server would; publication stays local.
    requests: { create: async input => ({ ...input, actor: { id: 'synthetic-you', login: 'you@example.org', provider: 'vk-teams' }, status: 'new', version: 0, events: [], createdAt: new Date().toISOString(), anchorStatus: 'current', target: { ...input.target, anchor: input.target.componentKey ? { key: input.target.componentKey, digest: 'a'.repeat(64) } : null } }),
      event: explain, publish: async id => ({ id: '00000000-0000-4000-8000-000000000086', status: 'unconfigured', context: { changeRequestId: id }, message: 'Отчёт сохранён. Для отправки или проверки результата настройте GitHub.' }), retry: explain },
    context: async id => ({ source: 'widgets/synthetic-contract.json', content: JSON.stringify({ descriptor: { clientScripts: id === 'synthetic-before' ? 'const value = 1;' : 'const value = 2;' } }, null, 2), editable: false,
      limitation: 'Синтетический исходный файл. Код не выполняется.' }),
    // UX-08: a synthetic echo of the actor's own marks, kept for this story only.
    markViewed: async (artifactId, input) => { const rows = model.review.viewed.rows; const index = rows.findIndex(row => row.key === input.key);
      rows[index] = { ...rows[index], status: input.viewed ? 'viewed' : 'unviewed', at: input.viewed ? new Date().toISOString() : null }; return { actor: model.review.viewed.actor, rows }; },
    navigate: () => { root.querySelector('[role=status]').textContent = 'Учебная навигация: выберите нужное состояние в меню Storybook.'; } });
  return root;
}
export default { id: 'managed-workspace', title: 'Решение/Изменение и рассмотрение', parameters: { layout: 'fullscreen' } };
export const Empty = { render: () => story('empty') };
export const List = { render: () => story('list') };
export const Create = { render: () => story('create'), parameters: { docs: { description: { story:
  'Единственный вход: сервер и решение, одна кнопка. Scope, источник, база и ответственность не спрашиваются; сервер записывает их из именованного подключения.' } } } };
export const CreateLegacy = { render: () => story('create-legacy') };
export const PullExporting = { render: () => story('pull-exporting') };
export const PullReady = { render: () => story('pull-ready') };
export const PullFailed = { render: () => story('pull-failed') };
export const PullUnavailable = { render: () => story('pull-unavailable') };
export const Update = { render: () => story('update') };
export const Overview = { render: () => story('overview') };
export const Pending = { render: () => story('pending') };
export const Change = { render: () => story('change') };
export const Review = { render: () => story('review') };
export const Conflict = { render: () => story('conflict') };
export const SummaryMixed = { render: () => story('summary-mixed'), parameters: { docs: { description: { story:
  'Сначала ответ: строка счётчиков, факты как метки, одно «Подробнее». Лента статусов фильтрует карточки; изменённые объекты сгруппированы по модулям, без изменений — одна свёрнутая группа; зависимости сгруппированы с количеством.' } } } };
export const SummaryNoChanges = { render: () => story('summary-no-changes') };
export const SummaryClosed = { render: () => story('summary-closed') };
export const Decision = { render: () => story('decision'), parameters: { docs: { description: { story:
  'UX-03b: the one "Решение по версии" button opens one dialog with Принять, Запросить доработку and Только комментарий. A closed gate disables acceptance and shows its reason inside the dialog.' } } } };
export const ViewedMarked = { render: () => story('viewed-marked'), parameters: { docs: { description: { story:
  'UX-08: each changed object carries the reviewer’s own "Просмотрено" mark; the header counts "Просмотрено · 2 из 4". Marks are personal reading progress and never gate the decision.' } } } };
export const ViewedChanged = { render: () => story('viewed-changed'), parameters: { docs: { description: { story:
  'UX-08: an object changed after it was marked: the mark is cleared, the row says "Изменилось после просмотра" and the header counts only 1 of 4.' } } } };
export const ViewedSecondActor = { render: () => story('viewed-second-actor'), parameters: { docs: { description: { story:
  'UX-08: the same review seen by a second reviewer shows only their own single mark (1 of 4); the first reviewer’s marks stay theirs.' } } } };
export const LifecycleBuild = { render: () => story('lifecycle-build'), parameters: { docs: { description: { story:
  'UX-04: header badge and lifecycle stepper. Загрузка, Сравнение and Рассмотрение are done, Сборка is the current step because the server reported an available builder and every build eligibility gate verified (hypothetical), Выпуск is unavailable with its reason.' } } } };
export const LifecycleVerified = { render: () => story('lifecycle-verified') };
export const AboutEmpty = { render: () => story('about-empty'), parameters: { docs: { description: { story:
  'UX-05: О решении with no saved purpose: the empty sentence and one Написать button; module cards and the activity list with two distinct people.' } } } };
export const AboutGenerated = { render: () => story('about-generated') };
export const AboutSaved = { render: () => story('about-saved') };
export const AboutStale = { render: () => story('about-stale') };
export const AboutError = { render: () => story('about-error') };
export const Overlap = { render: () => story('overlap') };
export const Ambiguous = { render: () => story('ambiguous') };
export const Stale = { render: () => story('stale') };
export const Archived = { render: () => story('archived') };
export const Loading = { render: () => story('loading') };
export const LoadError = { render: () => story('load-error') };
export const Changes = { render: () => story('changes') };
export const Solution = { render: () => story('solution') };
export const Flows = { render: () => story('flows'), parameters: { docs: { description: { story:
  'UX-06: Как работает. Processes by module with business names, declared responsibility and a one-line reading from their human tasks; search by name or code; the selected process opens the shared diagram with step detail.' } } } };
export const FlowsError = { render: () => story('flows-error') };
export const FlowsUnknown = { render: () => story('flows-unknown') };
export const Requests = { render: () => story('requests'), parameters: { docs: { description: { story:
  'UX-07: the Запросы tab. Newest first; status, author, where (module · business name, with the anchor warning when the object changed), created, fulfilling version. "Новый запрос" opens the form.' } } } };
export const RequestsEmpty = { render: () => story('requests-empty') };
export const RequestsObject = { render: () => story('requests-object') };
export const RequestsError = { render: () => story('requests-error') };
export const RequestForm = { render: () => story('request-form'), parameters: { docs: { description: { story:
  'UX-07: the form opened from a step of Как работает. Что изменить preselected, Где filled from the entry point (object and step), Кратко, Что должно быть, Зачем, Срочность, one Отправить.' } } } };
export const RequestFormField = { render: () => story('request-form-field'), parameters: { docs: { description: { story:
  'UX-07: the form opened from the field row Сумма of Экраны и данные. Где names the object and the field; the request anchors to that declared field (code, position and fingerprint checked by the server).' } } } };
export const RequestRecord = { render: () => story('request-record'), parameters: { docs: { description: { story:
  'UX-07: a request record: where it points and whether the object changed, author and date, text, publication consent, history, comment and status forms.' } } } };
export const RequestPublished = { render: () => story('request-published') };
export const Screens = { render: () => story('screens'), parameters: { docs: { description: { story:
  'UX-06: Экраны и данные. Forms and data objects by module with the fields their export declares; search; system objects collapsed; processes referenced on Как работает.' } } } };
export const NativeComponents = { render: () => story('native-components') };
export const PaidDependencies = { render: () => story('paid-dependencies') };
export const NoSource = { render: () => story('no-source') };
export const NeedsFixes = { render: () => story('needs-fixes') };
export const PendingConflict = { render: () => story('pending-conflict') };
export const ReviewComment = { render: () => story('review-comment') };
export const ReviewFindings = { render: () => story('review-findings'), parameters: { docs: { description: { story:
  'Замечание блокирует принятие. Добавить исправление — главное следующее действие; загрузка другой версии отделена от него, в том числе на узком экране.' } } } };
export const ReviewResolved = { render: () => story('review-resolved') };
export const ReviewAccepted = { render: () => story('review-accepted') };
export const ReviewStaleAnchor = { render: () => story('review-stale-anchor') };
export const ReviewRemovedAnchor = { render: () => story('review-removed-anchor') };
export const ReviewAmbiguousAnchor = { render: () => story('review-ambiguous-anchor') };
export const ElementsAdded = { render: () => story('elements-added') };
export const ElementsBoundary = { render: () => story('elements-boundary') };
export const ElementsConflict = { render: () => story('elements-conflict') };
export const ElementsUnknown = { render: () => story('elements-unknown') };
export const ChangeBase = { render: () => story('change-base'), parameters: { docs: { description: { story:
  'Принятые полные версии с точной ревизией и SHA-256; прежняя версия остаётся выбираемой. Без выбора база неизвестна.' } } } };
export const ChangeDraft = { render: () => story('change-draft') };
export const ChangeRejected = { render: () => story('change-rejected') };
export const BaseDeclared = { render: () => story('base-declared') };
export const BaseUnknown = { render: () => story('base-unknown') };
export const MergeRequired = { render: () => story('merge-required'), parameters: { docs: { description: { story:
  'Принятая версия и это изменение правят один объект. Выбор версии обязателен, решение сохраняется с причиной и ничего не принимает.' } } } };
export const MergeResolved = { render: () => story('merge-resolved') };
export const MergeStale = { render: () => story('merge-stale') };
export const MergeBlocked = { render: () => story('merge-blocked') };
export const MergeParts = { render: () => story('merge-parts'), parameters: { docs: { description: { story:
  'Обе команды правили один процесс. Части сравниваются по идентификаторам ELMA; совмещение частей выбирается явно, конфликт части требует выбора, а влияние на поведение показано для проверки.' } } } };
export const MergePartsBlocked = { render: () => story('merge-parts-blocked') };

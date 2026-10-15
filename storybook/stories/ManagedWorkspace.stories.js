import { mountManagedWorkspace } from '../../web/managed/render.js';
import { managedFixture } from '../../web/managed/fixtures.js';
function story(mode) {
  const explain = async () => { throw Error('Учебный пример: данные не сохраняются. Для следующего состояния выберите другую story.'); };
  const model = managedFixture(mode);
  let draft = model.draft ?? null;
  const root = mountManagedWorkspace(model, { draft: { read: () => draft, write: value => { draft = value; }, clear: () => { draft = null; } }, upload: explain, create: explain, prepare: explain, accept: explain, close: explain, archive: explain, comment: explain, resolveMerge: explain,
    acquisition: { servers: async () => ({ servers: [], configured: true }), catalog: explain, start: explain, get: explain, upload: explain },
    explanations: { read: explain, save: explain },
    context: async id => ({ source: 'widgets/synthetic-contract.json', content: JSON.stringify({ descriptor: { clientScripts: id === 'synthetic-before' ? 'const value = 1;' : 'const value = 2;' } }, null, 2), editable: false,
      limitation: 'Синтетический исходный файл. Код не выполняется.' }),
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
export const LifecycleBuild = { render: () => story('lifecycle-build'), parameters: { docs: { description: { story:
  'UX-04: header badge and lifecycle stepper. Загрузка, Сравнение and Рассмотрение are done, Сборка is the current step because the server reported an available builder, Выпуск is unavailable with its reason.' } } } };
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

import { mountManagedWorkspace } from '../../web/managed/render.js';
import { managedFixture } from '../../web/managed/fixtures.js';
function story(mode) {
  const explain = async () => { throw Error('Учебный пример: данные не сохраняются. Для следующего состояния выберите другую story.'); };
  const model = managedFixture(mode);
  let draft = model.draft ?? null;
  const root = mountManagedWorkspace(model, { draft: { read: () => draft, write: value => { draft = value; }, clear: () => { draft = null; } }, upload: explain, create: explain, prepare: explain, accept: explain, archive: explain, comment: explain,
    context: async id => ({ source: 'widgets/synthetic-contract.json', content: JSON.stringify({ descriptor: { clientScripts: id === 'synthetic-before' ? 'const value = 1;' : 'const value = 2;' } }, null, 2), editable: false,
      limitation: 'Синтетический исходный файл. Код не выполняется.' }),
    navigate: () => { root.querySelector('[role=status]').textContent = 'Учебная навигация: выберите нужное состояние в меню Storybook.'; } });
  return root;
}
export default { id: 'managed-workspace', title: 'Решение/Изменение и рассмотрение', parameters: { layout: 'fullscreen' } };
export const Empty = { render: () => story('empty') };
export const List = { render: () => story('list') };
export const Create = { render: () => story('create') };
export const Overview = { render: () => story('overview') };
export const Pending = { render: () => story('pending') };
export const Change = { render: () => story('change') };
export const Review = { render: () => story('review') };
export const Conflict = { render: () => story('conflict') };
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

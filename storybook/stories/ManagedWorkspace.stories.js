import { mountManagedWorkspace } from '../../web/managed/render.js';
import { managedFixture } from '../../web/managed/fixtures.js';
function story(mode) {
  const explain = async () => { throw Error('Учебный пример: данные не сохраняются. Для следующего состояния выберите другую story.'); };
  const root = mountManagedWorkspace(managedFixture(mode), { upload: explain, create: explain, prepare: explain, accept: explain, archive: explain,
    navigate: () => { root.querySelector('[role=status]').textContent = 'Учебная навигация: выберите нужное состояние в меню Storybook.'; } });
  return root;
}
export default { id: 'managed-workspace', title: 'Рабочее пространство/Жизненный цикл', parameters: { layout: 'fullscreen' } };
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

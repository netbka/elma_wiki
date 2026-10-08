import { mountManagedWorkspace } from '../../web/managed/render.js';
import { solutionHandoffFixture } from '../../web/managed/handoff-fixtures.js';

function story(mode) {
  const explain = async () => { throw Object.assign(Error('Учебный пример: выберите следующее состояние в меню. Данные не сохраняются.'), { requiresRefresh: mode === 'lost-response' }); };
  return mountManagedWorkspace(solutionHandoffFixture(mode), { handoff: { create: explain, change: explain, preview: async () => ({ text: '{"synthetic":true}', truncated: false }), download: explain, open: explain } });
}
export default { id: 'solution-handoff', title: 'Решение/Передача принятой версии', parameters: { layout: 'fullscreen' } };
export const Create = { render: () => story('create') };
export const Blocked = { render: () => story('blocked') };
export const Review = { render: () => story('review') };
export const Ready = { render: () => story('ready') };
export const Candidate = { render: () => story('candidate') };
export const Prepared = { render: () => story('prepared') };
export const Stale = { render: () => story('stale') };
export const Loading = { render: () => story('loading') };
export const LoadError = { render: () => story('load-error') };
export const LostResponse = { render: () => story('lost-response') };

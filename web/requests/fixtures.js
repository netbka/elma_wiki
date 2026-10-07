const request = { id: 'REQ-ABCDEF123456', project: 'wiki', revision: 1, created: 1000, messages: [{ text: 'Улучшить сообщение о пустом решении.' }], questions: [], specification: null, pullRequest: null, deployed: false };
export function requestFixture(state) {
  if (state === 'loading') return { synthetic: true, loading: true };
  if (state === 'unconfigured') return { synthetic: true, unconfigured: true };
  if (state === 'error') return { synthetic: true, error: 'Очередь временно недоступна' };
  if (state === 'empty') return { synthetic: true, projects: ['wiki'], requests: [] };
  const r = { ...request, state };
  if (state === 'WAITING_USER') r.questions = ['Какой текст показать пользователю?'];
  if (state === 'AWAITING_APPROVAL') r.specification = { summary: 'Обновить сообщение пустого состояния.', criteria: ['Понятное сообщение', 'Видна кнопка добавления'], scope: ['Текст портала'] };
  if (state === 'BLOCKED') r.blocker = 'provider_not_configured';
  if (state === 'PR_READY') r.pullRequest = { url: 'https://github.com/example/synthetic/pull/1' };
  return { synthetic: true, projects: ['wiki'], requests: [r], selected: r };
}

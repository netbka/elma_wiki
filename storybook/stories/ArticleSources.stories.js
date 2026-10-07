import { renderArticleSources } from '../../web/public-article-sources.mjs';

export default {
  id: 'public-article-sources',
  title: 'Система/Источники статей',
  parameters: { layout: 'fullscreen' }
};
const story = sources => ({
  render: () => {
    const main = document.createElement('main');
    main.className = 'article';
    main.innerHTML = renderArticleSources(sources);
    return main;
  }
});
export const Listed = { ...story(['extensions/e365-workbench/core.mjs', 'https://elma365.com/ru/help/platform/lowcode-devops-pm.html']), name: 'Источники указаны' };
export const Empty = { ...story([]), name: 'Источники не указаны' };
export const Invalid = { ...story(['README.md', '.local/SYNTHETIC_PRIVATE_VALUE', { token: 'SYNTHETIC_PRIVATE_VALUE' }, 'https://elma365.com/ru/help/platform/%']), name: 'Некорректные ссылки скрыты' };

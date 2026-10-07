import { createArticleSourcesModel, renderArticleSources } from '../../web/public-article-sources.mjs';

export default {
  id: 'public-article-sources',
  title: 'Система/Источники публичной статьи',
  parameters: { layout: 'fullscreen' }
};

// The same renderer as lib/public-site.mjs, inside the same article shell the
// public page uses, so the Storybook state is the production state.
const story = (sources, status) => ({
  render: () => {
    const model = createArticleSourcesModel(sources, { status });
    const main = document.createElement('main');
    main.innerHTML = `<article class="article"><div class="eyebrow">Разработка через файлы</div><h1>Учебная статья</h1><p class="lead">Статья показывает, как читать пакет; поведение ELMA не проверялось в этом примере.</p><span class="badge">${model.status}</span><section id="body"><h2>Текст статьи</h2><p>Содержимое статьи для демонстрации блока источников.</p></section>${renderArticleSources(model)}</article>`;
    return main;
  }
});

export const Listed = {
  ...story(['README.md', 'lib/e365.mjs', 'https://elma365.com/ru/help/platform/export-import-elma365.html'], 'Экспериментально · импорт не испытан'),
  name: 'Источники указаны'
};
export const Empty = { ...story([], undefined), name: 'Источники не указаны' };
export const Invalid = {
  ...story(['lib/e365.mjs', '.local/SYNTHETIC_PRIVATE_VALUE', 'https://user:SYNTHETIC_PRIVATE_VALUE@elma365.com/ru/help/platform/a.html', { token: 'SYNTHETIC_PRIVATE_VALUE' }], 'Структура формата'),
  name: 'Некорректные источники'
};

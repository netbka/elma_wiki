// Declared references, not verification evidence. Shared by public HTML and Storybook.
// Based on the existing issue-27 draft; rejected values are never echoed publicly.
export const SOURCES_SECTION_ID = 'article-sources';
export const SOURCES_TITLE = "Источники";
const REPOSITORY_FILE_URL = 'https://github.com/netbka/elma_wiki/blob/main/';
// Explicitly reviewed public files used by the current articles. Add new paths
// here with the article, after checking they are public. A directory allowlist
// alone would also accept docs/private-data.json or tools/credentials.env.
const PUBLIC_FILES = new Set([
  'README.md', 'server.mjs', 'lib/e365.mjs', 'lib/project-parser.mjs',
  'lib/projects.mjs', 'docs/E365_FILE_PROJECTS.md', 'examples/e365/README.md',
  'extensions/e365-workbench/core.mjs', 'extensions/e365-workbench/extension.cjs',
  'tools/workbench.mjs', 'tools/package-workbench.mjs', 'test/workbench.test.mjs'
]);
const DOCUMENTATION_ORIGINS = new Set(['https://elma365.com', 'https://www.elma365.com']);
const invalid = () => ({ kind: 'invalid' });
const escapeHtml = value => String(value).replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Accept reviewed repository files or plain HTTPS ELMA help pages, not arbitrary URLs. */
export function classifySource(value) {
  if (typeof value !== 'string') return invalid();
  const text = value.trim();
  if (!text || text.length > 1024 || /[\s\u0000-\u001f\u007f-\u009f<>"'`\\%?]/.test(text)) return invalid();
  const file = text.startsWith(REPOSITORY_FILE_URL) ? text.slice(REPOSITORY_FILE_URL.length) : text;
  if (PUBLIC_FILES.has(file)) return { kind: 'repository', label: file, href: REPOSITORY_FILE_URL + file };
  // Do not decode, normalize or repair an invalid source into an allowed one.
  let url;
  try { url = new URL(text); } catch { return invalid(); }
  if (!DOCUMENTATION_ORIGINS.has(url.origin) || url.href !== text || url.username || url.password ||
      !/^\/(ru|en)\/help\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html$/.test(url.pathname) ||
      (url.hash && !/^#[A-Za-z0-9_-]+$/.test(url.hash))) return invalid();
  return { kind: 'external', label: text, href: text };
}

export function createArticleSourcesModel(sources) {
  if (sources == null || (Array.isArray(sources) && sources.length === 0)) return { state: 'empty', items: [] };
  if (!Array.isArray(sources)) return { state: 'invalid', items: [invalid()] };
  const items = Array.from(sources, classifySource);
  return { state: items.some(item => item.kind === 'invalid') ? 'invalid' : 'listed', items };
}

/** Raw declared sources enter one validation path, also used by Storybook. No network or file reads. */
export function renderArticleSources(sources) {
  const model = createArticleSourcesModel(sources);
  const items = model.items.map(item => item.kind === 'invalid'
    ? '<li class="muted">Источник скрыт: некорректная или непубличная ссылка.</li>'
    : `<li><a href="${escapeHtml(item.href)}" rel="noreferrer noopener">${escapeHtml(item.label)}</a>
      <span class="muted">${item.kind === 'repository' ? "файл публичного репозитория" : "внешняя документация"}</span></li>`).join('');
  return `<section class="article-sources section" data-sources-state="${model.state}" aria-labelledby="${SOURCES_SECTION_ID}">
    <h2 id="${SOURCES_SECTION_ID}">${SOURCES_TITLE}</h2>
    <p>Источники — материалы, на которые ссылается статья. Ссылка не подтверждает проверку на ELMA365. Применимость и ограничения смотрите в статусе и тексте статьи.</p>
    ${model.state === 'empty' ? '<p>Для этой статьи источники не указаны.</p>' : `<ul>${items}</ul>`}
    ${model.state === 'invalid' ? '<p class="muted">Недопустимые значения не публикуются. Автору статьи нужно исправить список источников; это не меняет статус проверки.</p>' : ''}
  </section>`;
}

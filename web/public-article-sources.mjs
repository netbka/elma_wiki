// Declared article sources for the static public site. Both the public build
// (lib/public-site.mjs) and Storybook render the same model with this module.
// A source is a reference the article relies on. Listing it is not evidence
// that the described behaviour was verified on ELMA365: that is what the
// article status says, and this renderer never upgrades it.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const SOURCES_SECTION_ID = 'article-sources';
export const SOURCES_TITLE = 'Источники';
export const REPOSITORY_URL = 'https://github.com/netbka/elma_wiki';
const REPOSITORY_FILE_URL = REPOSITORY_URL + '/blob/main/';

// Exact reviewed files, not entire directories which could contain private paths.
// Add new public source files alongside their article and an existence check.
const PUBLIC_FILES = new Set([
  'README.md', 'server.mjs', 'lib/e365.mjs', 'lib/project-parser.mjs',
  'lib/projects.mjs', 'docs/E365_FILE_PROJECTS.md', 'examples/e365/README.md',
  'extensions/e365-workbench/core.mjs', 'extensions/e365-workbench/extension.cjs',
  'tools/workbench.mjs', 'tools/package-workbench.mjs', 'test/workbench.test.mjs'
]);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const EXTERNAL_HOSTS = new Set(['elma365.com', 'www.elma365.com', 'github.com']);
const MAX_LENGTH = 200;

// Never stringify or retain rejected values: they may contain credentials or
// private paths. Diagnostics describe the category, not the rejected content.
const invalid = (_value, reason) => ({ kind: 'invalid', reason });

export function classifySource(value) {
  if (typeof value !== 'string') return invalid(value, 'источник должен быть строкой');
  const text = value.trim();
  if (!text) return invalid(value, 'пустое значение');
  if (text.length > MAX_LENGTH) return invalid(value, 'слишком длинное значение');
  if (/[\s\u0000-\u001f\u007f-\u009f<>"'`\\]/.test(text)) return invalid(value, 'недопустимые символы');
  if (text.startsWith('/') || /^[A-Za-z]:\//.test(text)) return invalid(value, 'абсолютный путь не публикуется');
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return classifyExternal(text, value);
  return classifyRepositoryPath(text, value);
}

function classifyExternal(text, value) {
  let url;
  try { url = new URL(text); } catch { return invalid(value, 'адрес не разобран'); }
  if (url.protocol !== 'https:') return invalid(value, 'разрешены только https-ссылки');
  if (url.username || url.password) return invalid(value, 'адрес содержит учётные данные');
  if (!EXTERNAL_HOSTS.has(url.hostname)) return invalid(value, 'узел вне списка публичной документации');
  if (url.hostname === 'github.com' && !url.pathname.startsWith('/netbka/elma_wiki/')) return invalid(value, 'ссылка на GitHub вне репозитория проекта');
  let pathname;
  try { pathname = decodeURI(url.pathname); } catch { return invalid(value, 'адрес содержит некорректное кодирование'); }
  // Do not normalize traversal/encodings into an allowed destination, or publish
  // token-bearing queries, alternate ports and arbitrary same-host endpoints.
  if (url.href !== text || url.port || text.includes('?') || text.includes('%') ||
      (url.hash && !/^#[A-Za-z0-9_-]+$/.test(url.hash))) return invalid(value, 'адрес вне поддержанного формата публичной ссылки');
  if (url.hostname === 'github.com') {
    if (url.hash || !text.startsWith(REPOSITORY_FILE_URL) || !PUBLIC_FILES.has(text.slice(REPOSITORY_FILE_URL.length))) {
      return invalid(value, 'файл вне списка публичных источников');
    }
  } else if (!/^\/(ru|en)\/help\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html$/.test(url.pathname)) {
    return invalid(value, 'адрес вне раздела публичной документации');
  }
  return { kind: 'external', href: url.href, label: url.hostname + pathname.replace(/\/$/, '') };
}

function classifyRepositoryPath(text, value) {
  const segments = text.split('/');
  if (segments.some(segment => !SEGMENT.test(segment))) return invalid(value, 'путь содержит скрытый или недопустимый сегмент');
  if (segments.length === 1 && !/\./.test(segments[0])) return invalid(value, 'нужен путь к файлу, а не к каталогу');
  if (!PUBLIC_FILES.has(text)) return invalid(value, 'путь вне публичной части репозитория');
  return { kind: 'repository', path: text, href: REPOSITORY_FILE_URL + segments.map(encodeURIComponent).join('/'), label: text };
}

/**
 * @param {unknown} sources declared article sources
 * @param {{ status?: unknown }} article status wording shown next to the references
 */
export function createArticleSourcesModel(sources, { status } = {}) {
  const statusText = typeof status === 'string' && status.trim() ? status.trim() : 'Руководство';
  if (sources == null || (Array.isArray(sources) && sources.length === 0)) return { state: 'empty', status: statusText, items: [] };
  if (!Array.isArray(sources)) return { state: 'invalid', status: statusText, items: [invalid(sources, 'список источников должен быть массивом')] };
  const items = Array.from(sources, classifySource);
  return { state: items.some(item => item.kind === 'invalid') ? 'invalid' : 'listed', status: statusText, items };
}

const KIND_LABEL = { repository: 'файл репозитория', external: 'внешняя документация' };

export function renderArticleSources(model) {
  const heading = `<h2 id="${SOURCES_SECTION_ID}">${SOURCES_TITLE}</h2>`;
  const note = `<p class="sources-note">Источники — материалы, на которые опирается статья. Ссылка на источник не означает, что описанное поведение проверено на ELMA365; степень проверки указана в статусе статьи: <span class="badge">${escapeHtml(model.status)}</span>.</p>`;
  if (model.state === 'empty') {
    return `<section class="sources" data-sources-state="empty" aria-labelledby="${SOURCES_SECTION_ID}">${heading}${note}<p class="sources-empty">Для этой статьи источники не указаны. Проверяйте описанное поведение на собственном стенде.</p></section>`;
  }
  const items = model.items.map(item => {
    if (item.kind === 'invalid') {
      return `<li class="source source-invalid"><span class="source-label">Источник не распознан</span> <span class="source-kind">${escapeHtml(item.reason)}; ссылка не публикуется</span></li>`;
    }
    return `<li class="source source-${item.kind}"><a href="${escapeHtml(item.href)}" rel="noreferrer noopener">${escapeHtml(item.label)}</a> <span class="source-kind">${KIND_LABEL[item.kind]}</span></li>`;
  }).join('');
  const warning = model.state === 'invalid'
    ? '<p class="sources-warning">Некорректные или непубличные значения скрыты. Автору статьи нужно исправить список источников. Это не влияет на статус статьи и не является подтверждением проверки.</p>' : '';
  return `<section class="sources" data-sources-state="${model.state}" aria-labelledby="${SOURCES_SECTION_ID}">${heading}${note}<ul class="sources-list">${items}</ul>${warning}</section>`;
}

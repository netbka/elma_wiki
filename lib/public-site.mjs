import { FIELD_GUIDE_PATH, FIELD_GUIDE_TITLE, renderFieldGuide } from '../web/public-field-guide.mjs';
import { SOURCES_SECTION_ID, SOURCES_TITLE, renderArticleSources } from '../web/public-article-sources.mjs';

// Public pages reuse the landing template and the same article/example sources
// as the internal service. Only explicitly rendered content can be published.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const articlePath = id => `/articles/${encodeURIComponent(id)}/`;
const examplePath = entity => `/examples/${encodeURIComponent(entity.service)}-${encodeURIComponent(entity.code)}/`;
const card = (href, title, lead) => `<a class="card task" href="${href}"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(lead)}</p></a>`;
const table = (headers, rows) => `<div class="scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function publicTemplate(template) {
  const tasks = { field: FIELD_GUIDE_PATH, handler: articlePath('script-roundtrip'), update: articlePath('file-update') };
  const page = template
    .replace(/<a href="\/dashboard">Мои проекты<\/a>/g, '<a href="/articles/">Руководства</a>')
    .replace(/<a class="button" href="\/dashboard">Загрузить E365<\/a>/g, '<a class="button" href="/articles/">Читать руководства</a>')
    .replace(/href="\/p\/showcase\/#\/article\/([a-z0-9-]+)"/g, (_, id) => `href="${articlePath(id)}"`)
    .replace(/href="\/p\/showcase\/#\/task\/(field|handler|update)"/g, (_, task) => `href="${tasks[task]}"`)
    .replace('<a class="button secondary" href="/p/showcase/">Открыть учебный пример</a>', `<a class="button secondary" href="${FIELD_GUIDE_PATH}">Пройти учебный пример</a>`)
    .replaceAll('href="/p/showcase/"', 'href="/examples/"')
    .replaceAll('href="/guide"', 'href="/guide/"')
    .replace('<script type="module" src="/service.js"></script>', '<script type="module" src="/public.js"></script>')
    .replace('Загрузите .e365 и получите приватную вики: объекты, поля, обработчики, файлы и инструкции для разработчиков.', 'Изучите устройство конфигурации ELMA365: объекты, поля, обработчики и порядок изменений — по руководствам и учебным примерам.')
    .replace('Один файл → один отдельный проект. Доступ к вашим файлам есть только у владельца и оператора хостинга.', 'Руководства и учебные примеры доступны без регистрации.')
    .replace('<h2>Файл остаётся у вас</h2>', '<h2>Два варианта использования</h2>')
    .replace(/<p>Оригинал и извлечённые части хранятся в приватном хранилище сервиса\.[\s\S]*?<\/p>/, '<p>Публичный сайт знакомит с подходом к разработке и показывает учебные примеры. Для работы со своей конфигурацией команда разворачивает внутренний сервис в Docker: там доступны загрузка файлов, приватные проекты и инструменты разработки.</p>');
  if (/href="\/(?:dashboard|login|auth|api)(?:["/?])|src="\/service\.js"/.test(page)) throw Error('В публичном шаблоне осталась ссылка на внутренний сервис');
  return page;
}

export function renderPublicFiles({ landing, articles, example }) {
  if (!example || !Array.isArray(example.entities)) throw Error('Нужен синтетический учебный пример');
  const shell = publicTemplate(landing), files = new Map();
  function page(title, content) {
    return shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)} · E365 Wiki</title>`)
      .replace(/<main>[\s\S]*?<\/main>/, `<main>${content}</main>`);
  }
  files.set('index.html', shell);
  files.set(FIELD_GUIDE_PATH.slice(1) + 'index.html', page(FIELD_GUIDE_TITLE, renderFieldGuide()));
  const groups = [...new Set(articles.map(a => a.group || 'Руководства'))];
  files.set('articles/index.html', page('Руководства', `<div class="eyebrow">База знаний</div><h1>Руководства по ELMA365</h1><p class="lead">От структуры пакета до проверки изменений. Примеры в статьях предназначены для изучения.</p>${groups.map(group => `<section><h2>${escapeHtml(group)}</h2><div class="grid">${articles.filter(a => (a.group || 'Руководства') === group).map(a => card(articlePath(a.id), a.title, a.lead)).join('')}</div></section>`).join('')}`));
  for (const article of articles) {
    if (!/^[a-z0-9-]+$/.test(article.id)) throw Error('Некорректный адрес статьи');
    const sections = article.sections.map(section => {
      const body = section.body.replace(/<table\b[\s\S]*?<\/table>/g, table => `<div class="scroll">${table}</div>`).replace(/href="#\/article\/([a-z0-9-]+)"/g, (_, id) => {
        if (!articles.some(a => a.id === id)) throw Error('Не найдена связанная статья');
        return `href="${articlePath(id)}"`;
      });
      return `<section id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>${body}</section>`;
    }).join('');
    files.set(`articles/${article.id}/index.html`, page(article.title, `<a href="/articles/">← Все руководства</a><article class="article"><div class="eyebrow">${escapeHtml(article.group)}</div><h1>${escapeHtml(article.title)}</h1><p class="lead">${escapeHtml(article.lead)}</p><span class="badge">${escapeHtml(article.status || 'Руководство')}</span><nav aria-label="Содержание статьи" class="section"><ul>${article.sections.map(s => `<li><a href="#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a></li>`).join('')}<li><a href="#${SOURCES_SECTION_ID}">${SOURCES_TITLE}</a></li></ul></nav>${sections}${renderArticleSources(article.sources)}</article>`));
  }
  files.set('examples/index.html', page('Учебные примеры', `<div class="eyebrow">Синтетическая конфигурация</div><h1>Учебная служба обращений</h1><p class="lead">Приложения, формы, процесс и настройки на примере небольшого модуля.</p><p>Все объекты вымышлены. Карточки объясняют структуру; готовый пакет для импорта из них не собирается.</p><p><a href="${FIELD_GUIDE_PATH}">Начать с задачи: найти поле →</a></p><div class="grid">${example.entities.map(e => card(examplePath(e), e.name || e.code, `${e.service} / ${e.namespace} / ${e.code}`)).join('')}</div><a href="${articlePath('package-map')}">Как устроен пакет E365 →</a>`));
  for (const entity of example.entities) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entity.service) || !/^[a-zA-Z0-9_-]+$/.test(entity.code)) throw Error('Некорректный адрес учебного объекта');
    const fields = entity.fields || [], functions = entity.functionSources || [];
    files.set(`examples/${entity.service}-${entity.code}/index.html`, page(entity.name || entity.code, `<a href="/examples/">← Учебные примеры</a><div class="eyebrow">Синтетический пример</div><h1>${escapeHtml(entity.name || entity.code)}</h1><p class="lead">${escapeHtml(entity.service)} / ${escapeHtml(entity.namespace)} / ${escapeHtml(entity.code)}</p><h2>Поля и контекст</h2>${fields.length ? table(['Код', 'Название', 'Тип', 'Контекст'], fields.map(f => [f.code, f.name, f.type, f.origin])) : '<p>В этом объекте поля не описаны.</p>'}${functions.length ? `<h2>Обработчики</h2>${table(['Функция', 'Контекст', 'Источник'], functions.map(f => [f.name, f.side === 'client' ? 'Клиент' : 'Сервер', f.path]))}` : ''}<p>Это учебное описание одного объекта. Проверяйте привязки, права и поведение на собственном стенде.</p><div class="actions"><a href="${articlePath('field-form-recipe')}">Поле и форма</a><a href="${articlePath('script-roundtrip')}">Работа со скриптами</a><a href="${articlePath('file-update')}">Проверка обновления</a></div>`));
  }
  files.set('guide/index.html', page('Как это работает', `<div class="eyebrow">Знакомство с E365 Wiki</div><h1>От конфигурации к понятной карте</h1><p class="lead">Изучите подход здесь, а со своими файлами работайте во внутреннем сервисе команды.</p><section><h2>1. Разберитесь в структуре</h2><p>Решение объединяет сервисы, пространства имён и объекты. Поле приложения, состояние формы и контекст процесса имеют разные роли.</p><a href="${articlePath('package-map')}">Карта пакета E365 →</a></section><section><h2>2. Попробуйте учебные примеры</h2><p>Посмотрите, как связаны приложения, формы и обработчики на синтетической службе обращений.</p><a href="/examples/">Открыть примеры →</a></section><section><h2>3. Подготовьте изменение</h2><p>Руководства объясняют, где искать исходник, что сохранить в полном пакете и как проверить результат. Статус рецепта указан в статье.</p><a href="/articles/">Все руководства →</a></section><section><h2>Внутренний сервис команды</h2><p>Полная версия разворачивается в Docker в инфраструктуре команды. Она предназначена для работы с файлами .e365, приватными проектами и инструментами разработки. Инструкции настройки находятся в репозитории.</p><a href="https://github.com/netbka/elma_wiki#readme" rel="noreferrer">Настройка внутреннего сервиса →</a></section>`));
  files.set('404.html', page('Страница не найдена', '<h1>Страница не найдена</h1><p>Выберите руководство или учебный пример.</p><div class="actions"><a href="/">На главную</a><a href="/articles/">Руководства</a><a href="/examples/">Примеры</a></div>'));
  return files;
}

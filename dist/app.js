import { articles, serviceDescriptions } from './articles.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Number(n || 0).toLocaleString('ru-RU');
const iconPaths = {
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  book:'<path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M17 6.5h1M17 17.5h1"/>',
  folder:'<path d="M3 5h6l2 3h10v12H3z"/>',
  file:'<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h5"/>',
  code:'<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M8 15c8 0 10-1 10-7"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  alert:'<path d="M12 3 2 21h20zM12 9v5M12 17h.01"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  compare:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  terminal:'<path d="m5 7 5 5-5 5M13 17h6"/><rect x="2" y="2" width="20" height="20" rx="3"/>',
  settings:'<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/><circle cx="12" cy="12" r="5"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  print:'<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z"/>',
  link:'<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
const badge = (text, tone='') => `<span class="badge ${tone}">${esc(text)}</span>`;
const href = (path, params={}) => `#/${path}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}`;
const service = key => (Object.hasOwn(serviceDescriptions,key) ? serviceDescriptions[key] : null) || {label:key,description:'Сущности и ресурсы сервиса из выгрузки.',change:'Сохраните manifest, ресурсы и точные пути; отдельно проверьте контракт target.',article:'architecture'};
let data, activeServer = localStorage.getItem('elma-wiki-server') || 'local';
let filters = {}, currentPage = 1, detailTab = 'fields', searchTimer, searchSelected = 0;
const searches = new Map();
const articleMap = new Map(articles.map(a => [a.id,a]));
const articlesText = new Map(articles.map(a => [a.id, [a.title,a.lead,...a.sections.map(s => s.title + ' ' + s.body.replace(/<[^>]*>/g, ' '))].join(' ').toLowerCase()]));

function server() { return data.servers[activeServer]; }
function route() {
  const [path, query=''] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
  return {parts:path.split('/').map(decodeURIComponent), params:Object.fromEntries(new URLSearchParams(query))};
}
function entity(id) { return server().entities.find(e => e.id === id); }
function solution(code) { return server().solutions.find(s => s.code === code); }
function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано в буфер обмена'); }
  catch { toast('Буфер недоступен — выделите и скопируйте текст'); }
}
function shell() {
  const s = server(), r = route(), current = r.parts.join('/');
  const groups = [
    {label:'Начало работы',items:[['overview','Обзор проекта','home'],['article/start','Как пользоваться вики','book'],['article/architecture','Архитектура проекта','layers'],['article/environments','Серверы и окружение','server']]},
    {label:'Конфигурация',items:[['solutions','Решения','grid',s.stats.exported],['structure','Структура конфигурации','folder'],['article/filesystem','Файлы и формат .e365','file'],['entities','Каталог сущностей','list',num(s.stats.entities)],['fields','Поля и переменные','code'],['functions','Функции и обработчики','code'],['dependency-map','Карта зависимостей','branch'],['comparison','Сравнение окружений','compare'],['upload','Загрузить конфигурацию','file']]},
    ...['Разработка через файлы','Разработка','Процедуры','Справочник'].map(label=>({label,items:articles.filter(a=>a.group===label).map(a=>['article/'+a.id,a.title,label==='Процедуры'?'terminal':'book'])}))
  ];
  $('#app').innerHTML = `
    <div class="mobile-scrim" data-action="menu-close"></div>
    <aside class="sidebar" aria-label="Навигация по вики">
      <a class="brand" href="/dashboard"><div class="brand-mark">E</div><div><div class="brand-word">ELMA<span>365</span></div><small>Техническая вики проекта</small></div></a>
      <nav class="sidebar-nav">${groups.map(g=>`<div class="nav-group"><div class="nav-label">${g.label}</div>${g.items.map(([path,title,i,count])=>`<a class="nav-link ${current===path?'active':''}" ${current===path?'aria-current="page"':''} href="${href(path)}">${icon(i)}<span>${title}</span>${count?`<span class="nav-count">${count}</span>`:''}</a>`).join('')}</div>`).join('')}</nav>
      <div class="sidebar-bottom"><span class="snapshot-dot"></span>Снимок конфигурации<strong>${esc(data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('ru-RU') : 'Нет загруженных данных')}</strong></div>
    </aside>
    <header class="topbar"><button class="hamburger" data-action="menu" aria-label="Открыть меню">${icon('menu')}</button>
      <button class="search-trigger" data-action="search">${icon('search')}<span>Поиск по вики, полям и функциям</span><kbd>Ctrl K</kbd></button>
      <div class="topbar-right"><div class="readonly">${icon('lock')}Только чтение</div><label class="server-control"><span>Окружение</span><select id="server-select" aria-label="Выбрать сервер">${Object.entries(data.servers).map(([key,value])=>`<option value="${esc(key)}" ${activeServer===key?'selected':''}>${esc(value.label||key)}</option>`).join('')}</select></label></div>
    </header>
    <div class="page"><main id="main" class="page-inner" tabindex="-1"></main></div>`;
}
function breadcrumbs(title, parent='База знаний') {
  return `<div class="breadcrumbs"><a href="#/overview">${icon('home')}</a>${icon('chevron')}<a href="#/overview">${parent}</a>${icon('chevron')}<span>${esc(title)}</span></div>`;
}
const actions = () => `<div class="page-actions"><button class="icon-button" data-action="copy-link" title="Скопировать ссылку">${icon('link')}Ссылка</button><button class="icon-button" data-action="print" title="Печать текущей страницы">${icon('print')}Печать</button></div>`;
const footer = () => `<footer class="page-footer"><span>ELMA365 · Инженерная база знаний · Структурный индекс</span><span>Документация и структура · <a href="#/article/coverage">Границы охвата</a></span></footer>`;
function heading(eyebrow,title,lead) { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p class="lead">${lead}</p></div>${actions()}</div>`; }
function flow() { return `<div class="flow">${[['Снимок','capture / build'],['Изменение','Файлы workspace'],['Компиляция','stage / compile'],['Проверка','check / history'],['Подтверждение','Экспорт target']].map(([t,sub],i)=>`<div class="flow-step"><span class="step-number">${i+1}</span><div><strong>${t}</strong><small>${sub}</small></div></div>`).join('')}</div>`; }
function overview() {
  const s = server();
  const cards = [['architecture','Устройство проекта','Как связаны сервер, решение, модуль и сущность.','layers'],['workflow','Полный цикл разработки','От свежего экспорта до проверки результата.','terminal'],['variables','Переменные и контексты','Context, ViewContext, RPC и параметры окружения.','code'],['dependencies','Работа с зависимостями','Поставщики, повторяющиеся модули и версии.','branch']];
  return `${breadcrumbs('Обзор проекта')}
    <div class="eyebrow">Инженерная база знаний</div><h1>Проект ELMA365.<br>Вся структура — под рукой.</h1>
    <p class="lead">Разбирайтесь в модулях, находите нужный код и проходите весь цикл разработки по проверенным инструкциям.</p>
    <div class="status-row">${badge('Локальная конфигурация','green')}${badge('Справочный портал · только чтение')}${badge('Частичный охват','amber')}</div>
    <div class="stats">${[[s.stats.exported,'Извлечено решений','Из '+s.stats.catalog+' в каталоге','grid'],[s.stats.modules,'Модульных пространств','В текущем окружении','layers'],[s.stats.entities,'Записей сущностей','Включая зависимые копии','folder'],[s.stats.fields,'Полей в индексе','Схемы, формы и процессы','code']].map(([n,title,sub,i])=>`<div class="stat"><div class="stat-top"><span>${title}</span>${icon(i)}</div><div class="stat-number">${num(n)}</div><small>${sub}</small></div>`).join('')}</div>
    <div class="section-label"><h2>С чего начать</h2><span>Короткий путь к нужному файлу</span></div>
    <div class="home-grid"><div class="start-cards">${cards.map(([id,t,desc,i])=>`<a class="start-card" href="#/article/${id}"><div class="card-icon">${icon(i)}</div><h3>${t}</h3><p>${desc}</p><footer><span>Открыть руководство</span>${icon('arrow')}</footer></a>`).join('')}</div>
      <div class="terminal"><div class="eyebrow">Карта исходников</div><h3>От задачи к месту изменения</h3><p>Выберите сервер и решение. Найдите модуль, сущность и связанные файлы — в одном каталоге.</p><pre><code><span class="terminal-root">example_solution/</span>\n└─ modules/example_module/\n   ├─ appViews     → поля приложения\n   ├─ widgets      → формы и скрипты\n   ├─ processor    → логика процессов\n   └─ permissions  → доступ и роли</code></pre><a href="#/structure">Исследовать структуру ${icon('arrow')}</a></div></div>
    <section class="developer-entry"><div class="section-label"><h2>Разработка ELMA365 через файлы</h2></div><p>Работайте с JSON и TypeScript в привычном редакторе. Поля, формы, связи, проверка runtime и первая версия расширения VS Code.</p><div class="article-links">${[["file-development","Начать с E365"],["field-form-recipe","Примеры с кодом"],["workbench","Инструменты и VS Code"]].map(([id,title])=>`<a class="article-link" href="#/article/${id}">${icon("code")}${title}${icon("chevron")}</a>`).join("")}</div></section><div class="section-label"><h2>Как проходит изменение</h2><a href="#/article/workflow">Полная процедура ${icon('arrow')}</a></div>${flow()}
    <div class="notice-inline">${icon('file')}<p>Загрузите .e365 в этот портал. Исходный код не исполняется, значения и тела скриптов не входят в индекс. <a href="#/upload">Загрузить конфигурацию</a></p></div>
    <div class="home-bottom"><div><div class="section-label" style="margin-top:0"><h2>Полезные инструкции</h2></div><div class="article-links">${[['environments','Как выбрать сервер и переменные окружения'],['widgets','Где менять форму, скрипт и обработчик'],['compiler','Что проверять перед сборкой пакета'],['troubleshooting','Ошибка, причина и следующий шаг']].map(([id,t])=>`<a class="article-link" href="#/article/${id}">${icon('book')}${t}<span>${articleMap.get(id).time}</span>${icon('chevron')}</a>`).join('')}</div></div>
    <div><div class="section-label" style="margin-top:0"><h2>Окружения портала</h2></div><div class="server-summary">${Object.entries(data.servers).map(([key,v])=>`<div class="server-box"><strong>${esc(v.label||key)}</strong><p>${v.stats.exported} из ${v.stats.catalog} решений<br>${num(v.stats.entities)} записей сущностей</p><div class="mini-bar"><div style="width:${v.stats.catalog ? v.stats.exported/v.stats.catalog*100 : 0}%"></div></div><a href="#/solutions" data-switch-server="${key}">Состав конфигурации ${icon('arrow')}</a></div>`).join('')}</div><p class="hint-line">Namespace может повторяться в зависимых пакетах. Данные серверов сохраняются раздельно.</p></div></div>${footer()}`;
}
function articlePage(id) {
  const a = articleMap.get(id); if (!a) return notFound();
  const n = articles.indexOf(a), prev = articles[n-1], next = articles[n+1];
  return `${breadcrumbs(a.title,a.group)}<div class="article-layout"><article class="article-main">${heading(a.group,a.title,esc(a.lead))}<div class="article-meta"><span>${icon('clock')}${a.time} чтения</span><span>${icon('check')}${esc(a.status || 'По структуре формата')}</span><span>Универсальное руководство</span></div>
    ${a.sections.map(s=>`<section class="article-section" id="section-${s.id}"><h2>${s.title}</h2>${s.body}</section>`).join('')}
    <div class="article-sources"><h3>Источники и реализация</h3>${a.sources.map(s=>/^https:\/\//.test(s)?`<p><a href="${esc(s)}" rel="noreferrer">${esc(s)}</a></p>`:`<code>${esc(s)}</code>`).join('')}</div>
    <div class="article-next">${prev?`<div><small>Предыдущая статья</small><a href="#/article/${prev.id}">← ${esc(prev.title)}</a></div>`:'<div></div>'}${next?`<div><small>Далее</small><a href="#/article/${next.id}">${esc(next.title)} →</a></div>`:''}</div></article>
    <nav class="article-toc" aria-label="Содержание статьи"><strong>На этой странице</strong>${a.sections.map(s=>`<a href="#section-${s.id}" data-section="${s.id}">${s.title}</a>`).join('')}</nav></div>${footer()}`;
}
function options(values, current, title) { return `<option value="">${esc(title)}</option>${values.map(v=>`<option value="${esc(v)}" ${current===v?'selected':''}>${esc(v)}</option>`).join('')}`; }
function filterControls({modules=true, services=true, solutions=true}={}) {
  const s = server();
  return `<div class="filters"><label class="filter-input">${icon('search')}<input id="catalog-query" value="${esc(filters.q||'')}" placeholder="Название, код, поле, функция или путь…" aria-label="Поиск в каталоге"></label>${solutions?`<select id="filter-solution" aria-label="Фильтр решений">${options(s.solutions.filter(x=>x.status==='editable').map(x=>x.code),filters.solution,'Все решения')}</select>`:''}${modules?`<select id="filter-module" aria-label="Фильтр модулей">${options(Object.keys(s.namespaces),filters.module,'Все модули')}</select>`:''}${services?`<select id="filter-service" aria-label="Фильтр сервисов">${options([...new Set(s.entities.map(e=>e.service))].sort(),filters.service,'Все сервисы')}</select>`:''}</div>`;
}
function searchString(e) {
  if (!searches.has(e.id)) searches.set(e.id, [e.name,e.code,e.namespace,e.module,e.service,e.kind,e.solution,e.file,...(e.functions||[]),...(e.fields||[]).flatMap(f=>[f.code,f.name,...(f.references||[]).map(r=>r.value)]),...Object.keys(e.variableUsage||{})].join(' ').toLowerCase());
  return searches.get(e.id);
}
function match(e) {
  const words = (filters.q||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return (!filters.solution||e.solution===filters.solution)&&(!filters.module||e.module===filters.module)&&(!filters.service||e.service===filters.service)&&words.every(w=>searchString(e).includes(w));
}
function paginate(items, size=30) {
  const count = Math.max(1,Math.ceil(items.length/size)); currentPage = Math.min(currentPage,count);
  const subset = items.slice((currentPage-1)*size,currentPage*size);
  return {items:subset,caption:`${items.length?num((currentPage-1)*size+1):0}–${num(Math.min(items.length,currentPage*size))} из ${num(items.length)}`,nav:items.length>size?`<div class="pagination"><button data-page="${currentPage-1}" ${currentPage===1?'disabled':''}>← Назад</button><span>Страница ${currentPage} из ${count}</span><button data-page="${currentPage+1}" ${currentPage===count?'disabled':''}>Далее →</button></div>`:''};
}
function empty(text='Совпадений нет. Измените поиск или фильтры.') { return `<div class="empty">${icon('search')}${esc(text)}</div>`; }
function entityRows(items) { return `<div class="entity-list">${items.map(e=>`<a class="entity-row" href="${href('entity/'+encodeURIComponent(e.id))}"><div class="entity-icon">${icon(e.service==='widgets'?'code':e.service==='processor'?'branch':'file')}</div><div><div class="entity-title">${esc(e.name || e.code || e.kind)}</div><div class="entity-sub">${esc(e.namespace)} / ${esc(e.code)}</div></div><div class="entity-owner">${esc(e.solution)}<br>${esc(service(e.service).label)}</div><div class="entity-chips">${e.fields.length?badge(e.fields.length+' полей'):''}${e.functions?.length?badge(e.functions.length+' функций'):''}</div>${icon('chevron')}</a>`).join('')}</div>`; }
function entityCatalog() {
  const items = server().entities.filter(match), pag = paginate(items);
  return `${breadcrumbs('Каталог сущностей','Конфигурация')}${heading('Конфигурация · '+activeServer,'Каталог сущностей','Все объекты извлечённых решений с точными путями, полями, функциями и связанными файлами.')}${filterControls()}<div class="result-caption"><span>${pag.caption} записей · ${esc(activeServer)}</span><a href="#/structure">Показать как дерево</a></div>${pag.items.length?entityRows(pag.items):empty()}${pag.nav}${footer()}`;
}
function structure() {
  const items = server().entities.filter(match);
  const grouped = new Map();
  for (const e of items) {
    if (!grouped.has(e.solution)) grouped.set(e.solution,new Map());
    const mods=grouped.get(e.solution); if (!mods.has(e.module)) mods.set(e.module,new Map());
    const svcs=mods.get(e.module); if (!svcs.has(e.service)) svcs.set(e.service,[]); svcs.get(e.service).push(e);
  }
  return `${breadcrumbs('Структура конфигурации','Конфигурация')}${heading('Конфигурация · '+activeServer,'Структура конфигурации','Решение → модуль → сервис → сущность. Раскройте ветку, чтобы увидеть связанные исходники.')}${filterControls()}<div class="result-caption"><span>${num(items.length)} записей · ${grouped.size} решений</span><a href="#/article/filesystem">Как устроены папки</a></div><div class="tree-wrap">${[...grouped].map(([code,mods])=>`<details ${filters.solution||filters.q?'open':''}><summary>${icon('grid')}<strong>${esc(solution(code)?.name||code)}</strong>${badge(code)}</summary><div class="tree-child">${[...mods].map(([mod,svcs])=>`<details ${filters.module||filters.q?'open':''}><summary>${icon('folder')}<code>${esc(mod)}</code>${badge([...svcs.values()].reduce((n,x)=>n+x.length,0)+' объектов')}</summary><div class="tree-child">${[...svcs].map(([svc,entities])=>`<details ${filters.service||filters.q?'open':''}><summary>${icon('layers')}${esc(service(svc).label)} <span class="text-muted">${esc(svc)}</span>${badge(entities.length)}</summary><div class="tree-child">${entities.map(e=>`<a href="${href('entity/'+encodeURIComponent(e.id))}">${esc(e.namespace)} / ${esc(e.code)}<small>${esc(e.name || e.kind)}${e.functions?.length?' · '+e.functions.length+' функций':''}</small></a>`).join('')}</div></details>`).join('')}</div></details>`).join('')}</div></details>`).join('')||empty()}</div><p class="hint-line">Каждое решение сохраняет собственные копии зависимых сущностей. Файлы без однозначного владельца и манифесты остаются в shared/.</p>${footer()}`;
}
function solutionsPage() {
  const items = server().solutions.filter(s=>!(filters.q||'')||[s.code,s.name,...s.modules].join(' ').toLowerCase().includes(filters.q.toLowerCase()));
  return `${breadcrumbs('Решения','Конфигурация')}${heading('Пакеты конфигурации · '+activeServer,'Решения проекта','Единицы экспорта и выпуска. Название решения может отличаться от пространства имён его модулей.')}${filterControls({modules:false,services:false,solutions:false})}<div class="result-caption"><span>${items.length} решений в каталоге · ${server().stats.exported} извлечено</span><a href="#/article/coverage">Границы охвата</a></div><div class="solution-grid">${items.map(s=>`<a class="solution-card" href="${href('solution/'+encodeURIComponent(s.code))}"><div>${badge(s.status==='editable'?'Из выгрузки':'Платный пакет',s.status==='editable'?'green':'amber')}</div><h3>${esc(s.name || s.code)}</h3><div class="solution-code">${esc(s.code)}</div><p>${s.status==='editable'?s.modules.length+' пространств имён · '+num(s.entities)+' записей':'Исходники недоступны: CLI отказал в экспорте.'}</p><div>${s.modules.slice(0,3).map(m=>`<span class="module-chip">${esc(m)}</span>`).join('')}${s.modules.length>3?`<span class="module-chip">+${s.modules.length-3}</span>`:''}</div><footer><span>${s.status==='editable'?'Состав и зависимости':'Причина недоступности'}</span>${icon('arrow')}</footer></a>`).join('')}</div>${items.length?'':empty()}${footer()}`;
}
function solutionPage(code) {
  const s = solution(code); if (!s) return notFound();
  if(s.status!=='editable')return `${breadcrumbs(s.name,'Решения')}${heading('Недоступная выгрузка',s.name,`Код решения: <code>${esc(s.code)}</code>`)}<div class="callout warning"><strong>CLI не поддерживает платный пакет</strong><p>При экспорте получен отказ paid package are not supported. Код и структура этого решения не входят в доступный снимок. Для дополнения каталога требуется поддерживаемый читаемый export.</p></div><p><a href="#/article/coverage">Подробности охвата</a></p>${footer()}`;
  const ents = server().entities.filter(e=>e.solution===code);
  return `${breadcrumbs(s.name,'Решения')}${heading('Решение · '+activeServer,s.name,`<code>${esc(s.code)}</code> · ${esc(s.type||'SOLUTION')} · исходные объекты сохранены в отдельном package workspace`)}<div class="status-row">${badge('Из выгрузки','green')}${badge(s.modules.length+' модулей')}${badge(num(s.entities)+' записей')}${badge(num(s.files)+' файлов')}</div><div class="detail-grid"><div class="panel"><h3>Модульные пространства</h3>${s.modules.map(m=>`<a class="module-chip" href="${href('entities',{solution:code,module:m})}">${esc(m)}</a>`).join('')}<p class="hint-line">Модуль может быть частью решения или зависимой копией. Одинаковое имя не доказывает одинаковую историю.</p><a href="${href('structure',{solution:code})}">Открыть дерево решения ${icon('arrow')}</a></div><div class="panel"><h3>Где находится исходник</h3>${fileRow(`server-configs/${activeServer}/workspaces/${code}/index.json`)}${fileRow(`server-configs/${activeServer}/workspaces/${code}/shared/package.json`)}<p>Скрипты и entity находятся внутри modules/&lt;namespace&gt;/services/. Для сборки нужен полный stage решения.</p></div></div><div class="section-label"><h2>Состав по сервисам</h2><a href="${href('entities',{solution:code})}">Все сущности ${icon('arrow')}</a></div><div class="table-wrap"><table><thead><tr><th>Сервис</th><th>Назначение</th><th>Записей</th></tr></thead><tbody>${Object.entries(s.services).map(([k,n])=>`<tr><td><a href="${href('entities',{solution:code,service:k})}"><code>${esc(k)}</code></a></td><td>${esc(service(k).description)}</td><td>${n}</td></tr>`).join('')}</tbody></table></div><div class="section-label"><h2>Объявленные зависимости</h2><a href="${href('dependency-map',{solution:code})}">Карта связей ${icon('arrow')}</a></div><div class="status-row">${Object.entries(s.dependencyCounts).map(([cat,n])=>badge(cat+' · '+n)).join('')}</div>${dependencyTable(s.dependencies.slice(0,15))}<p class="hint-line">Показаны первые ${Math.min(s.dependencies.length,15)} из ${s.dependencies.length} связей. Полный список доступен на карте зависимостей. Состояние относится к этому export, а не всему серверу.</p><div class="section-label"><h2>С чего начать изменение</h2></div><div class="article-links"><a class="article-link" href="#/article/workflow">${icon('terminal')}Полный цикл разработки${icon('chevron')}</a><a class="article-link" href="#/article/dependencies">${icon('branch')}Как выбрать поставщика и проверить версии${icon('chevron')}</a></div>${footer()}`;
}
function fileRow(path) { return `<div class="file-row">${icon('file')}<code>${esc(path)}</code><button data-copy="${esc(path)}" aria-label="Скопировать путь">${icon('copy')}</button></div>`; }
function entityPage(id) {
  const e = entity(id); if (!e) return notFound('Объект отсутствует в выбранном сервере. Вернитесь в каталог или переключите окружение.');
  const s=service(e.service), full = e.workspace+'/'+e.file;
  return `${breadcrumbs(e.code,'Сущности')}${heading(s.label+' · '+activeServer,e.name||e.code,`<code>${esc(e.namespace)} / ${esc(e.code)}</code>`)}<div class="status-row">${badge('Из выгрузки','green')}${badge(e.service)}${badge(e.kind||'entity')}${badge(e.module)}</div>
    <div class="detail-grid"><div class="panel"><h3>Принадлежность объекта</h3><dl class="kv"><dt>Сервер</dt><dd>${esc(server().label)}</dd><dt>Решение</dt><dd><a href="${href('solution/'+encodeURIComponent(e.solution))}">${esc(e.solution)}</a></dd><dt>Модуль</dt><dd><a href="${href('entities',{module:e.module,solution:e.solution})}"><code>${esc(e.module)}</code></a></dd><dt>Namespace</dt><dd><code>${esc(e.namespace)}</code></dd><dt>Код</dt><dd><code>${esc(e.code)}</code></dd>${Object.entries(e.dataBinding||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd><code>${esc(v)}</code></dd>`).join('')}</dl></div><div class="panel"><h3>Где менять</h3><p>${esc(s.change)}</p><a href="#/article/${s.article}">Руководство по этому типу объекта ${icon('arrow')}</a><p class="hint-line">Изменения выполняются в локальном проекте. Портал показывает пути и контракты, не редактирует source.</p></div></div>
    <div class="section-label"><h2>Основной файл сущности</h2></div>${fileRow(full)}
    <div class="tabs" role="tablist" aria-label="Подробности объекта">${[['fields','Поля',e.fields.length],['functions','Функции',e.functions?.length||0],['bindings','Привязки и переменные',Object.keys(e.variableUsage||{}).length],['files','Файлы и ресурсы','']].map(([id,t,count])=>`<button role="tab" aria-selected="${detailTab===id}" class="${detailTab===id?'active':''}" data-tab="${id}">${t}${count!==''?' · '+count:''}</button>`).join('')}</div><div id="entity-tab-content">${entityTab(e)}${detailTab==='functions'?functionLocations(e):''}</div>${footer()}`;
}
function functionLocations(e) {
  const rows=e.functionSources||[];
  return rows.length?`<div class="section-label"><h2>Какая функция в каком файле</h2></div><div class="table-wrap"><table><thead><tr><th>Функция</th><th>Сторона</th><th>Точный файл / pointer</th></tr></thead><tbody>${rows.map(f=>`<tr><td><code>${esc(f.name)}()</code></td><td>${badge({client:'Клиент',server:'Сервер',process:'Процесс'}[f.side]||f.side)}</td><td><code>${esc(f.path)}</code></td></tr>`).join('')}</tbody></table></div>`:'';
}
function fieldsTable(fields, e=null) {
  return `<div class="table-wrap"><table><thead><tr><th>Поле / переменная</th><th>Тип</th><th>Свойства</th><th>Объявление / связь</th></tr></thead><tbody>${fields.map(f=>`<tr><td><code>${esc(f.code)}</code><span class="field-name">${esc(f.name!==f.code?f.name:'')}</span></td><td><code>${esc(f.type)}</code></td><td>${[f.array?'Массив':'',f.required?'Обязательное':'',f.hidden?'Скрытое':'',f.readonly?'Только чтение':'',f.formula?'Формула':''].filter(Boolean).map(x=>badge(x)).join(' ')||'<span class="text-muted">—</span>'}</td><td><code>${esc(f.origin)}</code>${f.references?.length?`<div class="field-name">${f.references.map(r=>esc(r.key)+': '+esc(r.value)).join('<br>')}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
function entityTab(e) {
  if (detailTab==='fields')return `<p class="hint-line">Определения полей из <code>${esc(e.service==='widgets'?'descriptor.fields':e.service==='processor'?'context':'fields')}</code>. Значения и формулы не опубликованы. Для связанной формы Context берётся из приложения/процесса, а собственные поля относятся к ViewContext.</p>${e.fields.length?fieldsTable(e.fields,e):empty('В этом объекте индекс не обнаружил определений полей. Смотрите связанное приложение, форму или settings source.')}<p><a href="#/article/variables">Как поле попадает в Context и ViewContext →</a></p>`;
  if (detailTab==='functions')return `<div class="section-label"><h2>Объявления функций</h2>${badge(e.functions?.length||0)}</div>${e.functions?.length?`<div class="function-grid">${e.functions.map(f=>`<span class="function-chip">${esc(f)}()</span>`).join('')}</div>`:empty('Объявления function не найдены. Стрелочные, динамические или внешние обработчики могут не входить в индекс.')}<p class="hint-line">Имена извлечены из объявлений function. Список не является полным TypeScript-анализом. Реальная привязка обработчика показана на вкладке «Привязки и переменные».</p>${e.rpcFunctions?.length?`<div class="section-label"><h2>Клиентские вызовы RPC</h2></div><div class="function-grid">${e.rpcFunctions.map(f=>`<span class="function-chip">Server.rpc.${esc(f)}()</span>`).join('')}</div>`:''}${e.embeddedScriptPointer?`<div class="callout"><strong>Встроенный код процесса</strong><p>Скрипт хранится строкой по JSON pointer <code>${esc(e.embeddedScriptPointer)}</code>. Widget compiler не компилирует этот тип исходника.</p></div>`:''}<div class="section-label"><h2>Исходные скрипты</h2></div>${(e.scripts||[]).map(path=>fileRow(e.workspace+'/'+path)).join('')||'<p class="hint-line">Side-файлы скриптов в индексе не зарегистрированы.</p>'}`;
  if (detailTab==='bindings')return `<div class="section-label"><h2>Системные функции</h2></div>${Object.entries(e.lifecycle||{}).map(([slot,b])=>`<div class="binding-card"><code>${esc(slot)}</code>${icon('arrow')}<code>${esc(b.name||'—')}</code>${badge(b.type||b.kind||'binding','green')}</div>`).join('')||'<p class="hint-line">systemFunctions не зарегистрированы. Другие события могут быть связаны внутри template.</p>'}<div class="section-label"><h2>Использование переменных</h2></div><p class="hint-line">Только идентификаторы обращений из исходника. Количество означает число текстовых вхождений, а не число вызовов при исполнении.</p>${Object.entries(e.variableUsage||{}).length?`<div class="table-wrap"><table><thead><tr><th>Выражение</th><th>Вхождений</th><th>Контекст</th></tr></thead><tbody>${Object.entries(e.variableUsage).map(([v,n])=>`<tr><td><code>${esc(v)}</code></td><td>${n}</td><td>${v.startsWith('ViewContext')?'Собственные данные формы':v.startsWith('Context')?'Данные контекста':v.startsWith('Application')?'Приложение':'Namespace / Global'}</td></tr>`).join('')}</tbody></table></div>`:empty('Статические обращения к .data не найдены. Возможны другие способы доступа или динамические ссылки.')}${e.globalReferences?.length?`<div class="section-label"><h2>Literal Global-ссылки</h2></div>${e.globalReferences.map(x=>`<a class="module-chip" href="${href('entities',{q:x})}">Global.${esc(x)}</a>`).join('')}`:''}<p><a href="#/article/variables">Контексты, объявления и схема передачи →</a></p>`;
  const other = e.file.replace(/^modules\/[^/]+\/services\//,'');
  return `<div class="section-label"><h2>Пути для локальной работы</h2></div>${fileRow(e.workspace+'/'+e.file)}${(e.scripts||[]).map(path=>fileRow(e.workspace+'/'+path)).join('')}${fileRow(e.workspace+'/shared/'+e.service+'/manifest.json')}${fileRow(e.workspace+'/modules/'+e.module+'/module.json')}<p class="hint-line">После stage основной файл восстанавливается по исходному пути <code>${esc(e.source)}</code>. Ресурсы и полный состав файла перечислены в локальном index.json/module.json. Не все вспомогательные файлы являются скриптами.</p><div class="callout"><strong>Пакет собирается целиком</strong><p>Манифест и файлы shared являются частью решения. Папка модуля сама по себе не является импортируемым package.</p></div>`;
}
function fieldsIndex() {
  const all = server().entities.filter(match).flatMap(e=>e.fields.filter(f=>!filters.q||[f.code,f.name,f.type,...f.references.map(r=>r.value)].join(' ').toLowerCase().includes(filters.q.toLowerCase())||searchString(e).includes(filters.q.toLowerCase())).map(f=>({e,f})));
  const pag=paginate(all,35);
  return `${breadcrumbs('Поля и переменные','Конфигурация')}${heading('Схемы данных · '+activeServer,'Поля и переменные','Где объявлено поле, какой у него тип и к какой сущности оно относится. Реальные значения не включены.')}${filterControls()}<div class="result-caption"><span>${pag.caption} определений</span><a href="#/article/variables">Как устроены контексты</a></div>${pag.items.length?`<div class="table-wrap"><table><thead><tr><th>Поле</th><th>Тип</th><th>Сущность / namespace</th><th>Место объявления</th></tr></thead><tbody>${pag.items.map(({e,f})=>`<tr><td><code>${esc(f.code)}</code><span class="field-name">${esc(f.name===f.code?'':f.name)}</span></td><td><code>${esc(f.type)}</code>${f.array?'<span class="field-name">Массив</span>':''}</td><td><a href="${href('entity/'+encodeURIComponent(e.id))}">${esc(e.name||e.code)}</a><span class="field-name">${esc(e.namespace)} · ${esc(e.solution)}</span></td><td><code>${esc(f.origin)}</code><span class="field-name">${esc(service(e.service).label)}</span></td></tr>`).join('')}</tbody></table></div>`:empty()}${pag.nav}${footer()}`;
}
function functionsIndex() {
  const all = server().entities.filter(match).flatMap(e=>(e.functions||[]).filter(fn=>!filters.q||fn.toLowerCase().includes(filters.q.toLowerCase())||[e.code,e.name,e.namespace,e.solution].join(' ').toLowerCase().includes(filters.q.toLowerCase())).map(fn=>({e,fn})));
  const pag=paginate(all,35);
  return `${breadcrumbs('Функции и обработчики','Конфигурация')}${heading('Код и события · '+activeServer,'Функции и обработчики','Объявления function из виджетов и процессов. Откройте сущность, чтобы найти source и привязки вызовов.')}${filterControls()}<div class="result-caption"><span>${pag.caption} объявлений</span><a href="#/article/widgets">Как привязать обработчик</a></div>${pag.items.length?`<div class="table-wrap"><table><thead><tr><th>Функция</th><th>Сущность</th><th>Решение / модуль</th><th>Источник</th></tr></thead><tbody>${pag.items.map(({e,fn})=>`<tr><td><code>${esc(fn)}()</code></td><td><a data-detail-tab="functions" href="${href('entity/'+encodeURIComponent(e.id))}">${esc(e.name||e.code)}</a><span class="field-name">${esc(e.namespace)} / ${esc(e.code)}</span></td><td><code>${esc(e.solution)}</code><span class="field-name">${esc(e.module)}</span></td><td>${esc(service(e.service).label)}<span class="field-name">${e.embeddedScriptPointer?'/scripts':'side-файлы .ts'}</span></td></tr>`).join('')}</tbody></table></div>`:empty()}${pag.nav}<p class="hint-line">Одно объявление в нескольких exports учитывается несколько раз. Имя функции не доказывает, что она привязана и выполняется.</p>${footer()}`;
}
function dependencyStatus(status) {
  return {ambiguous:['Несколько поставщиков','amber'],present:['Найдена в окружении','green'],'namespace-present-unverified':['Namespace без точной цели','amber'],unresolved:['Не разрешена в этом export','amber'],'unknown-schema':['Неизвестная схема','amber']}[status]||[status||'—','muted'];
}
function dependencyTable(deps) {
  return `<div class="table-wrap"><table><thead><tr><th>Категория</th><th>Цель: сервис / namespace / код</th><th>Пакет-владелец</th><th>Состояние</th></tr></thead><tbody>${deps.map(d=>{const [label,tone]=dependencyStatus(d.status);return `<tr class="dep-row"><td><code>${esc(d.category)}</code>${d.source?.code?`<span class="field-name">Источник: ${esc(d.source.namespace)} / ${esc(d.source.code)}</span>`:''}</td><td><code>${esc(d.service)}</code><span class="field-name">${esc(d.targetNamespace||'Не указан')}</span>${d.targetCode?`<a href="${href('entities',{q:d.targetCode})}"><code>${esc(d.targetCode)}</code></a>`:'<span class="field-name">Код цели пуст</span>'}</td><td>${solution(d.ownerCode)?`<a href="${href('solution/'+encodeURIComponent(d.ownerCode))}">${esc(d.ownerCode)}</a>`:esc(d.ownerCode||'Внутренняя / системная')}</td><td>${badge(label,tone)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function dependencyGraph(s) {
  const groups = new Map();
  for (const d of (s.dependencies||[]).filter(d=>d.category==='dependencies')) {
    const key=d.ownerCode||d.targetNamespace||'Не указан';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);
  }
  const nodes=[...groups].slice(0,9), height=Math.max(190,nodes.length*66+30), sourceY=height/2-25;
  if(!nodes.length)return `<div class="callout"><strong>Внешние зависимости не объявлены</strong><p>В package.dependencies нет внешних связей. Это не доказывает отсутствия динамических вызовов из scripts.</p></div>`;
  return `<div class="panel" style="overflow:auto;padding:15px"><svg viewBox="0 0 850 ${height}" style="width:100%;height:auto;min-width:630px;display:block" role="img" aria-label="Объявленные внешние связи решения ${esc(s.code)}">
    ${nodes.map(([name,ds],i)=>`<path d="M310 ${sourceY+25} C400 ${sourceY+25},400 ${i*66+41},490 ${i*66+41}" stroke="#d6e1d2" stroke-width="1.4" fill="none"/>`).join('')}
    <rect x="20" y="${sourceY}" width="290" height="65" rx="8" fill="#234a35"/><text x="38" y="${sourceY+24}" fill="#fff" font-size="13">${esc(s.code)}</text><text x="38" y="${sourceY+45}" fill="#acc7ad" font-size="10">${activeServer} · текущий package</text>
    ${nodes.map(([name,ds],i)=>{const target=solution(name), available=target?.status==='editable';return `<a href="${target?href('solution/'+encodeURIComponent(name)):href('entities',{q:name})}"><rect x="490" y="${i*66+16}" width="340" height="51" rx="6" fill="${available?'#f4f8ee':'#fff7e7'}" stroke="${available?'#d8e4cd':'#e9d9b7'}"/><circle cx="507" cy="${i*66+34}" r="3" fill="${available?'#669957':'#c7a15c'}"/><text x="519" y="${i*66+37}" fill="#466240" font-size="11">${esc(name.length>43?name.slice(0,40)+'…':name)}</text><text x="519" y="${i*66+54}" fill="#82957a" font-size="9">${ds.length} объявленных связей · ${available?'export поставщика доступен':'поставщик требует проверки'}</text></a>`;}).join('')}</svg></div><p class="dep-note">Показаны ${nodes.length} из ${groups.size} внешних поставщиков. Наличие export поставщика не доказывает разрешение каждой цели или совместимость version history.</p>`;
}
function dependencyMap() {
  const available=server().solutions.filter(s=>s.status==='editable'), selected=solution(filters.solution)||available.find(s=>s.code==='example_solution')||available[0];
  if(!selected)return `${breadcrumbs('Карта зависимостей')}<h1>Карта зависимостей</h1>${empty('Загрузите читаемое решение для построения связей.')}<a href="#/upload">Загрузить .e365</a>`;
  filters.solution=selected.code;
  const deps=(selected.dependencies||[]).filter(d=>!filters.q||[d.category,d.service,d.targetNamespace,d.targetCode,d.ownerCode,d.source?.namespace,d.source?.code].join(' ').toLowerCase().includes(filters.q.toLowerCase()));
  const pag=paginate(deps,25);
  return `${breadcrumbs('Карта зависимостей','Конфигурация')}${heading('Связи конфигурации · '+activeServer,'Карта зависимостей','Объявленные ссылки package: кто использует объект, где находится цель и какой export её предоставляет.')}${filterControls({modules:false,services:false})}${dependencyGraph(selected)}<div class="status-row">${Object.entries(selected.dependencyCounts||{}).map(([k,n])=>badge(k+' · '+n)).join('')}</div><div class="result-caption"><span>${pag.caption} зависимостей</span><a href="#/article/dependencies">Как строить полный план</a></div>${pag.items.length?dependencyTable(pag.items):empty()}${pag.nav}<div class="callout"><strong>Структурный граф — не разрешение на deployment</strong><p>Портал показывает metadata. Для набора packages одного сервера выполните локальный plan, проверьте duplicate providers, cycles, версии и реальную конфигурацию target.</p></div>${footer()}`;
}
function comparison() {
  const keys=Object.keys(data.servers), l=data.servers[filters.left]?filters.left:keys[0], r=data.servers[filters.right]?filters.right:keys[1]||keys[0];
  const codes=[...new Set([...data.servers[l].solutions,...data.servers[r].solutions].map(x=>x.code))];
  const code=filters.solution||codes[0]||'', left=data.servers[l].entities.filter(e=>e.solution===code), right=data.servers[r].entities.filter(e=>e.solution===code);
  const key=e=>[e.service,e.namespace,e.code].join('|'), lm=new Map(left.map(e=>[key(e),e])), rm=new Map(right.map(e=>[key(e),e]));
  const rows=[...left.filter(e=>!rm.has(key(e))).map(e=>({e,type:'Только '+l})),...right.filter(e=>!lm.has(key(e))).map(e=>({e,type:'Только '+r})),...left.filter(e=>{const b=rm.get(key(e));return b&&JSON.stringify([e.fields,e.functions,e.lifecycle,e.dataBinding,e.variableUsage])!==JSON.stringify([b.fields,b.functions,b.lifecycle,b.dataBinding,b.variableUsage]);}).map(e=>({e,type:'Структурные различия'}))];
  const pag=paginate(rows,30);
  return breadcrumbs('Сравнение окружений')+heading('Структурный индекс','Сравнение окружений','Сопоставление по service + namespace + code; код и значения не сравниваются.')+'<div class="filters"><select id="filter-left" aria-label="Первое окружение">'+options(keys,l,'Первое окружение')+'</select><select id="filter-right" aria-label="Второе окружение">'+options(keys,r,'Второе окружение')+'</select><select id="filter-solution" aria-label="Сравниваемое решение">'+options(codes,code,'Решение')+'</select></div>'+(pag.items.length?'<div class="table-wrap"><table><thead><tr><th>Объект</th><th>Namespace</th><th>Отличие</th></tr></thead><tbody>'+pag.items.map(({e,type})=>'<tr><td><a data-switch-server="'+esc(e.server)+'" href="'+href('entity/'+encodeURIComponent(e.id))+'">'+esc(e.name||e.code)+'</a></td><td>'+esc(e.namespace)+'</td><td>'+esc(type)+'</td></tr>').join('')+'</tbody></table></div>':empty('Структурных различий нет либо конфигурация ещё не загружена.'))+pag.nav+footer();
}
function uploadPage() {
  const showcase=location.pathname.includes('/p/showcase/');
  return breadcrumbs('Загрузка конфигурации')+heading('Локальный разбор','Загрузить .e365','Несколько решений одного окружения. Повторный code заменяет предыдущую версию решения.')+(showcase?'<div class="callout"><strong>Синтетическая демонстрация</strong><p>Чтобы загрузить свою конфигурацию, создайте личный портал в кабинете.</p><a href="/dashboard">Перейти в кабинет</a></div>':'<div class="panel"><label>Код окружения<input class="upload-input" id="import-server" value="'+esc(activeServer)+'" maxlength="64" aria-label="Код окружения"></label><label>Файлы .e365<input class="upload-input" id="import-files" type="file" accept=".e365" multiple aria-label="Файлы e365"></label><button class="import-button" data-action="import-config">Разобрать конфигурацию</button><div id="import-result" role="status" aria-live="polite"></div></div>')+'<p class="hint-line">Архивы читаются в памяти. Сохраняется только структурный индекс. Конфигурация исходной платформы не изменяется.</p>'+footer();
}
async function awaitUpload() {
 const input=$('#import-files'), key=$('#import-server')?.value.trim(), button=$('[data-action="import-config"]'), result=$('#import-result');
 if(!input?.files.length){toast('Выберите .e365');return;} button.disabled=true;result.textContent='Разбор…';
 try {
  const messages=[];
  for(const file of input.files){const response=await fetch('./api/import?server='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Elma-Wiki-Import':'1'},body:file});const report=await response.json();if(!response.ok)throw Error(report.error||'Ошибка разбора');messages.push(report.code+': '+report.entities+' объектов; '+report.fields+' полей; '+report.functions+' функций. '+(report.warnings||[]).join(' '));}
  data=await (await fetch('./data.json')).json();activeServer=key;searches.clear();result.textContent=messages.join('\n');toast('Каталог обновлён');
 } catch(error){result.textContent=error.message;} finally{button.disabled=false;}
}
function notFound(message='Запрошенная страница не найдена.') {return `${breadcrumbs('Страница не найдена')}<h1>Ничего не найдено</h1><p class="lead">${esc(message)}</p><a href="#/overview">Вернуться к обзору проекта →</a>${footer()}`;}
function render({keepScroll=false}={}) {
  const scroll=window.scrollY, sidebarScroll=$('.sidebar-nav')?.scrollTop||0;
  const r=route(); shell();
  const pages={overview,solutions:solutionsPage,structure,entities:entityCatalog,fields:fieldsIndex,functions:functionsIndex,'dependency-map':dependencyMap,comparison,upload:uploadPage};
  const content = r.parts[0]==='article'?articlePage(r.parts[1]):r.parts[0]==='entity'?entityPage(r.parts[1]):r.parts[0]==='solution'?solutionPage(r.parts[1]):pages[r.parts[0]]?.()||notFound();
  $('#main').innerHTML=content;
  $('.sidebar-nav').scrollTop=sidebarScroll;
  document.title=($('#main h1')?.textContent||'Проект')+' · ELMA365 Вики';
  if (keepScroll)window.scrollTo(0,scroll);else window.scrollTo(0,0);
  if(r.params.section)setTimeout(()=>$('#section-'+r.params.section)?.scrollIntoView(),0);
}
function applyRoute() {filters={...route().params};currentPage=1;render();}
function refreshCatalog() {
  const cursor=$('#catalog-query')?.selectionStart, focus=document.activeElement?.id;
  const params=Object.fromEntries(Object.entries(filters).filter(([k,v])=>v));
  history.replaceState(null,'',href(route().parts.join('/'),params));
  currentPage=1;render({keepScroll:true});
  if(focus==='catalog-query') {$('#catalog-query')?.focus();$('#catalog-query')?.setSelectionRange(cursor,cursor);}
}
function searchResults(query) {
  const q=query.trim().toLowerCase(), words=q.split(/\s+/).filter(Boolean);
  const docs=articles.filter(a=>words.every(w=>articlesText.get(a.id).includes(w))).sort((a,b)=>Number(b.title.toLowerCase().includes(q))-Number(a.title.toLowerCase().includes(q))).slice(0,q?6:5);
  const entities=q?server().entities.filter(e=>words.every(w=>searchString(e).includes(w))).sort((a,b)=>Number((b.code||'').toLowerCase().includes(q))-Number((a.code||'').toLowerCase().includes(q))).slice(0,30):[];
  return {docs,entities};
}
function updateSearch(query) {
  const {docs,entities}=searchResults(query), target=$('#search-results'); if(!target)return;
  target.innerHTML=(docs.length?'<div class="search-group-label">Статьи и процедуры</div>':'')+docs.map(a=>`<a class="search-result" href="#/article/${a.id}">${icon('book')}<div><strong>${esc(a.title)}</strong><small>${esc(a.lead)}</small></div>${badge(a.time)}</a>`).join('')+(entities.length?`<div class="search-group-label">Сущности · ${activeServer}</div>`:'')+entities.map(e=>`<a class="search-result" href="${href('entity/'+encodeURIComponent(e.id))}">${icon(e.service==='widgets'?'code':'file')}<div><strong>${esc(e.name||e.code)}</strong><small>${esc(e.namespace)} / ${esc(e.code)} · ${esc(e.solution)}</small></div>${badge(service(e.service).label)}</a>`).join('')||'<div class="search-empty">Совпадений нет. Попробуйте код поля, функцию или namespace.</div>';
  searchSelected=0;target.querySelector('.search-result')?.classList.add('selected');
}
function openSearch() {
  if($('#search-dialog'))return;
  const div=document.createElement('div');div.id='search-dialog';div.className='modal-backdrop';
  div.innerHTML=`<section class="search-modal" role="dialog" aria-modal="true" aria-label="Поиск по вики"><div class="modal-input-wrap">${icon('search')}<input id="global-search" placeholder="Статья, поле, функция, модуль…" aria-label="Поисковый запрос" autocomplete="off"><button data-action="search-close">Esc</button></div><div class="search-results" id="search-results"></div><div class="search-help"><span><kbd>↑</kbd><kbd>↓</kbd>выбор <kbd>Enter</kbd>открыть</span><span>Структурный индекс · ${activeServer}</span></div></section>`;
  document.body.append(div);updateSearch('');$('#global-search').focus();document.body.style.overflow='hidden';
}
function closeSearch() {$('#search-dialog')?.remove();document.body.style.overflow='';$('.search-trigger')?.focus();}
document.addEventListener('click',event=>{
  const el=event.target.closest('button,a,[data-action]');
  if(!el){if(event.target.id==='search-dialog')closeSearch();return;}
  if(el.dataset.switchServer&&data.servers[el.dataset.switchServer]){activeServer=el.dataset.switchServer;localStorage.setItem('elma-wiki-server',activeServer);if(location.hash===el.getAttribute('href'))applyRoute();}
  if(el.dataset.detailTab)detailTab=el.dataset.detailTab;
  if(el.matches('.search-result'))closeSearch();
  if(el.dataset.copy){copy(el.dataset.copy);return;}
  if(el.matches('.copy')){copy(el.closest('.codeblock').querySelector('code').textContent);return;}
  if(el.dataset.section){event.preventDefault();$('#section-'+el.dataset.section)?.scrollIntoView();return;}
  if(el.dataset.page){currentPage=Number(el.dataset.page);render({keepScroll:true});return;}
  if(el.dataset.tab){detailTab=el.dataset.tab;render({keepScroll:true});return;}
  const action=el.dataset.action;
  if(action==='import-config')awaitUpload();
  if(action==='reload')location.reload();
  if(action==='search')openSearch();
  if(action==='search-close')closeSearch();
  if(action==='copy-link')copy(location.href);
  if(action==='print')window.print();
  if(action==='menu'){$('.sidebar').classList.toggle('open');$('.mobile-scrim').classList.toggle('open');}
  if(action==='menu-close'){$('.sidebar').classList.remove('open');$('.mobile-scrim').classList.remove('open');}
});
document.addEventListener('change',event=>{
  const id=event.target.id;
  if(id==='server-select') {activeServer=event.target.value;localStorage.setItem('elma-wiki-server',activeServer);filters={};currentPage=1;detailTab='fields';if(route().parts[0]==='entity'){location.hash='#/entities';}else{history.replaceState(null,'',href(route().parts.join('/')));render();}}
  if(id.startsWith('filter-')){filters[id.replace('filter-','')]=event.target.value;refreshCatalog();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='catalog-query'){filters.q=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(refreshCatalog,170);}
  if(event.target.id==='global-search') {clearTimeout(searchTimer);searchTimer=setTimeout(()=>updateSearch(event.target.value),100);}
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();return;}
  const dialog=$('#search-dialog');
  if(event.key==='Escape'){if(dialog)closeSearch();$('.sidebar')?.classList.remove('open');$('.mobile-scrim')?.classList.remove('open');}
  if(!dialog)return;
  const results=[...dialog.querySelectorAll('.search-result')];
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();searchSelected=(searchSelected+(event.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length);results.forEach((r,i)=>r.classList.toggle('selected',i===searchSelected));results[searchSelected]?.scrollIntoView({block:'nearest'});}
  if(event.key==='Enter'&&document.activeElement?.id==='global-search'){event.preventDefault();results[searchSelected]?.click();}
  if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('input,button,a')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
window.addEventListener('hashchange',()=>{closeSearchIfOpen();applyRoute();});
function closeSearchIfOpen(){if($('#search-dialog'))closeSearch();}
try {
  const response=await fetch('./data.json');if(!response.ok)throw Error('Не удалось загрузить структурный индекс.');
  data=await response.json();if(!data.servers[activeServer])activeServer=Object.keys(data.servers)[0];applyRoute();
} catch(error){$('#app').innerHTML=`<div class="initial-loading"><div class="brand-mark">E</div><h2>Не удалось открыть вики</h2><p>${esc(error.message)}</p><p>Откройте портал через HTTP-сервер, а не как файл file://.</p><button data-action="reload">Повторить загрузку</button></div>`;}


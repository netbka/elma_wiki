import { articles } from './articles.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const main = document.getElementById('main'), id = location.pathname.split('/')[2], privateProject = !['showcase','local'].includes(id);
let data, searchQuery = '';
const api = async (action,options={}) => {
  const response = await fetch('/api/projects/'+id+(action ? '/'+action : ''),{...options,headers:{'X-Elma-Wiki-Request':'1',...options.headers}});
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Ошибка запроса'); return value;
};
const link = (route,label,cls='') => `<a class="${cls}" href="#/${route}">${esc(label)}</a>`;
const back = () => `<div class="actions">${link('','← К задачам')} ${link('objects','Объекты')} ${link('files','Файлы')} ${link('guides','Инструкции')} ${link('report','Отчёт разбора' + (data.diagnosticCount ? ' ('+data.diagnosticCount+')' : ''))} <a href="/dashboard">← Мои проекты</a></div>`;
const badge = status => `<span class="badge">${esc(status)}</span>`;
const tasks = {
  field:{title:'Найти поле',lead:'Ищите по коду поля, названию объекта или контексту переменной.',guide:'field-form-recipe'},
  handler:{title:'Изменить обработчик',lead:'Ищите по имени функции. Проверьте клиентский и серверный контекст, исходник и сборку.',guide:'script-roundtrip'},
  update:{title:'Подготовить обновление',lead:'Проверьте происхождение пакета, зависимости и совместимость целевой компании.',guide:'file-update'}
};
function table(headers,rows) { return `<div class="scroll"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function objectRows(entities) { return entities.map(e => link('object/'+encodeURIComponent(e.id),e.name || e.code,'entity-row').replace('</a>',`<small>${esc(e.service)} / ${esc(e.namespace)} / ${esc(e.code)} · ${(e.fields || []).length} полей · ${(e.functions || []).length} функций</small></a>`)).join('') || '<p>Подходящих объектов нет. Проверьте файлы и отчёт разбора.</p>'; }
function searchPanel(title,lead) {
  main.innerHTML = back()+`<h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p><label for="search">Код, имя или путь</label><input id="search" type="search" placeholder="Например: title, onOpen, request_form"><p id="search-count" role="status"></p><div id="results"></div>`;
  const render = () => {
    const query = document.getElementById('search').value.toLowerCase().trim();
    const rows = data.entities.filter(e => JSON.stringify([e.name,e.code,e.namespace,e.service,e.archivePath,...(e.fields || []).map(f => [f.code,f.name,f.origin]),...(e.functions || [])]).toLowerCase().includes(query));
    document.getElementById('results').innerHTML=objectRows(rows); document.getElementById('search-count').textContent=`Найдено объектов: ${rows.length}`;
  };
  document.getElementById('search').value=searchQuery;
  document.getElementById('search').oninput=() => { searchQuery=document.getElementById('search').value; render(); }; render();
}
async function preview(path) {
  const target = document.getElementById('preview'); target.textContent='Загрузка…';
  try { const result = await api('preview?path='+encodeURIComponent(path)); target.textContent=result.text === null ? 'Двоичный файл: используйте скачивание оригинала.' : result.text + (result.truncated ? '\n… Предпросмотр ограничен 256 КБ.' : ''); }
  catch(e) { target.textContent=e.message; }
}
async function render() {
  const [kind,arg] = location.hash.replace(/^#\//,'').split('/');
  if (!kind) main.innerHTML = `<div class="eyebrow">${data.synthetic ? 'Синтетический пример' : 'Приватный проект'}</div><h1>Что нужно сделать?</h1><p class="lead">${esc(data.solution?.name || data.solution?.code || 'Карта загруженного файла')}</p>${data.legacy ? '<div class="note">Прежний формат. Оригинал не сохранялся; повторный разбор недоступен. Загрузите .e365 как отдельный проект.</div>' : ''}<div class="grid">${Object.entries(tasks).map(([key,t],n) => `<a class="card task" href="#/task/${key}"><span class="number">0${n+1}</span><h2>${esc(t.title)}</h2><p>${esc(t.lead)}</p></a>`).join('')}</div>${back()}<p>${badge(data.coverage)} · ${data.entities.length} объектов · ${esc(data.parserVersion || 'прежний парсер')}</p><p class="muted">Карта отражает один файл. Зависимости между разными проектами не разрешаются.</p>`;
  else if (kind === 'objects') searchPanel('Объекты конфигурации','Поиск по объектам, полям и функциям этого файла.');
  else if (kind === 'task') {
    const task = tasks[arg]; if (!task) { location.hash='#/'; return; }
    if (arg === 'update') main.innerHTML=back()+`<h1>${esc(task.title)}</h1><p class="lead">${esc(task.lead)}</p>${link('article/file-update','Открыть порядок обновления','button')}<h2>Происхождение файла</h2>${table(['Свойство','Значение','Источник'],Object.entries(data.provenance || {}).map(([key,row]) => [esc(key),esc(row.value ?? 'Не определено'),esc(row.source)]))}<p>isAuthor относится к компании, из которой экспортирован файл. Свойства целевого сервера неизвестны.</p><h2>Объявленные зависимости</h2>${table(['Сервис','Цель','Статус','Источник'],(data.solution?.dependencies || []).map(d => [esc(d.service),esc([d.targetNamespace,d.targetCode].filter(Boolean).join('/')),esc(d.status),esc(d.provenance || 'package.json')]))}<p>present-in-file означает найденную структурную цель внутри файла; это не проверка установки или выполнения.</p>`;
    else { searchPanel(task.title,task.lead); document.getElementById('results').insertAdjacentHTML('beforebegin',`<p>${link('article/'+task.guide,'Инструкция по изменению')}</p>`); }
  } else if (kind === 'object') {
    const e = data.entities.find(e => e.id === decodeURIComponent(arg || '')); if (!e) { main.innerHTML=back()+'<h1>Объект не найден</h1>'; return; }
    const source = e.archivePath || e.provenance?.source;
    const editable = privateProject && !data.legacy && e.service === 'widgets' && e.kind === 'WIDGET' && e.coverage === 'structural';
    main.innerHTML = back()+`<p>${link('objects','← К результатам поиска')}</p><h1>${esc(e.name || e.code)}</h1><p><code>${esc(e.service)} / ${esc(e.namespace)} / ${esc(e.code)}</code></p><p>Файл: <code>${esc(source || 'Путь доступен в полном оригинале')}</code></p>${source && privateProject && !data.legacy ? '<button id="show-source" class="secondary">Посмотреть исходный текст</button><pre id="preview" class="hidden"></pre>' : ''}<h2>Поля и переменные</h2>${table(['Код','Тип','Контекст','Источник'],(e.fields || []).map(f => [esc(f.code),esc(f.type),esc(f.origin),esc(f.source || source)]))}<h2>Функции и обработчики</h2>${table(['Функция','Сторона','Источник'],(e.functionSources || []).map(f => [esc(f.name),esc(f.side),esc(f.path)]))}<h2>Обнаруженные обращения</h2>${table(['Переменная','Количество'],Object.entries(e.variableUsage || {}).map(([name,count]) => [esc(name),esc(count)]))}<p class="muted">Текстовый поиск не разрешает динамические обращения. Привязки события проверьте в lifecycle и descriptor.template.</p>${e.coverage === 'unknown' ? '<div class="note">Неизвестный сервис: поля и функции не интерпретируются. Смотрите оригинал и отчёт.</div>' : ''}<h2>Следующий шаг</h2><div class="actions">${link('article/field-form-recipe','Поле и форма')} ${link('article/script-roundtrip','Изменить скрипт')} ${link('article/file-update','Проверка обновления')}</div><details><summary>Структурные сведения объекта</summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details>`;
    if (document.getElementById('show-source')) document.getElementById('show-source').onclick=() => { document.getElementById('preview').classList.remove('hidden'); preview(source); };
    if (editable) document.getElementById('show-source').insertAdjacentHTML('beforebegin',`<p><a class="button" href="/workspace/${encodeURIComponent(id)}/${encodeURIComponent(e.id)}">Открыть редактор скриптов</a> <span class="badge">Экспериментально · без публикации</span></p>`);
  } else if (kind === 'files') {
    main.innerHTML=back()+`<h1>Файлы пакета</h1><p>Пути принадлежат архиву. Исходный код отображается как текст и не выполняется.</p>${table(['Путь','Байты','Индекс','Просмотр'],(data.inventory || []).map((f,n) => [esc(f.path),esc(f.size),esc(f.indexed ? 'Частично прочитан' : 'Сохранён'),privateProject && !data.legacy ? `<button class="secondary file-preview" data-index="${n}">Текст</button>` : 'Учебный пример']))}<pre id="preview" class="hidden"></pre>`;
    document.querySelectorAll('.file-preview').forEach(button => button.onclick=() => { document.getElementById('preview').classList.remove('hidden'); preview(data.inventory[Number(button.dataset.index)].path); });
  } else if (kind === 'report') {
    const report = privateProject && !data.legacy ? await api('report') : {status:data.coverage,counts:{},diagnostics:[],parserVersion:data.parserVersion || 'legacy'};
    main.innerHTML=back()+`<h1>Отчёт разбора</h1><p>${badge(report.status)} · парсер ${esc(report.parserVersion)} · замечаний: ${(report.diagnostics || []).length}</p><p>Оригинальные байты сохранены для нового проекта. Структурный индекс не заменяет полную конфигурацию. Неизвестные части не означают пустые данные.</p>${table(['Часть','Статус','Причина','JSON pointer'],(report.diagnostics || []).map(d => [esc(d.path),esc(d.status),esc(d.reason),esc(d.pointer || '')]))}${privateProject && !data.legacy ? `<div class="actions"><a class="button secondary" href="/api/projects/${id}/original">Скачать оригинал</a><button id="reparse">Повторить разбор</button><button id="delete" class="secondary">Удалить проект</button><button id="summary" class="secondary">Диагностика без содержимого</button></div><p id="operation-status" role="status"></p><pre id="diagnostic-summary" class="hidden"></pre>` : '<div class="note">Для прежнего портала исходный архив отсутствует. В учебном примере используются синтетические данные.</div>'}`;
    const operation = document.getElementById('operation-status');
    if (document.getElementById('reparse')) document.getElementById('reparse').onclick=async () => { try { await api('reparse',{method:'POST'}); location.reload(); } catch(e) { operation.textContent=e.message; } };
    if (document.getElementById('delete')) document.getElementById('delete').onclick=async () => { if (!confirm('Удалить проект вместе с оригиналом и индексами?')) return; try { await api('',{method:'DELETE'}); location.href='/dashboard'; } catch(e) { operation.textContent=e.message; } };
    if (document.getElementById('summary')) document.getElementById('summary').onclick=async () => { const target = document.getElementById('diagnostic-summary'); target.classList.remove('hidden'); target.textContent=JSON.stringify(await api('diagnostic-summary'),null,2); };
  } else if (kind === 'guides') main.innerHTML=back()+`<h1>Инструкции разработчика</h1><div class="grid">${articles.map(a => `<a class="card task" href="#/article/${a.id}"><h2>${esc(a.title)}</h2><p>${esc(a.lead)}</p>${badge(a.status || 'Руководство')}</a>`).join('')}</div>`;
  else if (kind === 'article') {
    const a = articles.find(a => a.id === arg); if (!a) { main.innerHTML=back()+'<h1>Инструкция не найдена</h1>'; return; }
    main.innerHTML=back()+`<article class="article"><div class="eyebrow developer-entry">${esc(a.group || 'Разработка')}</div><h1>${esc(a.title)}</h1><p class="lead">${esc(a.lead)}</p>${badge(a.status || 'Руководство')}${a.sections.map(s => `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.body}</section>`).join('')}</article>`;
  } else { location.hash='#/'; return; }
  document.querySelectorAll('.copy').forEach(button => button.onclick=async () => { await navigator.clipboard.writeText(button.closest('.codeblock').querySelector('code').textContent); button.textContent='Скопировано'; });
}
async function start() {
  const response = await fetch('./data.json'); if (!response.ok) throw Error('Проект недоступен'); data=await response.json();
  window.addEventListener('hashchange',() => render().catch(error => main.textContent=error.message)); await render();
}
start().catch(error => main.textContent=error.message);

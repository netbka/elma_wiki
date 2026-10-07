import { renderLogin } from './login-view.js';
const $ = id => document.getElementById(id);
const status = message => { if ($('status')) $('status').textContent = message; };
const request = async (url,options={}) => {
  const response = await fetch(url,{...options,headers:{'X-Elma-Wiki-Request':'1',...options.headers}});
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Запрос не завершён'); return value;
};
async function init() {
  if (location.pathname === '/' && (await request('/api/session')).user) { location.replace('/solutions'); return; }
  if (location.pathname === '/login') {
    const session = await request('/api/session');
    if (session.user) { location.replace('/solutions'); return; }
    renderLogin($('bot-login'), { vkBotUrl: session.vkBotUrl, expired: new URLSearchParams(location.search).has('expired') });
  }
  if (location.pathname !== '/dashboard') return;
  const rows = await request('/api/projects'); $('projects').replaceChildren();
  if (!rows.length) $('projects').textContent='Проектов пока нет. Начните с загрузки файла.';
  for (const row of rows) {
    const card = document.createElement('article'); card.className='card';
    const title = document.createElement('h2'); title.textContent=row.filename;
    const detail = document.createElement('p'); detail.textContent=row.legacy ? 'Прежний формат · оригинал отсутствует' : `${row.entities} объектов · ${row.coverage} · парсер ${row.parserVersion}`;
    const time = document.createElement('p'); time.className='muted'; time.textContent=row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : '';
    const link = document.createElement('a'); link.href='/p/'+row.id+'/'; link.className='button secondary'; link.textContent='Открыть проект';
    card.append(title,detail,time,link); $('projects').append(card);
  }
  $('logout').onclick = async () => { await request('/auth/logout',{method:'POST'}); location.href='/'; };
  $('upload').onsubmit = async event => {
    event.preventDefault(); const file = $('file').files[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.e365')) return status('Выберите файл .e365');
    const button = event.currentTarget.querySelector('button'); button.disabled=true; status('Сохраняем оригинал и строим карту…');
    try {
      const project = await request('/api/projects?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      location.href='/p/'+project.id+'/';
    } catch(e) { status(e.message); button.disabled=false; }
  };
}
init().catch(e => status(e.message));

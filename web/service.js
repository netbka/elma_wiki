const $ = id => document.getElementById(id);
const status = message => { if ($('status')) $('status').textContent = message; };
const request = async (url,options={}) => {
  const response = await fetch(url,{...options,headers:{'X-Elma-Wiki-Request':'1',...options.headers}});
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Запрос не завершён'); return value;
};
async function init() {
  if (location.pathname === '/login') {
    const session = await request('/api/session');
    $('local-login-card').classList.toggle('hidden',!session.localEnabled);
    $('email-login-card').classList.toggle('hidden',!session.emailConfigured);
    $('vk-login-card').classList.toggle('hidden',!session.vkConfigured);
    $('auth-setup').classList.toggle('hidden',session.emailConfigured || session.vkConfigured || session.localEnabled);
    if (session.vkBotUrl) { $('vk-bot-link').href=session.vkBotUrl; $('vk-bot-link').classList.remove('hidden'); }
    $('vk-request').onsubmit = async event => {
      event.preventDefault(); $('send-vk').disabled=true; status('Отправляем код в VK Teams…');
      try {
        const result=await request('/auth/vk/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:$('vk-login').value})});
        status(result.message); $('vk-key').focus();
        let seconds=60;
        const timer=setInterval(()=>{ seconds--; $('send-vk').textContent=seconds>0 ? `Повторно через ${seconds} с` : 'Получить код в VK Teams'; if(seconds<=0) {clearInterval(timer);$('send-vk').disabled=false;} },1000);
      } catch(e) {status(e.message);$('send-vk').disabled=false;}
    };
    $('vk-verify').onsubmit = async event => {
      event.preventDefault(); if(!$('vk-login').reportValidity()) return;
      $('verify-vk').disabled=true; status('Проверяем код…');
      try {await request('/auth/vk/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:$('vk-login').value,key:$('vk-key').value})});location.href='/dashboard';}
      catch(e) {status(e.message);$('verify-vk').disabled=false;}
    };
    $('send-key').disabled = $('verify-key').disabled = !session.emailConfigured;
    $('email-request').onsubmit = async event => {
      event.preventDefault(); $('send-key').disabled = true;
      status('Отправляем ключ…');
      try {
        const result = await request('/auth/email/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value})});
        status(result.message + '. Проверьте также папку «Спам».'); $('key').focus();
        let seconds = 60;
        const timer = setInterval(() => { seconds--; $('send-key').textContent = seconds > 0 ? `Отправить повторно через ${seconds} с` : 'Отправить ключ повторно'; if (seconds <= 0) { clearInterval(timer); $('send-key').disabled = false; } },1000);
      } catch(e) { status(e.message); $('send-key').disabled = false; }
    };
    $('email-verify').onsubmit = async event => {
      event.preventDefault();
      if (!$('email').reportValidity()) return;
      $('verify-key').disabled = true; status('Проверяем ключ…');
      try { await request('/auth/email/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,key:$('key').value})}); location.href='/dashboard'; }
      catch(e) { status(e.message); $('verify-key').disabled = false; }
    };
    $('local-login').onclick = async () => { try { await request('/auth/local',{method:'POST'}); location.href='/dashboard'; } catch(e) { status(e.message); } };
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
